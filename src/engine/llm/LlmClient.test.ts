import { describe, expect, it, vi } from 'vitest';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import { BrowserLlmClient, LlmEmptyContentError } from './LlmClient';

const makeConfig = (overrides: Partial<ApiConfigArchive> = {}): ApiConfigArchive => ({
  id: 'api_1',
  name: 'test api',
  provider: 'openai_compatible',
  baseUrl: 'https://example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
  maxOutputTokens: 2048,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

async function observeSettlement<T>(promise: Promise<T>, waitMs = 25): Promise<
  | { status: 'resolved'; value: T }
  | { status: 'rejected'; reason: unknown }
  | { status: 'pending' }
> {
  return Promise.race([
    promise.then(
      (value) => ({ status: 'resolved' as const, value }),
      (reason) => ({ status: 'rejected' as const, reason }),
    ),
    new Promise<{ status: 'pending' }>((resolve) => {
      setTimeout(() => resolve({ status: 'pending' }), waitMs);
    }),
  ]);
}

function makeHangingBodyResponse(): Response {
  return new Response(new ReadableStream({ start() {} }), { status: 200 });
}

function makeFailingReaderResponse(error: Error): {
  response: Response;
  cancel: ReturnType<typeof vi.fn>;
  releaseLock: ReturnType<typeof vi.fn>;
} {
  const cancel = vi.fn(async () => undefined);
  const releaseLock = vi.fn();
  const reader = {
    read: vi.fn(async () => {
      throw error;
    }),
    cancel,
    releaseLock,
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
  const response = {
    ok: true,
    status: 200,
    body: {
      getReader: () => reader,
    },
  } as unknown as Response;
  return { response, cancel, releaseLock };
}

describe('BrowserLlmClient', () => {
  it('does not call fetch when the external signal is already aborted', async () => {
    const fetchImpl = vi.fn();
    const client = new BrowserLlmClient(fetchImpl);
    const controller = new AbortController();
    const cancellation = new Error('external cancellation');
    controller.abort(cancellation);

    await expect(client.generate({
      config: makeConfig(),
      messages: [{ role: 'user', content: 'user prompt' }],
      signal: controller.signal,
    })).rejects.toBe(cancellation);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('aborts an in-flight request when the external signal is cancelled', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));
    const client = new BrowserLlmClient(fetchImpl);
    const controller = new AbortController();
    const cancellation = new Error('session changed');

    const request = client.generate({
      config: makeConfig(),
      messages: [{ role: 'user', content: 'user prompt' }],
      signal: controller.signal,
    });
    controller.abort(cancellation);

    await expect(request).rejects.toBe(cancellation);
    const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(fetchCalls[0][1].signal).toBe(controller.signal);
  });

  it('does not report an external cancellation as an API timeout', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      }));
      const client = new BrowserLlmClient(fetchImpl);
      const controller = new AbortController();
      const cancellation = new Error('save session invalidated');

      const request = client.generate({
        config: makeConfig(),
        messages: [{ role: 'user', content: 'user prompt' }],
        signal: controller.signal,
        timeoutMs: 10_000,
        retryCount: 1,
      });
      controller.abort(cancellation);

      await expect(request).rejects.toBe(cancellation);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps external cancellation active while reading a non-streaming response body', async () => {
    const fetchImpl = vi.fn(async () => makeHangingBodyResponse());
    const client = new BrowserLlmClient(fetchImpl);
    const controller = new AbortController();
    const cancellation = new Error('cancel while reading response text');

    const request = client.generate({
      config: makeConfig(),
      messages: [{ role: 'user', content: 'user prompt' }],
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort(cancellation);

    const outcome = await observeSettlement(request);
    expect(outcome).toEqual({ status: 'rejected', reason: cancellation });
  });

  it('keeps timeout active while reading a non-streaming response body', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async () => makeHangingBodyResponse());
      const client = new BrowserLlmClient(fetchImpl);
      const request = client.generate({
        config: makeConfig(),
        messages: [{ role: 'user', content: 'user prompt' }],
        timeoutMs: 50,
      });
      const observed = request.then(
        (value) => ({ status: 'resolved' as const, value }),
        (reason) => ({ status: 'rejected' as const, reason }),
      );

      await vi.advanceTimersByTimeAsync(50);
      const outcome = await Promise.race([observed, Promise.resolve({ status: 'pending' as const })]);

      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toBeInstanceOf(Error);
        expect((outcome.reason as Error).message).toContain('API 请求超时');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps external cancellation active while reading a streaming response body', async () => {
    const fetchImpl = vi.fn(async () => makeHangingBodyResponse());
    const client = new BrowserLlmClient(fetchImpl);
    const controller = new AbortController();
    const cancellation = new Error('cancel while reading stream');

    const request = client.generate({
      config: makeConfig(),
      messages: [{ role: 'user', content: 'user prompt' }],
      signal: controller.signal,
      onContentDelta: () => undefined,
    });
    await Promise.resolve();
    controller.abort(cancellation);

    const outcome = await observeSettlement(request);
    expect(outcome).toEqual({ status: 'rejected', reason: cancellation });
  });

  it('keeps timeout active while reading a streaming response body', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async () => makeHangingBodyResponse());
      const client = new BrowserLlmClient(fetchImpl);
      const request = client.generate({
        config: makeConfig(),
        messages: [{ role: 'user', content: 'user prompt' }],
        timeoutMs: 50,
        onContentDelta: () => undefined,
      });
      const observed = request.then(
        (value) => ({ status: 'resolved' as const, value }),
        (reason) => ({ status: 'rejected' as const, reason }),
      );

      await vi.advanceTimersByTimeAsync(50);
      const outcome = await Promise.race([observed, Promise.resolve({ status: 'pending' as const })]);

      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toBeInstanceOf(Error);
        expect((outcome.reason as Error).message).toContain('API 请求超时');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { label: 'non-streaming', stream: false },
    { label: 'streaming', stream: true },
  ])('cancels and releases the $label reader after an arbitrary read failure', async ({ stream }) => {
    const readFailure = new Error('response body read failed');
    const { response, cancel, releaseLock } = makeFailingReaderResponse(readFailure);
    const client = new BrowserLlmClient(vi.fn(async () => response));

    const request = client.generate({
      config: makeConfig(),
      messages: [{ role: 'user', content: 'user prompt' }],
      onContentDelta: stream ? () => undefined : undefined,
    });

    await expect(request).rejects.toBe(readFailure);
    expect(cancel).toHaveBeenCalledWith(readFailure);
    expect(releaseLock).toHaveBeenCalledOnce();
  });

  it('aborts OpenAI-compatible generation when request timeout elapses', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('fetch aborted')));
      }));
      const client = new BrowserLlmClient(fetchImpl);

      const request = client.generate({
        config: makeConfig(),
        messages: [{ role: 'user', content: 'user prompt' }],
        timeoutMs: 50,
      });
      const expectation = expect(request).rejects.toThrow('API 请求超时');
      await vi.advanceTimersByTimeAsync(50);

      await expectation;
      const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
      expect(fetchCalls[0][1].signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries once after an unresponsive request timeout and succeeds on the next response', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockImplementationOnce(async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('first request aborted')));
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
        }), { status: 200 }));
      const client = new BrowserLlmClient(fetchImpl);

      const request = client.generate({
        config: makeConfig(),
        messages: [{ role: 'user', content: 'user prompt' }],
        timeoutMs: 50,
        retryCount: 1,
        retryDelayMs: 10,
      });

      await vi.advanceTimersByTimeAsync(60);
      await expect(request).resolves.toMatchObject({ content: '{"ok":true}' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry an HTTP or response-format failure', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'invalid request' },
    }), { status: 400 }));
    const client = new BrowserLlmClient(fetchImpl);

    await expect(client.generate({
      config: makeConfig(),
      messages: [{ role: 'user', content: 'user prompt' }],
      timeoutMs: 50,
      retryCount: 1,
    })).rejects.toThrow('invalid request');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('keeps the browser fetch binding when no custom fetch is injected', async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', function boundFetch(this: unknown) {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }

      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { content: '{"narrativeText":"绑定正常","suggestedActions":[],"statePatch":null}' } }],
      }), { status: 200 }));
    });

    try {
      const client = new BrowserLlmClient();
      const result = await client.generate({
        config: makeConfig(),
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(result.content).toContain('绑定正常');
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('uses the OpenAI-compatible chat completions shape for mainstream compatible providers', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"narrativeText":"AI正文","suggestedActions":[],"statePatch":null}' } }],
      usage: {
        prompt_tokens: 1234,
        completion_tokens: 456,
        total_tokens: 1690,
        prompt_cache_hit_tokens: 1000,
        prompt_cache_miss_tokens: 234,
      },
    }), { status: 200 }));
    const client = new BrowserLlmClient(fetchImpl);

    const result = await client.generate({
      config: makeConfig({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' }),
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
      ],
      responseFormat: 'json_object',
    });

    expect(result.content).toContain('AI正文');
    expect(result.usage).toEqual({
      promptTokens: 1234,
      completionTokens: 456,
      totalTokens: 1690,
      cacheReadTokens: 1000,
      cacheMissTokens: 234,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(fetchCalls[0][1].body));
    expect(body).toMatchObject({
      model: 'test-model',
      max_tokens: 2048,
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
      ],
      response_format: { type: 'json_object' },
    });
  });

  it('keeps GLM structured-output request shaping for the Coding Plan endpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
    }), { status: 200 }));
    const client = new BrowserLlmClient(fetchImpl);

    const result = await client.generate({
      config: makeConfig({
        provider: 'zhipu_coding',
        baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
        model: 'glm-4.5',
      }),
      messages: [{ role: 'user', content: 'structured prompt' }],
      responseFormat: 'json_object',
    });

    const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(fetchCalls[0][0]).toBe('https://open.bigmodel.cn/api/coding/paas/v4/chat/completions');
    expect(JSON.parse(String(fetchCalls[0][1].body))).toMatchObject({
      response_format: { type: 'json_object' },
    });
    expect(result).toMatchObject({ content: '{"ok":true}', finishReason: 'stop' });
  });

  it('uses MiniMax reasoning separation without forcing response_format', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: { reasoning_content: 'internal reasoning', content: '{"ok":true}' },
        finish_reason: 'stop',
      }],
    }), { status: 200 }));
    const client = new BrowserLlmClient(fetchImpl);

    const result = await client.generate({
      config: makeConfig({
        provider: 'minimax',
        baseUrl: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.1',
      }),
      messages: [{ role: 'user', content: 'structured prompt' }],
      responseFormat: 'json_object',
    });

    const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(fetchCalls[0][1].body));
    expect(body).toMatchObject({ reasoning_split: true, max_tokens: 2048 });
    expect(body.response_format).toBeUndefined();
    expect(result).toMatchObject({ content: '{"ok":true}', finishReason: 'stop' });
    expect(result.content).not.toContain('internal reasoning');
  });

  it('normalizes cumulative MiniMax SSE content while ignoring reasoning_content', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"think","content":"{\\"ok\\""}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"thinking","content":"{\\"ok\\":true"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"},"finish_reason":"stop"}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const client = new BrowserLlmClient(vi.fn(async () => new Response(stream, { status: 200 })));
    const deltas: string[] = [];

    const result = await client.generate({
      config: makeConfig({
        provider: 'minimax_international',
        baseUrl: 'https://api.minimax.io/v1',
        model: 'MiniMax-M2.1',
      }),
      messages: [{ role: 'user', content: 'stream prompt' }],
      responseFormat: 'json_object',
      onContentDelta: (delta) => deltas.push(delta),
    });

    expect(deltas).toEqual(['{"ok"', ':true', '}']);
    expect(result).toMatchObject({ content: '{"ok":true}', finishReason: 'stop' });
  });

  it('keeps GLM SSE content incremental and reports its finish reason', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"think","content":"{\\"ok\\""}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":":true}"},"finish_reason":"stop"}]}\n\n'));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => new Response(stream, { status: 200 }));
    const client = new BrowserLlmClient(fetchImpl);
    const deltas: string[] = [];

    const result = await client.generate({
      config: makeConfig({
        provider: 'zhipu',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'glm-4.5',
      }),
      messages: [{ role: 'user', content: 'stream prompt' }],
      responseFormat: 'json_object',
      onContentDelta: (delta) => deltas.push(delta),
    });

    const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(JSON.parse(String(fetchCalls[0][1].body))).toMatchObject({
      response_format: { type: 'json_object' },
    });
    expect(deltas).toEqual(['{"ok"', ':true}']);
    expect(result).toMatchObject({ content: '{"ok":true}', finishReason: 'stop' });
  });

  it('keeps ordinary OpenAI-compatible request and incremental stream semantics unchanged', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"A"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"AB"},"finish_reason":"stop"}]}\n\n'));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => new Response(stream, { status: 200 }));
    const client = new BrowserLlmClient(fetchImpl);

    const result = await client.generate({
      config: makeConfig(),
      messages: [{ role: 'user', content: 'stream prompt' }],
      responseFormat: 'json_object',
      onContentDelta: () => undefined,
    });

    const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(JSON.parse(String(fetchCalls[0][1].body))).toMatchObject({
      response_format: { type: 'json_object' },
    });
    expect(result.content).toBe('AAB');
  });

  it('throws a typed empty-content error with usage for OpenAI-compatible responses', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '' } }],
      usage: { prompt_tokens: 120, completion_tokens: 4, total_tokens: 124 },
    }), { status: 200 }));
    const client = new BrowserLlmClient(fetchImpl);

    const rejection = await client.generate({
      config: makeConfig(),
      messages: [{ role: 'user', content: 'user prompt' }],
    }).then(() => null, (error) => error);

    expect(rejection).toBeInstanceOf(LlmEmptyContentError);
    expect((rejection as Error).message).toBe('API 返回缺少正文内容');
    expect((rejection as LlmEmptyContentError).usage).toEqual({
      promptTokens: 120,
      completionTokens: 4,
      totalTokens: 124,
    });
  });

  it('uses the OpenAI-compatible embeddings shape for memory vector indexing', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { index: 0, embedding: [0.1, 0.2, 0.3] },
        { index: 1, embedding: [0.4, 0.5, 0.6] },
      ],
      usage: { prompt_tokens: 12, total_tokens: 12 },
    }), { status: 200 }));
    const client = new BrowserLlmClient(fetchImpl);

    const result = await client.embed({
      config: makeConfig({ model: 'text-embedding-test' }),
      input: ['first memory', 'second memory'],
    });

    expect(result.embeddings).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    expect(result.usage).toEqual({
      promptTokens: 12,
      totalTokens: 12,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(JSON.parse(String(fetchCalls[0][1].body))).toEqual({
      model: 'text-embedding-test',
      input: ['first memory', 'second memory'],
    });
  });

  it('does not call embedding fetch when the external signal is already aborted', async () => {
    const fetchImpl = vi.fn();
    const client = new BrowserLlmClient(fetchImpl);
    const controller = new AbortController();
    const cancellation = new Error('embedding cancelled before request');
    controller.abort(cancellation);

    await expect(client.embed({
      config: makeConfig({ model: 'text-embedding-test' }),
      input: ['memory'],
      signal: controller.signal,
    })).rejects.toBe(cancellation);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('aborts an in-flight embedding request when the external signal is cancelled', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));
    const client = new BrowserLlmClient(fetchImpl);
    const controller = new AbortController();
    const cancellation = new Error('embedding session invalidated');

    const request = client.embed({
      config: makeConfig({ model: 'text-embedding-test' }),
      input: ['memory'],
      signal: controller.signal,
    });
    controller.abort(cancellation);

    await expect(request).rejects.toBe(cancellation);
    const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(fetchCalls[0][1].signal).toBe(controller.signal);
  });

  it('aborts OpenAI-compatible embedding when request timeout elapses', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('embedding fetch aborted')));
      }));
      const client = new BrowserLlmClient(fetchImpl);

      const request = client.embed({
        config: makeConfig({ model: 'text-embedding-test' }),
        input: ['memory'],
        timeoutMs: 50,
      });
      const expectation = expect(request).rejects.toThrow('API 请求超时');
      await vi.advanceTimersByTimeAsync(50);

      await expectation;
      const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
      expect(fetchCalls[0][1].signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not report external embedding cancellation as an API timeout', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      }));
      const client = new BrowserLlmClient(fetchImpl);
      const controller = new AbortController();
      const cancellation = new Error('embedding user cancellation');

      const request = client.embed({
        config: makeConfig({ model: 'text-embedding-test' }),
        input: ['memory'],
        signal: controller.signal,
        timeoutMs: 10_000,
      });
      controller.abort(cancellation);

      await expect(request).rejects.toBe(cancellation);
      await vi.advanceTimersByTimeAsync(10_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('can stream OpenAI-compatible content deltas before returning the final content', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"{\\"narrativeText\\":\\"流式"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"正文\\"}"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => new Response(stream, { status: 200 }));
    const client = new BrowserLlmClient(fetchImpl);
    const deltas: string[] = [];

    const result = await client.generate({
      config: makeConfig(),
      messages: [{ role: 'user', content: 'user prompt' }],
      onContentDelta: (delta) => deltas.push(delta),
    });

    expect(deltas).toEqual(['{"narrativeText":"流式', '正文"}']);
    expect(result.content).toBe('{"narrativeText":"流式正文"}');
    const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(JSON.parse(String(fetchCalls[0][1].body))).toMatchObject({ stream: true });
  });

  it('keeps the final OpenAI-compatible SSE delta when the provider closes without a blank-line terminator', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"{\\"narrativeText\\":\\"流式正文"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"\\"}"}}]}'));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => new Response(stream, { status: 200 }));
    const client = new BrowserLlmClient(fetchImpl);
    const deltas: string[] = [];

    const result = await client.generate({
      config: makeConfig(),
      messages: [{ role: 'user', content: 'user prompt' }],
      onContentDelta: (delta) => deltas.push(delta),
    });

    expect(deltas).toEqual(['{"narrativeText":"流式正文', '"}']);
    expect(result.content).toBe('{"narrativeText":"流式正文"}');
  });

  it('adds stable prompt-cache routing only for the official OpenAI endpoint', async () => {
    const encoder = new TextEncoder();
    const makeStream = () => new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => new Response(makeStream(), { status: 200 }));
    const client = new BrowserLlmClient(fetchImpl);

    await client.generate({
      config: makeConfig({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-cache-test',
      }),
      messages: [
        { role: 'system', content: 'stable system contract' },
        { role: 'user', content: 'dynamic turn one' },
      ],
      onContentDelta: () => undefined,
    });
    await client.generate({
      config: makeConfig({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-cache-test',
      }),
      messages: [
        { role: 'system', content: 'stable system contract' },
        { role: 'user', content: 'dynamic turn two' },
      ],
      onContentDelta: () => undefined,
    });

    const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const firstBody = JSON.parse(String(fetchCalls[0][1].body));
    const secondBody = JSON.parse(String(fetchCalls[1][1].body));
    expect(firstBody.prompt_cache_key).toMatch(/^coc-v2:gpt-cache-test:[0-9a-f]{8}$/);
    expect(firstBody.prompt_cache_key).toBe(secondBody.prompt_cache_key);
    expect(firstBody.stream_options).toEqual({ include_usage: true });
  });

  it('does not add official OpenAI cache parameters to a custom compatible host', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '代理正文' } }],
    }), { status: 200 }));
    const client = new BrowserLlmClient(fetchImpl);

    await client.generate({
      config: makeConfig({
        provider: 'openai',
        baseUrl: 'https://openai-proxy.example/v1',
      }),
      messages: [{ role: 'user', content: 'user prompt' }],
    });

    const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(fetchCalls[0][1].body));
    expect(body.prompt_cache_key).toBeUndefined();
    expect(body.stream_options).toBeUndefined();
  });

  it('uses the typed empty-content error for empty OpenAI-compatible streams', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[],"usage":{"prompt_tokens":40,"completion_tokens":0,"total_tokens":40}}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const client = new BrowserLlmClient(vi.fn(async () => new Response(stream, { status: 200 })));

    const rejection = await client.generate({
      config: makeConfig(),
      messages: [{ role: 'user', content: 'user prompt' }],
      onContentDelta: () => undefined,
    }).then(() => null, (error) => error);

    expect(rejection).toBeInstanceOf(LlmEmptyContentError);
    expect((rejection as Error).message).toBe('API 流式返回缺少正文内容');
    expect((rejection as LlmEmptyContentError).usage).toEqual({
      promptTokens: 40,
      completionTokens: 0,
      totalTokens: 40,
    });
  });

  it('uses Anthropic Messages API shape for Claude configs', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: 'Claude正文' }],
      usage: {
        input_tokens: 3200,
        output_tokens: 620,
        cache_read_input_tokens: 2400,
        cache_creation_input_tokens: 400,
      },
    }), { status: 200 }));
    const client = new BrowserLlmClient(fetchImpl);

    const result = await client.generate({
      config: makeConfig({
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-test',
      }),
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
      ],
    });

    expect(result.content).toBe('Claude正文');
    expect(result.usage).toEqual({
      promptTokens: 3200,
      completionTokens: 620,
      totalTokens: 3820,
      cacheReadTokens: 2400,
      cacheWriteTokens: 400,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'sk-test',
          'anthropic-version': expect.any(String),
        }),
      }),
    );
    const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(fetchCalls[0][1].body));
    expect(body).toMatchObject({
      model: 'claude-sonnet-test',
      system: [{
        type: 'text',
        text: 'system prompt',
        cache_control: { type: 'ephemeral' },
      }],
      messages: [{ role: 'user', content: 'user prompt' }],
      max_tokens: 2048,
    });
  });

  it('keeps the legacy string system shape for non-official Anthropic-compatible endpoints', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: '代理正文' }],
      usage: { input_tokens: 100, output_tokens: 20 },
    }), { status: 200 }));
    const client = new BrowserLlmClient(fetchImpl);

    await client.generate({
      config: makeConfig({
        provider: 'anthropic',
        baseUrl: 'https://anthropic-proxy.example/v1',
        model: 'claude-compatible',
      }),
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
      ],
    });

    const fetchCalls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(fetchCalls[0][1].body));
    expect(body.system).toBe('system prompt');
    expect(body.cache_control).toBeUndefined();
  });

  it('throws a typed empty-content error with usage for Anthropic responses', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      content: [],
      usage: { input_tokens: 90, output_tokens: 0 },
    }), { status: 200 }));
    const client = new BrowserLlmClient(fetchImpl);

    const rejection = await client.generate({
      config: makeConfig({
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-test',
      }),
      messages: [{ role: 'user', content: 'user prompt' }],
    }).then(() => null, (error) => error);

    expect(rejection).toBeInstanceOf(LlmEmptyContentError);
    expect((rejection as Error).message).toBe('Anthropic 返回缺少正文内容');
    expect((rejection as LlmEmptyContentError).usage).toEqual({
      promptTokens: 90,
      completionTokens: 0,
      totalTokens: 90,
    });
  });
});

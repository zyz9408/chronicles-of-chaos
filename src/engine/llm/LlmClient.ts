import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';

export type LlmMessageRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmMessageRole;
  content: string;
}

export type LlmTimeoutErrorFactory = (timeoutMs: number) => unknown;

export interface LlmGenerateRequest {
  config: ApiConfigArchive;
  messages: LlmMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?: 'json_object' | 'text';
  onContentDelta?: (delta: string) => void;
  timeoutMs?: number;
  timeoutErrorFactory?: LlmTimeoutErrorFactory;
  retryCount?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
}

export interface LlmTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Provider-reported input tokens read from prompt/context cache. */
  cacheReadTokens?: number;
  /** Provider-reported input tokens written to prompt/context cache. */
  cacheWriteTokens?: number;
  /** Provider-reported input tokens that missed prompt/context cache. */
  cacheMissTokens?: number;
}

export class LlmEmptyContentError extends Error {
  constructor(message: string, public readonly usage?: LlmTokenUsage) {
    super(message);
    this.name = 'LlmEmptyContentError';
  }
}

export interface LlmGenerateResult {
  content: string;
  provider: ApiProviderId;
  model: string;
  /** Provider-reported completion status for truncation and safety diagnostics. */
  finishReason?: string;
  usage?: LlmTokenUsage;
  raw?: unknown;
}

export interface LlmClient {
  generate(request: LlmGenerateRequest): Promise<LlmGenerateResult>;
}

export interface LlmEmbeddingRequest {
  config: ApiConfigArchive;
  input: string[];
  timeoutMs?: number;
  timeoutErrorFactory?: LlmTimeoutErrorFactory;
  retryCount?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
}

export interface LlmEmbeddingResult {
  embeddings: number[][];
  provider: ApiProviderId;
  model: string;
  usage?: LlmTokenUsage;
  raw?: unknown;
}

export interface EmbeddingClient {
  embed(request: LlmEmbeddingRequest): Promise<LlmEmbeddingResult>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const ANTHROPIC_VERSION = '2023-06-01';

export class BrowserLlmClient implements LlmClient, EmbeddingClient {
  constructor(private readonly fetchImpl: FetchLike = defaultFetch) {}

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResult> {
    validateConfig(request.config);
    return runWithRequestAbortScope(
      request.signal,
      request.timeoutMs,
      request.timeoutErrorFactory,
      (signal) => {
        const scopedRequest: LlmGenerateRequest = {
          ...request,
          signal,
          timeoutMs: undefined,
          timeoutErrorFactory: undefined,
          retryCount: undefined,
          retryDelayMs: undefined,
        };
        if (request.config.provider === 'anthropic') {
          return this.generateAnthropic(scopedRequest);
        }
        return this.generateOpenAiCompatible(scopedRequest);
      },
      { retryCount: request.retryCount, retryDelayMs: request.retryDelayMs },
    );
  }

  async embed(request: LlmEmbeddingRequest): Promise<LlmEmbeddingResult> {
    validateConfig(request.config);

    return runWithRequestAbortScope(
      request.signal,
      request.timeoutMs,
      request.timeoutErrorFactory,
      async (signal) => {
        const scopedRequest: LlmEmbeddingRequest = {
          ...request,
          signal,
          timeoutMs: undefined,
          timeoutErrorFactory: undefined,
          retryCount: undefined,
          retryDelayMs: undefined,
        };
        if (request.config.provider === 'anthropic') {
          throw new Error('Anthropic config does not support embedding requests');
        }

        if (request.input.length === 0) {
          return {
            embeddings: [],
            provider: request.config.provider,
            model: request.config.model,
          };
        }

        return this.embedOpenAiCompatible(scopedRequest);
      },
      { retryCount: request.retryCount, retryDelayMs: request.retryDelayMs },
    );
  }

  private async generateOpenAiCompatible(request: LlmGenerateRequest): Promise<LlmGenerateResult> {
    const { config } = request;
    const body: Record<string, unknown> = {
      model: config.model,
      messages: request.messages,
    };
    const maxTokens = request.maxOutputTokens ?? config.maxOutputTokens;
    const temperature = request.temperature ?? config.temperature;

    if (maxTokens !== undefined) body.max_tokens = maxTokens;
    if (temperature !== undefined) body.temperature = temperature;
    if (isMiniMaxProvider(config)) {
      body.reasoning_split = true;
    } else if (request.responseFormat === 'json_object') {
      body.response_format = { type: 'json_object' };
    }
    if (isOfficialOpenAiEndpoint(config)) {
      body.prompt_cache_key = buildPromptCacheKey(config.model, request.messages);
    }

    if (request.onContentDelta) {
      body.stream = true;
      if (isOfficialOpenAiEndpoint(config)) {
        body.stream_options = { include_usage: true };
      }
      return this.generateOpenAiCompatibleStream(request, body);
    }

    const response = await this.fetchJson(
      `${trimTrailingSlash(config.baseUrl)}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      request.timeoutMs,
      request.signal,
    );

    const usage = parseOpenAiCompatibleUsage(response);
    const content = parseOpenAiCompatibleContent(response, usage);
    return {
      content,
      provider: config.provider,
      model: config.model,
      finishReason: shouldReportFinishReason(config) ? parseOpenAiCompatibleFinishReason(response) : undefined,
      usage,
      raw: response,
    };
  }

  private async embedOpenAiCompatible(request: LlmEmbeddingRequest): Promise<LlmEmbeddingResult> {
    const { config } = request;
    const response = await this.fetchJson(
      `${trimTrailingSlash(config.baseUrl)}/embeddings`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          input: request.input,
        }),
      },
      request.timeoutMs,
      request.signal,
    );

    return {
      embeddings: parseOpenAiCompatibleEmbeddings(response),
      provider: config.provider,
      model: config.model,
      usage: parseOpenAiCompatibleUsage(response),
      raw: response,
    };
  }

  private async generateOpenAiCompatibleStream(
    request: LlmGenerateRequest,
    body: Record<string, unknown>,
  ): Promise<LlmGenerateResult> {
    const { config } = request;
    const response = await this.fetchWithTimeout(
      `${trimTrailingSlash(config.baseUrl)}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      },
      request.timeoutMs,
      request.signal,
    );

    if (!response.ok) {
      const text = await readResponseText(response, request.signal);
      throw new Error(formatApiError(response.status, parseJsonOrText(text)));
    }

    const streamResult = await readOpenAiCompatibleStream(
      response,
      request.onContentDelta,
      request.signal,
      isMiniMaxProvider(config),
    );
    return {
      content: streamResult.content,
      provider: config.provider,
      model: config.model,
      finishReason: shouldReportFinishReason(config) ? streamResult.finishReason : undefined,
      usage: streamResult.usage,
      raw: streamResult.raw,
    };
  }

  private async generateAnthropic(request: LlmGenerateRequest): Promise<LlmGenerateResult> {
    const { config } = request;
    const system = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const messages = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
      }));

    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: request.maxOutputTokens ?? config.maxOutputTokens ?? 4096,
      messages,
    };
    const temperature = request.temperature ?? config.temperature;
    if (system) {
      body.system = isOfficialAnthropicEndpoint(config)
        ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        : system;
    }
    if (temperature !== undefined) body.temperature = temperature;

    const response = await this.fetchJson(
      `${trimTrailingSlash(config.baseUrl)}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      },
      request.timeoutMs,
      request.signal,
    );

    const usage = parseAnthropicUsage(response);
    const content = parseAnthropicContent(response, usage);
    return {
      content,
      provider: config.provider,
      model: config.model,
      usage,
      raw: response,
    };
  }

  private async fetchJson(
    url: string,
    init: RequestInit,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await this.fetchWithTimeout(url, init, timeoutMs, signal);
    const text = await readResponseText(response, signal);
    const payload = parseJsonOrText(text);

    if (!response.ok) {
      throw new Error(formatApiError(response.status, payload));
    }

    return payload;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs?: number,
    externalSignal?: AbortSignal,
  ): Promise<Response> {
    throwIfSignalAborted(externalSignal);

    if (!timeoutMs || timeoutMs <= 0 || typeof AbortController === 'undefined') {
      try {
        return await this.fetchImpl(url, externalSignal ? { ...init, signal: externalSignal } : init);
      } catch (error) {
        if (externalSignal?.aborted) throw getSignalReason(externalSignal);
        throw error;
      }
    }

    const controller = new AbortController();
    let timedOut = false;
    const handleExternalAbort = () => controller.abort(getSignalReason(externalSignal!));
    externalSignal?.addEventListener('abort', handleExternalAbort, { once: true });
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort(createRequestTimeoutError(timeoutMs));
    }, timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (externalSignal?.aborted) {
        throw getSignalReason(externalSignal);
      }
      if (timedOut) {
        throw getSignalReason(controller.signal);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', handleExternalAbort);
    }
  }
}

const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init);

function throwIfSignalAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw getSignalReason(signal);
}

function getSignalReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

async function runWithRequestAbortScope<T>(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
  timeoutErrorFactory: LlmTimeoutErrorFactory | undefined,
  task: (signal: AbortSignal | undefined) => Promise<T>,
  retryOptions: { retryCount?: number; retryDelayMs?: number } = {},
): Promise<T> {
  throwIfSignalAborted(externalSignal);
  const retryCount = normalizeRetryCount(retryOptions.retryCount);
  const retryDelayMs = normalizeRetryDelay(retryOptions.retryDelayMs);

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    throwIfSignalAborted(externalSignal);
    const hasTimeout = Boolean(timeoutMs && timeoutMs > 0 && typeof AbortController !== 'undefined');
    const controller = hasTimeout ? new AbortController() : undefined;
    let timedOut = false;
    const handleExternalAbort = controller && externalSignal
      ? () => controller.abort(getSignalReason(externalSignal))
      : undefined;
    if (handleExternalAbort) {
      externalSignal!.addEventListener('abort', handleExternalAbort, { once: true });
    }
    const timeoutId = controller
      ? setTimeout(() => {
          timedOut = true;
          controller.abort(createRequestTimeoutError(timeoutMs!, timeoutErrorFactory));
        }, timeoutMs)
      : undefined;

    try {
      return await raceWithSignal(task(controller?.signal ?? externalSignal), controller?.signal ?? externalSignal);
    } catch (error) {
      if (externalSignal?.aborted) throw getSignalReason(externalSignal);
      const resolvedError = timedOut && controller ? getSignalReason(controller.signal) : error;
      const canRetry = attempt < retryCount && (timedOut || isTransientNetworkFailure(error));
      if (!canRetry) throw resolvedError;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (handleExternalAbort) externalSignal!.removeEventListener('abort', handleExternalAbort);
    }

    if (retryDelayMs > 0) {
      await waitForRetryDelay(retryDelayMs, externalSignal);
    }
  }

  throw new Error('LLM request retry loop ended unexpectedly');
}

function normalizeRetryCount(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(3, Math.floor(value ?? 0)));
}

function normalizeRetryDelay(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10_000, Math.floor(value ?? 0)));
}

function isTransientNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return error instanceof DOMException && error.name === 'NetworkError';
}

function waitForRetryDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfSignalAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, delayMs);
    const handleAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', handleAbort);
      reject(getSignalReason(signal!));
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

function raceWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfSignalAborted(signal);

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(getSignalReason(signal));
    signal.addEventListener('abort', handleAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', handleAbort);
    });
  });
}

function createRequestTimeoutError(timeoutMs: number, factory?: LlmTimeoutErrorFactory): unknown {
  return factory?.(timeoutMs) ?? new Error(`API 请求超时（${formatTimeoutMs(timeoutMs)}）`);
}

async function readResponseText(response: Response, signal?: AbortSignal): Promise<string> {
  if (!response.body) return raceWithSignal(response.text(), signal);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let cancellation: Promise<void> | undefined;
  try {
    while (true) {
      const { value, done } = await raceWithSignal(reader.read(), signal);
      if (done) break;
      throwIfSignalAborted(signal);
      text += decoder.decode(value, { stream: true });
    }
    throwIfSignalAborted(signal);
    return text + decoder.decode();
  } catch (error) {
    cancellation = cancelReader(reader, error);
    throw error;
  } finally {
    releaseReaderLock(reader, cancellation);
  }
}

function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown,
): Promise<void> {
  return reader.cancel(reason).catch(() => undefined);
}

function releaseReaderLock(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  afterCancellation?: Promise<void>,
): void {
  try {
    reader.releaseLock();
  } catch {
    if (afterCancellation) {
      void afterCancellation.finally(() => {
        try {
          reader.releaseLock();
        } catch {
          // Cleanup must not replace the original request result.
        }
      });
    }
  }
}

function validateConfig(config: ApiConfigArchive): void {
  if (!config.baseUrl.trim()) {
    throw new Error('API 配置缺少接口地址');
  }
  if (!config.model.trim()) {
    throw new Error('API 配置缺少模型名称');
  }
  if (config.provider !== 'ollama' && config.provider !== 'lm_studio' && !config.apiKey.trim()) {
    throw new Error('API 配置缺少密钥');
  }
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function formatTimeoutMs(timeoutMs: number): string {
  if (timeoutMs >= 1000) {
    return `${Math.round(timeoutMs / 1000)}秒`;
  }
  return `${timeoutMs}毫秒`;
}

function parseJsonOrText(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseOpenAiCompatibleContent(payload: unknown, usage?: LlmTokenUsage): string {
  if (!isRecord(payload)) {
    throw new Error('API 返回格式不是对象');
  }

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('API 返回缺少 choices');
  }

  const first = choices[0];
  if (!isRecord(first)) {
    throw new Error('API 返回 choices[0] 格式异常');
  }

  const message = first.message;
  const messageContent = isRecord(message) ? message.content : undefined;
  const content = typeof messageContent === 'string' ? messageContent : first.text;

  if (typeof content !== 'string' || !content.trim()) {
    throw new LlmEmptyContentError('API 返回缺少正文内容', usage);
  }

  return content;
}

function parseOpenAiCompatibleUsage(payload: unknown): LlmTokenUsage | undefined {
  if (!isRecord(payload) || !isRecord(payload.usage)) return undefined;
  const promptTokenDetails = isRecord(payload.usage.prompt_tokens_details)
    ? payload.usage.prompt_tokens_details
    : undefined;
  const inputTokenDetails = isRecord(payload.usage.input_tokens_details)
    ? payload.usage.input_tokens_details
    : undefined;
  return normalizeUsage({
    promptTokens: firstDefined(
      payload.usage.prompt_tokens,
      payload.usage.input_tokens,
    ),
    completionTokens: payload.usage.completion_tokens,
    totalTokens: payload.usage.total_tokens,
    cacheReadTokens: firstDefined(
      promptTokenDetails?.cached_tokens,
      inputTokenDetails?.cached_tokens,
      payload.usage.prompt_cache_hit_tokens,
      payload.usage.total_cached_tokens,
      payload.usage.cached_content_token_count,
      payload.usage.cachedContentTokenCount,
    ),
    cacheWriteTokens: firstDefined(
      promptTokenDetails?.cache_write_tokens,
      inputTokenDetails?.cache_write_tokens,
      payload.usage.cache_creation_input_tokens,
    ),
    cacheMissTokens: payload.usage.prompt_cache_miss_tokens,
  });
}

function parseOpenAiCompatibleFinishReason(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.choices[0])) return undefined;
  const finishReason = payload.choices[0].finish_reason;
  return typeof finishReason === 'string' && finishReason ? finishReason : undefined;
}

function parseOpenAiCompatibleEmbeddings(payload: unknown): number[][] {
  if (!isRecord(payload)) {
    throw new Error('Embedding API response is not an object');
  }

  const data = payload.data;
  if (!Array.isArray(data)) {
    throw new Error('Embedding API response is missing data');
  }

  return data
    .map((item, fallbackIndex) => {
      if (!isRecord(item) || !Array.isArray(item.embedding)) {
        throw new Error('Embedding API response contains an invalid embedding item');
      }
      const embedding = item.embedding.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      if (embedding.length !== item.embedding.length || embedding.length === 0) {
        throw new Error('Embedding API response contains an invalid vector');
      }
      return {
        index: typeof item.index === 'number' ? item.index : fallbackIndex,
        embedding,
      };
    })
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

async function readOpenAiCompatibleStream(
  response: Response,
  onContentDelta?: (delta: string) => void,
  signal?: AbortSignal,
  normalizeCumulativeContent = false,
): Promise<{ content: string; finishReason?: string; usage?: LlmTokenUsage; raw: string[] }> {
  if (!response.body) {
    const text = await readResponseText(response, signal);
    const payload = parseJsonOrText(text);
    const usage = parseOpenAiCompatibleUsage(payload);
    const content = parseOpenAiCompatibleContent(payload, usage);
    onContentDelta?.(content);
    return {
      content,
      usage,
      raw: [text],
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finishReason: string | undefined;
  let usage: LlmTokenUsage | undefined;
  const raw: string[] = [];
  let cancellation: Promise<void> | undefined;

  const consumeEventBlock = (block: string): void => {
    const eventData = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');

    if (!eventData || eventData === '[DONE]') return;
    raw.push(eventData);

    const payload = parseJsonOrText(eventData);
    if (!isRecord(payload)) return;

    const chunkUsage = parseOpenAiCompatibleUsage(payload);
    if (chunkUsage) usage = chunkUsage;

    const choices = payload.choices;
    if (!Array.isArray(choices) || choices.length === 0 || !isRecord(choices[0])) return;

    const chunkFinishReason = choices[0].finish_reason;
    if (typeof chunkFinishReason === 'string' && chunkFinishReason) finishReason = chunkFinishReason;

    const delta = choices[0].delta;
    const deltaContent = isRecord(delta) && typeof delta.content === 'string' ? delta.content : undefined;
    if (!deltaContent) return;

    throwIfSignalAborted(signal);
    const normalizedDelta = normalizeCumulativeContent
      ? getCumulativeContentDelta(content, deltaContent)
      : deltaContent;
    if (!normalizedDelta) return;
    content += normalizedDelta;
    onContentDelta?.(normalizedDelta);
  };

  try {
    while (true) {
      const { value, done } = await raceWithSignal(reader.read(), signal);
      if (done) break;
      throwIfSignalAborted(signal);

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';

      for (const block of blocks) consumeEventBlock(block);
    }

    throwIfSignalAborted(signal);
    buffer += decoder.decode();
    const trailingData = buffer.trim();
    if (trailingData) consumeEventBlock(trailingData);

    if (!content.trim()) {
      throw new LlmEmptyContentError('API 流式返回缺少正文内容', usage);
    }

    return { content, finishReason, usage, raw };
  } catch (error) {
    cancellation = cancelReader(reader, error);
    throw error;
  } finally {
    releaseReaderLock(reader, cancellation);
  }
}

function getCumulativeContentDelta(current: string, next: string): string {
  if (next.startsWith(current)) return next.slice(current.length);
  if (current.startsWith(next)) return '';
  return next;
}

function parseAnthropicContent(payload: unknown, usage?: LlmTokenUsage): string {
  if (!isRecord(payload)) {
    throw new Error('API 返回格式不是对象');
  }

  const content = payload.content;
  if (!Array.isArray(content)) {
    throw new Error('Anthropic 返回缺少 content');
  }

  const text = content
    .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');

  if (!text.trim()) {
    throw new LlmEmptyContentError('Anthropic 返回缺少正文内容', usage);
  }

  return text;
}

function parseAnthropicUsage(payload: unknown): LlmTokenUsage | undefined {
  if (!isRecord(payload) || !isRecord(payload.usage)) return undefined;
  return normalizeUsage({
    promptTokens: payload.usage.input_tokens,
    completionTokens: payload.usage.output_tokens,
    cacheReadTokens: payload.usage.cache_read_input_tokens,
    cacheWriteTokens: payload.usage.cache_creation_input_tokens,
  });
}

function normalizeUsage(values: {
  promptTokens?: unknown;
  completionTokens?: unknown;
  totalTokens?: unknown;
  cacheReadTokens?: unknown;
  cacheWriteTokens?: unknown;
  cacheMissTokens?: unknown;
}): LlmTokenUsage | undefined {
  const promptTokens = normalizeUsageNumber(values.promptTokens);
  const completionTokens = normalizeUsageNumber(values.completionTokens);
  const cacheReadTokens = normalizeUsageNumber(values.cacheReadTokens);
  const cacheWriteTokens = normalizeUsageNumber(values.cacheWriteTokens);
  const cacheMissTokens = normalizeUsageNumber(values.cacheMissTokens);
  const totalTokens = normalizeUsageNumber(
    values.totalTokens ?? (
      promptTokens !== undefined || completionTokens !== undefined
        ? (promptTokens ?? 0) + (completionTokens ?? 0)
        : undefined
    ),
  );

  if (
    promptTokens === undefined
    && completionTokens === undefined
    && totalTokens === undefined
    && cacheReadTokens === undefined
    && cacheWriteTokens === undefined
    && cacheMissTokens === undefined
  ) {
    return undefined;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cacheMissTokens,
  };
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined);
}

function isOfficialOpenAiEndpoint(config: ApiConfigArchive): boolean {
  return config.provider === 'openai' && getEndpointHostname(config.baseUrl) === 'api.openai.com';
}

function isOfficialAnthropicEndpoint(config: ApiConfigArchive): boolean {
  return config.provider === 'anthropic' && getEndpointHostname(config.baseUrl) === 'api.anthropic.com';
}

function isMiniMaxProvider(config: ApiConfigArchive): boolean {
  return config.provider === 'minimax' || config.provider === 'minimax_international';
}

function shouldReportFinishReason(config: ApiConfigArchive): boolean {
  return config.provider === 'zhipu'
    || config.provider === 'zhipu_coding'
    || isMiniMaxProvider(config);
}

function getEndpointHostname(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function buildPromptCacheKey(model: string, messages: LlmMessage[]): string {
  const stableSystemPrefix = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  return `coc-v2:${sanitizeCacheKeyPart(model)}:${fnv1aHash(stableSystemPrefix)}`;
}

function sanitizeCacheKeyPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 48) || 'model';
}

function fnv1aHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeUsageNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return Math.max(0, Math.floor(value));
}

function formatApiError(status: number, payload: unknown): string {
  if (isRecord(payload)) {
    const error = payload.error;
    if (isRecord(error) && typeof error.message === 'string') {
      return `API 请求失败（${status}）：${error.message}`;
    }
    if (typeof payload.message === 'string') {
      return `API 请求失败（${status}）：${payload.message}`;
    }
  }

  if (typeof payload === 'string' && payload.trim()) {
    return `API 请求失败（${status}）：${payload.slice(0, 300)}`;
  }

  return `API 请求失败（${status}）`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

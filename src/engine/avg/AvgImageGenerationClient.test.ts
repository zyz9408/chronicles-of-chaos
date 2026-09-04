import { describe, expect, it, vi } from 'vitest';
import { AvgImageGenerationError, generateAvgImageCandidate } from './AvgImageGenerationClient';
import { createAvgImageGenerationProfile } from './AvgImageGenerationProfiles';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const profile = () => ({ ...createAvgImageGenerationProfile(), baseUrl: 'https://images.example/v1', model: 'image-model' });

describe('AVG image generation client', () => {
  it('sends one explicit compatible request and validates a base64 candidate', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ b64_json: btoa(String.fromCharCode(...png)) }] }), { status: 200 }));
    expect(fetchImpl).not.toHaveBeenCalled();
    const result = await generateAvgImageCandidate({ profile: profile(), credential: 'secret', prompt: 'safe prompt', fetchImpl: fetchImpl as typeof fetch, decodeDimensions: async () => ({ width: 1024, height: 1024 }) });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://images.example/v1/images/generations');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret' });
    expect(JSON.parse(String(init?.body))).toEqual({ model: 'image-model', prompt: 'safe prompt', size: '1024x1024', n: 1 });
    expect(result).toMatchObject({ source: 'base64', file: { mediaType: 'image/png', width: 1024 } });
  });

  it('rejects unsafe response URLs before attempting a download', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ url: 'http://evil.example/image.png' }] }), { status: 200 }));
    await expect(generateAvgImageCandidate({ profile: profile(), credential: 'secret', prompt: 'safe prompt', fetchImpl: fetchImpl as typeof fetch }))
      .rejects.toMatchObject({ code: 'unsafe-response-url' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps authentication and declared oversized downloads to stable errors', async () => {
    await expect(generateAvgImageCandidate({ profile: profile(), credential: 'secret', prompt: 'safe', fetchImpl: vi.fn(async () => new Response('', { status: 401 })) as typeof fetch }))
      .rejects.toMatchObject({ code: 'authentication' });
    const fetchImpl = vi.fn(async (url: string | URL | Request) => String(url).includes('/images/generations')
      ? new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/image.png' }] }), { status: 200 })
      : new Response('', { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(33 * 1024 * 1024) } }));
    await expect(generateAvgImageCandidate({ profile: profile(), credential: 'secret', prompt: 'safe', fetchImpl: fetchImpl as typeof fetch }))
      .rejects.toEqual(expect.objectContaining<Partial<AvgImageGenerationError>>({ code: 'image-too-large' }));
  });
});

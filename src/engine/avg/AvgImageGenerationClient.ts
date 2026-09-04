import { MAX_AVG_IMAGE_BYTES, validateAvgImage, type ValidatedAvgImage } from './AvgVisualOverrideRepository';
import { avgImageGenerationEndpoint, validateAvgImageGenerationProfile, type AvgImageGenerationProfile } from './AvgImageGenerationProfiles';

export type AvgImageGenerationErrorCode = 'invalid-config' | 'authentication' | 'rate-limit' | 'service-unavailable' | 'service-unreachable' | 'timeout' | 'cancelled' | 'unsupported-response' | 'unsafe-response-url' | 'image-too-large';
const MESSAGES: Record<AvgImageGenerationErrorCode, string> = {
  'invalid-config': '图片生成配置无效，请检查档案设置。', authentication: '图片服务鉴权失败，请检查 API Key。',
  'rate-limit': '图片服务限流或余额不足，请稍后重试并检查服务账户。', 'service-unavailable': '图片服务暂时不可用，请稍后重试。',
  'service-unreachable': '无法连接图片服务，可能是网络或 CORS 限制。', timeout: '图片生成超时，请重试或调整档案超时设置。',
  cancelled: '图片生成已取消。', 'unsupported-response': '图片服务返回了不支持的响应格式。', 'unsafe-response-url': '图片服务返回了不安全的下载地址。', 'image-too-large': '图片服务返回的文件超过 32 MiB。',
};

export class AvgImageGenerationError extends Error {
  constructor(readonly code: AvgImageGenerationErrorCode) { super(MESSAGES[code]); this.name = 'ImageGenerationError'; }
}

function statusError(status: number): void {
  if (status >= 200 && status < 300) return;
  if ([401, 403].includes(status)) throw new AvgImageGenerationError('authentication');
  if ([402, 429].includes(status)) throw new AvgImageGenerationError('rate-limit');
  throw new AvgImageGenerationError('service-unavailable');
}

async function boundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) throw new AvgImageGenerationError('image-too-large');
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new AvgImageGenerationError('image-too-large');
    return bytes;
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > limit) throw new AvgImageGenerationError('image-too-large'); chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}

function safeDownloadUrl(value: string): URL {
  let url: URL; try { url = new URL(value); } catch { throw new AvgImageGenerationError('unsafe-response-url'); }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname.toLowerCase());
  if (url.username || url.password || (url.protocol !== 'https:' && !localHttp)) throw new AvgImageGenerationError('unsafe-response-url');
  return url;
}

function decodeBase64(value: string): Uint8Array {
  if (!value || value.length > Math.ceil(MAX_AVG_IMAGE_BYTES / 3) * 4 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) throw new AvgImageGenerationError('unsupported-response');
  let raw: string; try { raw = atob(value); } catch { throw new AvgImageGenerationError('unsupported-response'); }
  if (raw.length > MAX_AVG_IMAGE_BYTES) throw new AvgImageGenerationError('image-too-large');
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function downloadImage(value: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<Blob> {
  let url = safeDownloadUrl(value);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetchImpl(url.toString(), { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual', signal });
    if (response.status >= 300 && response.status < 400) {
      if (redirects === 3) throw new AvgImageGenerationError('unsafe-response-url');
      const location = response.headers.get('location'); if (!location) throw new AvgImageGenerationError('unsafe-response-url');
      url = safeDownloadUrl(new URL(location, url).toString()); continue;
    }
    statusError(response.status);
    const type = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(type ?? '')) throw new AvgImageGenerationError('unsupported-response');
    return new Blob([await boundedBytes(response, MAX_AVG_IMAGE_BYTES)], { type });
  }
  throw new AvgImageGenerationError('unsafe-response-url');
}

export async function generateAvgImageCandidate(options: { profile: AvgImageGenerationProfile; credential: string; prompt: string; signal?: AbortSignal; fetchImpl?: typeof fetch; decodeDimensions?: (blob: Blob) => Promise<{ width: number; height: number }> }): Promise<{ file: ValidatedAvgImage; source: 'base64' | 'url' }> {
  let profile: AvgImageGenerationProfile;
  try { profile = validateAvgImageGenerationProfile(options.profile); } catch { throw new AvgImageGenerationError('invalid-config'); }
  const credential = options.credential.trim(); const prompt = options.prompt.trim();
  if (!credential || !prompt || prompt.length > 7000) throw new AvgImageGenerationError('invalid-config');
  if (options.signal?.aborted) throw new AvgImageGenerationError('cancelled');
  const fetchImpl = options.fetchImpl ?? fetch; const controller = new AbortController(); let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, profile.timeoutMs);
  const cancel = () => controller.abort(); options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await fetchImpl(avgImageGenerationEndpoint(profile), { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` }, body: JSON.stringify({ model: profile.model, prompt, size: profile.size, n: 1 }) });
    statusError(response.status);
    const body = new TextDecoder().decode(await boundedBytes(response, Math.ceil(MAX_AVG_IMAGE_BYTES / 3) * 4 + 1024 * 1024));
    let payload: unknown; try { payload = JSON.parse(body); } catch { throw new AvgImageGenerationError('unsupported-response'); }
    const first = typeof payload === 'object' && payload && Array.isArray((payload as { data?: unknown }).data) ? (payload as { data: unknown[] }).data[0] : undefined;
    if (!first || typeof first !== 'object') throw new AvgImageGenerationError('unsupported-response');
    const row = first as { b64_json?: unknown; url?: unknown }; let blob: Blob; let source: 'base64' | 'url';
    if (typeof row.b64_json === 'string') { const bytes = decodeBase64(row.b64_json); blob = new Blob([bytes], { type: detectImageType(bytes) ?? '' }); source = 'base64'; }
    else if (typeof row.url === 'string') { blob = await downloadImage(row.url, fetchImpl, controller.signal); source = 'url'; }
    else throw new AvgImageGenerationError('unsupported-response');
    if (!blob.type) throw new AvgImageGenerationError('unsupported-response');
    try { return { file: await validateAvgImage(blob, { decodeDimensions: options.decodeDimensions }), source }; }
    catch (error) { if (error instanceof AvgImageGenerationError) throw error; throw new AvgImageGenerationError('unsupported-response'); }
  } catch (error) {
    if (error instanceof AvgImageGenerationError) throw error;
    if (timedOut) throw new AvgImageGenerationError('timeout');
    if (options.signal?.aborted) throw new AvgImageGenerationError('cancelled');
    if (error instanceof DOMException && error.name === 'AbortError') throw new AvgImageGenerationError('cancelled');
    throw new AvgImageGenerationError('service-unreachable');
  } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', cancel); }
}

function detectImageType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | undefined {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return undefined;
}

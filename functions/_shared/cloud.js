export const CLOUD_SAVE_COOKIE = 'coc_cloud_session';
export const CLOUD_OAUTH_COOKIE = 'coc_cloud_oauth';
export const CLOUD_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const CLOUD_OAUTH_MAX_AGE_SECONDS = 10 * 60;

// These ceilings intentionally leave 20% of R2's 10 GB free allowance unused.
// Environment variables may lower them, but can never raise them.
export const CLOUD_GLOBAL_LIMIT_BYTES = 8_000_000_000;
export const CLOUD_USER_LIMIT_BYTES = 50_000_000;
export const CLOUD_UPLOAD_LIMIT_BYTES = 10_000_000;
export const CLOUD_SETTINGS_UPLOAD_LIMIT_BYTES = 1_000_000;
export const CLOUD_SLOT_LIMIT = 5;
export const CLOUD_DAILY_UPLOAD_LIMIT = 6_000;
export const CLOUD_USER_DAILY_UPLOAD_LIMIT = 100;

const textEncoder = new TextEncoder();

export function cloudJsonResponse(payload, status = 200, extraHeaders = {}) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, max-age=0',
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

export function cloudError(code, status, message, extra = {}, extraHeaders = {}) {
  return cloudJsonResponse({ ok: false, code, message, ...extra }, status, extraHeaders);
}

export function getCloudLimits(env = {}) {
  return {
    globalBytes: boundedLimit(
      env.CLOUD_SAVE_GLOBAL_LIMIT_BYTES,
      CLOUD_GLOBAL_LIMIT_BYTES,
      CLOUD_GLOBAL_LIMIT_BYTES,
    ),
    userBytes: boundedLimit(
      env.CLOUD_SAVE_USER_LIMIT_BYTES,
      CLOUD_USER_LIMIT_BYTES,
      CLOUD_USER_LIMIT_BYTES,
    ),
    uploadBytes: boundedLimit(
      env.CLOUD_SAVE_UPLOAD_LIMIT_BYTES,
      CLOUD_UPLOAD_LIMIT_BYTES,
      CLOUD_UPLOAD_LIMIT_BYTES,
    ),
    slots: boundedLimit(env.CLOUD_SAVE_SLOT_LIMIT, CLOUD_SLOT_LIMIT, CLOUD_SLOT_LIMIT),
    dailyUploads: boundedLimit(
      env.CLOUD_SAVE_DAILY_UPLOAD_LIMIT,
      CLOUD_DAILY_UPLOAD_LIMIT,
      CLOUD_DAILY_UPLOAD_LIMIT,
    ),
    userDailyUploads: boundedLimit(
      env.CLOUD_SAVE_USER_DAILY_UPLOAD_LIMIT,
      CLOUD_USER_DAILY_UPLOAD_LIMIT,
      CLOUD_USER_DAILY_UPLOAD_LIMIT,
    ),
  };
}

function boundedLimit(value, fallback, ceiling) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, ceiling);
}

export function cloudBindingsReady(env = {}) {
  return Boolean(env.CLOUD_SAVE_DB && env.CLOUD_SAVE_BUCKET);
}

export function discordAuthReady(env = {}) {
  return cloudBindingsReady(env)
    && typeof env.DISCORD_CLIENT_ID === 'string'
    && env.DISCORD_CLIENT_ID.length > 0
    && typeof env.DISCORD_CLIENT_SECRET === 'string'
    && env.DISCORD_CLIENT_SECRET.length > 0
    && typeof env.CLOUD_SESSION_SECRET === 'string'
    && env.CLOUD_SESSION_SECRET.length >= 32;
}

export function officialCloudOrigin(env = {}) {
  const configured = typeof env.CLOUD_ORIGIN === 'string' ? env.CLOUD_ORIGIN.trim() : '';
  try {
    return new URL(configured || 'https://cocsg.pages.dev').origin;
  } catch {
    return 'https://cocsg.pages.dev';
  }
}

export function isTrustedMutationRequest(request, env = {}) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  return origin === new URL(request.url).origin || origin === officialCloudOrigin(env);
}

export function parseCookies(request) {
  const result = {};
  const source = request.headers.get('cookie') ?? '';
  for (const item of source.split(';')) {
    const separator = item.indexOf('=');
    if (separator <= 0) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

export function sessionCookie(value, maxAge = CLOUD_SESSION_MAX_AGE_SECONDS) {
  return `${CLOUD_SAVE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function oauthCookie(value, maxAge = CLOUD_OAUTH_MAX_AGE_SECONDS) {
  return `${CLOUD_OAUTH_COOKIE}=${value}; Path=/api/cloud/auth/discord; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookie(name, path = '/') {
  return `${name}=; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function toBase64Url(value) {
  const bytes = typeof value === 'string' ? textEncoder.encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? textEncoder.encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function signState(payload, secret) {
  const encoded = toBase64Url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, textEncoder.encode(encoded)));
  return `${encoded}.${toBase64Url(signature)}`;
}

export async function verifyState(value, secret) {
  if (typeof value !== 'string') return null;
  const [encoded, signature, extra] = value.split('.');
  if (!encoded || !signature || extra !== undefined) return null;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(signature),
      textEncoder.encode(encoded),
    );
    if (!valid) return null;
    return JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
  } catch {
    return null;
  }
}

export async function requireCloudSession(context) {
  const { request, env } = context;
  if (!cloudBindingsReady(env)) {
    return { response: cloudError('cloud_not_configured', 503, '云存档服务尚未配置完成。') };
  }
  const token = parseCookies(request)[CLOUD_SAVE_COOKIE];
  if (!token) return { response: cloudError('not_authenticated', 401, '请先登录 Discord。') };

  const sessionHash = await sha256Hex(token);
  const nowIso = new Date().toISOString();
  const row = await env.CLOUD_SAVE_DB.prepare(`
    SELECT
      s.session_hash, s.user_id, s.expires_at,
      s.last_seen_at,
      u.discord_id, u.username, u.global_name, u.avatar_hash,
      u.usage_bytes, u.reserved_bytes
    FROM cloud_sessions s
    JOIN cloud_users u ON u.user_id = s.user_id
    WHERE s.session_hash = ?1 AND s.expires_at > ?2
  `).bind(sessionHash, nowIso).first();

  if (!row) {
    return {
      response: cloudError('session_expired', 401, 'Discord 登录已过期，请重新登录。', {}, {
        'set-cookie': clearCookie(CLOUD_SAVE_COOKIE),
      }),
    };
  }

  const lastSeenAt = Date.parse(String(row.last_seen_at ?? ''));
  if (!Number.isFinite(lastSeenAt) || Date.now() - lastSeenAt >= 15 * 60 * 1_000) {
    await env.CLOUD_SAVE_DB.prepare(
      'UPDATE cloud_sessions SET last_seen_at = ?2 WHERE session_hash = ?1',
    ).bind(sessionHash, nowIso).run();
  }

  return { sessionHash, user: row };
}

export function publicCloudAccount(user) {
  return {
    userId: user.user_id,
    discordId: user.discord_id,
    username: user.username,
    displayName: user.global_name || user.username,
    avatarUrl: user.avatar_hash
      ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.discord_id)}/${encodeURIComponent(user.avatar_hash)}.png?size=128`
      : null,
  };
}

export function parseCloudSaveMetadataHeader(request) {
  const encoded = request.headers.get('x-coc-save-metadata') ?? '';
  if (!encoded || encoded.length > 8_192) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const strings = ['label', 'playerName', 'currentDate', 'locationName', 'updatedAt', 'saveKind'];
    for (const key of strings) {
      if (typeof value[key] !== 'string' || value[key].length > 240) return null;
    }
    if (!Number.isSafeInteger(value.turnCount) || value.turnCount < 0) return null;
    return {
      label: value.label.slice(0, 160),
      playerName: value.playerName.slice(0, 100),
      currentDate: value.currentDate.slice(0, 100),
      locationName: value.locationName.slice(0, 160),
      updatedAt: value.updatedAt.slice(0, 64),
      saveKind: value.saveKind === 'manual' ? 'manual' : 'auto',
      turnCount: value.turnCount,
    };
  } catch {
    return null;
  }
}

export function safeReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value.slice(0, 500);
}

export function databaseErrorCode(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.includes('global_quota_exceeded')) return 'global_quota_exceeded';
  if (message.includes('user_quota_exceeded')) return 'user_quota_exceeded';
  if (message.includes('daily_upload_limit_exceeded')) return 'daily_upload_limit_exceeded';
  if (message.includes('user_daily_upload_limit_exceeded')) return 'user_daily_upload_limit_exceeded';
  return null;
}

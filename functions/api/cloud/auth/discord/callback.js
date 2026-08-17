import {
  CLOUD_OAUTH_COOKIE,
  CLOUD_OAUTH_MAX_AGE_SECONDS,
  clearCookie,
  cloudError,
  discordAuthReady,
  officialCloudOrigin,
  parseCookies,
  randomToken,
  safeReturnTo,
  sessionCookie,
  sha256Hex,
  verifyState,
} from '../../../../_shared/cloud.js';

function redirectWithStatus(env, returnTo, status, setCookie) {
  const origin = officialCloudOrigin(env);
  const destination = new URL(safeReturnTo(returnTo), origin);
  destination.searchParams.set('cloudAuth', status);
  const headers = new Headers({
    location: destination.toString(),
    'cache-control': 'no-store, max-age=0',
  });
  for (const cookie of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
    headers.append('set-cookie', cookie);
  }
  return new Response(null, {
    status: 302,
    headers,
  });
}

async function exchangeDiscordCode(env, code) {
  const redirectUri = `${officialCloudOrigin(env)}/api/cloud/auth/discord/callback`;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const authorization = btoa(`${env.DISCORD_CLIENT_ID}:${env.DISCORD_CLIENT_SECRET}`);
  const response = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${authorization}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!response.ok) throw new Error('discord_token_exchange_failed');
  return response.json();
}

async function getDiscordIdentity(accessToken) {
  const response = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('discord_identity_failed');
  return response.json();
}

async function revokeDiscordToken(env, accessToken) {
  try {
    const authorization = btoa(`${env.DISCORD_CLIENT_ID}:${env.DISCORD_CLIENT_SECRET}`);
    await fetch('https://discord.com/api/oauth2/token/revoke', {
      method: 'POST',
      headers: {
        authorization: `Basic ${authorization}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token: accessToken, token_type_hint: 'access_token' }),
    });
  } catch {
    // The app never persists Discord access tokens. Revocation is best-effort.
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!discordAuthReady(env)) {
    return cloudError('discord_auth_not_configured', 503, 'Discord 登录尚未配置完成。');
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = await verifyState(url.searchParams.get('state'), env.CLOUD_SESSION_SECRET);
  const oauthNonce = parseCookies(request)[CLOUD_OAUTH_COOKIE];
  const issuedAt = Number(state?.issuedAt ?? 0);
  const stateIsFresh = Number.isFinite(issuedAt)
    && issuedAt > 0
    && Date.now() - issuedAt <= CLOUD_OAUTH_MAX_AGE_SECONDS * 1_000;
  if (!code || !state || !stateIsFresh || state.nonce !== oauthNonce) {
    return redirectWithStatus(
      env,
      state?.returnTo,
      'invalid_state',
      clearCookie(CLOUD_OAUTH_COOKIE, '/api/cloud/auth/discord'),
    );
  }

  let accessToken = '';
  try {
    const token = await exchangeDiscordCode(env, code);
    accessToken = typeof token.access_token === 'string' ? token.access_token : '';
    if (!accessToken) throw new Error('discord_token_missing');
    const identity = await getDiscordIdentity(accessToken);
    if (!identity || typeof identity.id !== 'string' || typeof identity.username !== 'string') {
      throw new Error('discord_identity_invalid');
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const userId = `usr_${randomToken(18)}`;
    const user = await env.CLOUD_SAVE_DB.prepare(`
      INSERT INTO cloud_users (
        user_id, discord_id, username, global_name, avatar_hash, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
      ON CONFLICT(discord_id) DO UPDATE SET
        username = excluded.username,
        global_name = excluded.global_name,
        avatar_hash = excluded.avatar_hash,
        updated_at = excluded.updated_at
      RETURNING user_id
    `).bind(
      userId,
      identity.id,
      identity.username.slice(0, 100),
      typeof identity.global_name === 'string' ? identity.global_name.slice(0, 100) : '',
      typeof identity.avatar === 'string' ? identity.avatar.slice(0, 200) : '',
      nowIso,
    ).first();
    if (!user?.user_id) throw new Error('cloud_user_upsert_failed');

    const sessionToken = randomToken(32);
    const sessionHash = await sha256Hex(sessionToken);
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString();
    await env.CLOUD_SAVE_DB.batch([
      env.CLOUD_SAVE_DB.prepare(
        'DELETE FROM cloud_sessions WHERE expires_at <= ?1',
      ).bind(nowIso),
      env.CLOUD_SAVE_DB.prepare(`
        DELETE FROM cloud_sessions
        WHERE user_id = ?1 AND session_hash IN (
          SELECT session_hash
          FROM cloud_sessions
          WHERE user_id = ?1
          ORDER BY created_at DESC
          LIMIT -1 OFFSET 4
        )
      `).bind(user.user_id),
      env.CLOUD_SAVE_DB.prepare(`
        INSERT INTO cloud_sessions (
          session_hash, user_id, created_at, expires_at, last_seen_at
        ) VALUES (?1, ?2, ?3, ?4, ?3)
      `).bind(sessionHash, user.user_id, nowIso, expiresAt),
    ]);

    return redirectWithStatus(env, state.returnTo, 'success', [
      sessionCookie(sessionToken),
      clearCookie(CLOUD_OAUTH_COOKIE, '/api/cloud/auth/discord'),
    ]);
  } catch {
    return redirectWithStatus(
      env,
      state.returnTo,
      'failed',
      clearCookie(CLOUD_OAUTH_COOKIE, '/api/cloud/auth/discord'),
    );
  } finally {
    if (accessToken) await revokeDiscordToken(env, accessToken);
  }
}

export function onRequest() {
  return cloudError('method_not_allowed', 405, '仅支持 GET。', {}, { allow: 'GET' });
}

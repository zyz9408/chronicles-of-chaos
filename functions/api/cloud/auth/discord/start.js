import {
  CLOUD_OAUTH_COOKIE,
  cloudError,
  discordAuthReady,
  oauthCookie,
  officialCloudOrigin,
  randomToken,
  safeReturnTo,
  signState,
} from '../../../../_shared/cloud.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!discordAuthReady(env)) {
    return cloudError('discord_auth_not_configured', 503, 'Discord 登录尚未配置完成。');
  }

  const requestUrl = new URL(request.url);
  const nonce = randomToken(24);
  const state = await signState({
    nonce,
    issuedAt: Date.now(),
    returnTo: safeReturnTo(requestUrl.searchParams.get('returnTo')),
  }, env.CLOUD_SESSION_SECRET);
  const redirectUri = `${officialCloudOrigin(env)}/api/cloud/auth/discord/callback`;
  const authorize = new URL('https://discord.com/oauth2/authorize');
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
  authorize.searchParams.set('scope', 'identify');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('prompt', 'consent');

  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.toString(),
      'cache-control': 'no-store, max-age=0',
      'set-cookie': oauthCookie(nonce),
    },
  });
}

export function onRequest() {
  return cloudError('method_not_allowed', 405, '仅支持 GET。', {}, { allow: 'GET' });
}

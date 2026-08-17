import {
  cloudBindingsReady,
  cloudError,
  cloudJsonResponse,
  discordAuthReady,
  getCloudLimits,
  publicCloudAccount,
  requireCloudSession,
} from '../../../_shared/cloud.js';

export async function onRequestGet(context) {
  const { env } = context;
  const limits = getCloudLimits(env);
  if (!cloudBindingsReady(env)) {
    return cloudJsonResponse({
      ok: true,
      configured: false,
      authConfigured: false,
      authenticated: false,
      limits,
    });
  }

  const session = await requireCloudSession(context);
  if (session.response) {
    if (session.response.status === 401) {
      const clearSessionCookie = session.response.headers.get('set-cookie');
      return cloudJsonResponse({
        ok: true,
        configured: true,
        authConfigured: discordAuthReady(env),
        authenticated: false,
        limits,
      }, 200, clearSessionCookie ? { 'set-cookie': clearSessionCookie } : {});
    }
    return session.response;
  }

  const count = await env.CLOUD_SAVE_DB.prepare(
    'SELECT COUNT(*) AS count FROM cloud_saves WHERE user_id = ?1',
  ).bind(session.user.user_id).first();
  return cloudJsonResponse({
    ok: true,
    configured: true,
    authConfigured: discordAuthReady(env),
    authenticated: true,
    account: publicCloudAccount(session.user),
    usage: {
      usedBytes: Number(session.user.usage_bytes ?? 0),
      reservedBytes: Number(session.user.reserved_bytes ?? 0),
      limitBytes: limits.userBytes,
      slotCount: Number(count?.count ?? 0),
      slotLimit: limits.slots,
    },
    limits,
  });
}

export function onRequest() {
  return cloudError('method_not_allowed', 405, '仅支持 GET。', {}, { allow: 'GET' });
}

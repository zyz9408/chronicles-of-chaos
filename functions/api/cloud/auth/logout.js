import {
  CLOUD_SAVE_COOKIE,
  clearCookie,
  cloudError,
  cloudJsonResponse,
  isTrustedMutationRequest,
  requireCloudSession,
} from '../../../_shared/cloud.js';

export async function onRequestPost(context) {
  if (!isTrustedMutationRequest(context.request, context.env)) {
    return cloudError('invalid_origin', 403, '请求来源无效。');
  }
  const session = await requireCloudSession(context);
  if (!session.response) {
    await context.env.CLOUD_SAVE_DB.prepare(
      'DELETE FROM cloud_sessions WHERE session_hash = ?1',
    ).bind(session.sessionHash).run();
  }
  return cloudJsonResponse({ ok: true }, 200, {
    'set-cookie': clearCookie(CLOUD_SAVE_COOKIE),
  });
}

export function onRequest() {
  return cloudError('method_not_allowed', 405, '仅支持 POST。', {}, { allow: 'POST' });
}

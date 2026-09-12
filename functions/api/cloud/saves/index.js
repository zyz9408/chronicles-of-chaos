import { deleteCloudRows, drainCloudObjectCleanup } from '../../../_shared/cloudCleanup.js';
import {
  cloudError,
  cloudJsonResponse,
  getCloudLimits,
  isTrustedMutationRequest,
  requireCloudSession,
} from '../../../_shared/cloud.js';

function parseMetadata(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toPublicSave(row) {
  return {
    slotId: row.slot_id,
    revision: Number(row.revision),
    sizeBytes: Number(row.size_bytes),
    checksumSha256: row.checksum_sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: parseMetadata(row.metadata_json),
  };
}

export async function onRequestGet(context) {
  const { env } = context;
  const session = await requireCloudSession(context);
  if (session.response) return session.response;
  await drainCloudObjectCleanup(env, session.user.user_id);
  const limits = getCloudLimits(env);
  const result = await env.CLOUD_SAVE_DB.prepare(`
    SELECT slot_id, revision, size_bytes, checksum_sha256,
           metadata_json, created_at, updated_at
    FROM cloud_saves
    WHERE user_id = ?1
    ORDER BY updated_at DESC
  `).bind(session.user.user_id).all();
  const saves = Array.isArray(result?.results) ? result.results.map(toPublicSave) : [];
  return cloudJsonResponse({
    ok: true,
    saves,
    usage: {
      usedBytes: Number(session.user.usage_bytes ?? 0),
      reservedBytes: Number(session.user.reserved_bytes ?? 0),
      limitBytes: limits.userBytes,
      slotCount: saves.length,
      slotLimit: limits.slots,
    },
  });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!isTrustedMutationRequest(request, env)) {
    return cloudError('invalid_origin', 403, '请求来源无效。');
  }
  if (request.headers.get('x-coc-delete-all') !== 'yes') {
    return cloudError('confirmation_required', 400, '删除全部云存档需要再次确认。');
  }
  const session = await requireCloudSession(context);
  if (session.response) return session.response;
  return deleteCloudRows(env, session.user.user_id, 'all');
}

export function onRequest() {
  return cloudError('method_not_allowed', 405, '仅支持 GET 或 DELETE。', {}, {
    allow: 'GET, DELETE',
  });
}

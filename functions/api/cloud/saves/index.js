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
  const session = await requireCloudSession(context);
  if (session.response) return session.response;
  const { env } = context;
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
  const result = await env.CLOUD_SAVE_DB.prepare(`
    SELECT object_key, size_bytes FROM cloud_saves WHERE user_id = ?1
  `).bind(session.user.user_id).all();
  const rows = Array.isArray(result?.results) ? result.results : [];
  try {
    await Promise.all(rows.map((row) => env.CLOUD_SAVE_BUCKET.delete(row.object_key)));
  } catch {
    return cloudError('cloud_storage_failed', 503, '云端对象删除失败，未修改存档索引。');
  }
  const releasedBytes = rows.reduce((total, row) => total + Number(row.size_bytes ?? 0), 0);
  const nowIso = new Date().toISOString();
  await env.CLOUD_SAVE_DB.batch([
    env.CLOUD_SAVE_DB.prepare('DELETE FROM cloud_saves WHERE user_id = ?1')
      .bind(session.user.user_id),
    env.CLOUD_SAVE_DB.prepare(`
      UPDATE cloud_users
      SET usage_bytes = MAX(0, usage_bytes - ?2), updated_at = ?3
      WHERE user_id = ?1
    `).bind(session.user.user_id, releasedBytes, nowIso),
    env.CLOUD_SAVE_DB.prepare(`
      UPDATE cloud_quota
      SET used_bytes = MAX(0, used_bytes - ?1), updated_at = ?2
      WHERE scope = 'global'
    `).bind(releasedBytes, nowIso),
  ]);
  return cloudJsonResponse({ ok: true, deleted: rows.length });
}

export function onRequest() {
  return cloudError('method_not_allowed', 405, '仅支持 GET 或 DELETE。', {}, {
    allow: 'GET, DELETE',
  });
}

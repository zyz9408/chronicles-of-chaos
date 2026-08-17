import {
  cloudError,
  cloudJsonResponse,
  databaseErrorCode,
  getCloudLimits,
  isTrustedMutationRequest,
  parseCloudSaveMetadataHeader,
  randomToken,
  requireCloudSession,
  sha256Hex,
} from '../../../_shared/cloud.js';

function validSlotId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function parseRevision(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseMetadata(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function readSlot(env, userId, slotId) {
  return env.CLOUD_SAVE_DB.prepare(`
    SELECT slot_id, revision, object_key, size_bytes, checksum_sha256,
           metadata_json, created_at, updated_at
    FROM cloud_saves
    WHERE user_id = ?1 AND slot_id = ?2
  `).bind(userId, slotId).first();
}

export async function onRequestGet(context) {
  const session = await requireCloudSession(context);
  if (session.response) return session.response;
  const slotId = context.params?.slotId;
  if (!validSlotId(slotId)) return cloudError('invalid_slot_id', 400, '云存档槽位 ID 无效。');
  const row = await readSlot(context.env, session.user.user_id, slotId);
  if (!row) return cloudError('cloud_save_not_found', 404, '云端没有这个存档。');
  const object = await context.env.CLOUD_SAVE_BUCKET.get(row.object_key);
  if (!object) return cloudError('cloud_object_missing', 503, '云存档对象缺失，请联系维护者。');

  const headers = new Headers({
    'cache-control': 'no-store, max-age=0',
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="coc-cloud-${slotId}.zip"`,
    'x-coc-save-revision': String(row.revision),
    'x-coc-save-checksum': row.checksum_sha256,
  });
  return new Response(object.body, { status: 200, headers });
}

export async function onRequestPut(context) {
  const { request, env } = context;
  if (!isTrustedMutationRequest(request, env)) {
    return cloudError('invalid_origin', 403, '请求来源无效。');
  }
  const session = await requireCloudSession(context);
  if (session.response) return session.response;
  const slotId = context.params?.slotId;
  if (!validSlotId(slotId)) return cloudError('invalid_slot_id', 400, '云存档槽位 ID 无效。');

  const limits = getCloudLimits(env);
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > limits.uploadBytes) {
    return cloudError('payload_too_large', 413, '单个云存档压缩包不能超过 10 MB。');
  }
  const baseRevision = parseRevision(request.headers.get('x-coc-base-revision'));
  const expectedChecksum = request.headers.get('x-coc-save-checksum') ?? '';
  const metadata = parseCloudSaveMetadataHeader(request);
  if (baseRevision === null || !/^[a-f0-9]{64}$/.test(expectedChecksum) || !metadata) {
    return cloudError('invalid_upload_metadata', 400, '云存档元数据不完整。');
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length <= 0 || body.length > limits.uploadBytes) {
    return cloudError('payload_too_large', 413, '单个云存档压缩包不能超过 10 MB。');
  }
  const checksum = await sha256Hex(body);
  if (checksum !== expectedChecksum) {
    return cloudError('checksum_mismatch', 400, '云存档校验值不一致。');
  }

  const existing = await readSlot(env, session.user.user_id, slotId);
  const currentRevision = Number(existing?.revision ?? 0);
  if (currentRevision !== baseRevision) {
    return cloudError('cloud_save_conflict', 409, '云端存档已被其他设备更新。', {
      current: existing ? {
        slotId,
        revision: currentRevision,
        sizeBytes: Number(existing.size_bytes),
        checksumSha256: existing.checksum_sha256,
        updatedAt: existing.updated_at,
        metadata: parseMetadata(existing.metadata_json),
      } : null,
    });
  }

  if (!existing) {
    const count = await env.CLOUD_SAVE_DB.prepare(
      'SELECT COUNT(*) AS count FROM cloud_saves WHERE user_id = ?1',
    ).bind(session.user.user_id).first();
    if (Number(count?.count ?? 0) >= limits.slots) {
      return cloudError('slot_limit_exceeded', 409, `每个 Discord 账户最多保留 ${limits.slots} 个云存档。`);
    }
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const uploadDay = nowIso.slice(0, 10);
  const nextRevision = currentRevision + 1;
  const reservationId = `res_${randomToken(18)}`;
  const objectKey = `users/${session.user.user_id}/saves/${slotId}/${reservationId}.zip`;
  const previousSize = Number(existing?.size_bytes ?? 0);
  const growthBytes = Math.max(0, body.length - previousSize);
  await env.CLOUD_SAVE_DB.prepare(
    'DELETE FROM cloud_upload_reservations WHERE expires_at <= ?1',
  ).bind(nowIso).run();
  await env.CLOUD_SAVE_DB.prepare(`
    UPDATE cloud_quota
    SET limit_bytes = MIN(limit_bytes, ?1), updated_at = ?2
    WHERE scope = 'global'
  `).bind(limits.globalBytes, nowIso).run();
  await env.CLOUD_SAVE_DB.batch([
    env.CLOUD_SAVE_DB.prepare(`
      INSERT INTO cloud_daily_usage(day, upload_count, upload_limit, updated_at)
      VALUES (?1, 0, ?2, ?3)
      ON CONFLICT(day) DO UPDATE SET upload_limit = MIN(upload_limit, excluded.upload_limit)
    `).bind(uploadDay, limits.dailyUploads, nowIso),
    env.CLOUD_SAVE_DB.prepare(`
      INSERT INTO cloud_user_daily_usage(day, user_id, upload_count, upload_limit, updated_at)
      VALUES (?1, ?2, 0, ?3, ?4)
      ON CONFLICT(day, user_id) DO UPDATE SET upload_limit = MIN(upload_limit, excluded.upload_limit)
    `).bind(uploadDay, session.user.user_id, limits.userDailyUploads, nowIso),
  ]);

  try {
    await env.CLOUD_SAVE_DB.prepare(`
      INSERT INTO cloud_upload_reservations (
        reservation_id, user_id, slot_id, target_kind, expected_revision, next_revision,
        next_object_key, upload_bytes, user_growth_bytes, user_limit_bytes,
        created_at, expires_at, upload_day
      ) VALUES (?1, ?2, ?3, 'save', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    `).bind(
      reservationId,
      session.user.user_id,
      slotId,
      currentRevision,
      nextRevision,
      objectKey,
      body.length,
      growthBytes,
      limits.userBytes,
      nowIso,
      new Date(now.getTime() + 15 * 60 * 1_000).toISOString(),
      uploadDay,
    ).run();
  } catch (error) {
    const code = databaseErrorCode(error);
    if (code === 'global_quota_exceeded') {
      return cloudError(code, 507, '云存档公共免费额度已接近上限，暂时停止上传。');
    }
    if (code === 'user_quota_exceeded') {
      return cloudError(code, 507, '你的云存档已达到 50 MB 上限，请先删除旧档。');
    }
    if (code === 'daily_upload_limit_exceeded') {
      return cloudError(code, 429, '今日公共云同步次数已达到免费额度保护线，请明日再试。');
    }
    if (code === 'user_daily_upload_limit_exceeded') {
      return cloudError(code, 429, '你今天的云端上传次数已达到 100 次，请明日再试。');
    }
    throw error;
  }

  let objectWritten = false;
  try {
    await env.CLOUD_SAVE_BUCKET.put(objectKey, body, {
      httpMetadata: { contentType: 'application/zip' },
      customMetadata: { slotId, revision: String(nextRevision), checksum },
    });
    objectWritten = true;

    const metadataJson = JSON.stringify(metadata);
    const usageDelta = body.length - previousSize;
    const saveStatement = existing
      ? env.CLOUD_SAVE_DB.prepare(`
          UPDATE cloud_saves
          SET revision = ?4, object_key = ?5, size_bytes = ?6,
              checksum_sha256 = ?7, metadata_json = ?8, updated_at = ?9
          WHERE user_id = ?1 AND slot_id = ?2 AND revision = ?3
        `).bind(
          session.user.user_id, slotId, currentRevision, nextRevision, objectKey,
          body.length, checksum, metadataJson, nowIso,
        )
      : env.CLOUD_SAVE_DB.prepare(`
          INSERT INTO cloud_saves (
            user_id, slot_id, revision, object_key, size_bytes,
            checksum_sha256, metadata_json, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
        `).bind(
          session.user.user_id, slotId, nextRevision, objectKey, body.length,
          checksum, metadataJson, nowIso,
        );

    await env.CLOUD_SAVE_DB.batch([
      saveStatement,
      env.CLOUD_SAVE_DB.prepare(`
        UPDATE cloud_users
        SET usage_bytes = usage_bytes + ?2, updated_at = ?3
        WHERE user_id = ?1
      `).bind(session.user.user_id, usageDelta, nowIso),
      env.CLOUD_SAVE_DB.prepare(`
        UPDATE cloud_quota
        SET used_bytes = used_bytes + ?1, updated_at = ?2
        WHERE scope = 'global'
      `).bind(usageDelta, nowIso),
      env.CLOUD_SAVE_DB.prepare(`
        UPDATE cloud_upload_reservations SET finalized = 1
        WHERE reservation_id = ?1
      `).bind(reservationId),
      env.CLOUD_SAVE_DB.prepare(
        'DELETE FROM cloud_upload_reservations WHERE reservation_id = ?1',
      ).bind(reservationId),
    ]);

    if (existing?.object_key && existing.object_key !== objectKey) {
      await env.CLOUD_SAVE_BUCKET.delete(existing.object_key);
    }
    return cloudJsonResponse({
      ok: true,
      save: {
        slotId,
        revision: nextRevision,
        sizeBytes: body.length,
        checksumSha256: checksum,
        createdAt: existing?.created_at ?? nowIso,
        updatedAt: nowIso,
        metadata,
      },
      usageDelta,
    });
  } catch (error) {
    if (objectWritten) {
      try { await env.CLOUD_SAVE_BUCKET.delete(objectKey); } catch { /* best-effort */ }
    }
    try {
      await env.CLOUD_SAVE_DB.prepare(
        'DELETE FROM cloud_upload_reservations WHERE reservation_id = ?1',
      ).bind(reservationId).run();
    } catch {
      // Expired reservations are reclaimed before later uploads.
    }
    if (String(error instanceof Error ? error.message : error).includes('cloud_save_conflict')) {
      return cloudError('cloud_save_conflict', 409, '云端存档已被其他设备更新，请刷新后重试。');
    }
    return cloudError('cloud_upload_failed', 503, '云存档上传失败，本地存档不受影响。');
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!isTrustedMutationRequest(request, env)) {
    return cloudError('invalid_origin', 403, '请求来源无效。');
  }
  const session = await requireCloudSession(context);
  if (session.response) return session.response;
  const slotId = context.params?.slotId;
  if (!validSlotId(slotId)) return cloudError('invalid_slot_id', 400, '云存档槽位 ID 无效。');
  const expectedRevision = parseRevision(request.headers.get('x-coc-base-revision'));
  const existing = await readSlot(env, session.user.user_id, slotId);
  if (!existing) return cloudJsonResponse({ ok: true, deleted: false });
  if (expectedRevision === null || expectedRevision !== Number(existing.revision)) {
    return cloudError('cloud_save_conflict', 409, '云端存档已被其他设备更新，请刷新后重试。');
  }

  try {
    await env.CLOUD_SAVE_BUCKET.delete(existing.object_key);
  } catch {
    return cloudError('cloud_storage_failed', 503, '云端对象删除失败，未修改存档索引。');
  }
  const nowIso = new Date().toISOString();
  const releasedBytes = Number(existing.size_bytes);
  await env.CLOUD_SAVE_DB.batch([
    env.CLOUD_SAVE_DB.prepare(`
      DELETE FROM cloud_saves WHERE user_id = ?1 AND slot_id = ?2 AND revision = ?3
    `).bind(session.user.user_id, slotId, expectedRevision),
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
  return cloudJsonResponse({ ok: true, deleted: true });
}

export function onRequest() {
  return cloudError('method_not_allowed', 405, '仅支持 GET、PUT 或 DELETE。', {}, {
    allow: 'GET, PUT, DELETE',
  });
}

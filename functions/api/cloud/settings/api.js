import {
  CLOUD_SETTINGS_UPLOAD_LIMIT_BYTES,
  cloudError,
  cloudJsonResponse,
  databaseErrorCode,
  getCloudLimits,
  isTrustedMutationRequest,
  randomToken,
  requireCloudSession,
  sha256Hex,
} from '../../../_shared/cloud.js';

function parseRevision(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function publicSettings(row) {
  if (!row) return null;
  return {
    revision: Number(row.revision),
    sizeBytes: Number(row.size_bytes),
    checksumSha256: row.checksum_sha256,
    syncMode: row.sync_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readSettings(env, userId) {
  return env.CLOUD_SAVE_DB.prepare(`
    SELECT revision, object_key, size_bytes, checksum_sha256,
           sync_mode, created_at, updated_at
    FROM cloud_settings
    WHERE user_id = ?1 AND kind = 'api_settings'
  `).bind(userId).first();
}

export async function onRequestGet(context) {
  const session = await requireCloudSession(context);
  if (session.response) return session.response;
  const row = await readSettings(context.env, session.user.user_id);
  const url = new URL(context.request.url);
  if (url.searchParams.get('download') !== '1') {
    return cloudJsonResponse({ ok: true, settings: publicSettings(row) });
  }
  if (!row) return cloudError('cloud_settings_not_found', 404, '云端没有 API 配置快照。');
  const object = await context.env.CLOUD_SAVE_BUCKET.get(row.object_key);
  if (!object) return cloudError('cloud_object_missing', 503, '云端 API 配置对象缺失。');
  return new Response(object.body, {
    status: 200,
    headers: {
      'cache-control': 'no-store, max-age=0',
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename="coc-cloud-api-settings.bin"',
      'x-coc-settings-revision': String(row.revision),
      'x-coc-settings-checksum': row.checksum_sha256,
      'x-coc-settings-mode': row.sync_mode,
    },
  });
}

export async function onRequestPut(context) {
  const { request, env } = context;
  if (!isTrustedMutationRequest(request, env)) {
    return cloudError('invalid_origin', 403, '请求来源无效。');
  }
  const session = await requireCloudSession(context);
  if (session.response) return session.response;
  const baseRevision = parseRevision(request.headers.get('x-coc-base-revision'));
  const syncMode = request.headers.get('x-coc-settings-mode');
  const expectedChecksum = request.headers.get('x-coc-settings-checksum') ?? '';
  if (
    baseRevision === null
    || (syncMode !== 'routes_only' && syncMode !== 'encrypted_full')
    || !/^[a-f0-9]{64}$/.test(expectedChecksum)
  ) {
    return cloudError('invalid_upload_metadata', 400, 'API 配置快照元数据不完整。');
  }
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > CLOUD_SETTINGS_UPLOAD_LIMIT_BYTES) {
    return cloudError('payload_too_large', 413, 'API 配置快照不能超过 1 MB。');
  }
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length <= 0 || body.length > CLOUD_SETTINGS_UPLOAD_LIMIT_BYTES) {
    return cloudError('payload_too_large', 413, 'API 配置快照不能超过 1 MB。');
  }
  const checksum = await sha256Hex(body);
  if (checksum !== expectedChecksum) {
    return cloudError('checksum_mismatch', 400, 'API 配置快照校验值不一致。');
  }

  const existing = await readSettings(env, session.user.user_id);
  const currentRevision = Number(existing?.revision ?? 0);
  if (currentRevision !== baseRevision) {
    return cloudError('cloud_settings_conflict', 409, '云端 API 配置已被其他设备更新。', {
      current: publicSettings(existing),
    });
  }

  const limits = getCloudLimits(env);
  const now = new Date();
  const nowIso = now.toISOString();
  const uploadDay = nowIso.slice(0, 10);
  const nextRevision = currentRevision + 1;
  const reservationId = `res_${randomToken(18)}`;
  const objectKey = `users/${session.user.user_id}/settings/api/${reservationId}.bin`;
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
      ) VALUES (?1, ?2, 'api_settings', 'api_settings', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    `).bind(
      reservationId,
      session.user.user_id,
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
      return cloudError(code, 507, '你的云空间已达到 50 MB 上限，请先删除旧档。');
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
      httpMetadata: { contentType: 'application/octet-stream' },
      customMetadata: { kind: 'api_settings', revision: String(nextRevision), checksum, syncMode },
    });
    objectWritten = true;
    const usageDelta = body.length - previousSize;
    const settingsStatement = existing
      ? env.CLOUD_SAVE_DB.prepare(`
          UPDATE cloud_settings
          SET revision = ?3, object_key = ?4, size_bytes = ?5,
              checksum_sha256 = ?6, sync_mode = ?7, updated_at = ?8
          WHERE user_id = ?1 AND kind = 'api_settings' AND revision = ?2
        `).bind(
          session.user.user_id, currentRevision, nextRevision, objectKey,
          body.length, checksum, syncMode, nowIso,
        )
      : env.CLOUD_SAVE_DB.prepare(`
          INSERT INTO cloud_settings (
            user_id, kind, revision, object_key, size_bytes,
            checksum_sha256, sync_mode, created_at, updated_at
          ) VALUES (?1, 'api_settings', ?2, ?3, ?4, ?5, ?6, ?7, ?7)
        `).bind(
          session.user.user_id, nextRevision, objectKey, body.length,
          checksum, syncMode, nowIso,
        );
    await env.CLOUD_SAVE_DB.batch([
      settingsStatement,
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
      settings: publicSettings({
        revision: nextRevision,
        size_bytes: body.length,
        checksum_sha256: checksum,
        sync_mode: syncMode,
        created_at: existing?.created_at ?? nowIso,
        updated_at: nowIso,
      }),
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
      return cloudError('cloud_settings_conflict', 409, '云端 API 配置已被其他设备更新。');
    }
    return cloudError('cloud_settings_upload_failed', 503, 'API 配置上传失败，本机设置不受影响。');
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!isTrustedMutationRequest(request, env)) {
    return cloudError('invalid_origin', 403, '请求来源无效。');
  }
  const session = await requireCloudSession(context);
  if (session.response) return session.response;
  const expectedRevision = parseRevision(request.headers.get('x-coc-base-revision'));
  const existing = await readSettings(env, session.user.user_id);
  if (!existing) return cloudJsonResponse({ ok: true, deleted: false });
  if (expectedRevision === null || expectedRevision !== Number(existing.revision)) {
    return cloudError('cloud_settings_conflict', 409, '云端 API 配置已被其他设备更新。');
  }
  try {
    await env.CLOUD_SAVE_BUCKET.delete(existing.object_key);
  } catch {
    return cloudError('cloud_storage_failed', 503, '云端 API 配置对象删除失败。');
  }
  const nowIso = new Date().toISOString();
  const releasedBytes = Number(existing.size_bytes);
  await env.CLOUD_SAVE_DB.batch([
    env.CLOUD_SAVE_DB.prepare(`
      DELETE FROM cloud_settings
      WHERE user_id = ?1 AND kind = 'api_settings' AND revision = ?2
    `).bind(session.user.user_id, expectedRevision),
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

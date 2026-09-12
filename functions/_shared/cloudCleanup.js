import { cloudError, cloudJsonResponse } from './cloud.js';

// Rows are queued by the same D1 transaction that removes/replaces the index.
// A failed R2 delete leaves a durable retry record, never a dangling live save.
export async function drainCloudObjectCleanup(env, userId) {
  try {
    const pending = await env.CLOUD_SAVE_DB.prepare(
      'SELECT object_key FROM cloud_object_cleanup WHERE user_id = ?1 LIMIT 32',
    ).bind(userId).all();
    for (const row of pending.results ?? []) {
      try {
        await env.CLOUD_SAVE_BUCKET.delete(row.object_key);
        await env.CLOUD_SAVE_DB.prepare('DELETE FROM cloud_object_cleanup WHERE object_key = ?1').bind(row.object_key).run();
      } catch { /* Retain the queue row for the next request. */ }
    }
  } catch { /* Cleanup must not turn an already committed write into a failure. */ }
}

export async function deleteCloudRows(env, userId, kind, slotId, revision) {
  const sql = kind === 'settings'
    ? "DELETE FROM cloud_settings WHERE user_id = ?1 AND kind = 'api_settings' AND revision = ?2"
    : kind === 'all' ? 'DELETE FROM cloud_saves WHERE user_id = ?1'
      : 'DELETE FROM cloud_saves WHERE user_id = ?1 AND slot_id = ?2 AND revision = ?3';
  const values = kind === 'settings' ? [userId, revision] : kind === 'all' ? [userId] : [userId, slotId, revision];
  let results;
  try {
    await env.CLOUD_SAVE_DB.prepare('SELECT object_key FROM cloud_object_cleanup LIMIT 0').all();
    results = await env.CLOUD_SAVE_DB.batch([env.CLOUD_SAVE_DB.prepare(sql).bind(...values)]);
  } catch {
    return cloudError('cloud_delete_failed', 503, '云端删除未完成，存档正文保留，请稍后重试。');
  }
  const count = Number(results[0]?.meta?.changes ?? 0);
  if (kind !== 'all' && !count) return cloudError('cloud_save_conflict', 409, '云端数据已变化，请刷新后重试。');
  await drainCloudObjectCleanup(env, userId);
  return cloudJsonResponse({ ok: true, deleted: kind === 'all' ? count : true });
}

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { deleteCloudRows, drainCloudObjectCleanup } from '../../_shared/cloudCleanup.js';

function setup() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_cloud_saves.sql', '0002_daily_upload_limits.sql', '0003_atomic_cleanup.sql']) {
    db.exec(readFileSync(`migrations/cloud-saves/${file}`, 'utf8'));
  }
  db.exec("INSERT INTO cloud_users(user_id,discord_id,username,created_at,updated_at,usage_bytes) VALUES('u','d','user','now','now',6); UPDATE cloud_quota SET used_bytes=6;");
  db.exec("INSERT INTO cloud_saves VALUES('u','slot',1,'object',3,'checksum','{}','now','now'); INSERT INTO cloud_settings VALUES('u','api_settings',1,'settings-object',3,'checksum','routes_only','now','now');");
  const objects = new Set(['object', 'settings-object']);
  const prepare = sql => ({
    values: [], bind(...values) { this.values = values; return this; },
    async all() { return { results: db.prepare(sql).all(...this.values) }; },
    async run() { return { meta: db.prepare(sql).run(...this.values) }; },
  });
  const env = { CLOUD_SAVE_DB: { prepare, batch: vi.fn(async statements => {
    db.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }) }, CLOUD_SAVE_BUCKET: { delete: vi.fn(async key => { objects.delete(key); }) } };
  return { db, env, objects };
}

describe('atomic cloud deletion', () => {
  it('counts pending new-slot reservations inside the atomic slot guard', () => {
    const { db } = setup();
    try {
      const insert = db.prepare("INSERT INTO cloud_upload_reservations(reservation_id,user_id,slot_id,target_kind,expected_revision,next_revision,next_object_key,upload_bytes,user_growth_bytes,user_limit_bytes,created_at,expires_at,slot_limit) VALUES(?,'u',?,'save',0,1,?,3,3,1000,'now','later',2)");
      insert.run('r1', 'new-slot-1', 'new-object-1');
      expect(() => insert.run('r2', 'new-slot-2', 'new-object-2')).toThrow('slot_limit_exceeded');
      db.exec("DELETE FROM cloud_upload_reservations WHERE reservation_id='r1'");
      expect(db.prepare('SELECT object_key FROM cloud_object_cleanup').get().object_key).toBe('new-object-1');
    } finally { db.close(); }
  });
  it.each(['save', 'settings', 'all'])('%s retains objects when D1 fails', async kind => {
    const { db, env, objects } = setup();
    try {
      env.CLOUD_SAVE_DB.batch.mockRejectedValueOnce(new Error('D1 unavailable'));
      expect((await deleteCloudRows(env, 'u', kind, 'slot', 1)).status).toBe(503);
      expect(objects.size).toBe(2);
      expect(env.CLOUD_SAVE_BUCKET.delete).not.toHaveBeenCalled();
    } finally { db.close(); }
  });
  it('queues failed object cleanup durably and never deducts usage twice', async () => {
    const { db, env, objects } = setup();
    try {
      env.CLOUD_SAVE_BUCKET.delete.mockRejectedValueOnce(new Error('R2 unavailable'));
      expect((await deleteCloudRows(env, 'u', 'save', 'slot', 1)).status).toBe(200);
      expect(objects.has('object')).toBe(true);
      expect(db.prepare('SELECT * FROM cloud_object_cleanup').all()).toHaveLength(1);
      expect((await deleteCloudRows(env, 'u', 'save', 'slot', 1)).status).toBe(409);
      expect(db.prepare("SELECT used_bytes FROM cloud_quota WHERE scope='global'").get().used_bytes).toBe(3);
      await drainCloudObjectCleanup(env, 'u');
      expect(objects.has('object')).toBe(false);
      expect(db.prepare('SELECT * FROM cloud_object_cleanup').all()).toHaveLength(0);
    } finally { db.close(); }
  });
  it('does not delete a revision changed by another device', async () => {
    const { db, env, objects } = setup();
    try {
      db.exec("UPDATE cloud_saves SET revision=2 WHERE slot_id='slot'");
      expect((await deleteCloudRows(env, 'u', 'save', 'slot', 1)).status).toBe(409);
      expect(objects.size).toBe(2);
      expect(db.prepare('SELECT usage_bytes FROM cloud_users').get().usage_bytes).toBe(6);
    } finally { db.close(); }
  });
});

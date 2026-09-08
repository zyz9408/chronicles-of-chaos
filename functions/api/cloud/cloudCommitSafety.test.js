import { describe, expect, it, vi } from 'vitest';
vi.mock('../../_shared/cloud.js', async (original) => ({
  ...await original(),
  requireCloudSession: async () => ({ user: { user_id: 'test-user' } }),
  isTrustedMutationRequest: () => true,
  parseCloudSaveMetadataHeader: () => ({ label: 'test', playerName: 'test', currentDate: 'test', locationName: 'test', updatedAt: 'test', saveKind: 'manual', turnCount: 1 }),
}));
import { onRequestPut as putSave } from './saves/[slotId].js';
import { onRequestPut as putSettings } from './settings/api.js';
import { sha256Hex } from '../../_shared/cloud.js';

describe('cloud publication commit boundary (v1.8.7)', () => {
  for (const [kind, handler] of [['save', putSave], ['settings', putSettings]]) {
    for (const failCommit of [false, true]) it(`${kind}: ${failCommit ? 'failed commit preserves old object' : 'failed old cleanup preserves committed new object'}`, async () => {
      const body = new Uint8Array([1, 2, 3]);
      const checksum = await sha256Hex(body);
      const objects = new Map([['old-object', body]]);
      const existing = { revision: 1, object_key: 'old-object', size_bytes: body.length, created_at: 'before', updated_at: 'before' };
      const prepare = (sql) => ({ sql, bind() { return this; }, async first() { return existing; }, async run() { return { success: true }; } });
      const database = { prepare, batch: vi.fn(async (statements) => {
        if (statements.some((statement) => /UPDATE cloud_(saves|settings)\s/u.test(statement.sql))) {
          if (failCommit) throw new Error('transaction failed');
        }
        return [];
      }) };
      const bucket = { put: vi.fn(async (key, value) => objects.set(key, value)), delete: vi.fn(async (key) => {
        if (key === 'old-object') throw new Error('cleanup unavailable');
        objects.delete(key);
      }) };
      const request = new Request('https://example.test/api/cloud/upload', { method: 'PUT', body, headers: {
        'x-coc-base-revision': '1', 'x-coc-save-checksum': checksum,
        'x-coc-settings-checksum': checksum, 'x-coc-settings-mode': 'routes_only',
      } });
      const result = await handler({ request, env: { CLOUD_SAVE_DB: database, CLOUD_SAVE_BUCKET: bucket }, params: { slotId: 'slot_1' } });
      expect(result.status).toBe(failCommit ? 503 : 200);
      expect(objects.has('old-object')).toBe(true);
      expect(objects.size).toBe(failCommit ? 1 : 2);
      if (!failCommit) expect(bucket.delete).not.toHaveBeenCalledWith(bucket.put.mock.calls[0][0]);
    });
  }
});

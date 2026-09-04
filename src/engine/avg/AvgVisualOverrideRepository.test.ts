import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  IndexedDbAvgVisualOverrideRepository,
  createAvgActorTarget,
  createAvgSceneTarget,
  resetAvgVisualDatabaseForTests,
  validateAvgImage,
} from './AvgVisualOverrideRepository';

const databaseName = 'avg-visual-test';

function pngBlob(seed = 0): Blob {
  return new Blob([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]),
  ], { type: 'image/png' });
}

async function image(seed = 0) {
  return validateAvgImage(pngBlob(seed), { decodeDimensions: async () => ({ width: 1024, height: 1536 }) });
}

describe('IndexedDbAvgVisualOverrideRepository', () => {
  beforeEach(async () => {
    await resetAvgVisualDatabaseForTests(databaseName);
  });

  it('validates content type and stores actor/scene images by SHA-256', async () => {
    const repository = new IndexedDbAvgVisualOverrideRepository(databaseName);
    const actor = createAvgActorTarget('save-a', 'threeKingdoms', 'npc_guan_yu');
    const scene = createAvgSceneTarget('save-a', 'threeKingdoms', { kind: 'runtime-place', id: 'loc_xuchang' });
    const validated = await image();

    const actorRecord = await repository.replace(actor, validated);
    await repository.replace(scene, validated);

    expect(actorRecord.assetId).toBe(`local-avg-sha256:${validated.sha256}`);
    expect(await repository.lookup(actor)).toMatchObject({ status: 'found', record: { actorId: 'npc_guan_yu' } });
    const snapshot = await repository.exportPartition('save-a');
    expect(snapshot).toMatchObject({ actorCount: 1, sceneCount: 1, missingAssetCount: 0 });
    expect(snapshot.assets).toHaveLength(1);
  });

  it('rejects spoofed image MIME types before persistence', async () => {
    const spoofed = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/png' });
    await expect(validateAvgImage(spoofed, { decodeDimensions: async () => ({ width: 1, height: 1 }) }))
      .rejects.toThrow('文件内容与图片格式不一致');
  });

  it('keeps shared assets until their final reference is removed', async () => {
    const repository = new IndexedDbAvgVisualOverrideRepository(databaseName);
    const first = createAvgActorTarget('save-a', 'threeKingdoms', 'npc_guan_yu');
    const second = createAvgActorTarget('save-a', 'threeKingdoms', 'npc_zhang_fei');
    const validated = await image();
    await repository.replace(first, validated);
    await repository.replace(second, validated);

    await repository.remove(first);
    expect((await repository.lookup(second)).status).toBe('found');
    await repository.remove(second);
    expect((await repository.exportPartition('save-a')).assets).toEqual([]);
  });

  it('atomically restores outfits, selections, overrides, and blobs', async () => {
    const repository = new IndexedDbAvgVisualOverrideRepository(databaseName);
    const owner = { visualPartitionId: 'save-a', worldBookId: 'threeKingdoms', actorId: 'npc_guan_yu' };
    const outfit = await repository.createUserOutfit(owner, { name: ' 夜战披风 ', note: '虎牢关之后。' });
    await repository.selectUserOutfit(owner, outfit.outfitId);
    await repository.replaceOutfitImage(owner, outfit.outfitId, await image(1));
    const selectedVisual = await repository.lookup(createAvgActorTarget('save-a', 'threeKingdoms', 'npc_guan_yu'));
    expect(selectedVisual.status).toBe('found');
    if (selectedVisual.status === 'found') {
      const bytes = new Uint8Array(await selectedVisual.blob.arrayBuffer());
      expect(bytes[bytes.length - 1]).toBe(1);
    }
    expect(await repository.removeOutfitImage(owner, outfit.outfitId)).toBe(true);
    expect((await repository.lookup(createAvgActorTarget('save-a', 'threeKingdoms', 'npc_guan_yu'))).status).toBe('missing');
    await repository.replaceOutfitImage(owner, outfit.outfitId, await image(1));
    const exported = await repository.exportPartition('save-a');

    await repository.deletePartitions(['save-a']);
    expect((await repository.exportPartition('save-a')).outfitCount).toBe(0);
    await repository.replacePartitions([exported]);

    const restored = await repository.exportPartition('save-a');
    expect(restored).toMatchObject({ outfitCount: 1, outfitOverrideCount: 1, missingAssetCount: 0 });
    expect(restored.outfitSelections[0].outfitId).toBe(outfit.outfitId);
  });

  it('rejects cross-partition references before an atomic replacement starts', async () => {
    const repository = new IndexedDbAvgVisualOverrideRepository(databaseName);
    const target = createAvgActorTarget('save-a', 'threeKingdoms', 'npc_guan_yu');
    await repository.replace(target, await image());
    const snapshot = await repository.exportPartition('save-a');
    snapshot.records[0].visualPartitionId = 'save-b';

    await expect(repository.replacePartitions([snapshot])).rejects.toThrow('归属不一致');
    expect((await repository.lookup(target)).status).toBe('found');
  });
});

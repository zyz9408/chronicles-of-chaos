import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAvgPortraitMatchProfile } from './AvgPortraitLibrary';
import { createAvgVisualPartitionArchive, parseAvgVisualPartitionArchive } from './AvgVisualPartitionArchive';
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
  it('retains multiple generated candidates while pinning each borrower once, including concurrent reads and reloads', async () => {
    const repository = new IndexedDbAvgVisualOverrideRepository(databaseName);
    const source = createAvgActorTarget('save-a', 'threeKingdoms', 'guard-source');
    const profile = createAvgPortraitMatchProfile({ sex: '男', age: 30, roleFamily: '守卒' })!;
    await repository.saveGeneratedActorPortrait(source, await image(1), { portraitProfile: profile, registerAdaptiveCandidate: true });
    await repository.saveGeneratedActorPortrait(source, await image(2), { portraitProfile: profile, registerAdaptiveCandidate: true });
    expect((await repository.exportPartition('save-a')).records.filter((row) => row.portraitScope === 'adaptive-candidate')).toHaveLength(2);
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValue(0.999);
    try {
      const a = createAvgActorTarget('save-a', 'threeKingdoms', 'guard-a');
      const b = createAvgActorTarget('save-a', 'threeKingdoms', 'guard-b');
      const [first, duplicate] = await Promise.all([repository.lookup(a, { actorProfile: profile, rememberMatch: true }), repository.lookup(a, { actorProfile: profile, rememberMatch: true })]);
      expect(duplicate).toEqual(first);
      const second = await repository.lookup(b, { actorProfile: profile, rememberMatch: true });
      expect(first.status === 'found' && second.status === 'found' && first.record.sha256 !== second.record.sha256).toBe(true);
      await repository.saveGeneratedActorPortrait(source, await image(3), { portraitProfile: profile, registerAdaptiveCandidate: true });
      expect((await repository.exportPartition('save-a')).records.filter((row) => row.portraitScope === 'adaptive-candidate')).toHaveLength(3);
      expect(await new IndexedDbAvgVisualOverrideRepository(databaseName).lookup(a, { actorProfile: profile, rememberMatch: true })).toEqual(first);
      expect(await repository.lookup(b)).toEqual(second);
      const archive = await createAvgVisualPartitionArchive(await repository.exportPartition('save-a'));
      const restored = await parseAvgVisualPartitionArchive(archive!.archiveBytes, { expectedSummary: archive!.summary, decodeDimensions: async () => ({ width: 1024, height: 1536 }) });
      await repository.clear();
      await repository.replacePartitions([restored]);
      expect((await repository.exportPartition('save-a')).records.filter((row) => row.portraitScope === 'adaptive-candidate')).toHaveLength(3);
      expect(await repository.lookup(a)).toEqual(first);
      expect(await repository.lookup(b)).toEqual(second);
    } finally { random.mockRestore(); }
  });
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

  it('registers a generated portrait, matches a new ordinary actor, and keeps that face after the library grows', async () => {
    const repository = new IndexedDbAvgVisualOverrideRepository(databaseName);
    const profile = createAvgPortraitMatchProfile({ sex: '男', age: 30, roleFamily: '军士' })!;
    const first = createAvgActorTarget('save-a', 'threeKingdoms', 'soldier-a');
    const next = createAvgActorTarget('save-a', 'threeKingdoms', 'soldier-b');
    const portrait = await image(2);
    await repository.saveGeneratedActorPortrait(first, portrait, { portraitProfile: profile, registerAdaptiveCandidate: true });
    expect(await repository.lookup(next)).toEqual({ status: 'missing' });
    expect(await repository.lookup(next, { actorProfile: profile, rememberMatch: true })).toMatchObject({ status: 'found', record: { actorId: 'soldier-b', sha256: portrait.sha256 } });
    await repository.saveGeneratedActorPortrait(createAvgActorTarget('save-a', 'threeKingdoms', 'soldier-c'), await image(3), { portraitProfile: profile, registerAdaptiveCandidate: true });
    expect(await repository.lookup(next)).toMatchObject({ status: 'found', record: { sha256: portrait.sha256 } });
    expect(await repository.lookup(createAvgActorTarget('save-b', 'threeKingdoms', 'outsider'), { actorProfile: profile })).toEqual({ status: 'missing' });
    expect(await repository.lookup(createAvgActorTarget('save-a', 'other-world', 'outsider'), { actorProfile: profile })).toEqual({ status: 'missing' });
  });

  it('keeps dedicated portraits out of the reusable library and clears an active outfit when applying a new default portrait', async () => {
    const repository = new IndexedDbAvgVisualOverrideRepository(databaseName);
    const target = createAvgActorTarget('save-a', 'threeKingdoms', 'guan-yu');
    const profile = createAvgPortraitMatchProfile({ sex: '男', age: 30, roleFamily: '军士' })!;
    const outfit = await repository.createUserOutfit(target, { name: '便服' });
    await repository.replaceOutfitImage(target, outfit.outfitId, await image(1));
    await repository.selectUserOutfit(target, outfit.outfitId);
    const portrait = await image(2);
    await repository.saveGeneratedActorPortrait(target, portrait, { portraitProfile: profile, registerAdaptiveCandidate: false });
    expect(await repository.lookup(target)).toMatchObject({ status: 'found', record: { sha256: portrait.sha256 } });
    expect(await repository.getSelectedUserOutfit(target)).toBeUndefined();
    expect(await repository.lookup(createAvgActorTarget('save-a', 'threeKingdoms', 'ordinary'), { actorProfile: profile })).toEqual({ status: 'missing' });
    expect((await repository.listUserOutfits(target)).length).toBe(1);
  });

  it('preserves the generated library and exact bindings across portable export/import and source deletion', async () => {
    const repository = new IndexedDbAvgVisualOverrideRepository(databaseName);
    const target = createAvgActorTarget('save-a', 'threeKingdoms', 'merchant-a');
    const borrower = createAvgActorTarget('save-a', 'threeKingdoms', 'merchant-b');
    const profile = createAvgPortraitMatchProfile({ sex: '女', age: 32, roleFamily: '商人' })!;
    await repository.saveGeneratedActorPortrait(target, await image(4), { portraitProfile: profile, registerAdaptiveCandidate: true });
    await repository.lookup(borrower, { actorProfile: profile, rememberMatch: true });
    const exported = await createAvgVisualPartitionArchive(await repository.exportPartition('save-a'));
    const restored = await parseAvgVisualPartitionArchive(exported!.archiveBytes, { expectedSummary: exported!.summary, decodeDimensions: async () => ({ width: 1024, height: 1536 }) });
    await repository.clear();
    await repository.replacePartitions([restored]);
    expect((await repository.exportPartition('save-a')).actorCount).toBe(2);
    expect((await repository.lookup(createAvgActorTarget('save-a', 'threeKingdoms', 'merchant-c'), { actorProfile: profile })).status).toBe('found');
    await repository.remove(target);
    expect((await repository.lookup(borrower)).status).toBe('found');
    expect((await repository.lookup(createAvgActorTarget('save-a', 'threeKingdoms', 'merchant-d'), { actorProfile: profile })).status).toBe('missing');
  });
});

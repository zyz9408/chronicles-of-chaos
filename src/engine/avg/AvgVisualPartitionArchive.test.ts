import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { AvgVisualPartitionSnapshot } from './AvgVisualOverrideRepository';
import { createAvgActorTarget, avgVisualTargetKey, validateAvgImage } from './AvgVisualOverrideRepository';
import { createAvgVisualPartitionArchive, parseAvgVisualPartitionArchive } from './AvgVisualPartitionArchive';

async function makeSnapshot(): Promise<AvgVisualPartitionSnapshot> {
  const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' });
  const image = await validateAvgImage(blob, { decodeDimensions: async () => ({ width: 10, height: 20 }) });
  const target = createAvgActorTarget('partition-a', 'threeKingdoms', 'npc_guan_yu');
  const assetId = `local-avg-sha256:${image.sha256}`;
  return {
    visualPartitionId: 'partition-a', actorCount: 1, sceneCount: 0, outfitCount: 0,
    outfitOverrideCount: 0, totalBytes: image.byteSize, missingAssetCount: 0,
    records: [{
      key: avgVisualTargetKey(target), kind: 'actor', visualPartitionId: 'partition-a', worldBookId: 'threeKingdoms',
      actorId: 'npc_guan_yu', assetId, mediaType: image.mediaType, byteSize: image.byteSize,
      width: image.width, height: image.height, sha256: image.sha256, updatedAt: '2026-08-24T00:00:00.000Z',
    }],
    userOutfits: [], outfitSelections: [], outfitOverrides: [], assets: [{ assetId, ...image }],
  };
}

describe('AvgVisualPartitionArchive', () => {
  it('round-trips one fully validated visual partition', async () => {
    const exported = await createAvgVisualPartitionArchive(await makeSnapshot());
    expect(exported).not.toBeNull();
    const parsed = await parseAvgVisualPartitionArchive(exported!.archiveBytes, {
      expectedVisualPartitionId: 'partition-a',
      expectedSummary: exported!.summary,
      decodeDimensions: async () => ({ width: 10, height: 20 }),
    });
    expect(parsed).toMatchObject({ visualPartitionId: 'partition-a', actorCount: 1, missingAssetCount: 0 });
  });

  it('rejects undeclared files before returning imported state', async () => {
    const exported = await createAvgVisualPartitionArchive(await makeSnapshot());
    const entries = unzipSync(exported!.archiveBytes);
    entries['unexpected.txt'] = new Uint8Array([1]);
    await expect(parseAvgVisualPartitionArchive(zipSync(entries), { decodeDimensions: async () => ({ width: 10, height: 20 }) }))
      .rejects.toThrow('清单之外');
  });
});

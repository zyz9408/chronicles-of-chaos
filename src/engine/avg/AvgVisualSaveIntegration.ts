import type { SaveArchive } from '../save/SaveManager';
import type {
  PortableAvgVisualPartition,
  PortableSaveZipBundle,
} from '../save/SaveArchiveZip';
import {
  createAvgVisualPartitionArchive,
  parseAvgVisualPartitionArchive,
} from './AvgVisualPartitionArchive';
import { IndexedDbAvgVisualOverrideRepository } from './AvgVisualOverrideRepository';
import {
  exportSaves,
  importSaves,
  pruneAutoSaves,
} from '../save/SaveManager';

export function collectSaveVisualPartitionIds(archive: Pick<SaveArchive, 'saves'>): string[] {
  return [...new Set(archive.saves.flatMap((save) => {
    const direct = save.runtimeState.avgPresentation?.visualPartitionId?.trim();
    if (direct) return [direct];
    const legacy = [...new Set((save.runtimeState.avgPresentation?.portraitBindings ?? [])
      .map((binding) => binding.saveId?.trim()).filter(Boolean))];
    return legacy.length === 1 ? legacy : [];
  }))].sort();
}

export async function exportSaveVisualPartitions(
  archive: SaveArchive,
  repository = new IndexedDbAvgVisualOverrideRepository(),
): Promise<PortableAvgVisualPartition[]> {
  const partitions: PortableAvgVisualPartition[] = [];
  for (const visualPartitionId of collectSaveVisualPartitionIds(archive)) {
    const exported = await createAvgVisualPartitionArchive(await repository.exportPartition(visualPartitionId));
    if (!exported) continue;
    partitions.push({
      archiveBytes: exported.archiveBytes,
      ...exported.summary,
    });
  }
  return partitions;
}

export async function preflightSaveVisualImport(bundle: PortableSaveZipBundle) {
  return Promise.all(bundle.avgVisualPartitions.map((partition) => parseAvgVisualPartitionArchive(
    partition.archiveBytes,
    {
      expectedVisualPartitionId: partition.visualPartitionId,
      expectedSummary: partition,
    },
  )));
}

export async function importPreflightedSaveVisuals(
  bundle: PortableSaveZipBundle,
  snapshots: Awaited<ReturnType<typeof preflightSaveVisualImport>>,
  repository = new IndexedDbAvgVisualOverrideRepository(),
): Promise<void> {
  if (bundle.visualCapability === 'none') return;
  await repository.replacePartitions(snapshots);
}

/**
 * Applies a portable save bundle across the save and visual databases with a
 * compensating rollback. IndexedDB cannot create one transaction across two
 * databases, so both previous states are captured before either commit starts.
 */
export async function importPortableSaveBundleAtomically(
  bundle: PortableSaveZipBundle,
  repository = new IndexedDbAvgVisualOverrideRepository(),
  dependencies: {
    exportSaves?: typeof exportSaves;
    importSaves?: typeof importSaves;
  } = {},
): Promise<void> {
  const exportLocalSaves = dependencies.exportSaves ?? exportSaves;
  const importLocalSaves = dependencies.importSaves ?? importSaves;
  const snapshots = await preflightSaveVisualImport(bundle);
  const previousArchive = await exportLocalSaves();
  const touchedPartitionIds = [...new Set(snapshots.map((snapshot) => snapshot.visualPartitionId))];
  const previousPartitions = await Promise.all(touchedPartitionIds.map((id) => repository.exportPartition(id)));
  let savesCommitted = false;
  try {
    await importLocalSaves(bundle.archive, { mode: 'merge' });
    savesCommitted = true;
    await importPreflightedSaveVisuals(bundle, snapshots, repository);
  } catch (error) {
    if (!savesCommitted) throw error;
    let savesRestored = false;
    let visualsRestored = false;
    try {
      await importLocalSaves(previousArchive, { mode: 'replace' });
      savesRestored = true;
    } catch { /* reported below */ }
    try {
      if (previousPartitions.length) await repository.replacePartitions(previousPartitions);
      visualsRestored = true;
    } catch { /* reported below */ }
    if (!savesRestored || !visualsRestored) {
      throw new Error('导入失败且本地恢复不完整，请勿继续覆盖存档并先导出当前数据。');
    }
    throw new Error(`导入失败，本地数据已恢复：${error instanceof Error ? error.message : '未知错误'}`);
  }
}

export async function deleteUnreferencedSaveVisualPartitions(
  previousArchive: SaveArchive,
  currentArchive: SaveArchive,
  repository = new IndexedDbAvgVisualOverrideRepository(),
): Promise<void> {
  const before = new Set(collectSaveVisualPartitionIds(previousArchive));
  const after = new Set(collectSaveVisualPartitionIds(currentArchive));
  await repository.deletePartitions([...before].filter((partitionId) => !after.has(partitionId)));
}

export async function pruneAutoSavesWithVisuals(
  limit: number,
  protectedSaveId?: string,
  repository = new IndexedDbAvgVisualOverrideRepository(),
): Promise<void> {
  const previousArchive = await exportSaves();
  await pruneAutoSaves(limit, protectedSaveId);
  await deleteUnreferencedSaveVisualPartitions(previousArchive, await exportSaves(), repository);
}

import { idbDelete, idbGet, idbPut } from '../storage/IndexedDbStore';
import type { MemoryEmbeddingIndex } from '../types';

interface StoredMemoryEmbeddingIndex extends MemoryEmbeddingIndex {
  id: string;
}

export async function loadMemoryEmbeddingIndex(worldBookId: string): Promise<MemoryEmbeddingIndex | undefined> {
  const stored = await idbGet<StoredMemoryEmbeddingIndex>('memoryEmbeddingIndexes', worldBookId);
  if (!stored) return undefined;

  const { id: _id, ...index } = stored;
  return index;
}

export async function saveMemoryEmbeddingIndex(index: MemoryEmbeddingIndex): Promise<void> {
  await idbPut<StoredMemoryEmbeddingIndex>('memoryEmbeddingIndexes', {
    id: index.worldBookId,
    ...index,
  });
}

export async function deleteMemoryEmbeddingIndex(worldBookId: string): Promise<void> {
  await idbDelete('memoryEmbeddingIndexes', worldBookId);
}

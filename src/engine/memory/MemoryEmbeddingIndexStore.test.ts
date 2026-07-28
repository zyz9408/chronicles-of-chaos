import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetLocalDatabaseForTests } from '../storage/IndexedDbStore';
import type { MemoryEmbeddingIndex } from '../types';
import {
  deleteMemoryEmbeddingIndex,
  loadMemoryEmbeddingIndex,
  saveMemoryEmbeddingIndex,
} from './MemoryEmbeddingIndexStore';

const makeIndex = (worldBookId = 'world_a'): MemoryEmbeddingIndex => ({
  schema: 'coc.v2.memory-embedding-index',
  version: 1,
  worldBookId,
  updatedAt: 'day 30',
  items: [
    {
      indexId: 'longTermFact:fact_1',
      sourceType: 'longTermFact',
      sourceId: 'fact_1',
      text: 'A durable memory fact.',
      searchableText: 'durable memory fact',
      contentHash: '12345678',
      embedding: [0.1, 0.2, 0.3],
      embeddedAt: 'day 30',
      model: 'text-embedding-test',
    },
  ],
});

describe('MemoryEmbeddingIndexStore', () => {
  beforeEach(async () => {
    await resetLocalDatabaseForTests();
  });

  it('persists one embedding index per world book in IndexedDB', async () => {
    await saveMemoryEmbeddingIndex(makeIndex('world_a'));
    await saveMemoryEmbeddingIndex(makeIndex('world_b'));

    expect(await loadMemoryEmbeddingIndex('world_a')).toMatchObject({
      worldBookId: 'world_a',
      items: [{ indexId: 'longTermFact:fact_1', embedding: [0.1, 0.2, 0.3] }],
    });
    expect(await loadMemoryEmbeddingIndex('world_b')).toMatchObject({
      worldBookId: 'world_b',
      items: [{ indexId: 'longTermFact:fact_1' }],
    });
  });

  it('deletes a stored embedding index without touching other world books', async () => {
    await saveMemoryEmbeddingIndex(makeIndex('world_a'));
    await saveMemoryEmbeddingIndex(makeIndex('world_b'));

    await deleteMemoryEmbeddingIndex('world_a');

    expect(await loadMemoryEmbeddingIndex('world_a')).toBeUndefined();
    expect(await loadMemoryEmbeddingIndex('world_b')).toBeTruthy();
  });
});

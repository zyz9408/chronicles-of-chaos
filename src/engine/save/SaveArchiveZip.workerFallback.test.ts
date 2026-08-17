import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('SaveArchiveZip worker compatibility', () => {
  afterEach(() => {
    vi.doUnmock('fflate');
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('falls back to synchronous unzip when a mobile Worker cannot start', async () => {
    const workerError = new Error('Worker is not a constructor');
    const unzip = vi.fn((
      _data: Uint8Array,
      callback: (error: Error, entries: Record<string, Uint8Array>) => void,
    ) => callback(workerError, {}));
    vi.doMock('fflate', () => ({
      strFromU8: (value: Uint8Array) => new TextDecoder().decode(value),
      unzip,
      unzipSync,
    }));
    vi.stubGlobal('Worker', function WorkerStub() {});

    const manifest = {
      format: 'chronicles-of-chaos-v2-save-archive',
      version: 1,
      schema: 'coc.v2.saves',
      archiveVersion: 2,
      exportedAt: '2026-08-02T00:00:00.000Z',
      lastSaveId: null,
      saveCount: 0,
      snapshotCount: 0,
      saves: [],
      turnSnapshots: [],
      assetFolders: {
        characters: 'assets/images/characters',
        locations: 'assets/images/locations',
        events: 'assets/images/events',
        objects: 'assets/images/objects',
      },
    };
    const bytes = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) });
    const { parsePortableSaveZip } = await import('./SaveArchiveZip');

    await expect(parsePortableSaveZip(bytes)).resolves.toEqual({
      schema: 'coc.v2.saves',
      version: 2,
      exportedAt: '2026-08-02T00:00:00.000Z',
      lastSaveId: null,
      saves: [],
      turnSnapshots: [],
    });
    expect(unzip).toHaveBeenCalledOnce();
  });
});

import 'fake-indexeddb/auto';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AVG_RESOURCE_PACK_FORMAT,
  AvgResourcePackManager,
  THREE_KINGDOMS_AVG_REGISTRY_MANIFEST_ID,
  resetAvgResourcePackDatabaseForTests,
} from './AvgResourcePackManager';

const databaseName = 'avg-resource-pack-test';
const webp = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

async function digest(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function archive(overrides: Record<string, unknown> = {}): Promise<Blob> {
  const asset = {
    assetId: 'avg:threeKingdoms:scene:place_test:base',
    path: 'assets/place-test.webp',
    sha256: await digest(webp),
    byteLength: webp.byteLength,
    mediaType: 'image/webp',
    width: 1,
    height: 1,
    kind: 'scene',
    resourceId: 'avg:threeKingdoms:scene:place_test',
  };
  const manifest = {
    format: AVG_RESOURCE_PACK_FORMAT,
    schemaVersion: 1,
    packId: 'three-kingdoms-test',
    worldBookId: 'testWorldBook',
    displayName: '测试资源包',
    version: '1.0.0',
    registryManifestId: THREE_KINGDOMS_AVG_REGISTRY_MANIFEST_ID,
    assetCount: 1,
    totalByteLength: webp.byteLength,
    assets: [asset],
    ...overrides,
  };
  return new Blob([zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), [asset.path]: webp })], { type: 'application/zip' });
}

afterEach(async () => resetAvgResourcePackDatabaseForTests(databaseName));

describe('AvgResourcePackManager', () => {
  it('validates, atomically installs, selects and reads an asset', async () => {
    const manager = new AvgResourcePackManager(databaseName);
    const progress: string[] = [];
    const installed = await manager.install(await archive(), { onProgress: (event) => progress.push(event.phase) });
    expect(installed.manifest.assetCount).toBe(1);
    expect(await manager.getActive('testWorldBook')).toMatchObject({ manifest: { packId: 'three-kingdoms-test' } });
    expect(await manager.lookupActiveAsset('testWorldBook', 'avg:threeKingdoms:scene:place_test:base')).toBeInstanceOf(Blob);
    expect(progress).toContain('validating');
    expect(progress[progress.length - 1]).toBe('committing');
  });

  it('streams the archive instead of materializing the whole ZIP in memory', async () => {
    const manager = new AvgResourcePackManager(databaseName);
    const file = await archive();
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => { throw new Error('whole archive read is forbidden'); },
    });
    await expect(manager.install(file)).resolves.toMatchObject({
      manifest: { packId: 'three-kingdoms-test' },
    });
  });

  it('rejects a tampered image without replacing the active pack', async () => {
    const manager = new AvgResourcePackManager(databaseName);
    await manager.install(await archive());
    await expect(manager.install(await archive({ packId: 'tampered', assets: [{
      assetId: 'bad', path: 'assets/place-test.webp', sha256: '0'.repeat(64), byteLength: webp.byteLength, mediaType: 'image/webp',
      width: 1, height: 1, kind: 'scene', resourceId: 'avg:threeKingdoms:scene:place_test',
    }] }))).rejects.toThrow('校验失败');
    expect((await manager.getActive('testWorldBook'))?.manifest.packId).toBe('three-kingdoms-test');
  });

  it('rejects an incomplete archive that claims the official Three Kingdoms registry', async () => {
    const manager = new AvgResourcePackManager(databaseName);
    await expect(manager.install(await archive({ worldBookId: 'threeKingdoms' })))
      .rejects.toThrow('资源清单不完整');
    expect(await manager.getActive('threeKingdoms')).toBeUndefined();
  });

  it('uninstalls assets and clears the active selection', async () => {
    const manager = new AvgResourcePackManager(databaseName);
    await manager.install(await archive());
    await manager.uninstall('three-kingdoms-test');
    expect(await manager.list('testWorldBook')).toEqual([]);
    expect(await manager.getActive('testWorldBook')).toBeUndefined();
  });
});

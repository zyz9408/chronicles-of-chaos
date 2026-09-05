import { expect, test } from '@playwright/test';
import { assertE2eStorageIsolation } from './e2eStorage';

const AVG_DATABASE = 'chronicles-of-chaos-v2-avg-resource-packs';
const CORE_DATABASE = 'coc_v2_local_data';

async function dismissReleaseNotes(page: import('@playwright/test').Page): Promise<void> {
  const close = page.getByRole('button', { name: '关闭更新日志' });
  if (await close.isVisible()) await close.click();
}

async function seedOfficialAvgResourcePackSchema(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async ({ databaseName }) => {
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(databaseName);
      deletion.onsuccess = () => resolve();
      deletion.onerror = () => reject(deletion.error);
      deletion.onblocked = () => reject(new Error('AVG test database deletion was blocked.'));
    });
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(databaseName, 1);
      opening.onupgradeneeded = () => {
        const packs = opening.result.createObjectStore('installed-packs', { keyPath: 'packId' });
        packs.createIndex('by-worldbook', 'worldBookId');
        opening.result.createObjectStore('selections', { keyPath: 'worldBookId' });
        const resources = opening.result.createObjectStore('resource-files', { keyPath: 'key' });
        resources.createIndex('by-namespace', 'namespace');
      };
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['installed-packs', 'selections'], 'readwrite');
      transaction.objectStore('installed-packs').put({
        packId: 'official-reference-pack',
        worldBookId: 'threeKingdoms',
        record: {
          manifest: {
            format: 'chronicles-of-chaos-v2-avg-resource-pack',
            schemaVersion: 1,
            packId: 'official-reference-pack',
            displayName: '参考站兼容包',
            version: '1.8.4',
            worldBookId: 'threeKingdoms',
            registryManifestId: 'avg:threeKingdoms:accepted-resources:portrait-922-scene-200:2026-08-24',
            assetCount: 1122,
            totalByteLength: 361_758_720,
            assets: [],
          },
          storageNamespace: 'cocv2-avg-reference-test',
          storageBackend: 'indexeddb',
          installedAt: '2026-09-05T00:00:00.000Z',
          archiveByteLength: 361_758_720,
          validationStatus: 'valid',
        },
      });
      transaction.objectStore('selections').put({
        worldBookId: 'threeKingdoms',
        packId: 'official-reference-pack',
        updatedAt: '2026-09-05T00:00:00.000Z',
      });
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }, { databaseName: AVG_DATABASE });
}

async function readFeatureExecutionModes(page: import('@playwright/test').Page) {
  return page.evaluate(async ({ databaseName }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(databaseName);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    return new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const transaction = database.transaction('meta', 'readonly');
      const request = transaction.objectStore('meta').get('apiFeatureExecutionModes');
      request.onsuccess = () => resolve(request.result?.value);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
    });
  }, { databaseName: CORE_DATABASE });
}

test('reads the exact v1.8.4 AVG database schema used by the reference site', async ({ page }) => {
  await page.goto('/');
  await assertE2eStorageIsolation(page);
  await seedOfficialAvgResourcePackSchema(page);
  await dismissReleaseNotes(page);
  await page.getByRole('button', { name: /设置$/ }).click();
  await page.getByRole('button', { name: 'AVG 演出资源' }).click();

  await expect(page.getByTestId('avg-resource-pack-status'))
    .toHaveText('当前已启用：参考站兼容包 1.8.4');
  await expect(page.getByTestId('avg-resource-pack-list')).toContainText('1122 个 WebP');
});

test('persists state writeback execution mode and reveals dedicated routes', async ({ page }) => {
  await page.goto('/');
  await assertE2eStorageIsolation(page);
  await dismissReleaseNotes(page);
  await page.getByRole('button', { name: /设置$/ }).click();
  await page.getByRole('button', { name: '功能配置' }).click();
  await page.getByRole('button', { name: '状态写回配置' }).click();

  const mode = page.getByLabel('状态写回主要 API执行模式');
  await expect(mode).toHaveValue('bundledMain');
  await expect(page.getByText('额外调用 0')).toBeVisible();
  await expect(page.getByLabel('状态写回主要 API API 档案')).toHaveCount(0);

  await mode.selectOption('dedicated');
  await expect(page.getByLabel('状态写回主要 API API 档案')).toBeVisible();
  await expect(page.getByLabel('状态写回备用 API API 档案')).toBeVisible();
  await expect.poll(async () => (await readFeatureExecutionModes(page))?.stateWriteback)
    .toBe('dedicated');
});

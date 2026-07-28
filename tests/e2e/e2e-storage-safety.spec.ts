import { expect, test } from '@playwright/test';
import {
  assertE2eStorageIsolation,
  E2E_DATABASE_NAME,
  E2E_DATABASE_VERSION,
  E2E_STORAGE_MARKER,
  resetE2eCoreStores,
} from './e2eStorage';

test('E2E server uses a dedicated marked origin before touching IndexedDB', async ({ page }) => {
  await page.goto('/');

  const identity = await assertE2eStorageIsolation(page);

  expect(identity.marker).toBe(E2E_STORAGE_MARKER);
  expect(['3000', '3001', '5173']).not.toContain(identity.port);
});

test('destructive storage cleanup refuses to run after the E2E marker is removed', async ({ page }) => {
  await page.goto('/');
  await assertE2eStorageIsolation(page);
  await page.evaluate(
    async ({ databaseName, databaseVersion }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName, databaseVersion);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ key: 'e2eSafetySentinel', value: 'must-survive' });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      });
    },
    { databaseName: E2E_DATABASE_NAME, databaseVersion: E2E_DATABASE_VERSION },
  );

  await page.evaluate(() => {
    delete document.documentElement.dataset.cocE2eStorage;
  });

  await expect(resetE2eCoreStores(page)).rejects.toThrow('当前页面缺少专用 E2E 标记');

  const sentinel = await page.evaluate(
    async ({ databaseName, databaseVersion }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName, databaseVersion);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction('meta', 'readonly');
        const request = tx.objectStore('meta').get('e2eSafetySentinel');
        request.onsuccess = () => resolve(request.result?.value);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      });
    },
    { databaseName: E2E_DATABASE_NAME, databaseVersion: E2E_DATABASE_VERSION },
  );
  expect(sentinel).toBe('must-survive');
});

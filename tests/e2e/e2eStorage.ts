import type { Page } from '@playwright/test';
import { E2E_STORAGE_MARKER } from '../../src/engine/storage/E2eStorageGuard';

export { E2E_STORAGE_MARKER };
export const E2E_DATABASE_NAME = 'coc_v2_local_data';
export const E2E_DATABASE_VERSION = 4;

const RESERVED_DEVELOPMENT_PORTS = new Set(['3000', '3001', '5173']);

interface E2eOriginIdentity {
  hostname: string;
  marker?: string;
  origin: string;
  port: string;
}

export async function assertE2eStorageIsolation(page: Page): Promise<E2eOriginIdentity> {
  const identity = await page.evaluate(() => ({
    hostname: window.location.hostname,
    marker: document.documentElement.dataset.cocE2eStorage,
    origin: window.location.origin,
    port: window.location.port,
  }));

  if (identity.marker !== E2E_STORAGE_MARKER) {
    throw new Error(
      `拒绝清理 IndexedDB：当前页面缺少专用 E2E 标记 ${E2E_STORAGE_MARKER}（实际：${identity.marker ?? '未设置'}）。`,
    );
  }

  if (!['127.0.0.1', 'localhost'].includes(identity.hostname)) {
    throw new Error(`拒绝清理 IndexedDB：E2E 只允许本机来源，当前来源为 ${identity.origin}。`);
  }

  if (!identity.port || RESERVED_DEVELOPMENT_PORTS.has(identity.port)) {
    throw new Error(`拒绝清理 IndexedDB：端口 ${identity.port || '默认端口'} 不是专用 E2E 端口。`);
  }

  return identity;
}

export async function resetE2eCoreStores(page: Page): Promise<void> {
  await assertE2eStorageIsolation(page);
  await page.evaluate(
    async ({ databaseName, databaseVersion }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName, databaseVersion);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('saves')) database.createObjectStore('saves', { keyPath: 'id' });
          if (!database.objectStoreNames.contains('saveSummaries')) {
            database.createObjectStore('saveSummaries', { keyPath: 'id' });
          }
          if (!database.objectStoreNames.contains('apiConfigs')) {
            database.createObjectStore('apiConfigs', { keyPath: 'id' });
          }
          if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'key' });
          if (!database.objectStoreNames.contains('turnSnapshots')) {
            database.createObjectStore('turnSnapshots', { keyPath: 'id' });
          }
          if (!database.objectStoreNames.contains('memoryEmbeddingIndexes')) {
            database.createObjectStore('memoryEmbeddingIndexes', { keyPath: 'id' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['saves', 'apiConfigs', 'meta'], 'readwrite');
        tx.objectStore('saves').clear();
        tx.objectStore('apiConfigs').clear();
        tx.objectStore('meta').clear();
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      });
    },
    { databaseName: E2E_DATABASE_NAME, databaseVersion: E2E_DATABASE_VERSION },
  );
}

export async function seedMainNarrativeApi(page: Page): Promise<void> {
  await page.route('**/api/cloud/auth/session', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      status: 200,
      body: JSON.stringify({
        ok: true,
        configured: false,
        authConfigured: false,
        authenticated: false,
        limits: {
          globalBytes: 0,
          userBytes: 0,
          uploadBytes: 0,
          slots: 0,
          dailyUploads: 0,
          userDailyUploads: 0,
        },
      }),
    });
  });
  await page.goto('/');
  await resetE2eCoreStores(page);
  await page.evaluate(
    async ({ databaseName, databaseVersion }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName, databaseVersion);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['apiConfigs', 'meta'], 'readwrite');
        tx.objectStore('apiConfigs').put({
          id: 'api_main',
          name: 'E2E Main API',
          provider: 'openai_compatible',
          baseUrl: 'https://example.test/v1',
          apiKey: 'sk-test',
          model: 'e2e-model',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        });
        tx.objectStore('meta').put({
          key: 'apiTaskRoutes',
          value: {
            mainNarrative: 'api_main',
            quickInteraction: null,
            memorySummary: null,
            npcCompletion: null,
            worldEvolution: null,
            imagePrompt: null,
          },
        });
        tx.objectStore('meta').put({ key: 'legacyApiSettingsMigratedFromLocalStorage', value: true });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      });
    },
    { databaseName: E2E_DATABASE_NAME, databaseVersion: E2E_DATABASE_VERSION },
  );
  await page.reload();
}

import { expect, test, type Page } from '@playwright/test';
import { assertE2eStorageIsolation, E2E_DATABASE_NAME, E2E_DATABASE_VERSION, seedMainNarrativeApi } from './e2eStorage';

// Enter through StartScreen, load a persisted turn, and retain the actual parent
// state feedback/materialization effects (not an isolated stage-only mount).
async function prepareGame(page: Page, turnNumber = 1) {
  await seedMainNarrativeApi(page);
  await page.getByRole('button', { name: '新的征程' }).click();
  for (let step = 0; step < 4; step += 1) await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: /宗室支脉/ }).click();
  await page.getByRole('button', { name: /在野士人/ }).click();
  await page.evaluate(() => (window as unknown as { __cocDebugStart: () => Promise<void> }).__cocDebugStart());
  await expect(page.locator('.game-frame')).toBeVisible();
  await page.reload();
  await assertE2eStorageIsolation(page);
  return page.evaluate(async ({ name, version, number }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const save = await new Promise<any>((resolve, reject) => {
      const request = database.transaction('saves').objectStore('saves').getAll();
      request.onsuccess = () => resolve(request.result[0]);
      request.onerror = () => reject(request.error);
    });
    save.runtimeState.worldStateDelta.trueOpeningGenerated = true;
    save.runtimeState.turnLog = [{
      turnNumber: number, date: save.runtimeState.currentDate, playerInput: '',
      narrativeText: '【旁白】集市晨雾散去，正文不能被图片读取阻塞。\n【主角】我们继续前行。',
      statePatchSummary: '', timestamp: new Date().toISOString(),
      avgPresentation: {
        sceneBinding: { sceneResourceId: 'avg:threeKingdoms:scene:test-loading', source: 'registry-exact' },
        speakerBindings: [{ segmentIndex: 1, label: '主角', actorId: save.runtimeState.player.id, status: 'frozen', identityKind: 'player', diagnosticCode: 'frozen-speaker' }],
      },
    }];
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('saves', 'readwrite');
      transaction.objectStore('saves').put(save);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    localStorage.setItem('coc_v2_avg_player_portrait_mode', 'show');
    return { partitionId: (save.runtimeState.avgPresentation?.visualPartitionId || save.id) as string, playerId: save.runtimeState.player.id as string };
  }, { name: E2E_DATABASE_NAME, version: E2E_DATABASE_VERSION, number: turnNumber });
}

async function enterSavedGame(page: Page) {
  await page.getByRole('button', { name: '兵戈再起' }).click();
  await page.getByRole('button', { name: '读取最近存档' }).click();
  await expect(page.locator('.game-frame')).toBeVisible();
}

test('manual AVG opens a legacy opening without an external pack or turn-number gate', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepareGame(page, 0);
  await enterSavedGame(page);
  await expect(page.locator('.narrative-stream')).toContainText('正文不能被图片读取阻塞');
  await page.getByRole('button', { name: 'AVG 演出', exact: true }).click();
  await expect(page.getByTestId('avg-stage-dialogue')).toContainText('正文不能被图片读取阻塞');
  await expect(page.getByRole('button', { name: '生成候选图', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '生成人物图', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '生成人物图', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭人物图生成' }).click();
  await page.getByRole('button', { name: '→', exact: true }).click();
  await expect(page.getByTestId('avg-stage-dialogue')).toContainText('我们继续前行');
  await page.getByRole('button', { name: '原文', exact: true }).click();
  await expect(page.locator('.narrative-stream')).toContainText('我们继续前行');
  expect(errors).toEqual([]);
});

test('stalled image reads never block the real game, time out, retry, and discard late images', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await prepareGame(page);
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { AvgResourcePackManager } = await load('/src/engine/avg/AvgResourcePackManager.ts');
    const { IndexedDbAvgVisualOverrideRepository } = await load('/src/engine/avg/AvgVisualOverrideRepository.ts');
    AvgResourcePackManager.prototype.getActive = async () => ({ manifest: { assets: [] } });
    const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
    const context = canvas.getContext('2d')!; context.fillStyle = '#448866'; context.fillRect(0, 0, 8, 8);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((image) => resolve(image!), 'image/png'));
    const waiting: Array<() => void> = [];
    const hooks = window as unknown as { __avgRetry: () => void; __avgReleaseLate: () => void };
    IndexedDbAvgVisualOverrideRepository.prototype.lookup = () => new Promise((resolve) => waiting.push(() => resolve({ status: 'found', blob })));
    hooks.__avgRetry = () => { IndexedDbAvgVisualOverrideRepository.prototype.lookup = async () => ({ status: 'missing' }); };
    hooks.__avgReleaseLate = () => waiting.forEach((release) => release());
  });
  await enterSavedGame(page);
  await expect(page.getByTestId('avg-stage-dialogue')).toContainText('正文不能被图片读取阻塞');
  await expect(page.getByRole('button', { name: '生成人物图', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '→', exact: true }).click();
  await expect(page.getByTestId('avg-stage-dialogue')).toContainText('我们继续前行');
  await expect(page.locator('.avg-stage-resource-status')).toContainText('背景读取超时或失败', { timeout: 12_000 });
  await expect(page.locator('.avg-stage-resource-status')).toContainText('人物图读取超时或失败', { timeout: 12_000 });
  await page.evaluate(() => (window as unknown as { __avgRetry: () => void }).__avgRetry());
  await page.getByRole('button', { name: '重试图片', exact: true }).click();
  await expect(page.locator('.avg-stage-resource-status')).toContainText('场景未匹配');
  await expect(page.locator('.avg-stage-resource-status')).toContainText('人物立绘未匹配');
  await page.evaluate(() => (window as unknown as { __avgReleaseLate: () => void }).__avgReleaseLate());
  await expect(page.getByTestId('avg-narrative-stage')).toHaveAttribute('data-avg-background', 'neutral');
  await expect(page.getByTestId('avg-narrative-stage')).toHaveAttribute('data-avg-portrait', 'silhouette');
  await expect(page.getByTestId('avg-stage-frame-progress')).toHaveText('第 2 / 2 帧');
  await page.screenshot({ path: 'output/playwright/avg-loading-recovered.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('stalled pack discovery finishes with a warning and manual AVG still works', async ({ page }) => {
  await prepareGame(page);
  await page.evaluate(async () => {
    const path = '/src/engine/avg/AvgResourcePackManager.ts';
    const { AvgResourcePackManager } = await import(/* @vite-ignore */ path);
    AvgResourcePackManager.prototype.getActive = () => new Promise(() => undefined);
  });
  await enterSavedGame(page);
  await expect(page.locator('.narrative-stream')).toContainText('正文不能被图片读取阻塞');
  await expect(page.locator('.narrative-presentation-status')).toContainText('暂时无法读取', { timeout: 12_000 });
  await page.getByRole('button', { name: 'AVG 演出', exact: true }).click();
  await expect(page.getByTestId('avg-stage-dialogue')).toContainText('正文不能被图片读取阻塞');
});

test('real local images display without a pack, updates retain the frame/dialog, and corrupt images fall back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const targets = await prepareGame(page);
  await page.evaluate(async ({ partitionId, playerId }) => {
    const path = '/src/engine/avg/AvgVisualOverrideRepository.ts';
    const { IndexedDbAvgVisualOverrideRepository, createAvgActorTarget, createAvgSceneTarget, validateAvgImage } = await import(/* @vite-ignore */ path);
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d')!; context.fillStyle = '#446688'; context.fillRect(0, 0, 64, 64);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((image) => resolve(image!), 'image/png'));
    const image = await validateAvgImage(blob);
    const repository = new IndexedDbAvgVisualOverrideRepository();
    const actor = createAvgActorTarget(partitionId, 'threeKingdoms', playerId);
    await repository.replace(actor, image);
    await repository.replace(createAvgSceneTarget(partitionId, 'threeKingdoms', {
      kind: 'frozen-scene-resource', id: 'avg:threeKingdoms:scene:test-loading',
    }), image);
    (window as unknown as { __avgUpdatePortrait: () => Promise<void> }).__avgUpdatePortrait = () => repository.replace(actor, image);
  }, targets);
  await enterSavedGame(page);
  await page.getByRole('button', { name: 'AVG 演出', exact: true }).click();
  await expect(page.getByTestId('avg-narrative-stage')).toHaveAttribute('data-avg-background', 'registered');
  await page.getByRole('button', { name: '→', exact: true }).click();
  await expect(page.getByTestId('avg-narrative-stage')).toHaveAttribute('data-avg-portrait', 'registered');
  await expect.poll(() => page.locator('.avg-stage-portrait img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(64);
  const previousImage = await page.locator('.avg-stage-portrait img').getAttribute('src');
  await page.getByRole('button', { name: '生成人物图', exact: true }).click();
  await page.evaluate(() => (window as unknown as { __avgUpdatePortrait: () => Promise<void> }).__avgUpdatePortrait());
  await expect(page.locator('.avg-stage-portrait img')).not.toHaveAttribute('src', previousImage!);
  await expect(page.getByRole('dialog', { name: '生成人物图', exact: true })).toBeVisible();
  await expect(page.getByTestId('avg-stage-frame-progress')).toHaveText('第 2 / 2 帧');
  await page.getByRole('button', { name: '关闭人物图生成' }).click();
  await page.evaluate(async () => {
    const path = '/src/engine/avg/AvgVisualOverrideRepository.ts';
    const { IndexedDbAvgVisualOverrideRepository } = await import(/* @vite-ignore */ path);
    IndexedDbAvgVisualOverrideRepository.prototype.lookup = async () => ({ status: 'found', blob: new Blob(['broken'], { type: 'image/png' }) });
  });
  await page.getByRole('button', { name: '重试图片', exact: true }).click();
  await expect(page.locator('.avg-stage-resource-status')).toContainText('背景读取超时或失败');
  await expect(page.locator('.avg-stage-resource-status')).toContainText('人物图读取超时或失败');
  await expect(page.getByTestId('avg-stage-dialogue')).toContainText('我们继续前行');
  await expect(page.getByTestId('avg-narrative-stage')).toHaveAttribute('data-avg-portrait', 'silhouette');
  expect(errors).toEqual([]);
});

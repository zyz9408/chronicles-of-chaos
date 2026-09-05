import { expect, test, type Page } from '@playwright/test';
import { assertE2eStorageIsolation } from './e2eStorage';

async function mountStage(page: Page, setup = true, unregistered = false) {
  await page.goto('/');
  await assertE2eStorageIsolation(page);
  await page.evaluate(async ({ setupProfile, unregistered }) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const [{ default: React }, { default: ReactDOM }, { AvgNarrativeStage }, profiles] = await Promise.all([
      load('/node_modules/.vite/deps/react.js'), load('/node_modules/.vite/deps/react-dom_client.js'),
      load('/src/ui/AvgNarrativeStage.tsx'), load('/src/engine/avg/AvgImageGenerationProfiles.ts'),
    ]);
    if (setupProfile) {
      await new profiles.IndexedDbAvgImageGenerationProfileRepository().saveProfile({
        ...profiles.createAvgImageGenerationProfile(), id: 'test-images', name: '测试图片服务',
        baseUrl: 'https://images.example.test/v1', model: 'test-model', size: '1024x1536',
      }, 'test-key');
    }
    const state = {
      player: { id: 'player', name: '彭亮', sex: '男', age: 18, roleType: '流亡者' },
      worldBookId: 'threeKingdoms', currentDate: '公元184年03月01日', currentLocationId: '襄阳', currentPlaceId: '集市',
      knownActors: [{ id: 'guan-yu', name: '关羽', sex: '男', age: 25, roleType: '武将' }],
      npcs: ['甲', '乙'].map((suffix, index) => ({ npcId: `guard-${index}`, name: `差役${suffix}`, sex: '男', age: 30, role: '差役', isPresent: true, isFocused: false })),
      avgPresentation: { visualPartitionId: 'test-avg-partition' },
    };
    if (unregistered) { state.npcs = []; state.knownActors = []; }
    document.getElementById('root')!.hidden = true;
    const host = document.createElement('div');
    host.id = 'avg-test-host'; host.style.padding = '16px'; document.body.append(host);
    ReactDOM.createRoot(host).render(React.createElement(AvgNarrativeStage, {
      entryKey: 'test-turn', narrativeText: unregistered ? '【旁白】城门缓缓打开。\n【城头守卒】下面何事？\n【守卒乙】请进城。' : '【旁白】市集晨雾散去。\n【差役甲】来者何人？\n【差役乙】请出示凭证。\n【关羽】在下关羽。',
      ...(unregistered ? { visualSnapshot: { presentActorIds: [], runtimePlaceId: '集市' } } : {}),
      runtimeState: state, saveId: 'test-save', worldBookId: 'threeKingdoms', playerPortraitMode: 'hidden', onReturnClassic: () => undefined,
    }));
  }, { setupProfile: setup, unregistered });
  await expect(page.getByTestId('avg-narrative-stage')).toBeVisible();
}

async function imageResponse(page: Page, color = '#566878') {
  return page.evaluate((color) => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 480;
    const context = canvas.getContext('2d')!;
    context.fillStyle = color; context.fillRect(65, 150, 170, 320);
    context.fillStyle = '#d4b58c'; context.beginPath(); context.arc(150, 95, 55, 0, Math.PI * 2); context.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  }, color);
}

async function readVisuals(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/engine/avg/AvgVisualOverrideRepository.ts';
    const { IndexedDbAvgVisualOverrideRepository } = await import(/* @vite-ignore */ path);
    const snapshot = await new IndexedDbAvgVisualOverrideRepository().exportPartition('test-avg-partition');
    return { actorCount: snapshot.actorCount, records: snapshot.records, assets: snapshot.assets.length };
  });
}

for (const hasGuard of [true, false]) test(`unregistered guard with installed pack ${hasGuard ? 'uses compatible guard' : 'never borrows female artwork'}`, async ({ page }) => {
  await mountStage(page, false, true);
  await page.evaluate(async (hasGuard) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { AvgResourcePackManager, AVG_RESOURCE_PACK_DATABASE, THREE_KINGDOMS_AVG_REGISTRY_MANIFEST_ID, AVG_RESOURCE_PACK_CHANGED_EVENT } = await load('/src/engine/avg/AvgResourcePackManager.ts');
    const { resolveThreeKingdomsPortraitSet } = await load('/src/engine/avg/ThreeKingdomsAvgResolver.ts');
    const actorId = `avg-local:${encodeURIComponent('集市')}:${encodeURIComponent('城头守卒')}`;
    const selected = resolveThreeKingdomsPortraitSet({ actorId, name: '城头守卒', roleType: '军士', sex: 'male', ageBand: 'adult' }, { strict: true });
    if (!selected) throw new Error('Expected compatible soldier registry entry');
    const manager = new AvgResourcePackManager(); await manager.list('threeKingdoms');
    const namespace = 'guard-pack-regression';
    const packs = await (await navigator.storage.getDirectory()).getDirectoryHandle(AVG_RESOURCE_PACK_DATABASE, { create: true });
    const directory = await (await packs.getDirectoryHandle(namespace, { create: true })).getDirectoryHandle('assets', { create: true });
    const assets = [];
    for (const [resourceId, width, variant] of [
      ['avg:threeKingdoms:generic:camp_cook_female_individual_a', 128, 'default'],
      ...(hasGuard ? [[selected.portraitSetId, 64, selected.defaultVariant]] : []),
    ] as [string, number, string][]) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = 160;
      canvas.getContext('2d')!.fillRect(0, 0, width, 160);
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/webp'));
      const path = `assets/portrait-${width}.webp`;
      const writer = await (await directory.getFileHandle(`portrait-${width}.webp`, { create: true })).createWritable();
      await writer.write(blob); await writer.close();
      assets.push({ assetId: `${resourceId}:${variant}`, path, byteLength: blob.size, width, height: 160, mediaType: 'image/webp', kind: 'generic-portrait', resourceId, variant });
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open(AVG_RESOURCE_PACK_DATABASE, 1); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['installed-packs', 'selections'], 'readwrite');
      tx.objectStore('installed-packs').put({ packId: namespace, worldBookId: 'threeKingdoms', record: {
        manifest: { schemaVersion: 1, packId: namespace, displayName: '守卒回归包', version: '1', worldBookId: 'threeKingdoms', registryManifestId: THREE_KINGDOMS_AVG_REGISTRY_MANIFEST_ID, assetCount: assets.length, totalByteLength: assets.reduce((sum, asset) => sum + asset.byteLength, 0), assets },
        storageNamespace: namespace, storageBackend: 'opfs', validationStatus: 'valid', installedAt: new Date().toISOString(),
      } });
      tx.objectStore('selections').put({ worldBookId: 'threeKingdoms', packId: namespace });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
    if (await manager.lookupActivePortrait('threeKingdoms', actorId)) throw new Error('Unknown sex must not borrow from the pack');
    window.dispatchEvent(new CustomEvent(AVG_RESOURCE_PACK_CHANGED_EVENT));
  }, hasGuard);
  await page.getByRole('button', { name: '→', exact: true }).click();
  if (hasGuard) {
    await expect(page.locator('.avg-stage-portrait img')).toHaveAttribute('alt', '城头守卒');
    await expect.poll(() => page.locator('.avg-stage-portrait img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(64);
  } else {
    await expect(page.getByTestId('avg-narrative-stage')).toHaveAttribute('data-avg-portrait', 'silhouette');
    await expect(page.getByTestId('avg-narrative-stage')).not.toContainText('人物图加载中');
    await expect(page.locator('.avg-stage-portrait img')).toHaveCount(0);
  }
  expect((await readVisuals(page)).actorCount).toBe(0);
});

test('homepage buttons generate, preview, bind, reuse and persist character pictures', async ({ page }) => {
  await mountStage(page);
  let requests = 0;
  const image = await imageResponse(page);
  await page.route('https://images.example.test/v1/images/generations', async (route) => {
    requests += 1;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ b64_json: image }] }) });
  });
  const buttons = page.getByRole('group', { name: 'AVG 图片生成' });
  await expect(buttons.getByRole('button')).toHaveText(['生成候选图', '生成人物图']);
  await buttons.getByRole('button', { name: '生成候选图', exact: true }).click();
  const visuals = page.getByRole('dialog', { name: 'AVG 视觉管理' });
  await expect(visuals.getByLabel('AI 候选图提示词')).toContainText('无人物场景背景');
  await visuals.getByRole('button', { name: '关闭视觉管理' }).click();

  await buttons.getByRole('button', { name: '生成人物图', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '生成人物图', exact: true });
  await dialog.getByLabel('生成图片的人物').selectOption('guard-0');
  await expect(dialog.getByLabel('特殊人物专属绑定')).not.toBeChecked();
  expect(requests).toBe(0);
  await dialog.getByRole('button', { name: '生成候选图', exact: true }).click();
  await expect(dialog.getByAltText(/AI 候选图预览/)).toBeVisible();
  expect((await readVisuals(page)).actorCount).toBe(0);
  await dialog.getByRole('button', { name: '应用并加入 AVG 图库' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.avg-stage-portrait img')).toHaveAttribute('alt', '差役甲');
  const stored = await readVisuals(page);
  expect(stored.records.filter((record: { portraitScope?: string }) => record.portraitScope === 'adaptive-candidate')).toHaveLength(1);
  await page.getByRole('button', { name: '→', exact: true }).click();
  await page.getByRole('button', { name: '→', exact: true }).click();
  await expect(page.locator('.avg-stage-portrait img')).toHaveAttribute('alt', '差役乙');
  await expect.poll(async () => (await readVisuals(page)).actorCount).toBe(2);
  expect(requests).toBe(1);

  await page.getByRole('button', { name: '→', exact: true }).click();
  await buttons.getByRole('button', { name: '生成人物图', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '生成人物图', exact: true });
  await expect(dialog.getByLabel('生成图片的人物')).toHaveValue('guan-yu');
  await expect(dialog.getByLabel('特殊人物专属绑定')).toBeChecked();
  await expect(dialog.getByLabel('特殊人物专属绑定')).toBeDisabled();
  await dialog.getByRole('button', { name: '生成候选图', exact: true }).click();
  await expect(dialog.getByAltText(/AI 候选图预览/)).toBeVisible();
  await dialog.getByRole('button', { name: '应用并加入 AVG 图库' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await readVisuals(page)).records.filter((record: { portraitScope?: string }) => record.portraitScope === 'adaptive-candidate')).toHaveLength(1);

  await mountStage(page, false);
  await page.getByRole('button', { name: '→', exact: true }).click();
  await expect(page.locator('.avg-stage-portrait img')).toHaveAttribute('alt', '差役甲');
  await page.getByRole('button', { name: '→', exact: true }).click();
  await expect(page.locator('.avg-stage-portrait img')).toHaveAttribute('alt', '差役乙');
  expect(requests).toBe(2);
  const libraryData = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const [{ default: React }, { default: ReactDOM }, { AvgPortraitLibraryPanel }, { IndexedDbAvgVisualOverrideRepository }] = await Promise.all([
      load('/node_modules/.vite/deps/react.js'), load('/node_modules/.vite/deps/react-dom_client.js'),
      load('/src/ui/AvgPortraitLibraryPanel.tsx'), load('/src/engine/avg/AvgVisualOverrideRepository.ts'),
    ]);
    const snapshot = await new IndexedDbAvgVisualOverrideRepository().exportPartition('test-avg-partition');
    const host = document.createElement('div'); document.body.append(host);
    ReactDOM.createRoot(host).render(React.createElement(AvgPortraitLibraryPanel, { snapshot, state: {
      worldBookId: 'threeKingdoms', player: { id: 'player', name: '彭亮' }, knownActors: [{ id: 'guan-yu', name: '关羽' }],
      npcs: [{ npcId: 'guard-0', name: '差役甲' }, { npcId: 'guard-1', name: '差役乙' }],
    } }));
    return snapshot.actorCount;
  });
  expect(libraryData).toBe(3);
  await expect(page.getByRole('region', { name: 'AVG 人物图库' })).toContainText('已绑定 3 人 · 通用人物图 1 张');
  await expect(page.getByRole('region', { name: 'AVG 人物图库' }).getByRole('img')).toHaveCount(4);
  await page.screenshot({ path: 'output/playwright/avg-character-library-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(buttons.getByRole('button', { name: '生成人物图', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'output/playwright/avg-character-library-mobile.png', fullPage: true });
});

test('unregistered speaking guards can be generated instead of the player, accumulate candidates and stay bound after reload', async ({ page }) => {
  await mountStage(page, true, true);
  const pictures = [await imageResponse(page, '#667788'), await imageResponse(page, '#996633'), await imageResponse(page, '#446644')];
  let requests = 0;
  await page.route('https://images.example.test/v1/images/generations', async (route) => {
    const prompt = route.request().postDataJSON().prompt as string;
    expect(prompt).toContain('人物：城头守卒');
    expect(prompt).not.toContain('彭亮');
    expect(prompt).toContain('三国志式');
    expect(prompt).toContain('禁止真人摄影');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ b64_json: pictures[requests++] }] }) });
  });
  await page.getByRole('button', { name: '→', exact: true }).click();
  const generate = async () => {
    await page.getByRole('button', { name: '生成人物图', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '生成人物图', exact: true });
    await expect(dialog.getByLabel('生成图片的人物').locator('option:checked')).toContainText('城头守卒');
    await expect(dialog.getByLabel('生成图片的人物').locator('option')).toHaveCount(3);
    await dialog.getByRole('button', { name: '生成候选图', exact: true }).click();
    await expect(dialog.getByAltText(/AI 候选图预览/)).toBeVisible();
    await dialog.getByRole('button', { name: '应用并加入 AVG 图库' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.avg-stage-portrait img')).toHaveAttribute('alt', '城头守卒');
  };
  await generate();
  await generate();
  const stored = await readVisuals(page);
  expect(stored.records.filter((row: { portraitScope?: string }) => row.portraitScope === 'adaptive-candidate')).toHaveLength(2);
  expect(stored.records.some((row: { actorId?: string }) => row.actorId === 'player')).toBe(false);
  await page.getByRole('button', { name: '→', exact: true }).click();
  await expect(page.locator('.avg-stage-portrait img')).toHaveAttribute('alt', '守卒乙');
  await expect.poll(async () => (await readVisuals(page)).actorCount).toBe(2);
  const boundBefore = (await readVisuals(page)).records.find((row: { portraitScope?: string; actorId?: string }) => row.portraitScope === 'actor-bound' && decodeURIComponent(row.actorId ?? '').endsWith(':守卒乙'));
  expect(boundBefore).toBeTruthy();
  await page.getByRole('button', { name: '←', exact: true }).click();
  await generate();
  await mountStage(page, false, true);
  await page.getByRole('button', { name: '→', exact: true }).click();
  await page.getByRole('button', { name: '→', exact: true }).click();
  await expect(page.locator('.avg-stage-portrait img')).toHaveAttribute('alt', '守卒乙');
  expect((await readVisuals(page)).records.find((row: { key: string }) => row.key === boundBefore.key)).toEqual(boundBefore);
  expect(requests).toBe(3);
  await page.screenshot({ path: 'output/playwright/avg-unregistered-guard.png', fullPage: true });
});

test('failed and cancelled image requests keep existing pictures and do not create bindings', async ({ page }) => {
  await mountStage(page);
  const picture = await imageResponse(page);
  await page.evaluate(async (base64) => {
    const path = '/src/engine/avg/AvgVisualOverrideRepository.ts';
    const { IndexedDbAvgVisualOverrideRepository, createAvgActorTarget, validateAvgImage } = await import(/* @vite-ignore */ path);
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    await new IndexedDbAvgVisualOverrideRepository().replace(createAvgActorTarget('test-avg-partition', 'threeKingdoms', 'guard-0'), await validateAvgImage(blob));
  }, picture);
  const before = await readVisuals(page);
  await page.route('https://images.example.test/v1/images/generations', async (route) => {
    await route.fulfill({ status: 401, body: '{}' });
  });
  await page.getByRole('button', { name: '生成人物图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '生成人物图', exact: true });
  await dialog.getByRole('button', { name: '生成候选图', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('鉴权失败');
  expect(await readVisuals(page)).toEqual(before);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('https://images.example.test/v1/images/generations', async (route) => {
    await gate;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ b64_json: picture }] }) }).catch(() => undefined);
  });
  const requestStarted = page.waitForRequest('https://images.example.test/v1/images/generations');
  await dialog.getByRole('button', { name: '生成候选图', exact: true }).click();
  await requestStarted;
  await dialog.getByRole('button', { name: '取消生成' }).click();
  await expect(dialog.getByRole('status')).toContainText('已取消');
  release();
  expect(await readVisuals(page)).toEqual(before);
  await expect(dialog.getByRole('button', { name: '应用并加入 AVG 图库' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '关闭人物图生成' }).click();
  await expect(dialog).toHaveCount(0);
});

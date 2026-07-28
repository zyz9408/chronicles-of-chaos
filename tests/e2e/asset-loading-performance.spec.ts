import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __batch8LayoutShift?: number;
  }
}

const isResponsiveVisual = (url: string) => /\/src\/assets\/generated\/(combat|war|maps)\//.test(url);
const isResponsiveSourcePng = (url: string) => /\/src\/assets\/(combat|war|maps)\/.*\.png(?:\?|$)/.test(url);
const boxDimensions = (box: { width: number; height: number } | null) => box && ({ width: box.width, height: box.height });

async function decodedImageDimensions(page: Page, selector: string): Promise<Array<{ width: number; height: number }>> {
  return page.locator(selector).evaluateAll(async (images) => Promise.all(images.map(async (image) => {
    const response = await fetch((image as HTMLImageElement).currentSrc);
    const bitmap = await createImageBitmap(await response.blob());
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  })));
}

async function openAssetFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async () => {
    const worldBookLoader = await import('/src/engine/worldbook/WorldBookLoader.ts');
    const startBookmarkResolver = await import('/src/engine/worldbook/StartBookmarkResolver.ts');
    const openingState = await import('/src/engine/state/createCustomOpeningState.ts');
    const saveManager = await import('/src/engine/save/SaveManager.ts');

    const firstLeaf = (nodes) => {
      for (const node of nodes) {
        if (!node.subLocations?.length) return node;
        const child = firstLeaf(node.subLocations);
        if (child) return child;
      }
      return undefined;
    };

    worldBookLoader.initWorldBookRegistry();
    const manifest = worldBookLoader.listWorldBooks()[0];
    const worldBook = worldBookLoader.getWorldBook(manifest.id);
    const bookmark = startBookmarkResolver.listStartBookmarks(worldBook)[0];
    const location = firstLeaf(worldBook.openingLocationSeed ?? worldBook.mapSeed);
    const state = openingState.createCustomOpeningState({
      worldBook,
      bookmark,
      playerName: '资产验收',
      courtesyName: '定版',
      playerSex: '男',
      playerAge: 29,
      origin: '地方太守',
      birthOrigin: '寒门武人',
      currentIdentity: '颍川太守',
      locationId: location.id,
      situationSummary: 'Batch 8 响应式资产与按需加载验收。',
    });

    state.conflicts = [{
      conflictId: 'battle_batch8_river',
      type: '水战',
      title: '颍水渡口夜战',
      summary: '水军在雨夜截击敌方船队。',
      occurredAt: '公元189年09月01日 23:00（子时）',
      outcome: '敌方船队溃退。',
      scope: 'selfRelated',
      recordLevel: 'full',
      locationName: '颍水渡口',
      sides: ['颍川水军', '敌方船队'],
      resultLevel: 'majorWin',
      reportText: '雨夜江面火光交错，水军从两翼夹击，敌船弃旗溃退。',
      resultTags: ['riverBattle', 'rain', 'fire', 'rout'],
      decisiveFactors: ['boats', 'nightAttack'],
      updatedAt: '公元189年09月01日 23:30（子时）',
    }];
    state.combatRecords = [{
      combatId: 'combat_batch8_gate',
      kind: 'battlefieldDuel',
      title: '城门阵前决斗',
      summary: '玩家在城门前迎战敌军锐士。',
      occurredAt: '公元189年09月01日 22:30（亥时）',
      locationName: '阳翟城门',
      participants: [
        { name: '资产验收', side: 'player', participantId: 'player' },
        { name: '敌军锐士', side: 'enemy', npcId: 'npc_batch8_enemy' },
      ],
      playerInvolved: true,
      resultLevel: 'decisiveWin',
      outcome: '敌军锐士败退。',
      significance: 'major',
      chronicleWorthy: true,
      briefText: '城门前一合分胜负。',
      reportText: '雨中城门前刀光一闪，玩家击退敌军锐士。',
      visualTags: ['cityGate', 'rain', 'impact'],
      updatedAt: '公元189年09月01日 22:40（亥时）',
    }];

    await saveManager.clearAllSaves();
    await saveManager.createSave(state, 'Batch 8 资产验收');
  });

  await page.reload();
  await page.getByRole('button', { name: '兵戈再起' }).click();
  await page.getByText('资产验收', { exact: true }).click();
  await expect(page.locator('.game-frame')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__batch8LayoutShift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (!shift.hadRecentInput) window.__batch8LayoutShift = (window.__batch8LayoutShift ?? 0) + (shift.value ?? 0);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
});

test('settings, prompt registry, map, and visual manifests load only when opened', async ({ page }) => {
  const moduleRequests: string[] = [];
  await page.route('**/src/ui/ApiSettingsPanel.tsx*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 180));
    await route.continue();
  });
  page.on('request', (request) => {
    const url = request.url();
    if (/\/(ApiSettingsPanel|PromptRegistryPanel|MapPanel)\.tsx(?:\?|$)/.test(url)
      || /\/src\/generated\/panelVisuals\/(combat|war|map)/.test(url)) {
      moduleRequests.push(url);
    }
  });

  await page.goto('/');
  expect(moduleRequests).toHaveLength(0);
  await page.getByRole('button', { name: /设置$/ }).click();
  const loadingBox = await page.locator('.settings-modal-loading').boundingBox();
  expect(loadingBox).not.toBeNull();
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  expect(boxDimensions(await page.locator('.settings-modal').boundingBox())).toEqual(boxDimensions(loadingBox));
  expect(moduleRequests.filter((url) => url.includes('/ApiSettingsPanel.tsx'))).toHaveLength(1);
  expect(moduleRequests.filter((url) => url.includes('/PromptRegistryPanel.tsx'))).toHaveLength(0);

  await page.getByRole('button', { name: '提示词管理' }).click();
  await expect.poll(() => moduleRequests.filter((url) => url.includes('/PromptRegistryPanel.tsx')).length).toBe(1);
  await expect(page.locator('.settings-section-loading')).toHaveCount(0);
  expect(moduleRequests.filter((url) => url.includes('/MapPanel.tsx'))).toHaveLength(0);
  expect(moduleRequests.filter((url) => /panelVisuals\/(combat|war|map)/.test(url))).toHaveLength(0);
});

test('desktop battle and map visuals stay stable and avoid repeated source requests', async ({ page }) => {
  const responsiveRequests: string[] = [];
  const sourcePngRequests: string[] = [];
  page.on('request', (request) => {
    if (isResponsiveVisual(request.url())) responsiveRequests.push(request.url());
    if (isResponsiveSourcePng(request.url())) sourcePngRequests.push(request.url());
  });
  await page.route('**/*.webp', async (route) => {
    if (isResponsiveVisual(route.request().url())) await new Promise((resolve) => setTimeout(resolve, 180));
    await route.continue();
  });

  await openAssetFixture(page);
  expect(responsiveRequests).toHaveLength(0);
  await page.getByTestId('right-menu-battles').click();
  await page.getByTestId('battle-panel').getByRole('button', { name: '查看战报' }).click();
  const battleVisual = page.getByTestId('battle-report-visual');
  await expect(battleVisual).toHaveAttribute('data-visual-state', 'loading');
  const loadingBox = await battleVisual.boundingBox();
  await expect(battleVisual).toHaveAttribute('data-visual-state', 'ready');
  expect(boxDimensions(await battleVisual.boundingBox())).toEqual(boxDimensions(loadingBox));
  expect(await decodedImageDimensions(page, '[data-testid="battle-report-visual"] img')).toEqual([
    { width: 1280, height: 720 },
    { width: 1280, height: 720 },
  ]);
  const firstBattleUrls = [...new Set(responsiveRequests.filter((url) => url.includes('/war/')))];
  expect(firstBattleUrls).toHaveLength(2);
  expect(firstBattleUrls.every((url) => /\/display\/.*\.webp(?:\?|$)/.test(url))).toBe(true);

  await page.getByTestId('battle-report-detail').getByRole('button', { name: '关闭' }).click();
  await page.getByTestId('battle-panel').getByRole('button', { name: '查看战报' }).click();
  await expect(page.getByTestId('battle-report-visual')).toHaveAttribute('data-visual-state', 'ready');
  const repeatedBattleUrls = [...new Set(responsiveRequests.filter((url) => url.includes('/war/')))];
  expect(repeatedBattleUrls).toEqual(firstBattleUrls);
  await page.getByTestId('battle-report-detail').getByRole('button', { name: '关闭' }).click();
  await page.getByTestId('battle-panel').getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('right-menu-map').click();
  const mapBase = page.getByTestId('map-historical-base-layer');
  await expect(mapBase).toHaveAttribute('data-visual-state', 'loading');
  const mapLoadingBox = await mapBase.boundingBox();
  await expect(mapBase).toHaveAttribute('data-visual-state', 'ready');
  expect(boxDimensions(await mapBase.boundingBox())).toEqual(boxDimensions(mapLoadingBox));
  expect(await decodedImageDimensions(page, '[data-testid="map-historical-base-layer"] img')).toEqual([
    { width: 1586, height: 992 },
  ]);
  expect([...new Set(responsiveRequests.filter((url) => url.includes('/maps/')))]).toEqual([
    expect.stringMatching(/\/display\/three-kingdoms-map-v2-full-domain-base\.webp(?:\?|$)/),
  ]);
  expect(sourcePngRequests).toHaveLength(0);
  expect(await page.evaluate(() => window.__batch8LayoutShift ?? 0)).toBeLessThanOrEqual(0.02);
  await page.screenshot({ path: 'output/playwright/ui-batch8/desktop-map-1920x1080.png', fullPage: true });
});

test('mobile variants recover from one failed request without changing their slots', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let failWarOnce = true;
  let failMapOnce = true;
  const responseBytes = new Map<string, number>();
  await page.route('**/*.webp', async (route) => {
    const url = route.request().url();
    if (failWarOnce && /\/generated\/war\/.*\/mobile\//.test(url)) {
      failWarOnce = false;
      await route.abort();
      return;
    }
    if (failMapOnce && /\/generated\/maps\/mobile\//.test(url)) {
      failMapOnce = false;
      await route.abort();
      return;
    }
    await route.continue();
  });
  page.on('response', async (response) => {
    if (!isResponsiveVisual(response.url())) return;
    try {
      responseBytes.set(response.url(), (await response.body()).byteLength);
    } catch {
      // Browser cache bodies are optional; natural dimensions and URL selection stay authoritative.
    }
  });

  await openAssetFixture(page);
  await page.getByTestId('mobile-region-systems').click();
  await page.getByTestId('right-menu-battles').click();
  await page.getByTestId('battle-panel').getByRole('button', { name: '查看战报' }).click();
  const battleVisual = page.getByTestId('battle-report-visual');
  await expect(battleVisual).toHaveAttribute('data-visual-state', 'error');
  const battleErrorBox = await battleVisual.boundingBox();
  await battleVisual.getByRole('button', { name: '重试载入' }).click();
  await expect(battleVisual).toHaveAttribute('data-visual-state', 'ready');
  expect(boxDimensions(await battleVisual.boundingBox())).toEqual(boxDimensions(battleErrorBox));
  expect(await decodedImageDimensions(page, '[data-testid="battle-report-visual"] img')).toEqual([
    { width: 640, height: 360 },
    { width: 640, height: 360 },
  ]);
  await page.getByTestId('battle-report-detail').getByRole('button', { name: '关闭' }).click();
  await page.getByTestId('battle-panel').getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('right-menu-map').click();
  const mapBase = page.getByTestId('map-historical-base-layer');
  await expect(mapBase).toHaveAttribute('data-visual-state', 'error');
  const mapErrorBox = await mapBase.boundingBox();
  await mapBase.getByRole('button', { name: '重试载入' }).click();
  await expect(mapBase).toHaveAttribute('data-visual-state', 'ready');
  expect(boxDimensions(await mapBase.boundingBox())).toEqual(boxDimensions(mapErrorBox));
  expect(await decodedImageDimensions(page, '[data-testid="map-historical-base-layer"] img')).toEqual([
    { width: 760, height: 476 },
  ]);
  const mobileMapResponse = [...responseBytes.entries()].find(([url]) => /\/generated\/maps\/mobile\//.test(url));
  expect(mobileMapResponse).toBeDefined();
  expect(mobileMapResponse![1]).toBeLessThan(3 * 1024 * 1024);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  expect(await page.evaluate(() => window.__batch8LayoutShift ?? 0)).toBeLessThanOrEqual(0.02);
  await page.screenshot({ path: 'output/playwright/ui-batch8/mobile-map-390x844.png', fullPage: true });
});

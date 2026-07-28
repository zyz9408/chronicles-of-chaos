import { expect, test, type Locator, type Page } from '@playwright/test';

async function expectMapLabelsNotToOverlap(mapPanel: Locator): Promise<void> {
  await expect.poll(() => mapPanel.locator('.map-v2-marker strong').evaluateAll((nodes) => {
    const rects = nodes
      .map((node) => node.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);
    let overlaps = 0;
    for (let leftIndex = 0; leftIndex < rects.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < rects.length; rightIndex += 1) {
        const left = rects[leftIndex];
        const right = rects[rightIndex];
        const overlapWidth = Math.min(left.right, right.right) - Math.max(left.left, right.left);
        const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
        if (overlapWidth > 1 && overlapHeight > 1) overlaps += 1;
      }
    }
    return overlaps;
  })).toBe(0);
}

async function openStrategicPanelFixture(page: Page) {
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

    await saveManager.clearAllSaves();
    const state = openingState.createCustomOpeningState({
      worldBook,
      bookmark,
      playerName: '面板验收',
      courtesyName: '定版',
      playerSex: '男',
      playerAge: 29,
      origin: '地方太守',
      birthOrigin: '寒门武人',
      currentIdentity: '颍川太守',
      locationId: location.id,
      situationSummary: '战略面板排版验收用开局。',
    });

    state.resources = {
      money: 320,
      grain: 12000,
      horses: 40,
      arms: 210,
      recruits: 800,
      weapons: [],
      documents: [],
      tokens: [],
      importantSupplies: [],
    };
    state.factions = [
      {
        factionId: 'faction_player_yingchuan',
        name: '颍川太守府',
        type: 'local_government',
        summary: '玩家临时接管的颍川郡府，兵力有限，仍需士族配合。',
        stanceToPlayer: 'controlled',
        knownLevel: '亲历',
        aliases: ['颍川郡府'],
        nominalAllegiance: '汉廷',
        legalIdentity: '地方官府',
        actualController: '面板验收',
        knownSphere: '阳翟县城、郡府仓廪与南门营地',
        sourceNote: '郡府文书',
        lastKnownAt: '公元189年09月01日 08:00（辰时）',
        updatedAt: '公元189年09月01日 08:00（辰时）',
        recentActions: ['清点南门郡兵'],
      },
    ];
    state.holdings = [
      {
        holdingId: 'holding_yingchuan',
        name: '洛阳北营',
        type: 'camp',
        status: 'controlled',
        summary: '账面归郡府管辖，实际征收仍受地方豪强影响。',
        locationId: location.id,
        factionId: 'faction_player_yingchuan',
        nominalAllegiance: '汉廷',
        actualController: '面板验收',
        scaleLevel: 3,
        agriculture: 72,
        commerce: 61,
        population: 68,
        publicOrder: 52,
        popularSupport: 57,
        defense: 48,
        recruitPotential: 63,
        armory: 44,
        horseSupply: 22,
        corruption: 34,
        farmlandMu: 12000,
        registeredHouseholds: 1800,
        eliteControlledShare: 55,
        localEliteRelation: 35,
        localTreasury: 80,
        localGranary: 3500,
        garrisonTroopIds: ['troop_yingchuan_guard'],
        riskNotes: ['士族观望'],
        recentChanges: ['初步接管郡府'],
        siege: {
          status: 'encircled',
          supplyLine: 'cut',
          preparation: 'prepared',
          cutOffAtTurn: 2,
          initialEnduranceTurns: 18,
        },
        sourceNote: '郡府文书',
        updatedAt: '公元189年09月01日 10:00（巳时）',
      },
      {
        holdingId: 'holding_yingchuan_ferry',
        name: '颍水渡口',
        type: 'other',
        status: 'temporary',
        summary: '临时控制的水陆转运节点，尚未完成户籍与税契清丈。',
        locationId: location.id,
        factionId: 'faction_player_yingchuan',
        nominalAllegiance: '汉廷',
        actualController: '面板验收',
        scaleLevel: 1,
        agriculture: 30,
        commerce: 56,
        population: 28,
        publicOrder: 42,
        popularSupport: 39,
        defense: 24,
        recruitPotential: 18,
        armory: 12,
        horseSupply: 8,
        corruption: 18,
        sourceNote: '斥候回报',
        updatedAt: '公元189年09月01日 09:30（巳时）',
      },
    ];
    state.troops = [
      {
        troopId: 'troop_yingchuan_guard',
        name: '锦帆水军（刘平部）',
        size: 800,
        factionId: 'faction_player_yingchuan',
        troopType: 'naval',
        quality: '高',
        leaderNpcId: 'player',
        locationId: location.id,
        knownLevel: '亲历',
        morale: 75,
        training: 60,
        supplies: '正常',
        fatigue: '低',
        readiness: '高',
        task: '日常操练与阳翟城防',
        relationToPlayer: 'direct_command',
        sourceNote: '你目前直接统领的部队',
        statusTags: ['士气振奋', '春寒操练'],
        updatedAt: '公元189年09月01日 10:00（巳时）',
      },
      {
        troopId: 'troop_yingchuan_cavalry',
        name: '阳翟郡骑',
        size: 260,
        factionId: 'faction_player_yingchuan',
        troopType: 'cavalry',
        quality: '中',
        leaderNpcId: 'player',
        locationId: location.id,
        knownLevel: '亲历',
        morale: 62,
        training: 58,
        supplies: '略紧',
        fatigue: '中',
        readiness: '中',
        task: '巡查颍水渡口与南门驿道',
        relationToPlayer: 'direct_command',
        sourceNote: '你目前直接统领的部队',
        statusTags: ['渡口巡防'],
        updatedAt: '公元189年09月01日 09:30（巳时）',
      },
    ];

    await saveManager.createSave(state, '战略面板验收存档');
  });

  await page.reload();
  await page.getByRole('button', { name: '兵戈再起' }).click();
  await page.getByText('面板验收', { exact: true }).click();
}

const isGeneratedPanelVisual = (url: string) => /\/src\/assets\/generated\/(holdings|troops)\//.test(url);
const isSourcePanelPng = (url: string) => /\/src\/assets\/(holdings\/scenes|troops\/forces)\/.*\.png(?:\?|$)/.test(url);
const isPanelVisualManifest = (url: string) => /\/src\/generated\/panelVisuals\/(holding|troop)VisualManifest\.ts/.test(url);

test('strategic panels render compact faction, holding, and troop layouts', async ({ page }) => {
  const panelVisualRequests: string[] = [];
  const panelManifestRequests: string[] = [];
  const sourcePngRequests: string[] = [];
  const responseBytes = new Map<string, number>();
  page.on('request', (request) => {
    if (isGeneratedPanelVisual(request.url())) panelVisualRequests.push(request.url());
    if (isPanelVisualManifest(request.url())) panelManifestRequests.push(request.url());
    if (isSourcePanelPng(request.url())) sourcePngRequests.push(request.url());
  });
  page.on('response', async (response) => {
    if (!isGeneratedPanelVisual(response.url())) return;
    try {
      responseBytes.set(response.url(), (await response.body()).byteLength);
    } catch {
      // Cached response bodies are optional; request and layout assertions remain authoritative.
    }
  });
  await page.route('**/*.webp', async (route) => {
    if (isGeneratedPanelVisual(route.request().url())) {
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    await route.continue();
  });

  await openStrategicPanelFixture(page);
  expect(panelVisualRequests).toHaveLength(0);
  expect(panelManifestRequests).toHaveLength(0);
  expect(sourcePngRequests).toHaveLength(0);

  await page.getByTestId('right-menu-factions').click();
  const factionPanel = page.getByTestId('faction-panel');
  await expect(factionPanel).toBeVisible();
  await expect(factionPanel.locator('.faction-command-grid')).toContainText('对玩家立场');
  await expect(factionPanel.locator('.faction-command-grid')).toContainText('实际主事');
  await expect(factionPanel.locator('.faction-command-grid')).toContainText('已知范围');
  await expect(factionPanel.locator('.faction-command-grid')).toContainText('近期动作');
  await expect(factionPanel.locator('.faction-command-grid')).toContainText('情报时间');
  await expect(factionPanel.locator('.faction-command-grid')).toContainText('风险提示');
  await expect(factionPanel).toContainText('身份与主事');
  await expect(factionPanel.locator('.faction-intel-footnote')).toContainText('郡府文书');
  await factionPanel.getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('right-menu-holdings').click();
  const holdingPanel = page.getByTestId('holding-panel');
  await expect(holdingPanel).toBeVisible();
  expect(panelVisualRequests.filter((url) => url.includes('/holdings/'))).toHaveLength(0);
  expect(panelManifestRequests.filter((url) => url.includes('holdingVisualManifest'))).toHaveLength(0);
  await holdingPanel.getByRole('tab', { name: /控制领地/ }).click();
  await expect(holdingPanel).toContainText('理论产出、实征与差额');
  await expect(holdingPanel).toContainText('差额原因');
  await expect(holdingPanel).toContainText('围城与补给');
  await expect(holdingPanel).toContainText('完全包围');
  await expect(holdingPanel).toContainText('已中断');
  await expect(holdingPanel).toContainText('田亩户口与豪强');
  await expect(holdingPanel).toContainText('管辖与行政');
  await expect(holdingPanel.locator('.holding-controlled-layout')).toBeVisible();
  await expect(holdingPanel.locator('.holding-controlled-top-row')).toBeVisible();
  await expect(holdingPanel.locator('.holding-controlled-top-row .holding-controlled-info-stack')).toBeVisible();
  await expect(holdingPanel.locator('.holding-collection-stack')).toBeVisible();
  await expect(holdingPanel.locator('.holding-scenic-panel')).toBeVisible();
  const holdingVisualState = holdingPanel.getByTestId('holding-visual-state');
  await expect(holdingVisualState).toHaveClass(/panel-visual-state--loading/);
  const holdingLoadingBox = await holdingVisualState.boundingBox();
  expect(holdingLoadingBox).not.toBeNull();
  await expect(holdingVisualState).toHaveClass(/panel-visual-state--display-ready/);
  const holdingReadyBox = await holdingVisualState.boundingBox();
  expect(holdingReadyBox).not.toBeNull();
  expect(holdingReadyBox).toEqual(holdingLoadingBox);
  const holdingDisplayImage = holdingVisualState.locator('.panel-visual-image--display.is-ready');
  await expect(holdingDisplayImage).toBeVisible();
  await expect.poll(async () => holdingDisplayImage.evaluate((element) => ({
    width: (element as HTMLImageElement).naturalWidth,
    height: (element as HTMLImageElement).naturalHeight,
  }))).toEqual({ width: 1280, height: 720 });
  const holdingRequests = panelVisualRequests.filter((url) => url.includes('/holdings/'));
  expect(panelManifestRequests.filter((url) => url.includes('holdingVisualManifest'))).toHaveLength(1);
  expect(holdingRequests).toHaveLength(2);
  expect(holdingRequests).toEqual([
    expect.stringContaining('holding_scene_type_camp_normal_medium_v01.webp'),
    expect.stringContaining('holding_scene_type_camp_normal_medium_v01.webp'),
  ]);
  await expect.poll(() => holdingRequests.reduce((total, url) => total + (responseBytes.get(url) ?? 0), 0)).toBeGreaterThan(0);
  expect(holdingRequests.reduce((total, url) => total + (responseBytes.get(url) ?? 0), 0)).toBeLessThan(3_531_353 * 0.25);
  await expect(holdingVisualState.locator('.panel-visual-image--thumbnail')).toHaveCount(0);
  await expect(holdingPanel.locator('.holding-scenic-panel')).not.toContainText(/实征|掌控|郡国|县邑/);
  await expect.poll(async () => holdingPanel.locator('.holding-collection-stack').evaluate((element) => {
    return window.getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length;
  })).toBe(1);
  await expect.poll(async () => holdingPanel.locator('.holding-land-register-grid').evaluate((element) => {
    return window.getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length;
  })).toBe(4);
  await expect.poll(async () => holdingPanel.locator('.holding-scenic-panel').evaluate((element) => {
    const panel = element.getBoundingClientRect();
    const topRow = element.closest('.holding-controlled-top-row');
    const infoStack = topRow?.querySelector('.holding-controlled-info-stack')?.getBoundingClientRect();
    if (!infoStack) return false;
    return panel.left > infoStack.left;
  })).toBe(true);
  await expect.poll(async () => holdingPanel.locator('.holding-scenic-panel').evaluate((element) => {
    const panel = element.getBoundingClientRect();
    return Math.round((panel.width / panel.height) * 100) / 100;
  })).toBe(1.78);
  const holdingPanelBoxBeforeSwitch = await holdingPanel.boundingBox();
  await holdingPanel.getByRole('button', { name: /颍水渡口/ }).click();
  await expect(holdingPanel.locator('.strategic-detail h4')).toHaveText('颍水渡口');
  const switchedHoldingVisual = holdingPanel.getByTestId('holding-visual-state');
  await expect(switchedHoldingVisual).toHaveAttribute('data-asset-key', 'holding_scene_visual_ferry_ruined_small_v01.png');
  await expect(switchedHoldingVisual).toHaveClass(/panel-visual-state--display-ready/);
  expect(await holdingPanel.boundingBox()).toEqual(holdingPanelBoxBeforeSwitch);
  await holdingPanel.getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('right-menu-troops').click();
  const troopPanel = page.getByTestId('troop-panel');
  await expect(troopPanel).toBeVisible();
  await expect(troopPanel.locator('.troop-switch-control')).toContainText('2支部队');
  await expect(troopPanel.locator('.troop-record-card')).toContainText('位置与任务');
  await expect(troopPanel.locator('.troop-record-card')).toContainText('情报与变动');
  await expect(troopPanel.locator('.troop-stat-strip')).toContainText('精锐度');
  await expect(troopPanel.locator('.troop-stat-strip')).toContainText('高');
  await expect(troopPanel.locator('.troop-record-title .troop-record-meta')).toContainText('所属势力');
  await expect(troopPanel.locator('.troop-record-title .troop-record-meta')).toContainText('面板验收（你）');
  const troopVisualState = troopPanel.getByTestId('troop-visual-state');
  await expect(troopVisualState).toHaveClass(/panel-visual-state--loading/);
  const troopLoadingBox = await troopVisualState.boundingBox();
  expect(troopLoadingBox).not.toBeNull();
  await expect(troopVisualState).toHaveClass(/panel-visual-state--display-ready/);
  const troopReadyBox = await troopVisualState.boundingBox();
  expect(troopReadyBox).not.toBeNull();
  expect(troopReadyBox).toEqual(troopLoadingBox);
  const troopDisplayImage = troopVisualState.locator('.panel-visual-image--display.is-ready');
  await expect(troopDisplayImage).toBeVisible();
  await expect.poll(async () => troopDisplayImage.evaluate((element) => ({
    width: (element as HTMLImageElement).naturalWidth,
    height: (element as HTMLImageElement).naturalHeight,
  }))).toEqual({ width: 1280, height: 720 });
  const troopRequests = panelVisualRequests.filter((url) => url.includes('/troops/'));
  expect(panelManifestRequests.filter((url) => url.includes('troopVisualManifest'))).toHaveLength(1);
  expect(troopRequests).toEqual([
    expect.stringContaining('troop_force_naval_medium_elite_v01.webp'),
    expect.stringContaining('troop_force_naval_medium_elite_v01.webp'),
  ]);
  await expect.poll(() => troopRequests.reduce((total, url) => total + (responseBytes.get(url) ?? 0), 0)).toBeGreaterThan(0);
  expect(troopRequests.reduce((total, url) => total + (responseBytes.get(url) ?? 0), 0)).toBeLessThan(1_445_462 * 0.25);
  await expect(troopVisualState.locator('.panel-visual-image--thumbnail')).toHaveCount(0);
  expect(sourcePngRequests).toHaveLength(0);
  await expect(troopPanel.locator('.troop-visual-panel')).toContainText('水军 · 800人 · 精锐度 高');
  await expect(troopPanel).toContainText('面板验收（你）');
  await expect.poll(async () => troopPanel.locator('.troop-visual-panel').evaluate((element) => {
    const style = window.getComputedStyle(element);
    return style.backgroundImage;
  })).toContain('radial-gradient');
  await expect.poll(async () => troopPanel.locator('.troop-visual-panel').evaluate((element) => {
    const panel = element.getBoundingClientRect();
    return Math.round((panel.width / panel.height) * 100) / 100;
  })).toBe(1.78);
  await expect.poll(async () => troopPanel.locator('.troop-visual-panel').evaluate((element) => {
    const panel = element.getBoundingClientRect();
    const card = element.closest('.troop-record-card')?.getBoundingClientRect();
    if (!card) return 0;
    return Math.round((panel.left + panel.width / 2 - card.left) / card.width * 100);
  })).toBeGreaterThanOrEqual(70);
  await expect.poll(async () => troopPanel.locator('.troop-record-body').evaluate((element) => {
    const info = element.querySelector('.troop-record-info')?.getBoundingClientRect();
    const visual = element.querySelector('.troop-visual-panel')?.getBoundingClientRect();
    if (!info || !visual) return false;
    return visual.left >= info.right;
  })).toBe(true);
  await expect.poll(async () => troopPanel.locator('.troop-visual-panel small').evaluate((element) => {
    const caption = element.getBoundingClientRect();
    const visual = element.closest('.troop-visual-panel')?.getBoundingClientRect();
    if (!visual) return Number.POSITIVE_INFINITY;
    return Math.abs(Math.round(visual.bottom - caption.bottom));
  })).toBeLessThanOrEqual(2);
  const troopPanelBoxBeforeSwitch = await troopPanel.boundingBox();
  await troopPanel.getByRole('combobox', { name: '切换部队' }).selectOption({ label: '阳翟郡骑 · 260人' });
  await expect(troopPanel.locator('.troop-record-title h4')).toHaveText('阳翟郡骑');
  const switchedTroopVisual = troopPanel.getByTestId('troop-visual-state');
  await expect(switchedTroopVisual).toHaveAttribute('data-asset-key', 'troop_force_cavalry_small_standard_v01.png');
  await expect(switchedTroopVisual).toHaveClass(/panel-visual-state--display-ready/);
  expect(await troopPanel.boundingBox()).toEqual(troopPanelBoxBeforeSwitch);
  await troopPanel.getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('right-menu-map').click();
  const mapPanel = page.getByTestId('map-panel');
  await expect(mapPanel).toBeVisible();
  await expect(mapPanel.locator('.map-v2-national-stage')).toBeVisible();
  await expect(mapPanel.locator('.map-v2-base-map-art')).toHaveCount(1);
  const historicalBaseLayer = mapPanel.getByTestId('map-historical-base-layer');
  await expect(historicalBaseLayer).toBeVisible();
  await expect(historicalBaseLayer).toHaveAttribute('data-visual-state', 'ready');
  await expect(mapPanel.getByTestId('map-real-land-layer')).toBeVisible();
  await expect(mapPanel.getByTestId('map-real-river-layer')).toBeVisible();
  await expect(mapPanel.locator('.map-historical-real-land-layer path')).not.toHaveCount(0);
  await expect(mapPanel.locator('.map-historical-real-river-layer path')).not.toHaveCount(0);
  const nationalMarkerCount = await mapPanel.locator('.map-v2-marker').count();
  expect(nationalMarkerCount).toBeGreaterThan(0);
  expect(nationalMarkerCount).toBeLessThanOrEqual(40);
  await expect(mapPanel.locator('.map-v2-zoom-level')).toHaveText('全国');
  await expectMapLabelsNotToOverlap(mapPanel);
  await expect.poll(async () => {
    const toolbar = await mapPanel.locator('.map-v2-toolbar').boundingBox();
    const surface = await mapPanel.locator('.map-v2-map-surface').boundingBox();
    return Boolean(toolbar && surface && toolbar.y + toolbar.height <= surface.y);
  }).toBe(true);
  await expect.poll(async () => mapPanel.locator('.map-v2-cluster-count').count()).toBeGreaterThan(0);
  const currentMarker = mapPanel.locator('.map-v2-current-marker');
  await currentMarker.hover();
  const markerTooltip = currentMarker.getByRole('tooltip');
  await expect(markerTooltip).toBeVisible();
  await expect(markerTooltip).toContainText('类型');
  await expect(markerTooltip).toContainText('所属州郡');
  await expect(markerTooltip).toContainText('路线');
  await expect(markerTooltip).toContainText('已知控制方');
  await expect(mapPanel.locator('.map-historical-mainland')).toHaveCount(0);
  await expect(mapPanel.locator('.map-historical-domain')).toHaveCount(0);
  await expect(mapPanel.locator('.map-historical-island-layer')).toHaveCount(0);
  await expect(mapPanel.locator('.map-historical-region-layer')).toHaveCount(0);
  await expect(mapPanel.locator('.map-historical-major-river-layer')).toHaveCount(0);
  await expect(mapPanel.locator('.map-historical-mountain-layer path')).not.toHaveCount(0);
  await expect(mapPanel.locator('.map-historical-terrain-layer path')).not.toHaveCount(0);
  await expect(mapPanel.locator('.map-historical-forest-layer')).toHaveCount(0);
  await expect(mapPanel.locator('.map-v2-current-marker')).toBeVisible();
  await expect(mapPanel.getByRole('button', { name: '放大地图' })).toBeVisible();
  await expect(mapPanel.getByRole('button', { name: '缩小地图' })).toBeVisible();
  await expect(mapPanel.getByRole('button', { name: '复位全国' })).toBeVisible();
  await expect(mapPanel.getByRole('button', { name: '聚焦当前位置' })).toBeVisible();
  const mapPanelBoxBeforeSelection = await mapPanel.boundingBox();
  const routeTarget = mapPanel.locator('.map-v2-route-chips button').first();
  if (await routeTarget.count()) {
    await routeTarget.click();
    await expect(mapPanel.getByTestId('map-focus-card')).toContainText('地图焦点');
    expect(await mapPanel.boundingBox()).toEqual(mapPanelBoxBeforeSelection);
  }
  await mapPanel.getByRole('button', { name: '放大地图' }).click();
  await expect(mapPanel.locator('.map-v2-zoom-level')).toHaveText('区域');
  await expectMapLabelsNotToOverlap(mapPanel);
  await mapPanel.getByRole('button', { name: '放大地图' }).click();
  await mapPanel.getByRole('button', { name: '放大地图' }).click();
  await expect(mapPanel.locator('.map-v2-zoom-level')).toHaveText('近景');
  await expectMapLabelsNotToOverlap(mapPanel);
  await mapPanel.getByRole('button', { name: '复位全国' }).click();
  await expect(mapPanel.locator('.map-v2-zoom-level')).toHaveText('全国');
  await mapPanel.getByRole('button', { name: '聚焦当前位置' }).click();
  await expect(mapPanel.locator('.map-v2-zoom-level')).toContainText('详图');
  await expect.poll(async () => mapPanel.locator('.map-v2-marker').count()).toBeGreaterThan(nationalMarkerCount);
  await expectMapLabelsNotToOverlap(mapPanel);
  const mapModal = mapPanel;
  const mapSurface = mapPanel.locator('.map-v2-map-surface');
  await expect(mapSurface).toBeVisible();
  await mapModal.evaluate((element) => { element.scrollTop = 180; });
  const modalScrollBeforeWheel = await mapModal.evaluate((element) => element.scrollTop);
  const zoomBeforeWheel = await mapPanel.locator('.map-v2-canvas').evaluate((element) => (
    window.getComputedStyle(element).transform
  ));
  const mapSurfaceBox = await mapSurface.boundingBox();
  expect(mapSurfaceBox).not.toBeNull();
  await page.mouse.move(
    mapSurfaceBox!.x + mapSurfaceBox!.width / 2,
    mapSurfaceBox!.y + mapSurfaceBox!.height / 2,
  );
  await page.mouse.wheel(0, -450);
  await expect.poll(async () => mapModal.evaluate((element) => element.scrollTop)).toBe(modalScrollBeforeWheel);
  await expect.poll(async () => mapPanel.locator('.map-v2-canvas').evaluate((element) => (
    window.getComputedStyle(element).transform
  ))).not.toBe(zoomBeforeWheel);
  const mapToolbar = mapPanel.locator('.map-v2-toolbar');
  await mapModal.evaluate((element) => { element.scrollTop = 220; });
  const modalScrollBeforeToolbarWheel = await mapModal.evaluate((element) => element.scrollTop);
  const mapToolbarBox = await mapToolbar.boundingBox();
  expect(mapToolbarBox).not.toBeNull();
  await page.mouse.move(
    mapToolbarBox!.x + mapToolbarBox!.width / 2,
    mapToolbarBox!.y + mapToolbarBox!.height / 2,
  );
  await page.mouse.wheel(0, 450);
  await expect.poll(async () => mapModal.evaluate((element) => element.scrollTop)).toBe(modalScrollBeforeToolbarWheel);
  await expect.poll(async () => {
    return mapPanel.locator('.map-v2-marker strong').evaluateAll((nodes) => (
      nodes.filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).length
    ));
  }).toBeGreaterThanOrEqual(7);
  const visibleMapLabelCount = await mapPanel.locator('.map-v2-marker strong').evaluateAll((nodes) => (
    nodes.filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).length
  ));
  expect(visibleMapLabelCount).toBeLessThanOrEqual(80);
  await expectMapLabelsNotToOverlap(mapPanel);
  await expect(mapPanel).not.toContainText('MAP V1');
  await expect(mapPanel).not.toContainText('Map V1');
  await expect(mapPanel).not.toContainText('耗时待确认');
  await expect(mapPanel.getByRole('button', { name: '地图档案' })).toBeVisible();
  await mapPanel.getByRole('button', { name: '地图档案' }).click();
  await expect(mapPanel).toContainText('路线档案');
  await expect(mapPanel).toContainText('地点档案');
  await expect(mapPanel).not.toContainText('sourceKind');
  await expect(mapPanel).not.toContainText('routeEdge');
  await expect(mapPanel).not.toContainText('耗时待确认');
  await expect(mapPanel).not.toContainText('LLM');
});

test('panel visual load errors keep layout stable and retry in place', async ({ page }) => {
  let failHoldingDisplayOnce = true;
  await page.route('**/*.webp', async (route) => {
    const url = route.request().url();
    if (failHoldingDisplayOnce && url.includes('/generated/holdings/display/')) {
      failHoldingDisplayOnce = false;
      await new Promise((resolve) => setTimeout(resolve, 180));
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await openStrategicPanelFixture(page);
  await page.getByTestId('right-menu-holdings').click();
  const holdingPanel = page.getByTestId('holding-panel');
  await holdingPanel.getByRole('tab', { name: /控制领地/ }).click();
  const visualState = holdingPanel.getByTestId('holding-visual-state');
  await expect(visualState).toHaveClass(/panel-visual-state--loading/);
  const loadingBox = await visualState.boundingBox();
  await expect(visualState).toHaveClass(/panel-visual-state--load-error/);
  await expect(visualState).toContainText('图像载入失败');
  expect(await visualState.boundingBox()).toEqual(loadingBox);
  await visualState.getByRole('button', { name: '重试载入' }).click();
  await expect(visualState).toHaveClass(/panel-visual-state--loading/);
  await expect(visualState).toHaveClass(/panel-visual-state--display-ready/);
  expect(await visualState.boundingBox()).toEqual(loadingBox);
  await expect(visualState.locator('.panel-visual-image--thumbnail')).toHaveCount(0);
  await expect(visualState.locator('.panel-visual-image--display.is-ready')).toBeVisible();
});

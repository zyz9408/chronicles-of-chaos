import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resetE2eCoreStores } from './e2eStorage';

const SCREENSHOT_DIR = 'output/playwright/war-v2-batch4';

async function seedWarEncounter(page: Page): Promise<void> {
  await page.goto('/');
  await resetE2eCoreStores(page);
  await page.evaluate(async () => {
    const worldBookLoader = await import('/src/engine/worldbook/WorldBookLoader.ts');
    const startBookmarkResolver = await import('/src/engine/worldbook/StartBookmarkResolver.ts');
    const openingState = await import('/src/engine/state/createCustomOpeningState.ts');
    const saveManager = await import('/src/engine/save/SaveManager.ts');
    const warRuntime = await import('/src/engine/encounterV2/WarRuntimeIntegration.ts');
    const fixtures = await import('/src/engine/encounterV2/WarTestFixtures.ts');

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
      playerName: '刘平',
      courtesyName: '汉升',
      playerSex: '男',
      playerAge: 29,
      origin: '地方太守',
      birthOrigin: '寒门武人',
      currentIdentity: '荆州别部司马',
      locationId: location.id,
      situationSummary: 'War V2 浏览器验收夹具。',
    });

    state.player.id = 'player_liuping';
    state.player.name = '刘平';
    state.player.abilityScores = { 统率: 98, 智力: 90, 武力: 88, 魅力: 82, 政治: 72 };
    state.player.traits = [];
    state.player.uniqueArts = [];
    state.turnLog = [{
      turnNumber: 1,
      date: state.currentDate,
      playerInput: '亲自统军夺取新野水门',
      narrativeText: '两军已经在新野水门外列阵。',
      fullNarrativeText: '两军已经在新野水门外列阵，战争即将交给本地引擎。',
      statePatchSummary: 'War V2 触发',
      timestamp: '2026-07-20T04:00:00.000Z',
    }];
    state.activeQuests = [{
      id: 'quest_war_boundary',
      title: '不应由战争内部推进的事项',
      description: '验证战争引擎不会推进开放叙事系统。',
      status: 'active',
      priority: 'medium',
      createdAt: state.currentDate,
      updatedAt: state.currentDate,
    }];
    state.worldTrends = [{
      trendId: 'trend_war_boundary',
      title: '不应由战争内部推进的天下纪事',
      severity: '中',
      summary: '验证战争引擎不会推进天下纪事。',
      knownToPlayer: true,
      status: 'active',
      scope: 'realm',
      happenedAt: state.currentDate,
      updatedAt: state.currentDate,
    }];
    state.npcs = [{
      npcId: 'npc_enemy_commander',
      name: '张绣',
      sex: '男',
      age: 31,
      role: '西凉军主将',
      isPresent: false,
      isFocused: true,
      summary: '据守新野水门的敌军主将。',
      appearance: '披铁甲，持长枪。',
      personality: '强悍谨慎',
      motivation: '守住水门',
      relationToPlayer: '敌对',
      contactLevel: 1,
      recentAttitude: '严阵以待',
      abilityScores: { 统率: 58, 智力: 52, 武力: 65, 魅力: 45, 政治: 35 },
      traits: [],
      uniqueArts: [],
      memories: [],
    }];

    const playerIds = Array.from({ length: 6 }, (_, index) => `troop_player_${index + 1}`);
    const enemyIds = Array.from({ length: 6 }, (_, index) => `troop_enemy_${index + 1}`);
    state.troops = [
      ...playerIds.map((troopId, index) => fixtures.makeWarTroop(troopId, {
        name: `荆州精锐第${index + 1}营`,
        size: 1_600,
        factionId: 'faction_player_jingzhou',
        morale: 92,
        training: 90,
        quality: '高',
        readiness: '高',
        supplies: 96,
        fatigue: '低',
      })),
      ...enemyIds.map((troopId, index) => fixtures.makeWarTroop(troopId, {
        name: `新野守军第${index + 1}队`,
        size: 420,
        factionId: 'faction_enemy_xiliang',
        morale: 42,
        training: 45,
        quality: '低',
        readiness: '中',
        supplies: 48,
        fatigue: '中',
      })),
    ];
    state.holdings = [{
      holdingId: 'holding_xinye_water_gate',
      name: '新野水门',
      type: 'fort',
      status: 'contested',
      summary: '扼守水陆通道的城防节点。',
      locationId: location.id,
      factionId: 'faction_enemy_xiliang',
      actualController: '张绣',
      scaleLevel: 2,
      agriculture: 18,
      commerce: 25,
      population: 30,
      publicOrder: 48,
      popularSupport: 35,
      defense: 72,
      recruitPotential: 30,
      armory: 55,
      horseSupply: 22,
      corruption: 12,
      garrisonTroopIds: enemyIds,
      siege: { status: 'encircled', supplyLine: 'cut', preparation: 'prepared' },
      updatedAt: state.currentDate,
    }];

    await saveManager.clearAllSaves();
    const created = await saveManager.createSave(state, 'War V2 浏览器验收');
    const intent = {
      ...fixtures.makeWarIntent(playerIds, enemyIds),
      encounterId: 'encounter_war_batch4_e2e',
      sourceTurnNumber: 1,
      locationId: location.id,
      reason: '新野水门攻防战',
      objective: 'capture_holding',
      targetHoldingId: 'holding_xinye_water_gate',
      environmentTags: ['fortified', 'water'],
      seed: 'war-v2-batch4-e2e-seed',
    };
    const staged = warRuntime.stageWarEncounter(state, {
      saveId: created.id,
      intent,
      projections: [
        ...playerIds.map((troopId) => fixtures.makeTroopProfile(troopId, 'infantry', ['heavy', 'assault'])),
        ...enemyIds.map((troopId) => fixtures.makeTroopProfile(troopId, 'infantry', ['defensive', 'anti_cavalry'])),
      ],
      createdAt: '2026-07-20T04:00:00.000Z',
    });
    await saveManager.saveCurrentState(created.id, staged);
  });

  await page.reload();
  await page.getByRole('button', { name: '兵戈再起' }).click();
  await page.getByRole('button', { name: '读取最近存档' }).click();
  await expect(page.getByTestId('war-v2-screen')).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
}

async function expectStableEnemyLeftPlayerRight(page: Page): Promise<void> {
  const enemy = await page.getByTestId('war-side-enemy').boundingBox();
  const player = await page.getByTestId('war-side-player').boundingBox();
  expect(enemy).not.toBeNull();
  expect(player).not.toBeNull();
  expect(enemy!.x).toBeLessThan(player!.x);
  expect(Math.round(enemy!.width)).toBe(Math.round(player!.width));
  expect(Math.round(enemy!.height)).toBe(Math.round(player!.height));
}

test('War V2 preserves the full-screen layout, motion controls and exact-once world writeback', async ({ page }) => {
  test.setTimeout(120_000);
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const consoleProblems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await seedWarEncounter(page);
  const screen = page.getByTestId('war-v2-screen');
  await expect(screen.locator('.war-v2-background img')).toHaveCount(1);
  await expect(screen.locator('.war-v2-force-art img')).toHaveCount(2);
  await expect.poll(() => screen.locator('.war-v2-background img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expectStableEnemyLeftPlayerRight(page);
  await expectNoHorizontalOverflow(page);
  await expect.poll(() => screen.locator('.war-v2-force-list').first().evaluate((list) => list.scrollHeight <= list.clientHeight)).toBe(true);

  const mirrorState = await screen.evaluate((root) => {
    const enemyWrapper = root.querySelector('.war-v2-force-art--enemy');
    const enemyImage = enemyWrapper?.querySelector('img');
    const playerImage = root.querySelector('.war-v2-force-art--player img');
    return {
      enemyWrapper: enemyWrapper ? getComputedStyle(enemyWrapper).transform : '',
      enemyImage: enemyImage ? getComputedStyle(enemyImage).transform : '',
      playerImage: playerImage ? getComputedStyle(playerImage).transform : '',
    };
  });
  expect(mirrorState.enemyWrapper).toBe('none');
  expect(mirrorState.enemyImage).toContain('-1');
  expect(mirrorState.playerImage === 'none' || mirrorState.playerImage.includes('1, 0, 0, 1')).toBe(true);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-1920x1080.png`, fullPage: true });

  await page.setViewportSize({ width: 1366, height: 768 });
  await expectStableEnemyLeftPlayerRight(page);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/laptop-1366x768.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expectStableEnemyLeftPlayerRight(page);
  await expectNoHorizontalOverflow(page);
  await expect(screen.getByRole('button', { name: '进入战争' })).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/mobile-390x844.png`, fullPage: true });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedDuration = await screen.locator('.war-v2-center-seal').evaluate((seal) => getComputedStyle(seal).animationDuration);
  expect(parseFloat(reducedDuration)).toBeLessThanOrEqual(0.001);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.setViewportSize({ width: 1366, height: 768 });
  await screen.getByRole('button', { name: '进入战争' }).click();
  await screen.getByRole('button', { name: '4×' }).click();
  await expect(screen.getByRole('button', { name: '4×' })).toHaveClass(/is-active/);

  const tacticCases = [
    ['全军强攻', 'is-assault'],
    ['固守阵线', 'is-hold'],
    ['侧翼迂回', 'is-flank'],
    ['稳步推进', 'is-advance'],
  ] as const;
  for (const [label, motion] of tacticCases) {
    const button = screen.getByRole('button', { name: label });
    if (await button.isEnabled()) {
      await button.click();
      await expect(screen.locator('.war-v2-stage')).toHaveAttribute('data-motion', new RegExp(motion));
    }
  }
  await expect(screen.locator('.war-v2-stage')).toHaveAttribute('data-motion', /is-water/);
  await expect(screen.locator('.war-v2-stage')).toHaveAttribute('data-motion', /is-siege/);

  const briefingDialog = page.getByRole('dialog', { name: '战事简报' });
  for (let guard = 0; guard < 16; guard += 1) {
    if (await briefingDialog.isVisible().catch(() => false)) break;
    const pursue = screen.getByRole('button', { name: '追击', exact: true });
    const accept = screen.getByRole('button', { name: '接受投降', exact: true });
    const resume = screen.getByRole('button', { name: '确认风险并恢复手动指挥', exact: true });
    const assault = screen.getByRole('button', { name: '全军强攻', exact: true });
    if (await pursue.isVisible().catch(() => false)) await pursue.click();
    else if (await accept.isVisible().catch(() => false)) await accept.click();
    else if (await resume.isVisible().catch(() => false)) await resume.click();
    else if (await assault.isEnabled().catch(() => false)) await assault.click();
    await page.waitForTimeout(80);
  }

  await expect(briefingDialog).toBeVisible();
  await briefingDialog.getByRole('button', { name: '继续' }).click();
  await expect(screen.locator('.war-v2-result small')).toContainText('封存战果', { timeout: 10_000 });
  await expect(screen.getByRole('button', { name: '生成战后正文' })).toBeVisible();
  await expect(screen.locator('.war-v2-status')).not.toContainText('战争战果保存失败');
  await page.screenshot({ path: `${SCREENSHOT_DIR}/sealed-result-1366x768.png`, fullPage: true });

  const persisted = await page.evaluate(async () => {
    const saveManager = await import('/src/engine/save/SaveManager.ts');
    const saves = await saveManager.listSaves();
    const loaded = saves[0] ? await saveManager.loadSave(saves[0].id) : null;
    if (!loaded) throw new Error('War V2 验收存档未找到。');
    const runtime = loaded.runtimeState;
    const holding = runtime.holdings?.find((entry) => entry.holdingId === 'holding_xinye_water_gate');
    return {
      activeStatus: runtime.encounterV2?.active?.session.status,
      appliedHashes: runtime.encounterV2?.appliedResultHashes ?? [],
      narratedHashes: runtime.encounterV2?.narratedResultHashes ?? [],
      conflictCount: runtime.conflicts?.filter((entry) => entry.conflictId === 'encounter_war_batch4_e2e').length ?? 0,
      judgementMethod: runtime.conflicts?.find((entry) => entry.conflictId === 'encounter_war_batch4_e2e')?.judgement?.method,
      holdingFactionId: holding?.factionId,
      holdingStatus: holding?.status,
      siegeStatus: holding?.siege?.status,
      questStatus: runtime.activeQuests.find((entry) => entry.id === 'quest_war_boundary')?.status,
      trendStatus: runtime.worldTrends?.find((entry) => entry.trendId === 'trend_war_boundary')?.status,
      turnCount: runtime.turnLog.length,
    };
  });
  expect(persisted.activeStatus).toBe('narrative_pending');
  expect(persisted.appliedHashes).toHaveLength(1);
  expect(persisted.narratedHashes).toHaveLength(0);
  expect(persisted.conflictCount).toBe(1);
  expect(persisted.judgementMethod).toBe('warEngineV2');
  expect(persisted.holdingFactionId).toBe('faction_player_jingzhou');
  expect(persisted.holdingStatus).toBe('controlled');
  expect(persisted.siegeStatus).toBeUndefined();
  expect(persisted.questStatus).toBe('active');
  expect(persisted.trendStatus).toBe('active');
  expect(persisted.turnCount).toBe(1);
  expect(consoleProblems).toEqual([]);
});

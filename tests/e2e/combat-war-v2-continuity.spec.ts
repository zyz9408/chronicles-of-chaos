import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { seedMainNarrativeApi } from './e2eStorage';

const MAIN_API_URL = 'https://example.test/v1/chat/completions';
const SCREENSHOT_DIR = 'output/playwright/combat-war-v2-batch5';

async function installEncounterNarrativeStream(page: Page): Promise<void> {
  await page.addInitScript(({ apiUrl }) => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const requestUrl = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.href;
      if (requestUrl !== apiUrl) return nativeFetch(input, init);

      const requestBody = String(init?.body ?? '');
      const isWar = requestBody.includes('本地 War Engine');
      const counterKey = isWar ? '__cocWarNarrativeRequests' : '__cocCombatNarrativeRequests';
      const requestCount = Number(sessionStorage.getItem(counterKey) ?? '0') + 1;
      sessionStorage.setItem(counterKey, String(requestCount));

      if (isWar && requestCount <= 3) {
        throw new TypeError('Batch 5 simulated transient network failure');
      }

      const content = JSON.stringify({
        narrativeText: isWar
          ? '【旁白】新野水门的敌阵终于崩解，封存战果没有因重试发生变化。'
          : '【旁白】营门前的短兵相接已经结束，刘平收刀整顿队伍。',
        suggestedActions: [{
          label: isWar ? '收拢各营' : '清点伤员',
          description: '承接已经封存的本地结果。',
          actionType: 'rest',
        }],
      });
      const events = [
        `data: ${JSON.stringify({
          choices: [{ delta: { content } }],
          usage: { prompt_tokens: 160, completion_tokens: 40, total_tokens: 200 },
        })}`,
        '',
        'data: [DONE]',
        '',
        '',
      ].join('\n');
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(events));
          controller.close();
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };
  }, { apiUrl: MAIN_API_URL });
}

async function loadLatestSaveFromHome(page: Page): Promise<void> {
  await page.reload();
  await page.getByRole('button', { name: '兵戈再起' }).click();
  await page.getByRole('button', { name: '读取最近存档' }).click();
}

async function seedCombatCheckpoint(page: Page): Promise<string> {
  await seedMainNarrativeApi(page);
  await page.evaluate(() => {
    sessionStorage.setItem('__cocCombatNarrativeRequests', '0');
    sessionStorage.setItem('__cocWarNarrativeRequests', '0');
  });
  return page.evaluate(async () => {
    const worldBookLoader = await import('/src/engine/worldbook/WorldBookLoader.ts');
    const startBookmarkResolver = await import('/src/engine/worldbook/StartBookmarkResolver.ts');
    const openingState = await import('/src/engine/state/createCustomOpeningState.ts');
    const saveManager = await import('/src/engine/save/SaveManager.ts');
    const combatRuntime = await import('/src/engine/encounterV2/EncounterRuntimeIntegration.ts');
    const fixtures = await import('/src/engine/encounterV2/CombatTestFixtures.ts');

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
      situationSummary: 'Combat/War V2 长期连续验收夹具。',
    });

    state.player.id = 'player_liuping';
    state.player.name = '刘平';
    state.player.abilityScores = { 统率: 95, 智力: 88, 武力: 96, 机运: 60, 魅力: 80, 政治: 72 };
    state.player.vitals = { hp: 100, maxHp: 100, stamina: 100, maxStamina: 100 };
    state.player.traits = [];
    state.player.uniqueArts = [];
    state.player.equipment = [];
    state.player.inventory = [];
    state.turnLog = [{
      turnNumber: 1,
      date: state.currentDate,
      playerInput: '迎击闯入汉水大营的敌兵',
      narrativeText: '敌兵已经逼近营门，冲突交给本地战斗引擎。',
      fullNarrativeText: '敌兵已经逼近营门，冲突交给本地战斗引擎。',
      statePatchSummary: 'Combat V2 触发',
      timestamp: '2026-07-20T06:00:00.000Z',
    }];
    state.npcs = [{
      npcId: 'npc_enemy_guard',
      name: '西凉悍卒',
      sex: '男',
      age: 30,
      role: '敌军',
      isPresent: true,
      isFocused: true,
      summary: '闯入营门的敌兵。',
      appearance: '披甲持刀。',
      personality: '凶悍',
      motivation: '截杀刘平',
      relationToPlayer: '敌对',
      contactLevel: 1,
      recentAttitude: '杀意明显',
      abilityScores: { 武力: 25, 机运: 35 },
      vitals: { hp: 30, maxHp: 100, stamina: 100, maxStamina: 100 },
      traits: [],
      uniqueArts: [],
      equipment: [],
      inventory: [],
      memories: [],
    }];

    await saveManager.clearAllSaves();
    const created = await saveManager.createSave(state, 'Combat/War V2 Batch 5 长期档');
    const intent = {
      ...fixtures.makeCombatIntent(['player_liuping'], ['npc_enemy_guard']),
      encounterId: 'encounter_combat_batch5_continuity',
      sourceTurnNumber: 1,
      locationId: location.id,
      reason: '汉水大营遭遇战',
      seed: 'combat-v2-batch5-continuity-seed',
      partySelection: 'locked',
    };
    const staged = combatRuntime.stageCombatEncounter(state, {
      saveId: created.id,
      intent,
      projections: [],
      createdAt: '2026-07-20T06:00:00.000Z',
    });
    await saveManager.saveCurrentState(created.id, staged);
    return created.id;
  });
}

async function stageWarCheckpoint(page: Page, saveId: string): Promise<void> {
  await page.evaluate(async ({ targetSaveId }) => {
    const saveManager = await import('/src/engine/save/SaveManager.ts');
    const warRuntime = await import('/src/engine/encounterV2/WarRuntimeIntegration.ts');
    const fixtures = await import('/src/engine/encounterV2/WarTestFixtures.ts');
    const loaded = await saveManager.loadSave(targetSaveId);
    if (!loaded) throw new Error('Batch 5 长期档不存在。');
    const state = structuredClone(loaded.runtimeState);
    const playerTroopId = 'troop_player_batch5';
    const enemyTroopId = 'troop_enemy_batch5';
    state.npcs = [
      ...(state.npcs ?? []).filter((npc) => npc.npcId !== 'npc_enemy_commander'),
      {
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
        abilityScores: { 统率: 40, 智力: 42, 武力: 55, 魅力: 40, 政治: 35 },
        traits: [],
        uniqueArts: [],
        memories: [],
      },
    ];
    state.troops = [
      fixtures.makeWarTroop(playerTroopId, {
        name: '荆州主力营',
        size: 4_000,
        factionId: 'faction_player_jingzhou',
        morale: 95,
        training: 95,
        quality: '高',
        readiness: '高',
        supplies: 98,
        fatigue: '低',
      }),
      fixtures.makeWarTroop(enemyTroopId, {
        name: '新野水门守军',
        size: 100,
        factionId: 'faction_enemy_xiliang',
        morale: 20,
        training: 30,
        quality: '低',
        readiness: '低',
        supplies: 35,
        fatigue: '高',
      }),
    ];
    state.holdings = [{
      holdingId: 'holding_xinye_water_gate_batch5',
      name: '新野水门',
      type: 'fort',
      status: 'contested',
      summary: '扼守水陆通道的城防节点。',
      locationId: state.currentLocationId,
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
      garrisonTroopIds: [enemyTroopId],
      siege: { status: 'encircled', supplyLine: 'cut', preparation: 'prepared' },
      updatedAt: state.currentDate,
    }];
    const intent = {
      ...fixtures.makeWarIntent([playerTroopId], [enemyTroopId]),
      encounterId: 'encounter_war_batch5_continuity',
      sourceTurnNumber: state.turnLog.length,
      locationId: state.currentLocationId,
      reason: '新野水门攻防战',
      objective: 'capture_holding',
      targetHoldingId: 'holding_xinye_water_gate_batch5',
      environmentTags: ['fortified', 'water'],
      seed: 'war-v2-batch5-continuity-seed',
    };
    const staged = warRuntime.stageWarEncounter(state, {
      saveId: targetSaveId,
      intent,
      projections: [
        fixtures.makeTroopProfile(playerTroopId, 'infantry', ['heavy', 'assault']),
        fixtures.makeTroopProfile(enemyTroopId, 'infantry', ['defensive']),
      ],
      createdAt: '2026-07-20T07:00:00.000Z',
    });
    await saveManager.saveCurrentState(targetSaveId, staged);
  }, { targetSaveId: saveId });
}

async function inspectSave(page: Page, saveId: string) {
  return page.evaluate(async ({ targetSaveId }) => {
    const saveManager = await import('/src/engine/save/SaveManager.ts');
    const loaded = await saveManager.loadSave(targetSaveId);
    if (!loaded) throw new Error('Batch 5 长期档不存在。');
    const runtime = loaded.runtimeState;
    const holding = runtime.holdings?.find((entry) => entry.holdingId === 'holding_xinye_water_gate_batch5');
    return {
      activeStatus: runtime.encounterV2?.active?.session.status,
      activeKind: runtime.encounterV2?.active?.session.intent.kind,
      appliedHashes: runtime.encounterV2?.appliedResultHashes ?? [],
      narratedHashes: runtime.encounterV2?.narratedResultHashes ?? [],
      combatCount: runtime.combatRecords?.filter((entry) => entry.combatId === 'encounter_combat_batch5_continuity').length ?? 0,
      conflictCount: runtime.conflicts?.filter((entry) => entry.conflictId === 'encounter_war_batch5_continuity').length ?? 0,
      combatReport: runtime.combatRecords?.find((entry) => entry.combatId === 'encounter_combat_batch5_continuity')?.reportText,
      conflictReport: runtime.conflicts?.find((entry) => entry.conflictId === 'encounter_war_batch5_continuity')?.reportText,
      holdingFactionId: holding?.factionId,
      holdingStatus: holding?.status,
      siegeStatus: holding?.siege?.status,
      turnNumbers: runtime.turnLog.map((turn) => turn.turnNumber),
      turnNarratives: runtime.turnLog.map((turn) => turn.fullNarrativeText ?? turn.narrativeText),
      combatRequests: Number(sessionStorage.getItem('__cocCombatNarrativeRequests') ?? '0'),
      warRequests: Number(sessionStorage.getItem('__cocWarNarrativeRequests') ?? '0'),
    };
  }, { targetSaveId: saveId });
}

test.describe.serial('Combat and War V2 incremental continuity regression', () => {
  let context: BrowserContext;
  let page: Page;
  let saveId: string;
  const consoleProblems: string[] = [];

  test.beforeAll(async ({ browser }) => {
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    context = await browser.newContext({
      baseURL: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? '41731'}`,
      viewport: { width: 1366, height: 768 },
    });
    page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleProblems.push(`${message.type()}: ${message.text()}`);
      }
    });
    await installEncounterNarrativeStream(page);
    saveId = await seedCombatCheckpoint(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('Combat completes, narrates and reloads exactly once', async () => {
    test.setTimeout(120_000);
    await loadLatestSaveFromHome(page);
    const combatScreen = page.getByTestId('combat-v2-screen');
    await expect(combatScreen).toBeVisible();
    await combatScreen.getByRole('button', { name: '进入战斗' }).click();
    await combatScreen.getByRole('button', { name: '4×' }).click();
    await combatScreen.getByRole('button', { name: '自动战斗' }).click();

    const combatBriefing = page.getByRole('dialog', { name: '战斗简报' });
    await expect(combatBriefing).toBeVisible({ timeout: 30_000 });
    await combatBriefing.getByRole('button', { name: '继续' }).click();
    await expect(combatScreen).toBeHidden({ timeout: 30_000 });
    const afterCombat = await inspectSave(page, saveId);
    expect(afterCombat.activeStatus).toBeUndefined();
    expect(afterCombat.appliedHashes).toHaveLength(1);
    expect(afterCombat.narratedHashes).toEqual(afterCombat.appliedHashes);
    expect(afterCombat.combatCount).toBe(1);
    expect(afterCombat.turnNumbers).toEqual([1, 2]);
    expect(afterCombat.combatRequests).toBe(1);
    expect(afterCombat.combatReport).toContain('短兵相接已经结束');

    await loadLatestSaveFromHome(page);
    await expect(page.getByTestId('combat-v2-screen')).toBeHidden();
    expect(consoleProblems).toEqual([]);
  });

  test('War preserves the Combat ledger across retry, completion and reload', async () => {
    test.setTimeout(120_000);
    await stageWarCheckpoint(page, saveId);
    await loadLatestSaveFromHome(page);
    const warScreen = page.getByTestId('war-v2-screen');
    await expect(warScreen).toBeVisible();
    await warScreen.getByRole('button', { name: '进入战争' }).click();
    await warScreen.getByRole('button', { name: '4×' }).click();

    const warBriefing = page.getByRole('dialog', { name: '战事简报' });
    for (let guard = 0; guard < 16; guard += 1) {
      if (await warBriefing.isVisible().catch(() => false)) break;
      const pursue = warScreen.getByRole('button', { name: '追击', exact: true });
      const accept = warScreen.getByRole('button', { name: '接受投降', exact: true });
      const resume = warScreen.getByRole('button', { name: '确认风险并恢复手动指挥', exact: true });
      const assault = warScreen.getByRole('button', { name: '全军强攻', exact: true });
      if (await pursue.isVisible().catch(() => false)) await pursue.click();
      else if (await accept.isVisible().catch(() => false)) await accept.click();
      else if (await resume.isVisible().catch(() => false)) await resume.click();
      else if (await assault.isEnabled().catch(() => false)) await assault.click();
      await page.waitForTimeout(100);
    }

    await expect(warBriefing).toBeVisible({ timeout: 30_000 });
    await warBriefing.getByRole('button', { name: '继续' }).click();
    await expect(warScreen.getByRole('button', { name: '生成战后正文' })).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/war-result-retry-1366x768.png`, fullPage: true });

    const beforeRetry = await inspectSave(page, saveId);
    expect(beforeRetry.activeStatus).toBe('narrative_pending');
    expect(beforeRetry.activeKind).toBe('war');
    expect(beforeRetry.appliedHashes).toHaveLength(2);
    expect(beforeRetry.narratedHashes).toHaveLength(1);
    expect(beforeRetry.combatCount).toBe(1);
    expect(beforeRetry.conflictCount).toBe(1);
    expect(beforeRetry.turnNumbers).toEqual([1, 2]);
    expect(beforeRetry.warRequests).toBe(3);

    await warScreen.getByRole('button', { name: '生成战后正文' }).click();
    await expect(warScreen).toBeHidden({ timeout: 30_000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/continuity-complete-1366x768.png`, fullPage: true });

    await loadLatestSaveFromHome(page);
    await expect(page.getByTestId('combat-v2-screen')).toBeHidden();
    await expect(page.getByTestId('war-v2-screen')).toBeHidden();
    const final = await inspectSave(page, saveId);
    expect(final.activeStatus).toBeUndefined();
    expect(final.appliedHashes).toHaveLength(2);
    expect(new Set(final.appliedHashes).size).toBe(2);
    expect(final.narratedHashes).toEqual(final.appliedHashes);
    expect(final.combatCount).toBe(1);
    expect(final.conflictCount).toBe(1);
    expect(final.turnNumbers).toEqual([1, 2, 3]);
    expect(new Set(final.turnNumbers).size).toBe(3);
    expect(final.turnNarratives[2]).toContain('封存战果没有因重试发生变化');
    expect(final.conflictReport).toContain('封存战果没有因重试发生变化');
    expect(final.holdingFactionId).toBe('faction_player_jingzhou');
    expect(final.holdingStatus).toBe('controlled');
    expect(final.siegeStatus).toBeUndefined();
    expect(final.combatRequests).toBe(1);
    expect(final.warRequests).toBe(4);
    expect(consoleProblems).toEqual([]);
  });
});

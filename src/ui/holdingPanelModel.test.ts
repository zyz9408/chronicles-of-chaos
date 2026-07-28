import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { buildHoldingPanelModel } from './holdingPanelModel';
import { readUiStyleSource } from './readUiStyleSource.test-helper';

const baseRuntimeState = {
  resources: {
    money: 320,
    grain: 12000,
    horses: 40,
    arms: 210,
    recruits: 800,
    weapons: [],
    documents: [],
    tokens: [],
    importantSupplies: [],
  },
  holdings: [
    {
      holdingId: 'holding_yingchuan',
      name: '颍川郡',
      type: 'commandery',
      status: 'controlled',
      summary: '玩家实际掌握的颍川郡治，士族仍需安抚。',
      locationId: 'place_yingchuan',
      factionId: 'faction_player',
      nominalAllegiance: '汉廷',
      actualController: '刘构',
      stewardNpcId: 'npc_xun_you',
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
      relatedNpcIds: ['npc_xun_you'],
      riskNotes: ['士族观望'],
      recentChanges: ['初步接管郡府'],
      sourceNote: '郡府文书',
      updatedAt: '公元189年09月01日 10:00（巳时）',
    },
    {
      holdingId: 'holding_luoyang_camp',
      name: '洛阳北营',
      type: 'camp',
      status: 'temporary',
      summary: '临时控制的北营营地。',
      scaleLevel: 1,
      agriculture: 5,
      commerce: 4,
      population: 10,
      publicOrder: 30,
      popularSupport: 25,
      defense: 45,
      recruitPotential: 20,
      armory: 35,
      horseSupply: 12,
      corruption: 48,
      updatedAt: '公元189年09月01日 08:00（辰时）',
    },
  ],
  domesticReports: [
    {
      reportId: 'domestic_189',
      year: 189,
      settledAt: '公元189年09月01日 12:00（午时）',
      title: '189年秋收与军费核算',
      summary: '颍川秋收尚可，但军费吃紧。',
      income: { money: 120, grain: 6000, horses: 12, arms: 80, recruits: 300 },
      expenses: { money: 60, grain: 2400, horses: 3, arms: 20, recruits: 0 },
      netChange: { money: 60, grain: 3600, horses: 9, arms: 60, recruits: 300 },
      holdingHighlights: [{ holdingId: 'holding_yingchuan', summary: '颍川民心渐稳。' }],
      warnings: ['军费仍需节制'],
      readByPlayer: false,
    },
  ],
  privateAssets: [
    {
      privateAssetId: 'asset_family_estate',
      name: 'Family estate',
      type: 'estate',
      ownerScope: 'personal',
      status: 'active',
      summary: 'A household estate near Yingchuan.',
      locationId: 'place_yingchuan',
      managerNpcId: 'npc_xun_you',
      mu: 120,
      households: 16,
      workers: 8,
      workshopScale: 2,
      ranchCapacity: 5,
      conditionNotes: 'tenant order is stable',
      riskNotes: ['bandit pressure'],
      recentChanges: ['opened new tenant fields'],
      updatedAt: '189-09-01',
    },
  ],
  privateAssetProjects: [
    {
      projectId: 'project_family_estate_expand',
      assetId: 'asset_family_estate',
      title: 'Expand tenant fields',
      type: 'expand_farmland',
      status: 'active',
      startedAt: '189-03-01',
      expectedCompleteAt: '189-08-01',
      investedMoney: 12,
      investedGrain: 80,
      targetDelta: { mu: 40, households: 6 },
      progressNotes: ['clearing has begun'],
      updatedAt: '189-03-01',
    },
  ],
  factions: [{ factionId: 'faction_player', name: '刘构部', type: '自势力' }],
  locations: [{ locationId: 'place_yingchuan', name: '颍川郡' }],
  npcs: [{ npcId: 'npc_xun_you', name: '荀攸' }],
  troops: [{ troopId: 'troop_yingchuan_guard', name: '颍川郡兵' }],
} as unknown as RuntimeState;

describe('holdingPanelModel', () => {
  it('builds selected holding detail rows and resource totals', () => {
    const model = buildHoldingPanelModel(baseRuntimeState, 'holding_yingchuan');

    expect(model.selectedHoldingId).toBe('holding_yingchuan');
    expect(model.rosterItems[0]).toMatchObject({
      holdingId: 'holding_yingchuan',
      name: '颍川郡',
      statusText: '掌控',
      scaleText: '3级',
    });
    expect(model.resourceRows).toEqual([
      { key: 'money', label: '钱财', value: '320贯' },
      { key: 'grain', label: '粮草', value: '12000石' },
      { key: 'horses', label: '马匹', value: '40' },
      { key: 'arms', label: '军械', value: '210' },
      { key: 'recruits', label: '可征召人手', value: '800人' },
    ]);
    expect(model.detailRows).toEqual(expect.arrayContaining([
      { label: '地点', value: '颍川郡', tone: 'normal' },
      { label: '所属势力', value: '刘构部', tone: 'normal' },
      { label: '主事人物', value: '荀攸', tone: 'normal' },
      { label: '账面田亩', value: '12000亩', tone: 'normal' },
      { label: '编户', value: '1800户', tone: 'normal' },
      { label: '地方豪强掌控', value: '55%', tone: 'warning' },
      { label: '地方豪强关系', value: '可以商议', detail: '+35', tone: 'normal' },
    ]));
    expect(model.detailRows.map((row) => row.label)).not.toContain('本地府库');
    expect(model.detailRows.map((row) => row.label)).not.toContain('本地粮仓');
    expect(model.detailRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '地方估产', value: expect.stringMatching(/^粮草 \d+石 \/ 钱财 \d+贯$/) }),
      expect.objectContaining({ label: '实际征收', value: expect.stringMatching(/^粮草 \d+石 \/ 钱财 \d+贯$/) }),
      expect.objectContaining({ label: '实征率', value: expect.stringMatching(/^粮草 \d+% \/ 钱财 \d+%$/) }),
    ]));
    expect(model.relatedNpcNames).toEqual(['荀攸']);
    expect(model.garrisonTroopNames).toEqual(['颍川郡兵']);
  });

  it('formats the player controller sentinel for player-facing holding rows', () => {
    const state = {
      ...baseRuntimeState,
      holdings: (baseRuntimeState.holdings ?? []).map((holding) => (
        holding.holdingId === 'holding_yingchuan'
          ? { ...holding, actualController: 'player' }
          : holding
      )),
    } as RuntimeState;

    const model = buildHoldingPanelModel(state, 'holding_yingchuan');

    expect(model.rosterItems[0].subtitle).toBe('郡国 / 主角');
    expect(model.detailRows).toContainEqual({ label: '实际控制', value: '主角', tone: 'normal' });
  });

  it('resolves a faction controller id for player-facing holding rows', () => {
    const state = {
      ...baseRuntimeState,
      holdings: (baseRuntimeState.holdings ?? []).map((holding) => (
        holding.holdingId === 'holding_yingchuan'
          ? { ...holding, actualController: 'faction_player' }
          : holding
      )),
    } as RuntimeState;

    const model = buildHoldingPanelModel(state, 'holding_yingchuan');

    expect(model.rosterItems[0].subtitle).toBe('郡国 / 刘构部');
    expect(model.detailRows).toContainEqual({ label: '实际控制', value: '刘构部', tone: 'normal' });
  });

  it('prioritizes collection, land-register, and administration rows for holding layout', () => {
    const model = buildHoldingPanelModel(baseRuntimeState, 'holding_yingchuan');

    expect(model.visualProfile).toEqual({
      name: '颍川郡',
      locationId: 'place_yingchuan',
      type: 'commandery',
      typeText: '郡国',
      scaleText: '3级',
      statusText: '掌控',
      localEliteText: '豪强掌控 55%',
      collectionText: expect.stringMatching(/^实征 粮草 \d+% \/ 钱财 \d+%$/),
      caption: expect.stringMatching(/^郡国 · 3级 · 掌控 · 实征 粮草 \d+% \/ 钱财 \d+%$/),
    });
    expect(model.collectionRows).toEqual([
      expect.objectContaining({ label: '地方估产', value: expect.stringMatching(/^粮草 \d+石 \/ 钱财 \d+贯$/) }),
      expect.objectContaining({ label: '实际征收', value: expect.stringMatching(/^粮草 \d+石 \/ 钱财 \d+贯$/) }),
      expect.objectContaining({
        label: '差额原因',
        value: expect.stringContaining('地方豪强掌控 55%'),
        detail: expect.stringMatching(/^较理论少收：粮草 \d+石 \/ 钱财 \d+贯$/),
      }),
      expect.objectContaining({ label: '实征率', value: expect.stringMatching(/^粮草 \d+% \/ 钱财 \d+%$/) }),
    ]);
    expect(model.landRegisterRows).toEqual([
      { label: '账面田亩', value: '12000亩', tone: 'normal' },
      { label: '编户', value: '1800户', tone: 'normal' },
      { label: '地方豪强掌控', value: '55%', tone: 'warning' },
      { label: '地方豪强关系', value: '可以商议', detail: '+35', tone: 'normal' },
    ]);
    expect(model.administrationRows).toEqual(expect.arrayContaining([
      { label: '地点', value: '颍川郡', tone: 'normal' },
      { label: '实际控制', value: '刘构', tone: 'normal' },
      { label: '主事人物', value: '荀攸', tone: 'normal' },
    ]));
  });

  it('shows locally derived siege endurance instead of legacy treasury and granary amounts', () => {
    const state = {
      ...baseRuntimeState,
      turnLog: Array.from({ length: 5 }, (_, index) => ({ turnNumber: index + 1 })),
      holdings: (baseRuntimeState.holdings ?? []).map((holding) => (
        holding.holdingId === 'holding_yingchuan'
          ? {
              ...holding,
              siege: {
                status: 'encircled',
                supplyLine: 'cut',
                preparation: 'prepared',
                cutOffAtTurn: 2,
                initialEnduranceTurns: 18,
              },
            }
          : holding
      )),
    } as unknown as RuntimeState;

    const model = buildHoldingPanelModel(state, 'holding_yingchuan');

    expect(model.administrationRows).toEqual(expect.arrayContaining([
      { label: '围城态势', value: '完全包围', tone: 'danger' },
      { label: '补给线', value: '已中断', tone: 'danger' },
      { label: '备战储备', value: '已有准备', tone: 'normal' },
      { label: '守城补给', value: '尚可支撑（预计可支撑15回合）', tone: 'normal' },
    ]));
    expect(model.detailRows.map((row) => row.label)).not.toContain('本地府库');
    expect(model.detailRows.map((row) => row.label)).not.toContain('本地粮仓');
  });

  it('hides civil ledgers and settlement for an ordinary legacy military camp', () => {
    const model = buildHoldingPanelModel(baseRuntimeState, 'holding_luoyang_camp');

    expect(model.administrationRows).toContainEqual({
      label: '民政范围',
      value: '无民政辖境',
      tone: 'normal',
    });
    expect(model.landRegisterRows).toEqual([]);
    expect(model.collectionRows).toEqual([]);
    expect(model.scoreRows.map((row) => row.label)).toEqual(['防务', '军械产能', '马政']);
    expect(model.visualProfile).toMatchObject({
      localEliteText: '无民政辖境',
      collectionText: '不参与民政结算',
    });
  });

  it('shows household registers but not farmland for a household-only port town', () => {
    const state = {
      ...baseRuntimeState,
      holdings: [{
        ...baseRuntimeState.holdings![1],
        holdingId: 'holding_port_town',
        name: '临江港镇',
        type: 'port',
        civilAdministrationScope: 'households',
        agriculture: 0,
        registeredHouseholds: 420,
        eliteControlledShare: 25,
        localEliteRelation: 10,
      }],
    } as RuntimeState;

    const model = buildHoldingPanelModel(state, 'holding_port_town');
    expect(model.landRegisterRows.map((row) => row.label)).toEqual([
      '编户',
      '地方豪强掌控',
      '地方豪强关系',
    ]);
    expect(model.landRegisterRows.map((row) => row.label)).not.toContain('账面田亩');
    expect(model.scoreRows.map((row) => row.label)).not.toContain('农桑');
    expect(model.collectionRows).not.toEqual([]);
  });

  it('sorts domestic reports and marks weak scores as risk rows', () => {
    const model = buildHoldingPanelModel(baseRuntimeState, 'holding_luoyang_camp');

    expect(model.selectedHoldingId).toBe('holding_luoyang_camp');
    expect(model.rosterItems.find((item) => item.holdingId === 'holding_luoyang_camp')?.riskText).toBe('平稳');
    expect(model.scoreRows.map((row) => row.label)).not.toContain('民心');
    expect(model.scoreRows).toEqual(expect.arrayContaining([
      { label: '马政', value: '12', tone: 'danger' },
    ]));
    expect(model.scoreRows.map((row) => row.label)).not.toContain('腐败');
    expect(model.reports[0]).toMatchObject({
      reportId: 'domestic_189',
      title: '189年秋收与军费核算',
      netText: '钱财 +60贯，粮草 +3600石，马匹 +9，军械 +60，可征召人手 +300人',
      warnings: ['军费仍需节制'],
    });
  });

  it('builds overview tabs and private asset project rows', () => {
    const model = buildHoldingPanelModel(baseRuntimeState, 'holding_yingchuan');

    expect(model.tabs).toEqual([
      { key: 'overview', label: '总览', count: 1 },
      { key: 'privateAssets', label: '私人产业', count: 1 },
      { key: 'controlledHoldings', label: '控制领地', count: 2 },
      { key: 'domesticReports', label: '内政报告', count: 1 },
    ]);
    expect(model.overviewRows).toEqual(expect.arrayContaining([
      { label: '私人产业', value: '1', tone: 'normal' },
      { label: '进行工程', value: '1', tone: 'normal' },
    ]));
    expect(model.privateAssets[0]).toEqual(expect.objectContaining({
      privateAssetId: 'asset_family_estate',
      name: 'Family estate',
      scaleText: expect.stringContaining('120'),
      projectTitles: ['Expand tenant fields'],
    }));
    expect(model.privateAssetProjects[0]).toEqual(expect.objectContaining({
      projectId: 'project_family_estate_expand',
      assetId: 'asset_family_estate',
      title: 'Expand tenant fields',
      targetText: expect.stringContaining('田亩+40'),
    }));
  });

  it('does not expose unknown enum-like holding or private asset fields', () => {
    const model = buildHoldingPanelModel({
      ...baseRuntimeState,
      holdings: [
        {
          ...baseRuntimeState.holdings![0],
          holdingId: 'holding_enum_leak',
          name: '边郡坞堡',
          type: 'county_stronghold',
          status: 'ledger_pending',
        },
      ],
      privateAssets: [
        {
          ...baseRuntimeState.privateAssets![0],
          privateAssetId: 'asset_enum_leak',
          type: 'family_workshop_branch',
          status: 'project_pending_review',
          ownerScope: 'clan_branch',
        },
      ],
      privateAssetProjects: [
        {
          ...baseRuntimeState.privateAssetProjects![0],
          projectId: 'project_enum_leak',
          assetId: 'asset_enum_leak',
          type: 'secret_upgrade_queue',
          status: 'waiting_internal_review',
        },
      ],
    } as unknown as RuntimeState, 'holding_enum_leak');

    const visibleText = JSON.stringify([
      model.rosterItems,
      model.detailRows,
      model.privateAssets,
      model.privateAssetProjects,
    ]);

    expect(model.rosterItems[0]).toMatchObject({
      subtitle: '领地 / 刘构',
      statusText: '状态未明',
    });
    expect(model.detailRows).toEqual(expect.arrayContaining([
      { label: '类型', value: '领地', tone: 'normal' },
      { label: '状态', value: '状态未明', tone: 'normal' },
    ]));
    expect(model.privateAssets[0]).toMatchObject({
      subtitle: '产业 / 归属未明',
      statusText: '状态未明',
    });
    expect(model.privateAssetProjects[0]).toMatchObject({
      statusText: '进度未明',
    });
    expect(visibleText).not.toContain('county_stronghold');
    expect(visibleText).not.toContain('ledger_pending');
    expect(visibleText).not.toContain('family_workshop_branch');
    expect(visibleText).not.toContain('project_pending_review');
    expect(visibleText).not.toContain('clan_branch');
    expect(visibleText).not.toContain('secret_upgrade_queue');
    expect(visibleText).not.toContain('waiting_internal_review');
  });

  it('wires a left information stack and right holding scenic slot in GameScreen', async () => {
    const { readFileSync } = await import('node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');
    const visualSource = readFileSync(new URL('./ProgressivePanelVisual.tsx', import.meta.url), 'utf8');
    const css = await readUiStyleSource();

    expect(source).toContain('resolveHoldingVisualAsset');
    expect(source).toContain('holding-controlled-layout');
    expect(source).toContain('holding-controlled-top-row');
    expect(source).toContain('holding-controlled-info-stack');
    expect(source).toContain('holding-collection-stack');
    expect(source).toContain('ProgressivePanelVisual');
    expect(source).toContain('shouldLoadHoldingVisualAsset');
    expect(visualSource).toContain('holding-scenic-panel');
    expect(visualSource).toContain('holding-scenic-image');
    expect(css).toContain('.holding-controlled-layout');
    expect(css).toContain('.holding-controlled-top-row');
    expect(css).toContain('.holding-controlled-info-stack');
    expect(css).toContain('.holding-collection-stack');
    expect(css).toContain('.holding-scenic-panel');
  });

  it('does not expose terminal historical troops through the current garrison', () => {
    const state = {
      ...baseRuntimeState,
      holdings: baseRuntimeState.holdings!.map((holding) => (
        holding.holdingId === 'holding_yingchuan'
          ? { ...holding, garrisonTroopIds: ['troop_old_guard', 'troop_yingchuan_guard'] }
          : holding
      )),
      troops: [
        ...(baseRuntimeState.troops ?? []),
        {
          troopId: 'troop_old_guard',
          name: '旧颍川守军',
          size: 300,
          morale: 60,
          training: 50,
          supplies: 50,
          task: '历史建制',
          relationToPlayer: '你直接统领',
          lifecycleStatus: 'merged',
          mergedIntoTroopId: 'troop_yingchuan_guard',
        },
      ],
    } as unknown as RuntimeState;

    const model = buildHoldingPanelModel(state, 'holding_yingchuan');

    expect(model.selectedHolding?.garrisonTroopIds).toEqual(['troop_yingchuan_guard']);
    expect(model.garrisonTroopNames).toEqual(['颍川郡兵']);
    expect(JSON.stringify(model)).not.toContain('旧颍川守军');
  });
});

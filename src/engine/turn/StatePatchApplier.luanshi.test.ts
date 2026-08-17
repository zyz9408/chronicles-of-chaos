import { describe, expect, it } from 'vitest';
import type { RuntimeState, StatePatch, WorldBook } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { applyPatch, applyPatches } from './StatePatchApplier';
import { validatePatch } from './StatePatchValidator';

const worldBook = {} as WorldBook;

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test-chaos-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '乱世元年2月',
    currentDate: '乱世元年2月',
    player: {
      id: 'player',
      name: '主角',
      roleType: '流民',
      summary: '流落市镇。',
    },
    currentLocationId: 'loc_market_town',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    npcs: [
      {
        npcId: 'npc_chen_heng',
        name: '陈衡',
        sex: '男',
        age: 30,
        role: '游侠首领',
        locationId: 'loc_market_town',
        isPresent: true,
        isFocused: true,
        summary: '机警过人。',
        appearance: '目光锐利。',
        personality: '豪爽直接。',
        motivation: '寻找机会。',
        relationToPlayer: '初识。',
        contactLevel: 10,
        recentAttitude: '好奇',
        memories: [],
      },
    ],
  });
}

describe('applyPatch with luanshiCommand', () => {
  it('applies a narrow NPC presence update through the state patch pipeline', () => {
    const next = applyPatch(makeState(), {
      type: 'luanshiCommand',
      reason: '陈衡离开当前队伍前往城门',
      payload: {
        command: {
          action: 'updateNpcPresence',
          npcId: 'npc_chen_heng',
          locationId: 'loc_city_gate',
          isPresent: false,
          isFocused: true,
        },
      },
    } as StatePatch, 1, '陈衡先去城门', '陈衡告辞离开。');

    expect(next.npcs![0]).toMatchObject({
      npcId: 'npc_chen_heng',
      name: '陈衡',
      locationId: 'loc_city_gate',
      isPresent: false,
      isFocused: true,
      relationToPlayer: '初识。',
    });
  });

  it('keeps current place and scene in sync when moving to a concrete place', () => {
    const state = {
      ...makeState(),
      currentLocationId: 'place_old',
      currentPlaceId: 'place_old',
      currentSceneId: 'scene_old',
    };
    const patch: StatePatch = {
      type: 'locationChange',
      reason: 'move to another concrete place',
      payload: {
        toLocationId: 'place_new',
      },
    };

    const next = applyPatch(state, patch, 1, 'move', 'The player moves.');

    expect(next.currentLocationId).toBe('place_new');
    expect(next.currentPlaceId).toBe('place_new');
    expect(next.currentSceneId).toBeUndefined();
    expect(next.npcs?.[0]).toMatchObject({
      npcId: 'npc_chen_heng',
      isPresent: false,
      locationId: 'loc_market_town',
    });
  });

  it('keeps current place and scene in sync when moving into a scene under the place', () => {
    const state = {
      ...makeState(),
      currentLocationId: 'place_old',
      currentPlaceId: 'place_old',
      currentSceneId: undefined,
    };
    const patch: StatePatch = {
      type: 'locationChange',
      reason: 'move into a scene',
      payload: {
        toLocationId: 'place_new',
        toSceneId: 'scene_new_gate',
      },
    };

    const next = applyPatch(state, patch, 1, 'enter gate', 'The player enters the gate.');

    expect(next.currentLocationId).toBe('place_new');
    expect(next.currentPlaceId).toBe('place_new');
    expect(next.currentSceneId).toBe('scene_new_gate');
  });

  it('applies a flat payload.action luanshiCommand as the same command object', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: '登记玩家直辖庄园',
      payload: {
        action: 'upsertHoldingLedger',
        operation: 'create',
        holdingId: 'holding_gushui_estate',
        name: '谷水庄园',
        type: 'estate',
        status: 'controlled',
        summary: '洛阳近郊一处可供整顿的庄园。',
        controlEvidence: {
          kind: 'formal_handover',
          occurredAt: '公元189年09月01日 08:45（辰时）',
          sourceRefId: 'turn_event_gushui_handover',
          summary: '庄园册籍与管领权已正式移交给主角。',
        },
        civilAdministrationScope: 'territorial',
        scaleLevel: 2,
        agriculture: 45,
        commerce: 25,
        population: 30,
        publicOrder: 42,
        popularSupport: 38,
        defense: 28,
        recruitPotential: 22,
        armory: 10,
        horseSupply: 5,
        corruption: 35,
        updatedAt: '公元189年09月01日 08:45（辰时）',
      },
    };

    expect(validatePatch(patch, worldBook, []).valid).toBe(true);

    const next = ensureLuanShiState(
      applyPatch(makeState(), patch, 1, '清点庄园', '主角接掌谷水庄园。'),
    );

    expect(next.holdings).toHaveLength(1);
    expect(next.holdings[0]).toMatchObject({
      holdingId: 'holding_gushui_estate',
      name: '谷水庄园',
      scaleLevel: 2,
      corruption: 35,
    });
  });

  it('rejects a city-wall garrison writeback that lacks an actual control fact', () => {
    const state = makeState();
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: '玩家奉命驻守北城墙',
      payload: {
        command: {
          action: 'upsertHoldingLedger',
          operation: 'create',
          holdingId: 'holding_north_wall',
          name: '北城墙防段',
          type: 'fort',
          status: 'controlled',
          summary: '主角奉命在此段城墙驻守。',
          civilAdministrationScope: 'none',
          scaleLevel: 1,
          agriculture: 0,
          commerce: 0,
          population: 0,
          publicOrder: 0,
          popularSupport: 0,
          defense: 55,
          recruitPotential: 0,
          armory: 20,
          horseSupply: 0,
          updatedAt: '189-09-01 16:00',
        },
      },
    };

    const validation = validatePatch(patch, worldBook, [], state);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join('\n')).toContain('controlEvidence');

    const next = ensureLuanShiState(
      applyPatch(state, patch, 1, '驻守北城墙', '主角登上城墙，与守卒一同值守。'),
    );
    expect(next.holdings).toEqual([]);
  });

  it('preserves stable control evidence on ordinary updates and requires fresh evidence for control transitions', () => {
    const createPatch: StatePatch = {
      type: 'luanshiCommand',
      reason: '正式接掌谷水庄园',
      payload: {
        command: {
          action: 'upsertHoldingLedger',
          operation: 'create',
          holdingId: 'holding_control_evidence',
          name: '谷水庄园',
          type: 'estate',
          status: 'controlled',
          summary: '庄园册籍与管领权已完成移交。',
          civilAdministrationScope: 'territorial',
          scaleLevel: 1,
          agriculture: 40,
          commerce: 20,
          population: 25,
          publicOrder: 45,
          popularSupport: 40,
          defense: 25,
          recruitPotential: 20,
          armory: 10,
          horseSupply: 5,
          corruption: 20,
          actualController: 'player',
          controlEvidence: {
            kind: 'formal_handover',
            occurredAt: '189-09-01 08:00',
            sourceRefId: 'turn_event_initial_handover',
            summary: '前任管事交出册籍、印信和庄园管领权。',
          },
          updatedAt: '189-09-01 08:00',
        },
      },
    };
    const created = ensureLuanShiState(
      applyPatch(makeState(), createPatch, 1, '接掌庄园', '前任管事交出了庄园册籍与印信。'),
    );

    const ordinaryUpdate: StatePatch = {
      type: 'luanshiCommand',
      reason: '修缮庄园围墙',
      payload: {
        command: {
          action: 'upsertHoldingLedger',
          operation: 'update',
          holdingId: 'holding_control_evidence',
          defense: 30,
          summary: '围墙修缮后防御有所提升。',
          updatedAt: '189-09-02 08:00',
        },
      },
    } as StatePatch;
    expect(validatePatch(ordinaryUpdate, worldBook, [], created).valid).toBe(true);
    const updated = ensureLuanShiState(
      applyPatch(created, ordinaryUpdate, 2, '修缮围墙', '庄园围墙完成了第一轮修缮。'),
    );
    expect(updated.holdings[0].controlEvidence?.sourceRefId).toBe('turn_event_initial_handover');

    const unsupportedTransition: StatePatch = {
      type: 'luanshiCommand',
      reason: '尝试无依据改变控制状态',
      payload: {
        command: {
          action: 'upsertHoldingLedger',
          operation: 'update',
          holdingId: 'holding_control_evidence',
          status: 'temporary',
          actualController: 'faction_ally',
          summary: '控制状态被改写。',
          updatedAt: '189-09-03 08:00',
        },
      },
    } as StatePatch;
    const unsupportedValidation = validatePatch(unsupportedTransition, worldBook, [], updated);
    expect(unsupportedValidation.valid).toBe(false);
    expect(unsupportedValidation.errors.join('\n')).toContain('controlEvidence');

    const supportedTransition = structuredClone(unsupportedTransition);
    const supportedCommand = (supportedTransition.payload as { command: Record<string, unknown> }).command;
    supportedCommand.controlEvidence = {
      kind: 'temporary_administration',
      occurredAt: '189-09-03 08:00',
      sourceRefId: 'turn_event_temporary_transfer',
      summary: '双方完成临时行政移交，并由盟军代管。',
    };
    expect(validatePatch(supportedTransition, worldBook, [], updated).valid).toBe(true);
    const transitioned = ensureLuanShiState(
      applyPatch(updated, supportedTransition, 3, '临时移交', '双方完成了临时行政移交。'),
    );
    expect(transitioned.holdings[0]).toMatchObject({
      status: 'temporary',
      actualController: 'faction_ally',
      controlEvidence: {
        kind: 'temporary_administration',
        sourceRefId: 'turn_event_temporary_transfer',
      },
    });
  });

  it('normalizes holding fields while stripping deprecated local treasury and granary writes', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'record a holding ledger with string units and singleton list fields',
      payload: {
        command: {
          action: 'upsertHoldingLedger',
          operation: 'create',
          holdingId: 'holding_runtime_estate',
          name: 'Runtime Estate',
          type: 'estate',
          status: 'controlled',
          summary: 'A player-controlled estate near the capital.',
          controlEvidence: {
            kind: 'grant',
            occurredAt: '189-09-01 14:15',
            sourceRefId: 'turn_event_runtime_estate_grant',
            summary: 'The estate was formally granted to the player.',
          },
          civilAdministrationScope: 'territorial',
          scaleLevel: 1,
          agriculture: 45,
          commerce: 30,
          population: 35,
          publicOrder: 50,
          popularSupport: 55,
          defense: 30,
          recruitPotential: 40,
          armory: 20,
          horseSupply: 10,
          corruption: 35,
          localTreasury: '30000钱',
          localGranary: '300石',
          farmlandMu: '2,400亩',
          registeredHouseholds: '240户',
          eliteControlledShare: '65%',
          localEliteRelation: '-20',
          riskNotes: 'Bandit pressure remains high.',
          recentChanges: 'The player ordered a full inventory.',
          updatedAt: '189-09-01 14:15',
        },
      },
    };

    expect(validatePatch(patch, worldBook, []).valid).toBe(true);

    const next = ensureLuanShiState(
      applyPatch(makeState(), patch, 1, 'count estate stores', 'The player records a new estate ledger.'),
    );

    expect(next.holdings[0]).toMatchObject({
      holdingId: 'holding_runtime_estate',
      farmlandMu: 2400,
      registeredHouseholds: 240,
      eliteControlledShare: 65,
      localEliteRelation: -20,
      riskNotes: ['Bandit pressure remains high.'],
      recentChanges: ['The player ordered a full inventory.'],
    });
    expect(next.holdings[0].localTreasury).toBeUndefined();
    expect(next.holdings[0].localGranary).toBeUndefined();
  });

  it('validates and applies partial holding updates against an existing ledger entry', () => {
    const state = ensureLuanShiState({
      ...makeState(),
      holdings: [
        {
          holdingId: 'holding_runtime_estate',
          name: 'Runtime Estate',
          type: 'estate',
          status: 'controlled',
          summary: 'A player-controlled estate near the capital.',
          scaleLevel: 1,
          agriculture: 45,
          commerce: 30,
          population: 35,
          publicOrder: 50,
          popularSupport: 55,
          defense: 30,
          recruitPotential: 40,
          armory: 20,
          horseSupply: 10,
          corruption: 35,
          farmlandMu: 12000,
          registeredHouseholds: 1800,
          updatedAt: '189-09-01 14:15',
        },
      ],
    });
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'model only updates changed holding fields',
      payload: {
        command: {
          action: 'upsertHoldingLedger',
          holdingId: 'holding_runtime_estate',
          name: 'Runtime Estate',
          type: 'estate',
          status: 'controlled',
          scaleLevel: 1,
          agriculture: 45,
          commerce: 30,
          population: 35,
          publicOrder: 57,
          popularSupport: 60,
          defense: 30,
          recruitPotential: 40,
          armory: 20,
          horseSupply: 10,
          corruption: 32,
        },
      },
    };

    expect(validatePatch(patch, worldBook, [], state).valid).toBe(true);

    const next = ensureLuanShiState(
      applyPatch(state, patch, 1, 'settle estate', 'The estate recovers after local negotiation.'),
    );

    expect(next.holdings[0]).toMatchObject({
      holdingId: 'holding_runtime_estate',
      summary: 'A player-controlled estate near the capital.',
      publicOrder: 57,
      popularSupport: 60,
      corruption: 32,
      farmlandMu: 12000,
      registeredHouseholds: 1800,
      updatedAt: '189-09-01 14:15',
    });
  });

  it('merges a place-backed holding update when the model invents a new holding id for the same location', () => {
    const state = ensureLuanShiState({
      ...makeState(),
      holdings: [
        {
          holdingId: 'place_jingzhou_xinye',
          name: '新野县',
          type: 'county',
          status: 'controlled',
          summary: '主角已接管的新野县。',
          locationId: 'place_jingzhou_xinye',
          scaleLevel: 2,
          agriculture: 52,
          commerce: 40,
          population: 45,
          publicOrder: 38,
          popularSupport: 42,
          defense: 46,
          recruitPotential: 34,
          armory: 20,
          horseSupply: 8,
          corruption: 45,
          localTreasury: 120,
          localGranary: 800,
          updatedAt: '公元194年08月19日 13:00（未时）',
        },
      ],
    });
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'model updates the same county with an alias holding id',
      payload: {
        command: {
          action: 'upsertHoldingLedger',
          holdingId: 'holding_xinye',
          name: '新野县',
          type: 'county',
          status: 'controlled',
          summary: '新野县初步安定，主角开始整顿县署与粮仓。',
          locationId: 'place_jingzhou_xinye',
          scaleLevel: 2,
          agriculture: 54,
          commerce: 41,
          population: 46,
          publicOrder: 45,
          popularSupport: 48,
          defense: 48,
          recruitPotential: 36,
          armory: 22,
          horseSupply: 8,
          corruption: 41,
          recentChanges: ['县署清册已重新核对。'],
          updatedAt: '公元194年08月19日 15:00（申时）',
        },
      },
    };

    expect(validatePatch(patch, worldBook, [], state).valid).toBe(true);

    const next = ensureLuanShiState(
      applyPatch(state, patch, 77, '整顿新野', '主角整顿新野县署。'),
    );

    expect(next.holdings).toHaveLength(1);
    expect(next.holdings[0]).toEqual(expect.objectContaining({
      holdingId: 'place_jingzhou_xinye',
      locationId: 'place_jingzhou_xinye',
      name: '新野县',
      publicOrder: 45,
      localTreasury: 120,
      localGranary: 800,
      recentChanges: ['县署清册已重新核对。'],
    }));
  });

  it('applies a withdrawal to the resource ledger without mutating a legacy local treasury field', () => {
    const state = ensureLuanShiState({
      ...makeState(),
      holdings: [
        {
          holdingId: 'holding_yangdi_county',
          name: '阳翟县',
          type: 'county',
          status: 'controlled',
          summary: '主角实际掌管的县邑。',
          scaleLevel: 2,
          agriculture: 48,
          commerce: 36,
          population: 44,
          publicOrder: 38,
          popularSupport: 36,
          defense: 26,
          recruitPotential: 22,
          armory: 18,
          horseSupply: 8,
          corruption: 52,
          localTreasury: 5000,
          updatedAt: '184-03-01 09:00',
        },
      ],
    });
    const patches: StatePatch[] = [
      {
        type: 'luanshiCommand',
        reason: '玩家下令提取县府库钱财充作军饷',
        payload: {
          command: {
            action: 'upsertHoldingLedger',
            holdingId: 'holding_yangdi_county',
            name: '阳翟县',
            type: 'county',
            status: 'controlled',
            localTreasury: 3500,
            recentChanges: ['奉玩家命令从县府库提取一千五百贯充作军饷。'],
          },
        },
      },
      {
        type: 'luanshiCommand',
        reason: '府库提取钱财进入可调拨资源',
        payload: {
          command: {
            action: 'updateResourceLedger',
            previousMoneyGuan: 0,
            moneyDeltaGuan: 1500,
            moneyGuan: 1500,
            summary: '从阳翟县府库提取的一千五百贯军饷。',
          },
        },
      },
    ];

    expect(patches.map((patch) => validatePatch(patch, worldBook, [], state).valid)).toEqual([true, true]);

    const next = ensureLuanShiState(
      applyPatches(state, patches, 2, '提取府库军饷', '主角下令从阳翟县府库提取钱财。'),
    );

    expect(next.holdings[0]).toMatchObject({
      holdingId: 'holding_yangdi_county',
      localTreasury: 5000,
      recentChanges: ['奉玩家命令从县府库提取一千五百贯充作军饷。'],
    });
    expect(next.resources.money).toBe(1500);
    expect(next.player.personalMoney).toBeUndefined();
    expect(next.turnLog[next.turnLog.length - 1]?.statePatchSummary)
      .toContain('updateResourceLedger[money=1500贯, delta=+1500贯]');
  });

  it('applies questAdded as a current matter with relationship and timing metadata', () => {
    const patch: StatePatch = {
      type: 'questAdded',
      reason: '玩家答应护送伤者',
      payload: {
        questId: 'quest_rescue_wounded',
        title: '护送伤者离开市镇',
        description: '陈衡托主角把伤者送到安全处。',
        source: '陈衡所托',
        currentStep: '先找到能通行的北门小路。',
        stakes: '拖延太久会被追兵堵在市镇。',
        deadlineAt: '乱世元年2月夜前',
        priority: 'high',
        relatedNpcIds: ['npc_chen_heng'],
        relatedLocationIds: ['loc_market_town'],
        relatedFactionIds: ['faction_local_patrol'],
        threadId: 'thread_market_rescue',
        outcomeSummary: '主角已经把追兵注意力引向北门，市镇暗流开始变化。',
        consequenceTags: ['救援', '追兵压力'],
        affectedNpcIds: ['npc_chen_heng'],
        affectedFactionIds: ['faction_local_patrol'],
        affectedPlaceIds: ['loc_market_town'],
        affectedForceIds: ['force_patrol_unit'],
        affectedHoldingIds: ['holding_market_gate'],
        followUpHooks: ['追兵可能封锁北门', '陈衡会重新评估主角'],
        severity: 'moderate',
      },
    };

    const next = applyPatch(makeState(), patch, 1, '我答应陈衡', '主角答应护送伤者。');
    const quest = next.activeQuests[0] as any;

    expect(quest).toMatchObject({
      id: 'quest_rescue_wounded',
      title: '护送伤者离开市镇',
      status: 'active',
      source: '陈衡所托',
      currentStep: '先找到能通行的北门小路。',
      stakes: '拖延太久会被追兵堵在市镇。',
      deadlineAt: '乱世元年2月夜前',
      priority: 'high',
      relatedNpcIds: ['npc_chen_heng'],
      relatedLocationIds: ['loc_market_town'],
      relatedFactionIds: ['faction_local_patrol'],
      threadId: 'thread_market_rescue',
      outcomeSummary: '主角已经把追兵注意力引向北门，市镇暗流开始变化。',
      consequenceTags: ['救援', '追兵压力'],
      affectedNpcIds: ['npc_chen_heng'],
      affectedFactionIds: ['faction_local_patrol'],
      affectedPlaceIds: ['loc_market_town'],
      affectedForceIds: ['force_patrol_unit'],
      affectedHoldingIds: ['holding_market_gate'],
      followUpHooks: ['追兵可能封锁北门', '陈衡会重新评估主角'],
      severity: 'moderate',
    });
  });

  it('validates current matter patches before they enter state', () => {
    const result = validatePatch(
      {
        type: 'questAdded',
        reason: '缺少标题',
        payload: {
          questId: 'quest_invalid',
          description: '没有标题的当前事项不应写入。',
        },
      },
      worldBook,
      [],
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('questAdded 必须包含 title');
  });

  it('validates current matter consequence anchors as structured fields', () => {
    const result = validatePatch(
      {
        type: 'questAdded',
        reason: '后果字段格式错误',
        payload: {
          questId: 'quest_bad_consequence',
          title: '错误后果字段',
          severity: 'catastrophic',
          consequenceTags: ['可用标签', 123],
          affectedNpcIds: ['npc_chen_heng'],
        },
      },
      worldBook,
      [],
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('quest severity');
    expect(result.errors.join('\n')).toContain('quest.consequenceTags');
  });

  it('applies rumorAdded as a signal with potential consequence anchors', () => {
    const patch: StatePatch = {
      type: 'rumorAdded',
      reason: 'heard a gate closure signal',
      payload: {
        rumorId: 'signal_north_gate',
        title: 'North gate closure',
        content: 'Patrols may close the north gate before nightfall.',
        source: 'market caravan',
        signalType: 'rumor',
        confidence: 'medium',
        potentialOutcomeSummary: 'If true, the escort route through the north gate becomes dangerous.',
        consequenceTags: ['route-risk', 'patrol-movement'],
        affectedNpcIds: ['npc_chen_heng'],
        affectedFactionIds: ['faction_local_patrol'],
        affectedPlaceIds: ['loc_market_town'],
        affectedForceIds: ['force_patrol_unit'],
        affectedHoldingIds: ['holding_market_gate'],
        followUpHooks: ['verify north gate guards', 'search for an east gate path'],
        severity: 'moderate',
        relatedLocationIds: ['loc_market_town'],
        threadId: 'thread_market_rescue',
        expiresAt: 'before nightfall',
      },
    };

    const next = applyPatch(makeState(), patch, 1, 'listen for news', 'The caravan shares a warning.');

    expect(next.knownRumors[0]).toMatchObject({
      id: 'signal_north_gate',
      title: 'North gate closure',
      content: 'Patrols may close the north gate before nightfall.',
      source: 'market caravan',
      signalType: 'rumor',
      confidence: 'medium',
      potentialOutcomeSummary: 'If true, the escort route through the north gate becomes dangerous.',
      consequenceTags: ['route-risk', 'patrol-movement'],
      affectedNpcIds: ['npc_chen_heng'],
      affectedFactionIds: ['faction_local_patrol'],
      affectedPlaceIds: ['loc_market_town'],
      affectedForceIds: ['force_patrol_unit'],
      affectedHoldingIds: ['holding_market_gate'],
      followUpHooks: ['verify north gate guards', 'search for an east gate path'],
      severity: 'moderate',
      relatedLocationIds: ['loc_market_town'],
      threadId: 'thread_market_rescue',
      expiresAt: 'before nightfall',
      verified: false,
    });
  });

  it('deduplicates semantically identical rumorAdded patches in the same application batch', () => {
    const signalContent = '襄阳城西客舍住着几个南阳来的私商，手里压着一批生熟铁锭，急需粮食，但不敢冒险将铁料运出城外。';
    const signalOutcome = '若能成功交易并安全运出，左曲将获得打造兵器的关键原料。';
    const patches: StatePatch[] = [
      {
        type: 'rumorAdded',
        reason: '听闻南阳客商私卖铁料',
        payload: {
          title: '南阳客商私卖铁料',
          content: signalContent,
          source: '韩烈派出的心腹',
          signalType: 'clue',
          confidence: 'high',
          potentialOutcomeSummary: signalOutcome,
        },
      },
      {
        type: 'rumorAdded',
        reason: '写回整理补入稳定线索 ID',
        payload: {
          rumorId: 'rumor_nanyang_iron_trade',
          title: '南阳客商私卖铁料',
          content: signalContent,
          source: '韩烈派出的心腹',
          signalType: 'clue',
          confidence: 'high',
          potentialOutcomeSummary: signalOutcome,
        },
      },
    ];

    const next = applyPatches(makeState(), patches, 1, '听韩烈密报', '韩烈回报城中铁料消息。');

    expect(next.knownRumors).toHaveLength(1);
    expect(next.knownRumors[0]).toMatchObject({
      title: '南阳客商私卖铁料',
      content: signalContent,
      source: '韩烈派出的心腹',
      signalType: 'clue',
      confidence: 'high',
      potentialOutcomeSummary: signalOutcome,
    });
  });

  it('reuses the unique active same-title rumorAdded record when its generated id and wording drift', () => {
    const state = {
      ...makeState(),
      knownRumors: [
        {
          id: 'rumor_bocai_camp_weakness',
          title: '长社黄巾大营破绽',
          content: '旧报称大营西侧夜间换防迟缓。',
          source: '先前斥候',
          status: 'open',
          signalType: 'clue',
          verified: false,
          createdAt: 'day 1',
        },
      ],
    } as any;
    const patch: StatePatch = {
      type: 'rumorAdded',
      reason: '新探马补充同一营寨破绽',
      payload: {
        rumorId: '2822320c-fcc7-4e86-89af-6af2d622ea3c',
        title: '长社黄巾大营破绽',
        content: '新报确认营后粮车入口守备松动，可继续核查。',
        source: '新到探马',
        signalType: 'clue',
        confidence: 'high',
      },
    };

    const next = applyPatch(state, patch, 2, '继续查营', '探马补充了同一营寨的破绽。');

    expect(next.knownRumors).toHaveLength(1);
    expect(next.knownRumors[0]).toMatchObject({
      id: 'rumor_bocai_camp_weakness',
      title: '长社黄巾大营破绽',
      content: '新报确认营后粮车入口守备松动，可继续核查。',
      source: '新到探马',
      confidence: 'high',
    });
  });

  it('applies quest and rumor patches that were mistakenly nested under luanshiCommand.command.action', () => {
    const state = applyPatch(makeState(), {
      type: 'questAdded',
      reason: '玩家答应护送伤者',
      payload: {
        questId: 'quest_rescue_wounded',
        title: '护送伤者离开市镇',
        description: '陈衡托主角把伤者送到安全处。',
        currentStep: '先找到能通行的北门小路。',
        priority: 'medium',
      },
    }, 1, '我答应陈衡', '主角答应护送伤者。');
    const patches: StatePatch[] = [
      {
        type: 'luanshiCommand',
        reason: '模型误把 questUpdated 塞进 command.action',
        payload: {
          command: {
            action: 'questUpdated',
            questId: 'quest_rescue_wounded',
            currentStep: '北门已被封死，改查东门水道。',
            priority: 'high',
          },
        },
      },
      {
        type: 'luanshiCommand',
        reason: '模型误把 rumorAdded 塞进 command.action',
        payload: {
          command: {
            action: 'rumorAdded',
            rumorId: 'rumor_east_water_gate',
            content: '有脚夫说东门水道夜里还能通行。',
            source: '码头脚夫',
            signalType: 'rumor',
            confidence: 'medium',
          },
        },
      },
    ];

    expect(patches.map((patch) => validatePatch(patch, worldBook, ['quest_rescue_wounded'], state).valid)).toEqual([
      true,
      true,
    ]);

    const next = applyPatches(state, patches, 2, '探问东门', '主角探问新的撤离路径。');

    expect(next.activeQuests[0]).toMatchObject({
      id: 'quest_rescue_wounded',
      currentStep: '北门已被封死，改查东门水道。',
      priority: 'high',
    });
    expect(next.knownRumors).toContainEqual(expect.objectContaining({
      id: 'rumor_east_water_gate',
      content: '有脚夫说东门水道夜里还能通行。',
      source: '码头脚夫',
      verified: false,
    }));
  });

  it('treats misnested upsertQuest as a current matter update for an existing quest id', () => {
    const state = applyPatch(makeState(), {
      type: 'questAdded',
      reason: '玩家答应护送伤者',
      payload: {
        questId: 'quest_rescue_wounded',
        title: '护送伤者离开市镇',
        description: '陈衡托主角把伤者送到安全处。',
        currentStep: '先找到能通行的北门小路。',
      },
    }, 1, '我答应陈衡', '主角答应护送伤者。');
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: '模型误用 upsertQuest',
      payload: {
        command: {
          action: 'upsertQuest',
          questId: 'quest_rescue_wounded',
          currentStep: '陈衡已经把伤者转移到药铺后院。',
          status: 'active',
        },
      },
    };

    expect(validatePatch(patch, worldBook, ['quest_rescue_wounded'], state).valid).toBe(true);

    const next = applyPatch(state, patch, 2, '查看伤者', '伤者暂时安置妥当。');

    expect(next.activeQuests).toHaveLength(1);
    expect(next.activeQuests[0]).toMatchObject({
      id: 'quest_rescue_wounded',
      currentStep: '陈衡已经把伤者转移到药铺后院。',
      status: 'active',
    });
  });

  it('normalizes singleton faction recentActions from runtime writeback', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: '模型把 recentActions 写成单个字符串',
      payload: {
        command: {
          action: 'upsertFactionLedger',
          factionId: 'faction_market_patrol',
          name: '市镇巡卒',
          type: '地方武装',
          summary: '市镇里维持秩序的小股巡卒。',
          stanceToPlayer: '暂时观望主角。',
          knownLevel: '听闻',
          recentActions: '封锁北门，盘查伤者去向。',
        },
      },
    };

    expect(validatePatch(patch, worldBook, []).valid).toBe(true);

    const next = ensureLuanShiState(applyPatch(makeState(), patch, 1, '打听巡卒', '主角打听巡卒动向。'));

    expect(next.factions).toContainEqual(expect.objectContaining({
      factionId: 'faction_market_patrol',
      recentActions: ['【听闻】封锁北门，盘查伤者去向。'],
    }));
  });

  it('applies a same-turn structured recent action to an existing faction ledger entry', () => {
    const factionPatch: StatePatch = {
      type: 'luanshiCommand',
      reason: '建立现有势力档案',
      payload: {
        command: {
          action: 'upsertFactionLedger',
          factionId: 'faction_market_patrol',
          name: '市镇巡卒',
          type: '地方武装',
          summary: '市镇里维持秩序的小股巡卒。',
          stanceToPlayer: '暂时观望主角。',
          knownLevel: '听闻',
          recentActions: ['封锁北门'],
        },
      },
    };
    const stateWithFaction = ensureLuanShiState(
      applyPatch(makeState(), factionPatch, 1, '打听巡卒', '主角打听巡卒动向。'),
    );
    const actionPatch: StatePatch = {
      type: 'recordFactionRecentAction',
      reason: '正文通过传闻明确了已有势力的新行动',
      payload: {
        factionId: 'faction_market_patrol',
        summary: '巡卒开始盘查出城商旅',
        knownLevel: '听闻',
        observedAt: '公元189年09月01日 12:00（午时）',
        sourceNote: '商旅转述',
      },
    } as unknown as StatePatch;

    expect(validatePatch(actionPatch, worldBook, [], stateWithFaction).valid).toBe(true);

    const next = ensureLuanShiState(
      applyPatch(stateWithFaction, actionPatch, 2, '继续打听', '商旅称巡卒已经开始盘查。'),
    );
    expect(next.factions).toContainEqual(expect.objectContaining({
      factionId: 'faction_market_patrol',
      knownLevel: '听闻',
      sourceNote: '商旅转述',
      recentActions: ['【听闻】封锁北门', '【听闻】巡卒开始盘查出城商旅'],
    }));
  });

  it('registers a hidden NPC awareness entry without creating an archive NPC', () => {
    const patch: StatePatch = {
      type: 'npcAwarenessRegistered',
      reason: 'rumor names a relevant off-stage person',
      payload: {
        name: 'Zhang Miao',
        sourceType: 'rumor',
        sourceId: 'rumor_recruit',
        contactLevel: 0,
        playerRelevance: ['same-location'],
      },
    };

    const next = ensureLuanShiState(applyPatch(makeState(), patch, 1, 'listen for news', 'A caravan names Zhang Miao.'));

    expect(next.npcAwarenessIndex).toHaveLength(1);
    expect(next.npcAwarenessIndex[0]).toMatchObject({
      name: 'Zhang Miao',
      sourceType: 'rumor',
      sourceIds: ['rumor_recruit'],
      contactLevel: 0,
      playerRelevance: ['same-location'],
      knownToPlayer: true,
      archiveVisible: false,
    });
    expect(next.npcs.find((npc) => npc.name === 'Zhang Miao')).toBeUndefined();
  });

  it('appends an unread presence update to an existing NPC only', () => {
    const patch: StatePatch = {
      type: 'npcPresenceUpdated',
      reason: 'remote presence surfaced through a letter',
      payload: {
        npcId: 'npc_chen_heng',
        kind: 'letter',
        summary: 'Chen Heng sent a short letter asking whether the player still intends to leave town.',
        source: 'messenger',
        relatedWorldTrendIds: ['trend_market_lockdown'],
        relatedConflictIds: ['battle_market_gate'],
      },
    };

    const next = ensureLuanShiState(applyPatch(makeState(), patch, 1, 'read the letter', 'A messenger arrives.'));
    const npc = next.npcs.find((item) => item.npcId === 'npc_chen_heng');

    expect(npc?.presenceUpdates).toHaveLength(1);
    expect(npc?.presenceUpdates?.[0]).toMatchObject({
      kind: 'letter',
      summary: 'Chen Heng sent a short letter asking whether the player still intends to leave town.',
      source: 'messenger',
      relatedWorldTrendIds: ['trend_market_lockdown'],
      relatedConflictIds: ['battle_market_gate'],
      readByPlayer: false,
    });
  });

  it('allows off-stage NPC awareness to use a conflict source without creating an archive NPC', () => {
    const patch: StatePatch = {
      type: 'npcAwarenessRegistered',
      reason: 'a public battle names a relevant off-stage person',
      payload: {
        name: 'Zhang Miao',
        sourceType: 'conflict',
        sourceId: 'battle_chenliu_recruit',
        contactLevel: 0,
        playerRelevance: ['battle-related'],
      },
    };

    const next = ensureLuanShiState(applyPatch(makeState(), patch, 1, 'listen for war news', 'A messenger names Zhang Miao.'));

    expect(next.npcAwarenessIndex).toHaveLength(1);
    expect(next.npcAwarenessIndex[0]).toMatchObject({
      name: 'Zhang Miao',
      sourceType: 'conflict',
      sourceIds: ['battle_chenliu_recruit'],
      contactLevel: 0,
      archiveVisible: false,
    });
    expect(next.npcs.find((npc) => npc.name === 'Zhang Miao')).toBeUndefined();
  });

  it('registers NPC awareness refs carried by a rumor without making them visible archive NPCs', () => {
    const patch: StatePatch = {
      type: 'rumorAdded',
      reason: 'heard a recruiting rumor',
      payload: {
        rumorId: 'rumor_zhang_miao_recruit',
        content: 'Zhang Miao is recruiting guards near the same commandery.',
        source: 'merchant',
        npcAwarenessRefs: [
          {
            name: 'Zhang Miao',
            contactLevel: 0,
            playerRelevance: ['same-location'],
            unresolvedHooks: ['may recruit capable locals'],
          },
        ],
      },
    };

    const next = ensureLuanShiState(applyPatch(makeState(), patch, 1, 'ask about local news', 'The merchant shares a rumor.'));

    expect(next.knownRumors[0].npcAwarenessRefs?.[0]).toMatchObject({ name: 'Zhang Miao' });
    expect(next.npcAwarenessIndex[0]).toMatchObject({
      name: 'Zhang Miao',
      sourceType: 'rumor',
      sourceIds: ['rumor_zhang_miao_recruit'],
      contactLevel: 0,
      archiveVisible: false,
      unresolvedHooks: ['may recruit capable locals'],
    });
    expect(next.npcs.find((npc) => npc.name === 'Zhang Miao')).toBeUndefined();
  });

  it('validates signal metadata as structured fields', () => {
    const result = validatePatch(
      {
        type: 'rumorAdded',
        reason: 'bad signal fields',
        payload: {
          rumorId: 'signal_bad',
          content: 'A malformed signal should be rejected.',
          signalType: 'prophecy',
          confidence: 'certain',
          severity: 'catastrophic',
          affectedNpcIds: ['npc_chen_heng', 123],
          relatedLocationIds: ['loc_market_town'],
        },
      },
      worldBook,
      [],
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('rumor signalType');
    expect(result.errors.join('\n')).toContain('rumor confidence');
    expect(result.errors.join('\n')).toContain('rumor severity');
    expect(result.errors.join('\n')).toContain('rumor.affectedNpcIds');
  });

  it('validates NPC awareness and presence patches as structured fields', () => {
    const awareness = validatePatch(
      {
        type: 'npcAwarenessRegistered',
        reason: 'register hidden awareness',
        payload: {
          name: 'Zhang Miao',
          sourceType: 'conflict',
          sourceId: 'battle_zhang_miao_recruit',
          contactLevel: 0,
          playerRelevance: ['same-location'],
        },
      },
      worldBook,
      [],
    );
    const invalidPresence = validatePatch(
      {
        type: 'npcPresenceUpdated',
        reason: 'missing summary',
        payload: {
          npcId: 'npc_chen_heng',
          kind: 'letter',
        },
      },
      worldBook,
      [],
    );

    expect(awareness.valid).toBe(true);
    expect(invalidPresence.valid).toBe(false);
    expect(invalidPresence.errors.join('\n')).toContain('npcPresenceUpdated');
  });

  it('updates current matter status and keeps extended fields', () => {
    const state = applyPatch(makeState(), {
      type: 'questAdded',
      reason: '玩家答应护送伤者',
      payload: {
        questId: 'quest_rescue_wounded',
        title: '护送伤者离开市镇',
        description: '陈衡托主角把伤者送到安全处。',
        currentStep: '先找到能通行的北门小路。',
        stakes: '拖延太久会被追兵堵在市镇。',
        priority: 'medium',
      },
    }, 1, '我答应陈衡', '主角答应护送伤者。');

    const next = applyPatch(state, {
      type: 'questUpdated',
      reason: '当前事项推进',
      payload: {
        questId: 'quest_rescue_wounded',
        status: 'invalidated',
        description: '北门已被封死，原护送路线失效。',
        currentStep: '重新寻找出城路径。',
        priority: 'high',
        outcomeSummary: '北门路线失效，救援事项转入重新规划。',
        consequenceTags: ['路线失效'],
        affectedPlaceIds: ['loc_market_town'],
        followUpHooks: ['寻找东门或水路'],
        severity: 'major',
      },
    }, 2, '我查看北门', '北门已被封死。');

    expect(next.activeQuests[0]).toMatchObject({
      status: 'invalidated',
      description: '北门已被封死，原护送路线失效。',
      currentStep: '重新寻找出城路径。',
      stakes: '拖延太久会被追兵堵在市镇。',
      priority: 'high',
      outcomeSummary: '北门路线失效，救援事项转入重新规划。',
      consequenceTags: ['路线失效'],
      affectedPlaceIds: ['loc_market_town'],
      followUpHooks: ['寻找东门或水路'],
      severity: 'major',
    });
  });

  it('closes a quest-linked NPC background activity when the matter reaches a terminal state', () => {
    const state = {
      ...makeState(),
      activeQuests: [{
        id: 'quest_horse_feed_delivered',
        title: '战马精料危机',
        description: '蔡家筹运三船豆饼精料。',
        status: 'active' as const,
        createdAt: '乱世元年1月',
        updatedAt: '乱世元年1月',
      }],
      npcs: makeState().npcs!.map((npc) => ({
        ...npc,
        backgroundActivity: {
          activityId: 'activity_prepare_horse_feed',
          summary: '筹备并运送战马精料。',
          status: 'active' as const,
          sourceType: 'quest' as const,
          sourceIds: ['quest_horse_feed_delivered'],
          dueAt: '乱世元年2月',
        },
      })),
    };

    const next = applyPatch(state, {
      type: 'questUpdated',
      reason: '三船精料已经到港入库',
      payload: {
        questId: 'quest_horse_feed_delivered',
        status: 'completed',
        outcomeSummary: '三船精料已经到港入库，骑兵补给恢复充足。',
      },
    }, 2, '清点入库', '三船精料已经全部入库。');

    expect(next.npcs![0].backgroundActivity).toMatchObject({
      activityId: 'activity_prepare_horse_feed',
      status: 'completed',
      lastEvaluatedAt: '乱世元年2月',
    });
  });

  it('awards quest experience exactly once on the first completed transition', () => {
    const state = applyPatch({
      ...makeState(),
      player: {
        ...makeState().player,
        level: 1,
        xp: 80,
        growthPoints: 1,
      },
    }, {
      type: 'questAdded',
      reason: '接下护送任务',
      payload: {
        questId: 'quest_rewarded_rescue',
        title: '护送伤者',
        description: '把伤者送到安全处。',
      },
    }, 1, '接下任务', '主角接下了任务。');
    const completionPatch: StatePatch = {
      type: 'questUpdated',
      reason: '护送任务首次完成',
      payload: {
        questId: 'quest_rewarded_rescue',
        status: 'completed',
        experienceReward: 30,
        outcomeSummary: '伤者安全抵达。',
      },
    };

    expect(validatePatch(completionPatch, worldBook, ['quest_rewarded_rescue'], state).valid).toBe(true);
    const completed = applyPatch(state, completionPatch, 2, '完成护送', '伤者安全抵达。');

    expect(completed.activeQuests.find((quest) => quest.id === 'quest_rewarded_rescue')?.archivedAt).toBe('乱世元年2月');

    expect(completed.activeQuests[0].status).toBe('completed');
    expect(completed.activeQuests[0].completionExperienceAwarded).toBe(30);
    expect(completed.player).toMatchObject({ level: 2, xp: 10, growthPoints: 6 });

    const repeatedValidation = validatePatch(
      completionPatch,
      worldBook,
      ['quest_rewarded_rescue'],
      completed,
    );
    const repeated = applyPatch(completed, completionPatch, 3, '再次确认', '任务已经完成。');

    expect(repeatedValidation.valid).toBe(false);
    expect(repeatedValidation.errors.join('\n')).toContain('重复');
    expect(repeated.player).toMatchObject({ level: 2, xp: 10, growthPoints: 6 });

    const reopened = {
      ...completed,
      activeQuests: completed.activeQuests.map((quest) => ({ ...quest, status: 'active' as const })),
    };
    expect(validatePatch(
      completionPatch,
      worldBook,
      ['quest_rewarded_rescue'],
      reopened,
    ).valid).toBe(false);
    expect(applyPatch(reopened, completionPatch, 4, '重新完成', '任务再次被标记完成。').player).toMatchObject({
      level: 2,
      xp: 10,
      growthPoints: 6,
    });
  });

  it('derives direct quest patch experience from structured severity', () => {
    const state = {
      ...makeState(),
      player: {
        ...makeState().player,
        level: 2,
        xp: 0,
        growthPoints: 0,
      },
      activeQuests: [{
        id: 'quest_critical_granary',
        title: '保全郡仓',
        description: '阻止郡仓被焚并恢复粮道。',
        severity: 'critical' as const,
        status: 'active' as const,
        createdAt: 'day 1',
        updatedAt: 'day 1',
      }],
    };
    const completionPatch: StatePatch = {
      type: 'questUpdated',
      reason: '郡仓和粮道均已保全',
      payload: {
        questId: 'quest_critical_granary',
        status: 'completed',
        outcomeSummary: '郡仓无损，粮道恢复。',
      },
    };

    expect(validatePatch(
      completionPatch,
      worldBook,
      ['quest_critical_granary'],
      state,
    ).valid).toBe(true);
    const completed = applyPatch(state, completionPatch, 2, '保全郡仓', '粮道重新畅通。');

    expect(completed.activeQuests[0].completionExperienceAwarded).toBe(160);
    expect(completed.player).toMatchObject({ level: 2, xp: 160, growthPoints: 0 });
  });

  it.each([
    ['non-completed update', { status: 'active', experienceReward: 20 }],
    ['negative reward', { status: 'completed', experienceReward: -1 }],
    ['non-finite reward', { status: 'completed', experienceReward: Number.POSITIVE_INFINITY }],
    ['oversized reward', { status: 'completed', experienceReward: 1001 }],
  ])('rejects invalid quest experience contract: %s', (_label, rewardPayload) => {
    const state = {
      ...makeState(),
      activeQuests: [{
        id: 'quest_reward_contract',
        title: '测试任务',
        description: '用于校验奖励合同。',
        status: 'active' as const,
        createdAt: 'day 1',
        updatedAt: 'day 1',
      }],
    };
    const result = validatePatch({
      type: 'questUpdated',
      reason: '测试奖励合同',
      payload: {
        questId: 'quest_reward_contract',
        ...rewardPayload,
      },
    }, worldBook, ['quest_reward_contract'], state);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('experienceReward');
  });

  it('applies one personal purchase delta exactly once through the state patch path', () => {
    const state = {
      ...makeState(),
      player: {
        ...makeState().player,
        personalMoney: 100,
      },
      playerResources: {
        粮饷: 240,
      },
    };
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: '购买药材花费四十钱',
      payload: {
        command: {
          action: 'updatePlayerLoadout',
          characterId: 'player',
          personalMoneyDelta: -40,
          summary: '购买药材花费四十钱。',
        },
      },
    };

    expect(validatePatch(patch, worldBook, [], state).valid).toBe(true);
    const next = applyPatch(state, patch, 1, '购买药材', '主角买下药材。');

    expect(next.player.personalMoney).toBe(60);
    expect(next.playerResources).toEqual({ 粮饷: 240 });
    expect(next.playerResources).not.toHaveProperty('钱财');
    expect(next.playerResources).not.toHaveProperty('money');
    expect(next.resources).toEqual(state.resources);
  });

  it.each(['钱财', 'money'])('rejects updateResourceLedger personal-money shadow %s through the state patch path', (resourceKey) => {
    const state = {
      ...makeState(),
      player: {
        ...makeState().player,
        personalMoney: 100,
      },
      playerResources: {
        粮饷: 240,
      },
    };
    const patch = {
      type: 'luanshiCommand',
      reason: '错误地把个人钱财写入资源账本',
      payload: {
        command: {
          action: 'updateResourceLedger',
          playerResources: {
            [resourceKey]: 36,
          },
        },
      },
    } as StatePatch;

    const validation = validatePatch(patch, worldBook, [], state);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join('\n')).toContain('updatePlayerLoadout.personalMoneyDelta');

    const next = applyPatch(state, patch, 1, '错误账本写回', '无有效状态变化。');
    expect(next.player.personalMoney).toBe(100);
    expect(next.playerResources).toEqual({ 粮饷: 240 });
    expect(next.resources).toEqual(state.resources);
  });

  it('applies precise time advancement to currentTime, currentDate and turn log date', () => {
    const state = {
      ...makeState(),
      startDate: '公元189年09月01日 08:00（辰时）',
      currentDate: '公元189年09月01日 08:00（辰时）',
      currentTime: {
        year: 189,
        month: 9,
        day: 1,
        hour: 8,
        minute: 0,
      },
    };
    const patch: StatePatch = {
      type: 'timeAdvance',
      reason: '玩家奔走一个时辰',
      payload: {
        timeBlocksAdvanced: 1,
      },
    };

    const next = applyPatch(state, patch, 1, '前往官署', '主角赶往官署。');

    expect(next.currentDate).toBe('公元189年09月01日 10:00（巳时）');
    expect(next.currentTime).toEqual({
      year: 189,
      month: 9,
      day: 1,
      hour: 10,
      minute: 0,
    });
    expect(next.turnLog[0].date).toBe('公元189年09月01日 10:00（巳时）');
  });

  it('applies one adult-gated pregnancy opportunity and resolves its saved roll after time advances', () => {
    const state = {
      ...makeState(),
      startDate: '公元189年09月01日 08:00（辰时）',
      currentDate: '公元189年09月01日 08:00（辰时）',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      npcs: [{
        ...makeState().npcs![0],
        npcId: 'npc_lady_he',
        name: '何氏',
        sex: '女' as const,
        age: 24,
        ageKnownAtDate: '公元189年09月01日 08:00（辰时）',
        femaleProfile: {
          adultPrivateProfile: {
            enabled: true,
            ageConfirmedAdult: true,
            wombProfile: { status: '未受孕' },
          },
        },
      }],
    };
    const riskPatch: StatePatch = {
      type: 'luanshiCommand',
      reason: '记录本回合明确成立的受孕风险',
      payload: {
        command: {
          action: 'recordPregnancyRisk',
          npcId: 'npc_lady_he',
          npcName: '何氏',
          riskType: 'tryingToConceive',
          summary: '双方明确备孕并发生有效行为。',
        },
      },
    };
    const timePatch: StatePatch = {
      type: 'timeAdvance',
      reason: '等待一个月',
      payload: { daysAdvanced: 30 },
    };

    expect(validatePatch(riskPatch, worldBook, [], state).valid).toBe(true);
    const next = applyPatches(
      state,
      [riskPatch, timePatch],
      1,
      '等待一个月',
      '一个月过去了。',
      undefined,
      { pregnancyMode: 'high' },
    );
    const wombProfile = next.npcs?.[0]?.femaleProfile?.adultPrivateProfile?.wombProfile;

    expect(wombProfile?.lastPregnancyCheck).toMatchObject({
      firstExposureAt: '公元189年09月01日 08:00（辰时）',
    });
    expect(wombProfile?.pregnancy?.status === 'suspected' || wombProfile?.pregnancy === undefined).toBe(true);
    expect(next.turnLog).toHaveLength(1);
  });

  it('applies explicit several-month training time advancement', () => {
    const state = {
      ...makeState(),
      startDate: '公元194年04月02日 09:30（巳时）',
      currentDate: '公元194年04月02日 09:30（巳时）',
      currentTime: {
        year: 194,
        month: 4,
        day: 2,
        hour: 9,
        minute: 30,
      },
    };
    const patch: StatePatch = {
      type: 'timeAdvance',
      reason: '长达三个月的屯田练兵与打造成军',
      payload: {
        daysAdvanced: 91,
        hoursAdvanced: 7,
        minutesAdvanced: 15,
      },
    };

    const next = applyPatch(state, patch, 20, '练兵三个月', '三个月的时间悄然流逝。');

    expect(next.currentDate).toBe('公元194年07月03日 16:45（申时）');
    expect(next.currentTime).toEqual({
      year: 194,
      month: 7,
      day: 3,
      hour: 16,
      minute: 45,
    });
    expect(next.turnLog[0].date).toBe('公元194年07月03日 16:45（申时）');
  });

  it('通过 StatePatch 应用 recordTurnEvent 命令', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: '记录回合事件',
      payload: {
        command: {
          action: 'recordTurnEvent',
          eventId: 'evt_market_rescue',
          locationId: 'loc_market_town',
          summary: '主角在市镇救下伤者，陈衡在场目睹。',
          presentNpcIds: ['npc_chen_heng'],
          involvedNpcIds: ['npc_chen_heng'],
          visibility: '在场可知',
        },
      },
    };

    const next = ensureLuanShiState(
      applyPatch(makeState(), patch, 1, '我救下伤者', '主角救下伤者。'),
    );

    expect(next.turnEvents).toHaveLength(1);
    expect(next.turnEvents[0]).toMatchObject({
      eventId: 'evt_market_rescue',
      happenedAt: '乱世元年2月',
      locationId: 'loc_market_town',
    });
    expect(next.turnLog).toHaveLength(1);
  });

  it('通过 StatePatch 应用 pushNpcMemory 命令', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: '记录 NPC 亲历记忆',
      payload: {
        command: {
          action: 'pushNpcMemory',
          npcId: 'npc_chen_heng',
          npcName: '陈衡',
          source: '亲历',
          value: '陈衡亲眼见到主角在市镇救人。',
        },
      },
    };

    const next = ensureLuanShiState(
      applyPatch(makeState(), patch, 1, '我救下伤者', '主角救下伤者。'),
    );
    const chenHeng = next.npcs.find((npc) => npc.npcId === 'npc_chen_heng');

    expect(chenHeng?.memories).toHaveLength(1);
    expect(chenHeng?.memories[0].content).toBe('陈衡亲眼见到主角在市镇救人。');
    expect(next.turnLog).toHaveLength(1);
  });

  it('applies common top-level LuanShi action names as luanshiCommand patches', () => {
    const eventPatch = {
      type: 'recordTurnEvent',
      reason: '模型把命令 action 写成顶层 type',
      payload: {
        eventId: 'evt_top_level_action',
        locationId: 'loc_market_town',
        summary: '顶层 action 漂移仍应记录为回合事件。',
        presentNpcIds: [],
        involvedNpcIds: [],
        visibility: '公开',
      },
    } as unknown as StatePatch;
    const memoryPatch = {
      type: 'pushNpcMemory',
      reason: '模型把 NPC 记忆命令写成顶层 type',
      payload: {
        npcId: 'npc_chen_heng',
        npcName: '陈衡',
        source: '亲历',
        value: '陈衡记得主角在混乱中仍先救人。',
      },
    } as unknown as StatePatch;

    const next = ensureLuanShiState(
      applyPatches(
        makeState(),
        [eventPatch, memoryPatch],
        1,
        '我先救人',
        '主角先救下伤者。',
      ),
    );

    expect(next.turnEvents.map((event) => event.eventId)).toContain('evt_top_level_action');
    expect(next.npcs.find((npc) => npc.npcId === 'npc_chen_heng')?.memories.map((memory) => memory.content)).toContain(
      '陈衡记得主角在混乱中仍先救人。',
    );
  });

  it('通过 StatePatch 应用 updateCharacterIdentity 命令', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: '细化主角当前军职',
      payload: {
        command: {
          action: 'updateCharacterIdentity',
          characterId: 'player',
          characterName: '主角',
          currentIdentity: '军中下级将校',
          currentIdentityDescription: '统带北军一部的基层军官。',
          militaryTitle: '军侯',
          commonAddress: '刘军侯',
          identitySummary: '主角在洛阳乱局中被明确为北军军侯。',
          personalEscortEntitlement: {
            status: 'customary',
            bases: ['military_command'],
            updatedAt: '乱世元年2月',
          },
        },
      },
    };

    const next = ensureLuanShiState(
      applyPatch(makeState(), patch, 1, '整理军中身份', '军中众人改称主角为刘军侯。'),
    );

    expect(next.player.currentIdentity).toBe('军中下级将校');
    expect(next.player.militaryTitle).toBe('军侯');
    expect(next.player.commonAddress).toBe('刘军侯');
    expect(next.player.identitySummary).toContain('北军军侯');
  });
  it('通过 StatePatch 应用 updatePlayerLoadout 命令', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: '真开局写回初始行装',
      payload: {
        command: {
          action: 'updatePlayerLoadout',
          characterId: 'player',
          personalMoney: 380,
          equipment: [
            {
              id: 'eq_court_sword',
              slot: 'weapon',
              name: '佩剑',
              quality: '精良',
              description: '朝中官员随身佩剑。',
            },
          ],
          inventory: [{ id: 'item_seal_bag', name: '符传囊', quantity: 1 }],
          summary: '按朝中重臣身份生成的官员行装。',
        },
      },
    };

    const next = ensureLuanShiState(
      applyPatch(
        makeState(),
        patch,
        1,
        'true opening',
        '主角整点行装。',
        undefined,
        { openingInitialization: true },
      ),
    );

    expect(next.player.personalMoney).toBe(380);
    expect(next.player.equipment?.[0]).toMatchObject({ name: '佩剑', quality: '精良' });
    expect(next.player.inventory?.[0]).toMatchObject({ name: '符传囊', quantity: 1 });
    expect(next.playerResources).not.toHaveProperty('钱财');
    expect(next.resources.money).toBe(0);
    expect(next.worldStateDelta.openingLoadoutSummary).toBe('按朝中重臣身份生成的官员行装。');
  });

  it('通过成对 StatePatch 应用 NPC 交出物品给主角', () => {
    const baseState = makeState();
    const state = ensureLuanShiState({
      ...baseState,
      npcs: (baseState.npcs ?? []).map((npc) => npc.npcId === 'npc_chen_heng'
        ? {
            ...npc,
            inventory: [
              {
                id: 'item_gate_token',
                name: '营门木符',
                quantity: 1,
                category: 'token',
                description: '陈衡持有的营门出入凭证。',
                keyItem: true,
              },
            ],
          }
        : npc),
    });
    const patches: StatePatch[] = [
      {
        type: 'luanshiCommand',
        reason: '陈衡交出营门木符',
        payload: {
          command: {
            action: 'updateNpcLoadout',
            npcId: 'npc_chen_heng',
            npcName: '陈衡',
            inventoryChanges: [{ action: 'remove', itemId: 'item_gate_token' }],
            summary: '陈衡把营门木符交给主角。',
          },
        },
      },
      {
        type: 'luanshiCommand',
        reason: '主角收下营门木符',
        payload: {
          command: {
            action: 'updatePlayerLoadout',
            characterId: 'player',
            inventoryChanges: [
              {
                action: 'upsert',
                item: {
                  id: 'item_gate_token',
                  name: '营门木符',
                  quantity: 1,
                  category: 'token',
                  description: '陈衡交出的营门出入凭证。',
                  keyItem: true,
                },
              },
            ],
            summary: '主角收下陈衡交出的营门木符。',
          },
        },
      },
    ];

    expect(patches.map((patch) => validatePatch(patch, worldBook, [], state).valid)).toEqual([true, true]);

    const next = ensureLuanShiState(
      applyPatches(state, patches, 1, '接过木符', '陈衡把营门木符交给主角。'),
    );
    const chenHeng = next.npcs.find((npc) => npc.npcId === 'npc_chen_heng');
    const playerToken = next.player.inventory?.find((item) => item.id === 'item_gate_token');

    expect((chenHeng?.inventory ?? []).some((item) => item.id === 'item_gate_token')).toBe(false);
    expect(playerToken).toMatchObject({
      id: 'item_gate_token',
      name: '营门木符',
      quantity: 1,
    });
  });

  it('通过 StatePatch 应用使用 equipSlot 的 equipmentChanges 初始装备', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: '真开局写回初始装备变更',
      payload: {
        command: {
          action: 'updatePlayerLoadout',
          characterId: 'player',
          personalMoney: 3000,
          equipmentChanges: [
            {
              action: 'upsert',
              item: {
                id: 'item_equip_han_sword',
                name: '百炼环首剑',
                category: 'equipment',
                equipSlot: 'weapon',
                quality: '精良',
                description: '蜀中工匠锻造的环首剑。',
              },
            },
          ],
          inventoryChanges: [
            {
              action: 'upsert',
              item: {
                id: 'item_inv_royal_token',
                name: '宗室牙牌',
                quantity: 1,
                description: '证明汉室宗亲身份的古旧牙牌。',
              },
            },
          ],
          summary: '按真开局身份生成初始行装。',
        },
      },
    };

    expect(validatePatch(patch, worldBook, [], makeState()).valid).toBe(true);

    const next = ensureLuanShiState(
      applyPatch(makeState(), patch, 1, 'true opening', '主角整点行装。'),
    );

    expect(next.player.personalMoney).toBe(3000);
    expect(next.player.equipment?.[0]).toMatchObject({
      id: 'item_equip_han_sword',
      slot: 'weapon',
      name: '百炼环首剑',
    });
    expect(next.player.inventory?.[0]).toMatchObject({
      id: 'item_inv_royal_token',
      quantity: 1,
    });
  });

  it('通过顶层 upsertNpcProfile 应用缺省 isFocused 的在场重要 NPC', () => {
    const patch = {
      type: 'upsertNpcProfile',
      reason: '模型把重要在场 NPC 写成顶层命令 patch 且漏写 isFocused',
      payload: {
        npcId: 'npc_chen_zhi',
        name: '陈祗',
        persistenceReason: 'historical_figure',
        persistenceEvidence: '蜀汉尚书令陈祗已在御前议事中持续承接朝政线。',
        sex: '男',
        age: 45,
        role: '尚书令',
        currentIdentity: '蜀汉尚书令',
        locationId: 'place_yizhou_chengdu',
        isPresent: true,
        summary: '蜀汉后期重要执政者，掌握后方政务调拨。',
        appearance: '手执象简，眉目谨慎。',
        personality: '精于权衡，重视朝局稳定。',
        motivation: '在北伐压力与益州民力之间维持平衡。',
        relationToPlayer: '御前议事时观察主角。',
        contactLevel: 10,
        recentAttitude: '审慎评估',
        abilityScores: { 武力: 20, 统率: 45, 智力: 72, 政治: 78, 魅力: 55, 机运: 45 },
        traits: [
          {
            id: 'trait_late_shu_chancellor_official',
            label: '后主近臣',
            description: '熟悉蜀汉后期朝堂运行与后勤调拨。',
            source: 'worldline',
            rarity: 'blue',
          },
        ],
      },
    } as unknown as StatePatch;

    expect(validatePatch(patch, worldBook, [], makeState()).valid).toBe(true);

    const next = ensureLuanShiState(
      applyPatch(makeState(), patch, 1, '觐见', '陈祗在殿中审视主角。'),
    );

    expect(next.npcs.find((npc) => npc.npcId === 'npc_chen_zhi')).toMatchObject({
      name: '陈祗',
      isPresent: true,
      isFocused: true,
      currentIdentity: '蜀汉尚书令',
    });
  });

  it('通过 luanshiCommand 应用缺省特质来源的开局 NPC 档案', () => {
    const patch = {
      type: 'luanshiCommand',
      reason: '创建开局互动副手 NPC',
      payload: {
        command: {
          action: 'upsertNpcProfile',
          npcId: 'npc_chenwu',
          name: '陈伍',
          persistenceReason: 'opening_cast',
          persistenceEvidence: '陈伍是开局已明确追随主角两年的固定副将。',
          sex: '男',
          age: 32,
          role: '副将/亲兵',
          currentIdentity: '襄阳北营军侯',
          locationId: 'place_jingzhou_xiangyang',
          isPresent: true,
          isFocused: true,
          summary: '追随主角两年的荆州老卒，为人忠厚实诚。',
          appearance: '满面风霜，手背上有旧刀疤。',
          personality: '本分、忠诚。',
          motivation: '保住手下弟兄的命和饭碗。',
          relationToPlayer: '忠实下属',
          contactLevel: 3,
          recentAttitude: '信赖且担忧现状',
          abilityScores: { 武力: 65, 统率: 58, 智力: 45, 政治: 30, 魅力: 50, 机运: 40 },
          traits: [
            {
              id: 'trait_veteran_soldier',
              label: '老卒本分',
              rarity: 'white',
              description: '吃苦耐劳，熟悉基层军务。',
            },
          ],
        },
      },
    } as unknown as StatePatch;

    expect(validatePatch(patch, worldBook, [], makeState()).valid).toBe(true);

    const next = ensureLuanShiState(
      applyPatch(makeState(), patch, 1, 'true opening', '陈伍汇报粮饷被克扣。'),
    );

    expect(next.npcs.find((npc) => npc.npcId === 'npc_chenwu')).toMatchObject({
      name: '陈伍',
      currentIdentity: '襄阳北营军侯',
      traits: [{ id: 'trait_veteran_soldier', source: 'writeback' }],
    });
  });

  it('通过 StatePatch 应用 upsertConflictRecord 命令且不直接改动部队', () => {
    const state = ensureLuanShiState({
      ...makeState(),
      troops: [
        {
          troopId: 'troop_north_gate_guard',
          name: '北门守卒',
          size: 300,
          morale: 48,
          training: 35,
          supplies: '两日口粮',
          task: '守住北门退路',
          relationToPlayer: '自势力相关',
        },
      ],
    });
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: '记录本回合战事',
      payload: {
        command: {
          action: 'upsertConflictRecord',
          conflictId: 'battle_north_gate_ambush',
          type: '伏击',
          title: '北门伏击',
          summary: '北门守卒夜间遭西凉军伏击，主角率众突围。',
          occurredAt: '公元189年09月01日 10:00（巳时）',
          outcome: '突围成功，但守卒折损严重。',
          scope: 'selfRelated',
          recordLevel: 'full',
          locationId: 'place_luoyang_north_gate',
          locationName: '洛阳北门',
          sides: ['北门守卒', '西凉军'],
          involvedTroopIds: ['troop_north_gate_guard'],
          involvedFactionIds: ['faction_han_court', 'faction_xiliang_army'],
          result: '突围',
          winnerSide: '北门守卒',
          loserSide: '西凉军伏兵',
          decisiveFactors: ['主角及时识破伏兵', '守卒仍保持阵列'],
          reportText: '北门外火把乱晃，伏兵从暗处压来。主角率守卒稳住退路，折损之后仍冲开缺口，保住了撤离通道。',
          troopEffects: ['troop_north_gate_guard 减员待另行使用 upsertTroopLedger 写回'],
          relatedTrendIds: ['trend_luoyang_storm'],
          updatedAt: '公元189年09月01日 10:00（巳时）',
        },
      },
    };

    expect(validatePatch(patch, worldBook, [], state).valid).toBe(true);

    const next = ensureLuanShiState(
      applyPatch(state, patch, 1, '率守卒突围', '北门伏击战后，守卒冲出缺口。'),
    );

    expect(next.conflicts).toHaveLength(1);
    expect(next.conflicts[0]).toMatchObject({
      conflictId: 'battle_north_gate_ambush',
      type: '伏击',
      scope: 'selfRelated',
      recordLevel: 'full',
      involvedTroopIds: ['troop_north_gate_guard'],
      relatedTrendIds: ['trend_luoyang_storm'],
    });
    expect(next.conflicts[0].reportText).toContain('北门外火把乱晃');
    expect(next.troops.find((troop) => troop.troopId === 'troop_north_gate_guard')?.size).toBe(300);
  });

  it('通过 StatePatch 应用 upsertTroopLedger 更新同一部队生命周期而不复制条目', () => {
    const state = ensureLuanShiState({
      ...makeState(),
      troops: [
        {
          troopId: 'troop_north_gate_guard',
          name: '北门守卒',
          size: 300,
          morale: 48,
          training: 35,
          supplies: '两日口粮',
          task: '守住北门退路',
          relationToPlayer: '自势力相关',
          lifecycleStatus: 'active',
        },
      ],
    });
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: '战后确认部队减员并整编',
      payload: {
        command: {
          action: 'upsertTroopLedger',
          troopId: 'troop_north_gate_guard',
          name: '北门守卒',
          size: 220,
          previousSize: 300,
          morale: 42,
          training: 35,
          supplies: '一日口粮',
          task: '收拢伤卒，等待撤离',
          relationToPlayer: '自势力相关',
          lifecycleStatus: 'routed',
          statusTags: ['减员', '溃散待整编'],
          lastBattleId: 'battle_north_gate_ambush',
          strengthTrend: 'decreased',
          lastChangeReason: '北门伏击后折损严重',
          lastKnownAt: '公元189年09月01日 10:15（巳时）',
          knownLevel: '亲历',
          certainty: 'confirmed',
          updatedAt: '公元189年09月01日 10:15（巳时）',
        },
      },
    };

    expect(validatePatch(patch, worldBook, [], state).valid).toBe(true);

    const next = ensureLuanShiState(
      applyPatch(state, patch, 1, '整编守卒', '北门伏击战后，守卒被收拢整编。'),
    );

    expect(next.troops).toHaveLength(1);
    expect(next.troops[0]).toMatchObject({
      troopId: 'troop_north_gate_guard',
      size: 220,
      previousSize: 300,
      lifecycleStatus: 'routed',
      statusTags: ['减员', '溃散待整编'],
      lastBattleId: 'battle_north_gate_ambush',
      strengthTrend: 'decreased',
    });
  });

  it('同批写回中部队先于势力出现时，最终状态仍保留真实势力归属', () => {
    const state = makeState();
    const patches: StatePatch[] = [
      {
        type: 'luanshiCommand',
        reason: '先记录主角直属部队',
        payload: {
          command: {
            action: 'upsertTroopLedger',
            troopId: 'troop_player_qu',
            name: '主角部曲',
            size: 300,
            morale: 50,
            training: 60,
            supplies: 40,
            task: '城防巡守',
            relationToPlayer: '你直接统领',
            factionId: 'faction_regional_office',
            troopType: '步卒',
            leaderNpcId: 'player',
            quality: '中',
            readiness: '中',
            fatigue: '低',
            lifecycleStatus: 'active',
            knownLevel: '亲历',
            certainty: 'confirmed',
          },
        },
      },
      {
        type: 'luanshiCommand',
        reason: '随后记录部队真实归属势力',
        payload: {
          command: {
            action: 'upsertFactionLedger',
            factionId: 'faction_regional_office',
            name: '地方军府',
            type: '军府',
            summary: '地方军府统辖城防郡兵。',
            stanceToPlayer: '自势力相关',
            knownLevel: '亲历',
            recentActions: ['清点城防郡兵并安排巡守。'],
          },
        },
      },
    ];

    const next = ensureLuanShiState(
      applyPatches(state, patches, 1, '清点麾下士兵', '主角清点麾下士兵并确认归属。'),
    );

    expect(next.factions).toContainEqual(expect.objectContaining({
      factionId: 'faction_regional_office',
      name: '地方军府',
    }));
    expect(next.troops).toContainEqual(expect.objectContaining({
      troopId: 'troop_player_qu',
      factionId: 'faction_regional_office',
      quality: '中',
      readiness: '中',
      fatigue: '低',
      lifecycleStatus: 'active',
    }));
  });

  it('accepts numeric troop supplies from runtime writeback', () => {
    const state = makeState();
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'record troop supplies as a numeric readiness value',
      payload: {
        command: {
          action: 'upsertTroopLedger',
          troopId: 'troop_runtime_numeric_supplies',
          name: 'Runtime Numeric Supplies Troop',
          size: 105,
          morale: 70,
          training: 50,
          supplies: 80,
          task: 'Hold the south market route',
          relationToPlayer: 'owned',
          lifecycleStatus: 'active',
        } as any,
      },
    };

    expect(validatePatch(patch, worldBook, [], state).valid).toBe(true);

    const next = ensureLuanShiState(
      applyPatch(state, patch, 1, 'numeric supplies', 'The troop takes stock of supplies.'),
    );

    expect(next.troops.find((troop) => troop.troopId === 'troop_runtime_numeric_supplies')?.supplies).toBe(80);
  });

  it('normalizes common personal combat writeback aliases before validation and apply', () => {
    const state = makeState();
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'record a drill duel returned by a real model with natural-language aliases',
      payload: {
        command: {
          action: 'upsertCombatRecord',
          combatId: 'combat_yangdi_drill',
          kind: '比武/立威',
          title: '阳翟校场立威',
          summary: '主角在校场与赵虎比试，以刀法压住蛮力，令营中士卒心服。',
          occurredAt: '公元184年03月01日 09:30（巳时）',
          participants: ['主角', '赵虎'],
          playerInvolved: true,
          resultLevel: 'win',
          outcome: '主角胜，赵虎被折服，阳翟南营士气大振。',
          significance: '提振了阳翟南营的士气，确立了主角作为主官的权威。',
          judgement: {
            method: 'combatJudgementV1',
            perspectiveSide: '主角',
            advantageBand: 'win',
            scoreBreakdown: {
              personalBase: 10,
              combatMethod: 15,
              playerAction: 10,
              uniqueArts: 15,
              total: 50,
              notes: '刀法和军中威望压住了赵虎的蛮力。',
            },
          },
        } as any,
      },
    };

    expect(validatePatch(patch, worldBook, [], state).valid).toBe(true);

    const next = ensureLuanShiState(
      applyPatch(state, patch, 2, '前往校场训练比试', '主角在校场下场比试立威。'),
    );

    expect(next.combatRecords).toHaveLength(1);
    expect(next.combatRecords[0]).toMatchObject({
      combatId: 'combat_yangdi_drill',
      kind: 'duel',
      resultLevel: 'win',
      significance: 'major',
      participants: [
        { name: '主角', side: 'player' },
        { name: '赵虎', side: 'neutral' },
      ],
      judgement: {
        method: 'combatJudgementV1',
        advantageBand: 'clearAdvantage',
        scoreBreakdown: {
          total: 50,
          notes: ['刀法和军中威望压住了赵虎的蛮力。'],
        },
      },
    });
  });

  it('normalizes common troop enum aliases from runtime writeback', () => {
    const state = makeState();
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'record troop state with common natural-language level aliases',
      payload: {
        command: {
          action: 'upsertTroopLedger',
          troopId: 'troop_runtime_alias_levels',
          name: 'Runtime Alias Levels Troop',
          size: 108,
          morale: 70,
          training: 50,
          supplies: 80,
          task: 'Hold together after a raid',
          relationToPlayer: 'direct_command',
          quality: '中',
          fatigue: '中等',
          readiness: '中高',
          lifecycleStatus: 'active',
        } as any,
      },
    };

    expect(validatePatch(patch, worldBook, [], state).valid).toBe(true);

    const next = ensureLuanShiState(
      applyPatch(state, patch, 1, 'alias troop levels', 'The troop is recorded with natural language levels.'),
    );

    const troop = next.troops.find((entry) => entry.troopId === 'troop_runtime_alias_levels');
    expect(troop?.fatigue).toBe('中');
    expect(troop?.readiness).toBe('高');
  });

  it('accepts accumulated war judgement totals above single component bounds', () => {
    const state = makeState();
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'record an accumulated war judgement score',
      payload: {
        command: {
          action: 'upsertConflictRecord',
          conflictId: 'conflict_runtime_accumulated_score',
          type: '战争',
          title: 'Runtime Accumulated Score Battle',
          summary: 'A small force wins by timing and local advantage.',
          occurredAt: '189-09-01 12:00',
          outcome: 'The player side wins after a sharp clash.',
          judgement: {
            method: 'warJudgementV1',
            scoreBreakdown: {
              troopBase: 40,
              commander: 70,
              tactical: 50,
              playerAction: 60,
              total: 220,
            },
          },
        } as any,
      },
    };

    expect(validatePatch(patch, worldBook, [], state).valid).toBe(true);

    const next = ensureLuanShiState(
      applyPatch(state, patch, 1, 'accumulated score', 'The battle is recorded.'),
    );

    expect(next.conflicts[0]?.judgement?.scoreBreakdown?.total).toBe(220);
  });

  it('允许同一批 statePatches 先创建女性 NPC 再写入同 npcId 的女性档案', () => {
    const patches: StatePatch[] = [
      {
        type: 'luanshiCommand',
        reason: '创建成年女性 NPC 档案',
        payload: {
          command: {
            action: 'upsertNpcProfile',
            npcId: 'npc_adult_woman',
            name: '某氏',
            persistenceReason: 'recurring_contact',
            persistenceEvidence: '她已与主角约定后续联络并继续寻求庇护。',
            sex: '女',
            age: 33,
            role: '重要女性 NPC',
            currentIdentity: '地方贵族女性',
            locationId: 'loc_market_town',
            isPresent: true,
            isFocused: true,
            identitySummary: '其兄曾任大将军，人物背景牵涉官职与兵权。',
            summary: '成年女性角色，当前处在权力倾轧的压力下。',
            appearance: '衣饰庄重。',
            personality: '谨慎克制。',
            motivation: '保全自身和亲族。',
            relationToPlayer: '危局中的求助者。',
            contactLevel: 1,
            recentAttitude: '试探',
            abilityScores: { 武力: 10, 统率: 20, 智力: 50, 政治: 55, 魅力: 70, 机运: 30 },
            traits: [
              {
                id: 'trait_court_pressure',
                label: '权局余波',
                description: '受时代权力结构牵连。',
                source: 'event',
                rarity: 'white',
              },
            ],
          },
        },
      },
      {
        type: 'luanshiCommand',
        reason: '写入同一 NPC 的女性档案',
        payload: {
          command: {
            action: 'updateNpcFemaleProfile',
            npcId: 'npc_adult_woman',
            npcName: '某氏',
            relationshipNotes: '在危局中对主角保持试探性信任。',
            publicIntimacyNotes: '公开关系仍保持礼节边界。',
            appearanceExtension: '细节描写延续人物身份。',
            emotionalBoundary: '需要确认安全感后才会进一步信任。',
            updatedAt: '乱世元年2月',
            source: '同批建档测试',
            adultPrivateProfile: {
              summary: '成年女性私密档案摘要。',
              preferenceNotes: '偏好可靠且守信的人。',
              boundaryNotes: '边界以安全感与关系承诺为前提。',
              relationshipRiskNotes: '关系风险来自外部权力结构。',
              updatedAt: '乱世元年2月',
              source: '同批建档测试',
            },
          },
        },
      },
    ];

    expect(patches.map((patch) => validatePatch(patch, worldBook, []).valid)).toEqual([true, true]);

    const next = ensureLuanShiState(
      applyPatches(makeState(), patches, 1, '创建女性 NPC', '主角遇见某氏。'),
    );
    const npc = next.npcs.find((item) => item.npcId === 'npc_adult_woman');

    expect(npc?.femaleProfile?.relationshipNotes).toBe('在危局中对主角保持试探性信任。');
    expect(npc?.femaleProfile?.adultPrivateProfile?.summary).toBe('成年女性私密档案摘要。');
  });
  it('accepts heroine thread writeback without lastUpdatedAt and uses current game time', () => {
    const baseState = makeState();
    const npcTemplate = (baseState.npcs ?? [])[0]!;
    const state = {
      ...baseState,
      currentDate: '189-09-01 09:00',
      npcs: [
        ...(baseState.npcs ?? []),
        {
          ...npcTemplate,
          npcId: 'npc_gu_lan',
          name: 'Gu Lan',
          sex: '女' as const,
          age: 28,
        },
      ],
    };
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'real model omitted heroine lastUpdatedAt',
      payload: {
        command: {
          action: 'upsertHeroineThread',
          heroineThreadId: 'heroine_thread_gu_lan',
          npcId: 'npc_gu_lan',
          npcName: 'Gu Lan',
          status: 'active',
          stage: 'early trust',
          relationshipRole: 'trusted confidante',
          summary: 'Gu Lan risks herself to bring military intelligence to the player.',
          recentProgress: 'She delivered a troop movement order and deepened mutual trust.',
          tags: ['secret contact', 'mutual trust'],
        } as any,
      },
    };

    expect(validatePatch(patch, worldBook, [], state).valid).toBe(true);

    const next = ensureLuanShiState(applyPatch(state, patch, 1, 'heroine writeback', 'Gu Lan arrives.'));

    expect(next.heroineThreads.find((entry) => entry.heroineThreadId === 'heroine_thread_gu_lan')?.lastUpdatedAt).toBe(
      '189-09-01 09:00',
    );
  });

  it('accepts bond thread writeback without lastUpdatedAt and uses current game time', () => {
    const state = {
      ...makeState(),
      currentDate: '189-09-01 09:00',
    };
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'real model omitted bond lastUpdatedAt',
      payload: {
        command: {
          action: 'upsertBondThread',
          bondThreadId: 'bond_thread_zhao_wu',
          targetNames: ['Zhao Wu'],
          bondType: 'sworn',
          status: 'active',
          summary: 'The player and veteran Zhao Wu swear brotherhood in a ruined courtyard.',
          recentProgress: 'They share a cup and pledge to survive the crisis together.',
        } as any,
      },
    };

    expect(validatePatch(patch, worldBook, [], state).valid).toBe(true);

    const next = ensureLuanShiState(applyPatch(state, patch, 1, 'bond writeback', 'Zhao Wu raises his cup.'));

    expect(next.bondThreads.find((entry) => entry.bondThreadId === 'bond_thread_zhao_wu')?.lastUpdatedAt).toBe(
      '189-09-01 09:00',
    );
  });
});

describe('applyPatch with canonical resourceChanged contracts', () => {
  it('keeps explicit empty-batch turn logging distinct from rejected patches', () => {
    const state = makeState();

    const next = applyPatches(state, [], 1, 'wait', 'Nothing changes.');

    expect(next).not.toBe(state);
    expect(next.turnLog).toHaveLength(1);
    expect(next.turnLog[0].statePatchSummary).toBe('无状态变更');
    expect(next.lastStatePatch).toBeUndefined();
  });

  it('normalizes numeric strings and applies delta or absolute mode', () => {
    const state = { ...makeState(), playerResources: { supplyCredit: 10 } };
    const next = applyPatches(state, [
      {
        type: 'resourceChanged',
        reason: 'legacy numeric string delta',
        payload: { resource: 'supplyCredit', change: '2.5' },
      },
      {
        type: 'resourceChanged',
        reason: 'explicit absolute value',
        payload: { resource: 'supplyCredit', mode: 'absolute', newValue: '20' },
      },
      {
        type: 'resourceChanged',
        reason: 'explicit delta after absolute value',
        payload: { resource: 'supplyCredit', mode: 'delta', change: -3 },
      },
    ], 1, 'update grain', 'The grain ledger changes.');

    expect(next.playerResources.supplyCredit).toBe(17);
    expect(next.lastStatePatch?.payload).toMatchObject({
      resource: 'supplyCredit',
      mode: 'delta',
      change: -3,
    });
    expect(next.turnLog[next.turnLog.length - 1]?.statePatchSummary)
      .toContain('playerResources.supplyCredit-=3');
  });

  it('returns the original state when a finite delta overflows the resource result', () => {
    const state = { ...makeState(), playerResources: { supplyCredit: Number.MAX_VALUE } };

    const next = applyPatches(state, [{
      type: 'resourceChanged',
      reason: 'overflow grain delta',
      payload: { resource: 'supplyCredit', mode: 'delta', change: Number.MAX_VALUE },
    }], 1, 'overflow update', 'No change applies.');

    expect(next).toBe(state);
    expect(next.playerResources.supplyCredit).toBe(Number.MAX_VALUE);
    expect(next.turnLog).toEqual([]);
    expect(next.lastStatePatch).toBeUndefined();
  });

  it('rejects a mixed direct batch atomically when a later resource delta overflows', () => {
    const state = {
      ...makeState(),
      playerResources: { supplyCredit: Number.MAX_VALUE },
      localSituationNotes: ['existing note'],
    };

    const next = applyPatches(state, [
      {
        type: 'localSituationChanged',
        reason: 'legal note before overflow',
        payload: { notes: ['must not be committed'] },
      },
      {
        type: 'resourceChanged',
        reason: 'overflow grain delta',
        payload: { resource: 'supplyCredit', mode: 'delta', change: Number.MAX_VALUE },
      },
    ], 1, 'mixed overflow', 'No change applies.');

    expect(next).toBe(state);
    expect(next.localSituationNotes).toEqual(['existing note']);
    expect(next.playerResources.supplyCredit).toBe(Number.MAX_VALUE);
    expect(next.turnLog).toEqual([]);
    expect(next.lastStatePatch).toBeUndefined();
  });

  it('checks each ordered delta result and rejects the batch when an intermediate draft overflows', () => {
    const halfMax = Number.MAX_VALUE / 2;
    const state = { ...makeState(), playerResources: { supplyCredit: halfMax } };

    const next = applyPatches(state, [
      {
        type: 'resourceChanged',
        reason: 'first finite grain delta',
        payload: { resource: 'supplyCredit', mode: 'delta', change: halfMax },
      },
      {
        type: 'resourceChanged',
        reason: 'second overflowing grain delta',
        payload: { resource: 'supplyCredit', mode: 'delta', change: Number.MAX_VALUE },
      },
    ], 1, 'ordered overflow', 'No change applies.');

    expect(next).toBe(state);
    expect(next.playerResources.supplyCredit).toBe(halfMax);
    expect(next.turnLog).toEqual([]);
    expect(next.lastStatePatch).toBeUndefined();
  });

  it('keeps finite absolute values and applies multiple same-resource deltas in order', () => {
    const state = { ...makeState(), playerResources: { supplyCredit: 1 } };

    const next = applyPatches(state, [
      {
        type: 'resourceChanged',
        reason: 'finite absolute maximum',
        payload: { resource: 'supplyCredit', mode: 'absolute', newValue: Number.MAX_VALUE },
      },
      {
        type: 'resourceChanged',
        reason: 'subtract the finite maximum',
        payload: { resource: 'supplyCredit', mode: 'delta', change: -Number.MAX_VALUE },
      },
      {
        type: 'resourceChanged',
        reason: 'add a final finite unit',
        payload: { resource: 'supplyCredit', mode: 'delta', change: 1 },
      },
    ], 1, 'finite ordered updates', 'The finite updates apply.');

    expect(next.playerResources.supplyCredit).toBe(1);
    expect(next.turnLog).toHaveLength(1);
    expect(next.lastStatePatch?.reason).toBe('add a final finite unit');
  });

  it.each([
    { resource: 'supplyCredit', mode: 'delta', change: Number.NaN },
    { resource: 'supplyCredit', mode: 'absolute', newValue: Number.POSITIVE_INFINITY },
    { resource: 'supplyCredit', change: 1, newValue: 2 },
    { resource: 'supplyCredit', mode: 'delta', change: '1kg' },
  ])('does not apply a resource payload rejected by the shared contract %#', (payload) => {
    const state = { ...makeState(), playerResources: { supplyCredit: 10 } };
    const next = applyPatch(state, {
      type: 'resourceChanged',
      reason: 'invalid resource payload',
      payload,
    }, 1, 'invalid update', 'Nothing changes.');

    expect(next.playerResources.supplyCredit).toBe(10);
    expect(next.lastStatePatch).toBeUndefined();
    expect(next.turnLog).toEqual([]);
  });

  it('does not record or mutate a direct resource patch with a null payload', () => {
    const state = { ...makeState(), playerResources: { supplyCredit: 10 } };
    const patch = {
      type: 'resourceChanged',
      reason: 'null resource payload',
      payload: null,
    } as unknown as StatePatch;

    const next = applyPatch(state, patch, 1, 'invalid update', 'Nothing changes.');

    expect(next).toEqual(state);
    expect(next.lastStatePatch).toBeUndefined();
    expect(next.turnLog).toEqual([]);
  });

  it('rejects an entire direct batch when one resource patch fails the shared contract', () => {
    const state = { ...makeState(), playerResources: { supplyCredit: 10 } };
    const next = applyPatches(state, [
      {
        type: 'resourceChanged',
        reason: 'valid grain delta',
        payload: { resource: 'supplyCredit', change: '2' },
      },
      {
        type: 'resourceChanged',
        reason: 'invalid unit-bearing delta',
        payload: { resource: 'supplyCredit', mode: 'delta', change: '1kg' },
      },
    ], 1, 'mixed update', 'No change applies.');

    expect(next).toBe(state);
    expect(next.playerResources.supplyCredit).toBe(10);
    expect(next.turnLog).toEqual([]);
    expect(next.lastStatePatch).toBeUndefined();
  });
});

describe('applyPatches with normalized timeAdvance uniqueness', () => {
  const directTimeAdvance: StatePatch = {
    type: 'timeAdvance',
    reason: 'direct time advance',
    payload: { minutesAdvanced: 10 },
  };
  const misnestedTimeAdvance = (reason: string): StatePatch => ({
    type: 'luanshiCommand',
    reason,
    payload: {
      command: {
        action: 'timeAdvance',
        minutesAdvanced: 5,
      },
    },
  });

  it.each([
    ['direct plus misnested', [directTimeAdvance, misnestedTimeAdvance('misnested duplicate')]],
    ['two misnested', [misnestedTimeAdvance('first misnested'), misnestedTimeAdvance('second misnested')]],
  ] as const)('rejects %s atomically without metadata pollution', (_label, patches) => {
    const previousPatch: StatePatch = {
      type: 'localSituationChanged',
      reason: 'previous patch',
      payload: { notes: ['existing note'] },
    };
    const previousTurnLog: RuntimeState['turnLog'] = [{
      turnNumber: 1,
      date: '公元189年09月01日 08:00（辰时）',
      playerInput: 'previous input',
      narrativeText: 'Previous narrative.',
      fullNarrativeText: 'Previous narrative.',
      statePatchSummary: 'localSituationChanged: previous patch',
      timestamp: '2026-01-01T00:00:00.000Z',
    }];
    const state: RuntimeState = {
      ...makeState(),
      currentDate: '公元189年09月01日 08:00（辰时）',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      lastStatePatch: previousPatch,
      turnLog: previousTurnLog,
    };

    const next = applyPatches(state, [...patches], 2, 'wait', 'Time must not advance.');

    expect(next).toBe(state);
    expect(next.currentDate).toBe('公元189年09月01日 08:00（辰时）');
    expect(next.currentTime).toEqual({ year: 189, month: 9, day: 1, hour: 8, minute: 0 });
    expect(next.turnLog).toBe(previousTurnLog);
    expect(next.lastStatePatch).toBe(previousPatch);
  });

  it('keeps one misnested timeAdvance compatible and records its canonical form', () => {
    const state: RuntimeState = {
      ...makeState(),
      currentDate: '公元189年09月01日 08:00（辰时）',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
    };

    const next = applyPatches(
      state,
      [misnestedTimeAdvance('single compatible time advance')],
      1,
      'wait',
      'Five minutes pass.',
    );

    expect(next.currentDate).toBe('公元189年09月01日 08:05（辰时）');
    expect(next.lastStatePatch).toMatchObject({
      type: 'timeAdvance',
      reason: 'single compatible time advance',
      payload: { minutesAdvanced: 5 },
    });
  });
});

describe('applyPatch with canonical relationshipChange contracts', () => {
  it('applies one narrow NPC relationship update and rejects duplicate updates for the same NPC atomically', () => {
    const patch = {
      type: 'luanshiCommand',
      reason: '共同脱离伏击，往来加深',
      payload: {
        command: {
          action: 'updateNpcRelationship',
          npcId: 'npc_chen_heng',
          contactDelta: 6,
          relationToPlayer: '共同经历险境的可靠同伴。',
          recentAttitude: '信任',
          summary: '共同脱离伏击并交换了重要情报。',
        },
      },
    } as StatePatch;

    const next = applyPatches(makeState(), [patch], 1, '并肩突围', '两人共同脱离伏击。');
    expect(next.npcs?.find((npc) => npc.npcId === 'npc_chen_heng')).toMatchObject({
      contactLevel: 16,
      relationToPlayer: '共同经历险境的可靠同伴。',
      recentAttitude: '信任',
    });

    const duplicated = applyPatches(makeState(), [
      patch,
      {
        ...patch,
        reason: '重复写回同一次互动',
        payload: {
          command: {
            ...(patch.payload.command as Record<string, unknown>),
            contactDelta: 4,
          },
        },
      },
    ], 1, '并肩突围', '两人共同脱离伏击。');
    expect(duplicated).toEqual(makeState());
  });

  it('writes actor and faction targets with kind-aware identity', () => {
    const patches: StatePatch[] = [
      {
        type: 'relationshipChange',
        reason: 'actor relationship',
        payload: {
          actorId: 'actor_source',
          targetId: 'shared_target',
          targetKind: 'actor',
          value: '10',
        },
      },
      {
        type: 'relationshipChange',
        reason: 'faction relationship',
        payload: {
          actorId: 'actor_source',
          targetId: 'shared_target',
          targetKind: 'faction',
          targetType: 'faction',
          value: 20,
        },
      },
      {
        type: 'relationshipChange',
        reason: 'update actor relationship only',
        payload: {
          actorId: 'actor_source',
          targetId: 'shared_target',
          targetKind: 'actor',
          value: 30,
        },
      },
    ];

    const next = applyPatches(makeState(), patches, 1, 'update relationships', 'Relationships change.');

    expect(next.relationships).toHaveLength(2);
    expect(next.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorId: 'actor_source',
        targetId: 'shared_target',
        targetKind: 'actor',
        targetType: 'actor',
        value: 30,
      }),
      expect.objectContaining({
        actorId: 'actor_source',
        targetId: 'shared_target',
        targetKind: 'faction',
        targetType: 'faction',
        value: 20,
      }),
    ]));
  });

  it('updates a legacy targetType-only relationship without creating a duplicate', () => {
    const state: RuntimeState = {
      ...makeState(),
      relationships: [{
        id: 'relationship_legacy_faction',
        actorId: 'actor_source',
        targetId: 'faction_target',
        targetType: 'faction',
        type: 'neutral',
        value: 5,
        description: 'Legacy relationship record.',
      } as RuntimeState['relationships'][number]],
    };

    const next = applyPatch(state, {
      type: 'relationshipChange',
      reason: 'canonical faction relationship update',
      payload: {
        actorId: 'actor_source',
        targetId: 'faction_target',
        targetKind: 'faction',
        value: 35,
        description: 'Canonical relationship update.',
      },
    }, 1, 'update relation', 'The faction relationship changes.');

    expect(next.relationships).toHaveLength(1);
    expect(next.relationships[0]).toMatchObject({
      id: 'relationship_legacy_faction',
      actorId: 'actor_source',
      targetId: 'faction_target',
      targetKind: 'faction',
      targetType: 'faction',
      value: 35,
      description: 'Canonical relationship update.',
    });
  });

  it('rejects a mixed direct batch with targetType-only and preserves all metadata', () => {
    const previousPatch: StatePatch = {
      type: 'localSituationChanged',
      reason: 'previous state patch',
      payload: { notes: ['existing note'] },
    };
    const previousTurnLog: RuntimeState['turnLog'] = [{
      turnNumber: 1,
      date: '乱世元年2月',
      playerInput: 'previous input',
      narrativeText: 'Previous narrative.',
      fullNarrativeText: 'Previous narrative.',
      statePatchSummary: 'localSituationChanged: previous state patch',
      timestamp: '2026-01-01T00:00:00.000Z',
    }];
    const state: RuntimeState = {
      ...makeState(),
      localSituationNotes: ['existing note'],
      lastStatePatch: previousPatch,
      turnLog: previousTurnLog,
    };

    const next = applyPatches(state, [
      {
        type: 'localSituationChanged',
        reason: 'new legal note',
        payload: { notes: ['must not be applied'] },
      },
      {
        type: 'relationshipChange',
        reason: 'targetType-only new relationship',
        payload: {
          actorId: 'actor_source',
          targetId: 'faction_target',
          targetType: 'faction',
          value: 25,
        },
      },
    ], 2, 'invalid relationship batch', 'No patch is committed.');

    expect(next).toBe(state);
    expect(next.relationships).toEqual([]);
    expect(next.localSituationNotes).toEqual(['existing note']);
    expect(next.turnLog).toBe(previousTurnLog);
    expect(next.lastStatePatch).toBe(previousPatch);
  });

  it('rejects the whole direct batch when factionId lacks explicit targetId and target kind', () => {
    const previousPatch: StatePatch = {
      type: 'localSituationChanged',
      reason: 'previous state patch',
      payload: { notes: ['existing note'] },
    };
    const state: RuntimeState = {
      ...makeState(),
      localSituationNotes: ['existing note'],
      lastStatePatch: previousPatch,
      turnLog: [{
        turnNumber: 1,
        date: '乱世元年2月',
        playerInput: 'previous input',
        narrativeText: 'Previous narrative.',
        fullNarrativeText: 'Previous narrative.',
        statePatchSummary: 'localSituationChanged: previous state patch',
        timestamp: '2026-01-01T00:00:00.000Z',
      }],
    };
    const next = applyPatches(state, [
      {
        type: 'localSituationChanged',
        reason: 'new legal note',
        payload: { notes: ['must not be applied'] },
      },
      {
        type: 'relationshipChange',
        reason: 'incomplete legacy faction target',
        payload: {
          actorId: 'actor_source',
          factionId: 'faction_target',
          value: '-25',
        },
      },
    ], 2, 'invalid faction relation', 'No patch is committed.');

    expect(next).toBe(state);
    expect(next.relationships).toEqual([]);
    expect(next.localSituationNotes).toEqual(['existing note']);
    expect(next.turnLog).toHaveLength(1);
    expect(next.turnLog[0].statePatchSummary).toBe('localSituationChanged: previous state patch');
    expect(next.lastStatePatch).toBe(previousPatch);
  });

  it('does not create an undefined relationship from factionId without source actorId', () => {
    const next = applyPatch(makeState(), {
      type: 'relationshipChange',
      reason: 'missing source actor',
      payload: {
        factionId: 'faction_target',
        value: 10,
      },
    }, 1, 'invalid relation', 'Nothing changes.');

    expect(next.relationships).toEqual([]);
  });
});

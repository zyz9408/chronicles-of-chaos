import { describe, expect, it } from 'vitest';
import { parseNarratorResponse } from './NarratorResponseParser';

function makeNpcProfileSuggestion(loadout: Record<string, unknown>): Record<string, unknown> {
  return {
    npcId: 'npc_loadout_protocol',
    name: '行装校尉',
    persistenceReason: 'active_system_role',
    persistenceEvidence: '本回合已确认其长期负责守门与验符。',
    sex: '男',
    age: 31,
    role: '校尉',
    locationId: 'place_test_gate',
    isPresent: true,
    isFocused: true,
    currentIdentity: '守门校尉',
    summary: '负责守门与验符。',
    appearance: '披甲佩刀。',
    personality: '谨慎。',
    motivation: '守住城门。',
    relationToPlayer: '初见。',
    contactLevel: 5,
    recentAttitude: '戒备',
    abilityScores: { 武力: 60, 统率: 55, 智力: 45, 政治: 35, 魅力: 40, 机运: 50 },
    traits: [{ id: 'trait_guard', label: '守门有责', description: '熟悉守门规程。', source: 'identity' }],
    ...loadout,
  };
}

describe('parseNarratorResponse', () => {
  it('normalizes abbreviated correspondence replies against the stable local letter ledger', () => {
    const result = parseNarratorResponse(JSON.stringify({
      narrativeText: '驿卒带回蔡琰亲笔回信，她答应按期送粮。',
      suggestedActions: [],
      writeback: {
        turnSummary: {
          correspondenceActions: [{
            action: 'reply',
            sourceLetterId: 'letter_player_request_grain',
            letterId: 'letter_caiyan_reply_grain_1',
            npcId: 'npc_caiyan',
            deliveryState: 'received',
            body: '答应调拨二百石粮草，并于三月初四午时前送到汉水北岸大营。',
            commitments: [{
              targetLocationId: 'place_a',
              expectedAt: '公元184年03月04日 12:00',
              deliverables: { resources: { grain: 200 } },
            }],
          }],
        },
      },
    }), {
      correspondenceSources: [{
        letterId: 'letter_player_request_grain',
        direction: 'outgoing',
        npcId: 'npc_caiyan',
      }],
    });

    expect(result.writeback?.turnSummary).toMatchObject({
      brief: '答应调拨二百石粮草，并于三月初四午时前送到汉水北岸大营。',
      correspondenceActions: [{
        sourceRefId: 'correspondence:reply:letter_player_request_grain',
        action: 'reply',
        direction: 'npc_to_player',
        deliveryState: 'received',
        senderNpcId: 'npc_caiyan',
        commitments: [{
          commitmentId: 'correspondence:reply:letter_player_request_grain:commitment:1',
          targetLocationId: 'place_a',
          deliverables: [{ kind: 'resources', resources: { grain: 200 } }],
        }],
      }],
    });
  });

  it('keeps old correspondence outputs safely in transit when deliveryState is omitted', () => {
    const result = parseNarratorResponse(JSON.stringify({
      narrativeText: '蔡琰已将复书交给驿使。',
      suggestedActions: [],
      writeback: {
        turnSummary: {
          correspondenceActions: [{
            action: 'send',
            sourceRefId: 'letter_caiyan_sent_1',
            letterId: 'letter_caiyan_sent_1',
            direction: 'npc_to_player',
            senderNpcId: 'npc_caiyan',
            body: '近来安好，勿念。',
          }],
        },
      },
    }));

    expect(result.writeback?.turnSummary?.correspondenceActions?.[0]).toMatchObject({
      deliveryState: 'sent',
    });
  });

  it('does not guess an abbreviated correspondence reply without a matching ledger letter', () => {
    const result = parseNarratorResponse(JSON.stringify({
      narrativeText: '有人声称已经回信。',
      suggestedActions: [],
      writeback: {
        turnSummary: {
          correspondenceActions: [{
            action: 'reply',
            sourceLetterId: 'letter_unknown',
            letterId: 'letter_unknown_reply',
            npcId: 'npc_unknown',
            body: '含混的回信。',
          }],
        },
      },
    }));

    expect(result.writeback?.turnSummary).toBeNull();
  });

  it('keeps a concise source-letter summary for NPC memory without exposing the stable letter id', () => {
    const parsed = parseNarratorResponse(JSON.stringify({
      narrativeText: '蔡琰读罢来信，决定稍后作答。',
      suggestedActions: [],
      writeback: {
        turnSummary: {
          brief: '蔡琰收到了林砚的问候。',
          correspondenceActions: [{
            action: 'acknowledge',
            sourceLetterId: 'letter_player_greeting',
            sourceLetterSummary: '林砚来信问候近况，并询问何时方便相见',
          }],
        },
      },
    }), {
      correspondenceSources: [{
        letterId: 'letter_player_greeting',
        direction: 'outgoing',
        npcId: 'npc_caiyan',
      }],
    });

    expect(parsed.writeback?.turnSummary?.correspondenceActions?.[0]).toMatchObject({
      action: 'acknowledge',
      sourceLetterId: 'letter_player_greeting',
      sourceLetterSummary: '林砚来信问候近况，并询问何时方便相见',
    });
  });

  it('normalizes an id-bound commitment resolution alias without reading narrative prose', () => {
    const result = parseNarratorResponse(JSON.stringify({
      narrativeText: '粮车已到。',
      suggestedActions: [],
      writeback: {
        turnSummary: {
          commitmentResolutions: [{
            commitmentId: 'commit_caiyan_grain_200',
            resolution: 'fulfilled',
            summary: '蔡琰如约送来二百石粮草。',
          }],
        },
      },
    }));

    expect(result.writeback?.turnSummary).toMatchObject({
      brief: '蔡琰如约送来二百石粮草。',
      commitmentResolutions: [{
        sourceRefId: 'commitment-resolution:commit_caiyan_grain_200:fulfilled',
        commitmentId: 'commit_caiyan_grain_200',
        status: 'fulfilled',
      }],
    });
  });

  it('requires a future continuation date for partial or delayed correspondence commitments', () => {
    const parseResolution = (
      status: 'partial' | 'delayed',
      nextExpectedAt?: string,
      includeDelivery = false,
    ) => (
      parseNarratorResponse(JSON.stringify({
        narrativeText: '使者说明尚有余数未到。',
        suggestedActions: [],
        writeback: {
          turnSummary: {
            brief: '承诺仅完成一部分。',
            commitmentResolutions: [{
              sourceRefId: `resolution_${status}`,
              commitmentId: 'commitment_1',
              status,
              summary: '先行送到一部分。',
              ...(nextExpectedAt ? { nextExpectedAt } : {}),
              ...(includeDelivery
                ? { deliveredDeliverables: [{ kind: 'resources', resources: { grain: 100 } }] }
                : {}),
            }],
          },
        },
      })).writeback?.turnSummary?.commitmentResolutions ?? []
    );

    expect(parseResolution('partial')).toEqual([]);
    expect(parseResolution('delayed')).toEqual([]);
    expect(parseResolution('partial', '公元184年03月04日 08:00（辰时）')).toEqual([]);
    expect(parseResolution('partial', '公元184年03月04日 08:00（辰时）', true)).toHaveLength(1);
    expect(parseResolution('delayed', '公元184年03月04日 08:00（辰时）')).toHaveLength(1);
  });

  it('parses JSON responses even when the model wraps them in markdown fences', () => {
    const result = parseNarratorResponse(`
\`\`\`json
{
  "narrativeText": "你听见城外鼓噪声渐近。",
  "suggestedActions": [
    { "label": "登城查看", "description": "看看城外发生了什么", "actionType": "explore" }
  ],
  "statePatch": {
    "type": "localSituationChanged",
    "payload": { "notes": ["城外出现骚动"] },
    "reason": "玩家察觉城外变化"
  }
}
\`\`\`
`);

    expect(result.narrativeText).toContain('城外鼓噪');
    expect(result.suggestedActions[0]).toMatchObject({ label: '登城查看', actionType: 'explore' });
    expect(result.statePatch).toMatchObject({ type: 'localSituationChanged' });
  });

  it('parses multiple state patches so time can advance alongside other writes', () => {
    const result = parseNarratorResponse(JSON.stringify({
      narrativeText: '你与门吏交谈片刻，得知城中戒严。',
      suggestedActions: [],
      statePatches: [
        {
          type: 'timeAdvance',
          payload: { minutesAdvanced: 30, reason: '交谈与等待', category: 'conversation' },
          reason: '本回合经过半个时辰',
        },
        {
          type: 'localSituationChanged',
          payload: { notes: ['城门戒严，外来者盘查更严'] },
          reason: '玩家得知城门形势',
        },
      ],
    }));

    expect(result.statePatches).toHaveLength(2);
    expect(result.statePatches?.[0]).toMatchObject({ type: 'timeAdvance' });
    expect(result.statePatches?.[1]).toMatchObject({ type: 'localSituationChanged' });
  });

  it('parses ordinary check cards for non-combat uncertainty', () => {
    const result = parseNarratorResponse(JSON.stringify({
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: '你在门吏换班前看出一丝破绽。',
      suggestedActions: [],
      ordinaryChecks: [
        {
          checkId: 'check_gate_probe',
          label: '察言观色',
          target: '门吏',
          ability: '智力',
          difficulty: 16,
          total: 23,
          result: '成功',
          summary: '以智力和谨慎特质判断门吏避重就轻。',
          details: [
            { label: '基础', value: 14, text: '智力' },
            { label: '特质', value: 5, text: '谨慎敏锐' },
            { label: '环境', value: 4, text: '换班混乱' },
          ],
          tags: ['日常', '试探'],
        },
      ],
    }));

    expect(result.ordinaryChecks).toHaveLength(1);
    expect(result.ordinaryChecks?.[0]).toMatchObject({
      checkId: 'check_gate_probe',
      label: '察言观色',
      ability: '智力',
      difficulty: 16,
      total: 23,
      result: '成功',
    });
    expect(result.ordinaryChecks?.[0].details?.[1]).toMatchObject({
      label: '特质',
      value: 5,
      text: '谨慎敏锐',
    });
  });

  it('parses the generic V1 writeback protocol without applying it as state', () => {
    const result = parseNarratorResponse(JSON.stringify({
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: '你记下门吏的神色，知道此事会被人传开。',
      suggestedActions: [],
      statePatches: [
        {
          type: 'timeAdvance',
          payload: { minutesAdvanced: 15, reason: '盘问门吏', category: 'conversation' },
          reason: '交谈耗时',
        },
      ],
      writeback: {
        playerRecoveryKind: 'none',
        turnSummary: {
          brief: '主角在城门处确认戒严消息。',
          playerActionSummary: '盘问门吏。',
          visibleConsequence: '城门守军对外来者更警惕。',
          memoryImportance: 'medium',
          privateAssetAcquisitions: [
            {
              sourceRefId: 'asset-acquisition-turn-1-manor',
              privateAssetId: 'asset_lin_fort',
              assetName: '林氏坞堡',
              kind: 'transfer',
              type: 'estate',
              ownerScope: 'personal',
              status: 'active',
              locationId: 'place_test_gate',
              mu: 80,
              households: 12,
              summary: '原主当面交付契书，产权正式归入主角名下。',
            },
            {
              sourceRefId: '',
              assetName: '无效产业',
              kind: 'claim',
              summary: '只是单方面声称。',
            },
          ],
          identityChanges: [
            {
              sourceRefId: 'identity-turn-1-gate-captain',
              characterType: 'player',
              characterId: 'player',
              currentIdentity: '城门军侯',
              currentIdentityDescription: '经正式任命负责城门轮值与盘查。',
              identitySummary: '主角已经正式就任城门军侯。',
              militaryTitle: '军侯',
              personalEscortEntitlement: {
                status: 'customary',
                bases: ['military_command'],
              },
              summary: '任命文书已宣读并由主角当场接任。',
            },
          ],
          npcAdmissions: [
            {
              sourceRefId: 'npc-admission-turn-1-xuchu',
              npcId: 'npc_xuchu',
              name: '许褚',
              persistenceReason: 'historical_figure',
              persistenceEvidence: '许褚已经接受主角招募并约定长期同行。',
              summary: '历史人物许褚正式进入主角长期关系网。',
            },
            {
              sourceRefId: '',
              npcId: 'npc_invalid',
              name: '无效人物',
              persistenceReason: 'named_once',
              persistenceEvidence: '',
              summary: '',
            },
          ],
          relationshipAdmissions: [
            {
              sourceRefId: 'relationship-turn-1-caocao',
              relationshipKind: 'bond',
              targetNpcIds: ['npc_gate_guard'],
              targetNames: ['门吏'],
              bondType: 'ally',
              summary: '双方约定长期互通城门消息。',
            },
            {
              sourceRefId: '',
              relationshipKind: 'bond',
              targetNames: [],
              bondType: 'unknown',
              summary: '',
            },
          ],
        },
        protagonistMemory: {
          recentTurnSummary: '主角盘问门吏，确认城中戒严。',
          keyDeed: {
            summary: '在城门处问出戒严消息。',
            impact: '可能影响城门守军对主角的警惕。',
          },
        },
        npcMemorySuggestions: [
          {
            npcId: 'npc_gate_guard',
            npcName: '守门军士',
            source: '亲历',
            content: '主角追问城中戒严缘由。',
            eventId: 'evt_gate_question',
          },
        ],
        factionRecentActionSuggestions: [
          {
            factionId: 'faction_gate_command',
            summary: '城门守军开始加倍盘查',
            knownLevel: '亲历',
            observedAt: '公元184年03月08日 08:15（辰时）',
            sourceNote: '主角当面所见',
          },
        ],
        locationWriteSuggestions: [
          {
            name: '城门岗亭',
            kind: '场景',
            parentPath: '测试州 / 测试郡 / 测试县城',
            summary: '守军盘查出入者的岗亭。',
            permanence: 'permanent',
          },
        ],
        questChanges: [
          {
            action: 'complete',
            questId: 'quest_opening_thread',
            title: '乱世之始',
            summary: '城门戒严成为新的调查方向。',
            experienceReward: 120,
          },
        ],
        plotPlanSuggestions: [
          {
            action: 'update',
            plotId: 'plot_opening_pressure',
            title: '城门戒严',
            horizon: '近期',
            priority: '中',
            status: '进行中',
            summary: '城门戒严可作为近期开局压力继续推进。',
          },
        ],
        worldEventSummary: {
          summary: '城门盘查趋严，外来者更难入城。',
          visibility: '在场可知',
          locationId: 'loc_gate',
          presentNpcIds: ['npc_gate_guard'],
        },
      },
    }));

    expect(result.protocolVersion).toBe('lsfy.turn.v1');
    expect(result.writeback?.turnSummary).toMatchObject({
      brief: '主角在城门处确认戒严消息。',
      memoryImportance: 'medium',
    });
    expect(result.writeback?.turnSummary?.privateAssetAcquisitions).toEqual([
      {
        sourceRefId: 'asset-acquisition-turn-1-manor',
        privateAssetId: 'asset_lin_fort',
        assetName: '林氏坞堡',
        kind: 'transfer',
        type: 'estate',
        ownerScope: 'personal',
        status: 'active',
        locationId: 'place_test_gate',
        mu: 80,
        households: 12,
        summary: '原主当面交付契书，产权正式归入主角名下。',
      },
    ]);
    expect(result.writeback?.turnSummary?.identityChanges).toEqual([
      {
        sourceRefId: 'identity-turn-1-gate-captain',
        characterType: 'player',
        characterId: 'player',
        currentIdentity: '城门军侯',
        currentIdentityDescription: '经正式任命负责城门轮值与盘查。',
        identitySummary: '主角已经正式就任城门军侯。',
        militaryTitle: '军侯',
        personalEscortEntitlement: {
          status: 'customary',
          bases: ['military_command'],
        },
        summary: '任命文书已宣读并由主角当场接任。',
      },
    ]);
    expect(result.writeback?.turnSummary?.npcAdmissions).toEqual([{
      sourceRefId: 'npc-admission-turn-1-xuchu',
      npcId: 'npc_xuchu',
      name: '许褚',
      persistenceReason: 'historical_figure',
      persistenceEvidence: '许褚已经接受主角招募并约定长期同行。',
      summary: '历史人物许褚正式进入主角长期关系网。',
    }]);
    expect(result.writeback?.turnSummary?.relationshipAdmissions).toEqual([{
      sourceRefId: 'relationship-turn-1-caocao',
      relationshipKind: 'bond',
      targetNpcIds: ['npc_gate_guard'],
      targetNames: ['门吏'],
      bondType: 'ally',
      summary: '双方约定长期互通城门消息。',
    }]);
    expect(result.writeback?.protagonistMemory?.recentTurnSummary).toBe('主角盘问门吏，确认城中戒严。');
    expect(result.writeback?.npcMemorySuggestions[0]).toMatchObject({
      npcId: 'npc_gate_guard',
      source: '亲历',
    });
    expect(result.writeback?.factionRecentActionSuggestions?.[0]).toMatchObject({
      factionId: 'faction_gate_command',
      summary: '城门守军开始加倍盘查',
      knownLevel: '亲历',
      sourceNote: '主角当面所见',
    });
    expect(result.writeback?.locationWriteSuggestions[0]).toMatchObject({
      name: '城门岗亭',
      permanence: 'permanent',
    });
    expect(result.writeback?.questChanges[0]).toMatchObject({
      action: 'complete',
      questId: 'quest_opening_thread',
      experienceReward: 120,
    });
    expect(result.writeback?.plotPlanSuggestions?.[0]).toMatchObject({
      action: 'update',
      plotId: 'plot_opening_pressure',
      horizon: '近期',
    });
    expect(result.writeback?.worldEventSummary?.visibility).toBe('在场可知');
    expect(result.writeback?.playerRecoveryKind).toBe('none');
    expect(result.statePatches).toHaveLength(1);
  });

  it.each([
    ['none', 'none'],
    ['rest', 'rest'],
    ['treatment', 'treatment'],
  ] as const)('parses the closed player recovery kind %s', (value, expected) => {
    const result = parseNarratorResponse(JSON.stringify({
      narrativeText: '本回合正文。',
      suggestedActions: [],
      writeback: {
        playerRecoveryKind: value,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        debugNotes: [],
      },
    }));

    expect(result.writeback?.playerRecoveryKind).toBe(expected);
  });

  it.each([
    undefined,
    null,
    'sleep',
    true,
    1,
    { kind: 'rest' },
  ])('does not coerce invalid player recovery semantics: %j', (value) => {
    const writeback: Record<string, unknown> = {
      npcMemorySuggestions: [],
      locationWriteSuggestions: [],
      routeWriteSuggestions: [],
      questChanges: [],
      debugNotes: [],
    };
    if (value !== undefined) writeback.playerRecoveryKind = value;
    const result = parseNarratorResponse(JSON.stringify({
      narrativeText: '本回合正文。',
      suggestedActions: [],
      writeback,
    }));

    expect(result.writeback?.playerRecoveryKind).toBeUndefined();
  });

  it('normalizes only unambiguous force aliases in unique-art targetMode', () => {
    const result = parseNarratorResponse(JSON.stringify({
      narrativeText: '赵云领副将之职，率军突击敌阵。',
      suggestedActions: [],
      writeback: {
        semanticProjections: [{
          projectionVersion: 1,
          profileKind: 'ability',
          sourceId: 'art_zhao_yun_dragon_formation',
          status: 'executable',
          rulesetScopes: ['war'],
          effects: [{
            trigger: 'before_attack',
            condition: 'always',
            operation: 'modify_accuracy',
            target: 'all_allies',
            value: 5,
            priority: 20,
          }],
          sourceType: 'unique_art',
          activation: 'active',
          targetMode: 'enemy_force',
          purpose: 'control',
          powerClass: 'heavy',
          powerMultiplier: 1.65,
          staminaCost: 22,
          accuracyModifier: 5,
          maxHits: 1,
          perEncounterLimit: 1,
          blockable: true,
          armorPiercing: false,
          canCrit: false,
          allowAutoUse: true,
        }],
        debugNotes: [],
      },
    }));

    expect(result.writeback?.semanticProjections).toEqual([
      expect.objectContaining({
        sourceId: 'art_zhao_yun_dragon_formation',
        targetMode: 'all_enemies',
        allowAutoUse: false,
      }),
    ]);
    expect(result.writeback?.debugNotes).toContain(
      'Encounter V2 能力投影 art_zhao_yun_dragon_formation 已将 targetMode 结构别名 enemy_force 规范化为 all_enemies。 Encounter V2 能力投影 art_zhao_yun_dragon_formation 已将 heavy 绝艺的冲突字段 allowAutoUse 规范化为 false。',
    );
  });

  it('parses structured protagonist profile writeback separately from protagonist memory', () => {
    const result = parseNarratorResponse(JSON.stringify({
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: '开局身份被具体化。',
      suggestedActions: [],
      writeback: {
        protagonistProfile: {
          birthOrigin: '汉室远支',
          birthOriginDescription: '宗室名分尚在，但远离权力中枢。',
          currentIdentity: '北军军侯',
          currentIdentityDescription: '统带北军一部的低阶军官，正被洛阳乱局卷入。',
          militaryTitle: '北军军侯',
          personalEscortEntitlement: {
            status: 'customary',
            bases: ['military_command'],
            updatedAt: '公元189年09月01日 12:00（午时）',
          },
          appearance: '年少而清瘦，甲衣尚新，眉眼里有压不住的警觉。',
          personality: '谨慎敏锐，重承诺，也知道乱局里不能轻信人。',
          identitySummary: '汉室远支出身的北军军侯。',
        },
        protagonistMemory: {
          recentTurnSummary: '确定身份：以汉室远支之身，担任北军军侯。',
        },
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
    }));

    expect(result.writeback?.protagonistProfile).toMatchObject({
      birthOrigin: '汉室远支',
      currentIdentity: '北军军侯',
      militaryTitle: '北军军侯',
      personalEscortEntitlement: {
        status: 'customary',
        bases: ['military_command'],
      },
      appearance: '年少而清瘦，甲衣尚新，眉眼里有压不住的警觉。',
      personality: '谨慎敏锐，重承诺，也知道乱局里不能轻信人。',
      identitySummary: '汉室远支出身的北军军侯。',
    });
    expect(result.writeback?.protagonistMemory?.recentTurnSummary).toContain('确定身份');
  });

  it('rejects model-authored friendly scoped combatants while accepting the scene availability field', () => {
    const encounterId = 'encounter_guard_boundary_001';
    const result = parseNarratorResponse(JSON.stringify({
      narrativeText: '三名匪徒已经挥刀扑来。',
      suggestedActions: [],
      writeback: {
        encounterTransitionDecision: { mode: 'start', reason: '攻击已经发动' },
        encounterStartIntent: {
          contractVersion: 1,
          encounterId,
          kind: 'personal_combat',
          rulesetVersion: 'combat-v2.0.0',
          sourceTurnNumber: 1,
          locationId: 'location_road',
          reason: '匪徒袭击',
          seed: 'seed_guard_boundary_001',
          createdAt: '2026-07-31T00:00:00.000Z',
          policy: {
            lethality: 'standard',
            allowRetreat: true,
            allowSurrender: true,
            allowCapture: true,
            lootPolicy: 'actual_items_only',
          },
          playerParty: { actorIds: ['player', `${encounterId}:scoped:player_guard_1`] },
          enemyParty: { actorIds: [`${encounterId}:scoped:enemy_1`] },
          partySelection: 'locked',
          escortAvailability: 'normal',
          scopedCombatants: [
            {
              actorId: `${encounterId}:scoped:player_guard_1`,
              name: '护卫',
              archetype: 'regular',
              weaponClass: 'standard',
              armorClass: 'light',
            },
            {
              actorId: `${encounterId}:scoped:enemy_1`,
              name: '匪徒',
              archetype: 'rabble',
              weaponClass: 'light',
              armorClass: 'none',
            },
          ],
        },
      },
    }));

    expect(result.writeback?.encounterStartIntent).toBeNull();
    expect(result.writeback?.debugNotes.join('\n')).toContain('模型不得声明本地临时护卫');
  });

  it('parses dynamic writeback bridge fields from the V1 protocol', () => {
    const result = parseNarratorResponse(JSON.stringify({
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: 'The bridge road grows tense.',
      suggestedActions: [],
      writeback: {
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [
          {
            action: 'invalidate',
            questId: 'quest_old_route',
            title: 'Old route',
            summary: 'The old route is no longer usable.',
            currentStep: 'Find a different ford.',
            stakes: 'Delay may allow pursuers to catch up.',
            deadlineAt: 'day 2 dawn',
            priority: 'high',
            consequenceTags: ['route-blocked'],
            affectedPlaceIds: ['place_a'],
            followUpHooks: ['ask locals for a ford'],
            severity: 'major',
            threadId: 'thread_bridge',
          },
        ],
        signalChanges: [
          {
            action: 'add',
            rumorId: 'signal_bridge_spies',
            title: 'Spies near the bridge',
            content: 'Travelers report strangers watching the bridge road.',
            source: 'roadside traveler',
            signalType: 'report',
            confidence: 'medium',
            potentialOutcomeSummary: 'The bridge may be targeted tonight.',
            consequenceTags: ['ambush-risk'],
            affectedPlaceIds: ['place_a'],
            followUpHooks: ['question the travelers'],
            severity: 'moderate',
            threadId: 'thread_bridge',
          },
        ],
        plotPlanSuggestions: [],
        worldEventSummary: null,
        debugNotes: [],
      },
    }));

    expect(result.writeback?.questChanges[0]).toMatchObject({
      action: 'invalidate',
      questId: 'quest_old_route',
      currentStep: 'Find a different ford.',
      consequenceTags: ['route-blocked'],
      affectedPlaceIds: ['place_a'],
      followUpHooks: ['ask locals for a ford'],
      severity: 'major',
      threadId: 'thread_bridge',
    });
    expect(result.writeback?.signalChanges?.[0]).toMatchObject({
      action: 'add',
      rumorId: 'signal_bridge_spies',
      signalType: 'report',
      confidence: 'medium',
      potentialOutcomeSummary: 'The bridge may be targeted tonight.',
      consequenceTags: ['ambush-risk'],
      affectedPlaceIds: ['place_a'],
      followUpHooks: ['question the travelers'],
      severity: 'moderate',
      threadId: 'thread_bridge',
    });
  });

  it('parses lifecycle updates for matters, signals, and chronicles', () => {
    const result = parseNarratorResponse(JSON.stringify({
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: 'The old lead has cooled, while the confirmed event moves into the background.',
      suggestedActions: [],
      writeback: {
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [
          {
            action: 'archive',
            questId: 'quest_old_lead',
            summary: 'The old lead is no longer part of current play.',
            archiveReason: 'The player resolved the consequence through a later event.',
          },
        ],
        signalChanges: [
          {
            action: 'verify',
            rumorId: 'signal_chenliu_letter',
            confidence: 'high',
            potentialOutcomeSummary: 'The letter confirms the earlier rumor.',
            convertedToQuestIds: ['quest_visit_chenliu'],
          },
          {
            action: 'archive',
            rumorId: 'signal_stale_patrol',
            archiveReason: 'The patrol left three days ago.',
          },
        ],
        worldEventUpdates: [
          {
            eventId: 'trend_chenliu_muster',
            status: 'historical',
            summary: 'The Chenliu muster is now a known background fact.',
            archiveReason: 'Its immediate pressure has passed.',
          },
        ],
        worldEventSummary: null,
        debugNotes: [],
      },
    }));

    expect(result.writeback?.questChanges[0]).toMatchObject({
      action: 'archive',
      questId: 'quest_old_lead',
      archiveReason: 'The player resolved the consequence through a later event.',
    });
    expect(result.writeback?.signalChanges?.[0]).toMatchObject({
      action: 'verify',
      rumorId: 'signal_chenliu_letter',
      confidence: 'high',
      convertedToQuestIds: ['quest_visit_chenliu'],
    });
    expect(result.writeback?.signalChanges?.[1]).toMatchObject({
      action: 'archive',
      rumorId: 'signal_stale_patrol',
      archiveReason: 'The patrol left three days ago.',
    });
    expect(result.writeback?.worldEventUpdates?.[0]).toMatchObject({
      eventId: 'trend_chenliu_muster',
      status: 'historical',
      archiveReason: 'Its immediate pressure has passed.',
    });
  });

  it('parses current matter lifecycle updates without repeated summaries', () => {
    const result = parseNarratorResponse(JSON.stringify({
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: 'The grain raid is finished and should leave the current list.',
      suggestedActions: [],
      writeback: {
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [
          {
            action: 'archive',
            threadId: 'thread_grain_raid',
            outcomeSummary: 'The player secured the grain and removed the immediate threat.',
            archiveReason: 'The matter has resolved into consequences and no longer needs active tracking.',
          },
        ],
        signalChanges: [],
        plotPlanSuggestions: [],
        worldEventSummary: null,
        debugNotes: [],
      },
    }));

    expect(result.writeback?.questChanges).toHaveLength(1);
    expect(result.writeback?.questChanges[0]).toMatchObject({
      action: 'archive',
      threadId: 'thread_grain_raid',
      outcomeSummary: 'The player secured the grain and removed the immediate threat.',
      archiveReason: 'The matter has resolved into consequences and no longer needs active tracking.',
    });
  });

  it('parses plot plan timing fields from writeback suggestions', () => {
    const result = parseNarratorResponse(JSON.stringify({
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: 'The delayed plot remains only a pressure for now.',
      suggestedActions: [],
      writeback: {
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        signalChanges: [],
        plotPlanSuggestions: [
          {
            action: 'update',
            plotId: 'plot_delayed_pressure',
            title: 'Delayed pressure',
            horizon: '中期',
            status: '进行中',
            priority: '高',
            summary: 'The plot should not resolve until the later date.',
            notBeforeAt: '0189-09-20 08:00',
            lastAdvancedAt: '0189-09-10 08:00',
          },
        ],
        worldEventSummary: null,
        debugNotes: [],
      },
    }));

    expect(result.writeback?.plotPlanSuggestions?.[0]).toMatchObject({
      action: 'update',
      plotId: 'plot_delayed_pressure',
      notBeforeAt: '0189-09-20 08:00',
      lastAdvancedAt: '0189-09-10 08:00',
    });
  });

  it('parses worldEventSummary as a chronicle-ready world event with consequence anchors', () => {
    const result = parseNarratorResponse(JSON.stringify({
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: 'The courier confirms the capital gate lockdown.',
      suggestedActions: [],
      writeback: {
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: {
          eventId: 'trend_gate_lockdown',
          title: 'Capital gate lockdown',
          summary: 'The capital gates are locked down after a palace order.',
          visibility: '公开',
          scope: 'regional',
          certainty: 'confirmed',
          severity: 'high',
          locationId: 'loc_gate',
          presentNpcIds: ['npc_guard'],
          involvedNpcIds: ['npc_guard', 'npc_courier'],
          affectedNpcIds: ['npc_courier'],
          affectedFactionIds: ['faction_guard'],
          affectedPlaceIds: ['loc_gate'],
          affectedForceIds: ['force_gate_guard'],
          affectedHoldingIds: ['holding_gate'],
          consequenceTags: ['gate-lockdown', 'travel-restricted'],
          outcomeSummary: 'Travel through the capital gate now requires official permission.',
          followUpHooks: ['find who signed the order'],
          sourceQuestIds: ['quest_gate'],
          sourceSignalIds: ['signal_gate'],
          sourceConflictIds: ['battle_gate'],
          npcAwarenessRefs: [
            { name: 'Cao Cao', contactLevel: 0, playerRelevance: ['world-event'] },
          ],
          threadId: 'thread_gate_lockdown',
          happenedAt: 'day 1 morning',
          knownToPlayer: true,
          source: 'courier report',
        },
        debugNotes: [],
      },
    }));

    const worldEvent = result.writeback?.worldEventSummary as any;
    expect(worldEvent).toMatchObject({
      eventId: 'trend_gate_lockdown',
      title: 'Capital gate lockdown',
      scope: 'regional',
      certainty: 'confirmed',
      severity: 'high',
      outcomeSummary: 'Travel through the capital gate now requires official permission.',
      sourceQuestIds: ['quest_gate'],
      sourceSignalIds: ['signal_gate'],
      sourceConflictIds: ['battle_gate'],
      threadId: 'thread_gate_lockdown',
      happenedAt: 'day 1 morning',
      knownToPlayer: true,
      source: 'courier report',
    });
    expect(worldEvent.affectedPlaceIds).toEqual(['loc_gate']);
    expect(worldEvent.consequenceTags).toEqual(['gate-lockdown', 'travel-restricted']);
    expect(worldEvent.npcAwarenessRefs).toEqual([
      { name: 'Cao Cao', contactLevel: 0, playerRelevance: ['world-event'] },
    ]);
  });

  it('parses NPC profile suggestions with ability scores and trait hooks', () => {
    const result = parseNarratorResponse(JSON.stringify({
      narrativeText: '门候低声报上姓名。',
      suggestedActions: [],
      writeback: {
        npcProfileSuggestions: [
           {
             npcId: 'npc_gate_captain',
             name: '门候',
             persistenceReason: 'active_system_role',
             persistenceEvidence: '本回合已确认其长期负责洛阳城门盘查。',
            courtesyName: '伯安',
            aliases: ['老门候'],
            commonAddress: '门候',
            sex: '男',
            age: 39,
            role: '城门军吏',
            factionName: '洛阳守军',
            locationId: 'place_luoyang_city',
            isPresent: true,
            isFocused: true,
            birthOrigin: '军户',
            currentIdentity: '城门门候',
            summary: '负责洛阳城门盘查的中下层军吏。',
            appearance: '甲衣旧而整齐，眼神疲惫。',
            personality: '谨慎怕事，但懂得审时度势。',
            motivation: '想保住城门差事，避免卷入朝局。',
            relationToPlayer: '初见，对主角保持戒心。',
            contactLevel: 8,
            recentAttitude: '戒备',
            abilityScores: { 武力: 55, 统率: 42, 智力: 45, 政治: 30, 魅力: 36, 机运: 48 },
            traits: [
              {
                id: 'trait_gate_routine',
                label: '熟悉城门规矩',
                description: '知道城门盘查、口令和守军换防的习惯。',
                source: 'identity',
                rarity: 'blue',
                promptHint: '城门盘问、通行规矩、守军消息上更可靠。',
                checkHooks: [{ scope: '城门交涉', modifier: 6, note: '熟悉城门规矩。' }],
              },
            ],
          },
        ],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
    }));

    expect(result.writeback?.npcProfileSuggestions?.[0]).toMatchObject({
      npcId: 'npc_gate_captain',
      name: '门候',
      persistenceReason: 'active_system_role',
      persistenceEvidence: '本回合已确认其长期负责洛阳城门盘查。',
      currentIdentity: '城门门候',
      abilityScores: { 机运: 48 },
    });
    expect(result.writeback?.npcProfileSuggestions?.[0].traits[0]).toMatchObject({
      label: '熟悉城门规矩',
      promptHint: '城门盘问、通行规矩、守军消息上更可靠。',
      rarity: 'blue',
      checkHooks: [{ scope: '城门交涉', modifier: 6, note: '熟悉城门规矩。' }],
    });
  });

  it('deduplicates repeated NPC traits before they reach state commands', () => {
    const result = parseNarratorResponse(JSON.stringify({
      narrativeText: '军吏报上姓名。',
      writeback: {
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          traits: [
            { id: 'trait_genius', label: '鬼才', description: '善谋。', source: 'history', rarity: 'blue' },
            {
              id: 'trait_genius_drifted',
              label: ' 鬼 才 ',
              description: '善于在复杂局势中迅速找到破局之法。',
              source: 'event',
              rarity: 'orange',
            },
          ],
        })],
      },
    }));

    expect(result.writeback?.npcProfileSuggestions?.[0].traits).toEqual([
      expect.objectContaining({
        id: 'trait_genius',
        label: '鬼才',
        rarity: 'orange',
        description: '善于在复杂局势中迅速找到破局之法。',
      }),
    ]);
  });

  it('preserves every existing NPC equipment and inventory field', () => {
    const equipment = {
      id: 'eq_gate_sabre',
      slot: 'weapon',
      name: '守门环首刀',
      quality: '军中精造',
      description: '守门校尉随身兵器。',
      condition: '刀刃完好',
      statBonuses: { 武力: 4, 威慑: 2 },
      promptHint: '近身格斗与守门威慑时生效。',
      checkHooks: [{ scope: 'personalCombat.melee', modifier: 4, note: '兵器顺手。' }],
      unlocks: ['可执行近身拦截'],
      risks: ['狭窄处挥刀受限'],
    };
    const inventory = {
      id: 'item_gate_token',
      name: '守门符牌',
      quantity: 1,
      description: '验明守门身份的符牌。',
      category: 'token',
      quality: '官造',
      equipSlot: 'treasure',
      condition: '字迹清晰',
      statBonuses: { 交涉: 3 },
      promptHint: '查验身份与调动守卒时生效。',
      checkHooks: [{ scope: 'ordinaryCheck.gateAccess', modifier: 3, note: '符牌可验明身份。' }],
      unlocks: ['进入门楼'],
      risks: ['遗失后会被追责'],
      keyItem: true,
      updatedAt: '公元189年09月01日 09:30（巳时）',
    };
    const result = parseNarratorResponse(JSON.stringify({
      narrativeText: '校尉出示行装。',
      writeback: { npcProfileSuggestions: [makeNpcProfileSuggestion({ equipment: [equipment], inventory: [inventory] })] },
    }));

    expect(result.writeback?.npcProfileSuggestions?.[0].equipment?.[0]).toEqual(equipment);
    expect(result.writeback?.npcProfileSuggestions?.[0].inventory?.[0]).toEqual(inventory);
  });

  it('preserves invalid nested NPC loadout values for downstream rejection', () => {
    const invalidEquipment = {
      id: 'eq_bad_slot',
      slot: 'ring',
      name: '错误装备',
      quality: '未知',
      description: '协议错误样本。',
      statBonuses: { 武力: 'not-a-number' },
      checkHooks: [{ scope: 'combat', modifier: '__NON_FINITE__', note: '非法修正。' }],
    };
    const invalidInventory = {
      id: 'item_bad_quantity',
      name: '错误物品',
      quantity: '__NON_FINITE__',
      promptHint: 42,
      keyItem: 'yes',
    };
    const content = JSON.stringify({
      narrativeText: '返回了非法行装。',
      writeback: {
        npcProfileSuggestions: [makeNpcProfileSuggestion({
          equipment: [invalidEquipment, null],
          inventory: [invalidInventory, 'invalid-entry'],
        })],
      },
    }).replace(/"__NON_FINITE__"/g, '1e400');
    const result = parseNarratorResponse(content);
    const suggestion = result.writeback?.npcProfileSuggestions?.[0] as any;

    expect(suggestion.equipment[0]).toEqual({
      ...invalidEquipment,
      checkHooks: [{ scope: 'combat', modifier: Number.POSITIVE_INFINITY, note: '非法修正。' }],
    });
    expect(suggestion.equipment[1]).toBeNull();
    expect(suggestion.inventory[0]).toEqual({ ...invalidInventory, quantity: Number.POSITIVE_INFINITY });
    expect(suggestion.inventory[1]).toBe('invalid-entry');
  });

  it('parses NPC profile suggestions with unique arts', () => {
    const result = parseNarratorResponse(JSON.stringify({
      narrativeText: '老卒在校场露了一手。',
      suggestedActions: [],
      writeback: {
        npcProfileSuggestions: [
          {
            npcId: 'npc_old_scout',
            name: '老斥候',
            sex: '男',
            age: 52,
            role: '军中老卒',
            locationId: 'place_luoyang_city',
            isPresent: true,
            isFocused: true,
            currentIdentity: '随军斥候',
            summary: '久历行伍的斥候。',
            appearance: '衣甲旧而利落。',
            personality: '沉默寡言，眼力很毒。',
            motivation: '保住同袍性命。',
            relationToPlayer: '听命但仍在观察。',
            contactLevel: 12,
            recentAttitude: '谨慎服从',
            abilityScores: { 武力: 58, 统率: 40, 智力: 63, 政治: 20, 魅力: 34, 机运: 55 },
            traits: [
              {
                id: 'trait_old_scout',
                label: '老于行伍',
                description: '熟悉军中巡哨和伏击征兆。',
                source: 'identity',
                rarity: 'green',
              },
            ],
            uniqueArts: [
              {
                id: 'art_listen_hoof',
                name: '听蹄辨远',
                rarity: 'blue',
                domain: 'survival',
                level: 2,
                maxLevel: 5,
                progress: 30,
                description: '能凭马蹄、车辙和风声辨别远近动静。',
                effectSummary: '侦察、伏击预警和夜间行军时更易先察敌踪。',
                source: 'opening',
                acquisition: {
                  kind: 'background',
                  occurredAt: '公元189年09月01日 08:00（辰时）',
                  sourceRefId: 'npc-profile:npc_old_scout',
                  summary: '其长期斥候身份与多年行伍经历已经确立此能力。',
                },
                promptHint: '侦察、伏击预警或夜行时体现其听辨经验。',
                checkHooks: [{ scope: '侦察', modifier: 6, note: '凭声辨敌踪。' }],
                tags: ['斥候', '预警'],
              },
            ],
          },
        ],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
    }));

    expect(result.writeback?.npcProfileSuggestions?.[0].uniqueArts?.[0]).toMatchObject({
      id: 'art_listen_hoof',
      name: '听蹄辨远',
      rarity: 'blue',
      domain: 'survival',
      level: 2,
      acquisition: {
        kind: 'background',
        sourceRefId: 'npc-profile:npc_old_scout',
      },
      promptHint: '侦察、伏击预警或夜行时体现其听辨经验。',
      checkHooks: [{ scope: '侦察', modifier: 6, note: '凭声辨敌踪。' }],
      tags: ['斥候', '预警'],
    });
  });

  it('defaults missing npcProfileSuggestions isFocused from isPresent', () => {
    const result = parseNarratorResponse(JSON.stringify({
      narrativeText: '天子与尚书令都在殿中听取陈述。',
      suggestedActions: [],
      writeback: {
        npcProfileSuggestions: [
          {
            npcId: 'npc_liu_shan',
            name: '刘禅',
            sex: '男',
            age: 48,
            role: '蜀汉皇帝',
            locationId: 'place_yizhou_chengdu',
            isPresent: true,
            currentIdentity: '蜀汉天子',
            summary: '蜀汉后主，当前为北伐粮草调拨所困。',
            appearance: '神色疲惫，衣冠仍合天子礼制。',
            personality: '优柔而念旧，容易被旧臣与先帝遗志触动。',
            motivation: '维持成都朝局并避免民力彻底崩坏。',
            relationToPlayer: '在殿上听取主角陈述。',
            contactLevel: 12,
            recentAttitude: '动容但迟疑',
            abilityScores: { 武力: 15, 统率: 28, 智力: 55, 政治: 58, 魅力: 50, 机运: 35 },
            traits: [
              {
                id: 'trait_shu_late_emperor',
                label: '蜀汉后主',
                description: '身处蜀汉后期朝局的核心位置。',
                source: 'worldline',
                rarity: 'blue',
              },
            ],
          },
        ],
      },
    }));

    expect(result.writeback?.npcProfileSuggestions?.[0]).toMatchObject({
      npcId: 'npc_liu_shan',
      isPresent: true,
      isFocused: true,
    });
  });

  it('parses femaleProfile nested in NPC profile suggestions', () => {
    const result = parseNarratorResponse(JSON.stringify({
      narrativeText: '某位女性 NPC 被建立档案。',
      suggestedActions: [],
      writeback: {
        npcProfileSuggestions: [
          {
            npcId: 'npc_adult_woman',
            name: '某氏',
            sex: '女',
            age: 33,
            role: '重要女性 NPC',
            factionName: '地方势力',
            locationId: 'place_luoyang_city',
            isPresent: true,
            isFocused: true,
            currentIdentity: '地方贵族女性',
            summary: '在危局中出现的成年女性角色。',
            appearance: '衣饰庄重。',
            personality: '谨慎克制。',
            motivation: '保全亲族。',
            relationToPlayer: '初见，保持观察。',
            contactLevel: 5,
            recentAttitude: '谨慎',
            abilityScores: { 武力: 20, 统率: 25, 智力: 55, 政治: 50, 魅力: 70, 机运: 45 },
            traits: [{ id: 'trait_cautious', label: '谨慎', description: '处事谨慎。', source: 'identity' }],
            femaleProfile: {
              birthday: '八月初三',
              addressToPlayer: '郎君',
              appearanceDescription: '仪态端庄。',
              bodyDescription: '体态丰腴。',
              clothingStyle: '常着素雅深衣。',
              personalityCore: '谨慎克制。',
              relationshipNetwork: [{ targetName: '主角', relationship: '危局中的盟友', notes: '仍在观察。' }],
              adultPrivateProfile: {
                enabled: true,
                summary: '成年女性私密档案摘要。',
                breastDescription: '长期稳定正文字段一。',
                vaginaDescription: '长期稳定正文字段二。',
                anusDescription: '长期稳定正文字段三。',
                sexualPreferenceNotes: '长期偏好记录。',
                sensitiveSpotNotes: '长期敏感点记录。',
                wombProfile: {
                  status: '未受孕',
                  cervixStatus: '紧闭',
                  inseminationRecords: [{ date: '公元189年09月01日', description: '长期档案记录。', pregnancyCheckDate: '公元189年10月01日' }],
                },
                virgin: false,
                firstNightPartner: '主角',
                firstNightTime: '公元189年09月01日',
                firstNightDescription: '长期档案记录。',
              },
            },
          },
        ],
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
    }));

    const suggestion = result.writeback?.npcProfileSuggestions?.[0] as any;
    expect(suggestion?.femaleProfile?.birthday).toBe('八月初三');
    expect(suggestion?.femaleProfile?.relationshipNetwork?.[0]).toMatchObject({ targetName: '主角', relationship: '危局中的盟友' });
    expect(suggestion?.femaleProfile?.adultPrivateProfile?.breastDescription).toBe('长期稳定正文字段一。');
    expect(suggestion?.femaleProfile?.adultPrivateProfile?.vaginaDescription).toBe('长期稳定正文字段二。');
    expect(suggestion?.femaleProfile?.adultPrivateProfile?.anusDescription).toBe('长期稳定正文字段三。');
    expect(suggestion?.femaleProfile?.adultPrivateProfile?.sexualPreferenceNotes).toBe('长期偏好记录。');
    expect(suggestion?.femaleProfile?.adultPrivateProfile?.sensitiveSpotNotes).toBe('长期敏感点记录。');
    expect(suggestion?.femaleProfile?.adultPrivateProfile?.wombProfile?.status).toBe('未受孕');
    expect(suggestion?.femaleProfile?.adultPrivateProfile?.virgin).toBe(false);
    expect(suggestion?.femaleProfile?.adultPrivateProfile?.firstNightPartner).toBe('主角');
    expect(suggestion?.femaleProfile?.adultPrivateProfile?.firstNightTime).toBe('公元189年09月01日');
    expect(suggestion?.femaleProfile?.adultPrivateProfile?.firstNightDescription).toBe('长期档案记录。');
  });

  it('parses Map V1 structured location and route writeback suggestions', () => {
    const result = parseNarratorResponse(JSON.stringify({
      narrativeText: '新的道路被确认下来。',
      suggestedActions: [],
      statePatches: [
        {
          type: 'timeAdvance',
          payload: { minutesAdvanced: 30, reason: '探路', category: 'travel' },
          reason: '探路耗时',
        },
      ],
      writeback: {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [
          {
            locationId: 'place_new_fort',
            name: '新堡',
            kind: '坞堡',
            mapLayer: 'place',
            parentId: 'region_commandery',
            parentPath: '州 / 郡',
            summary: '一处被确认的具体地点。',
            permanence: 'permanent',
          },
        ],
        routeWriteSuggestions: [
          {
            routeId: 'route_county_fort',
            fromPlaceId: 'place_county',
            toPlaceId: 'place_new_fort',
            name: '县城至新堡小路',
            routeKind: '小路',
            status: '可通行但危险',
            source: 'llm',
            knownLevel: '亲历',
            riskLevel: 55,
            standardTravelMinutes: 120,
            travelTimeText: '约一个时辰',
            notes: '玩家本回合亲自走过。',
          },
        ],
        questChanges: [],
        worldEventSummary: null,
        debugNotes: [],
      },
    }));

    expect(result.writeback?.locationWriteSuggestions[0]).toMatchObject({
      locationId: 'place_new_fort',
      mapLayer: 'place',
      parentId: 'region_commandery',
    });
    expect(result.writeback?.routeWriteSuggestions[0]).toMatchObject({
      routeId: 'route_county_fort',
      fromPlaceId: 'place_county',
      toPlaceId: 'place_new_fort',
      routeKind: '小路',
      standardTravelMinutes: 120,
    });
  });

  it.each([
    [
      'fenced JSON',
      '你核对完军报，将竹简收入匣中。\n```json\n{"statePatches":[],"writeback":{}}\n```',
    ],
    [
      'raw appended object',
      '你核对完军报，将竹简收入匣中。\n{\n  "statePatches": [],\n  "writeback": {}\n}',
    ],
    [
      'inline appended object',
      '你核对完军报，将竹简收入匣中。 {"statePatches":[],"writeback":{}}',
    ],
  ])('removes %s leaked structured payloads from narrativeText', (_label, narrativeText) => {
    const result = parseNarratorResponse(JSON.stringify({
      protocolVersion: 'lsfy.turn.v1',
      narrativeText,
      suggestedActions: [],
      statePatches: [],
      statePatch: null,
    }));

    expect(result.narrativeText).toBe('你核对完军报，将竹简收入匣中。');
    expect(result.narrativeText).not.toMatch(/```json|"statePatches"\s*:|"writeback"\s*:/i);
  });

  it.each([
    [
      'fenced payload',
      '你核对完军报，将竹简收入匣中。\n```json\n{"statePatches":[],"writeback":{}}\n```',
    ],
    [
      'raw appended payload',
      '你核对完军报，将竹简收入匣中。\n{"statePatches":[],"writeback":{}}',
    ],
  ])('removes %s when the model response falls back to plain text', (_label, content) => {
    const result = parseNarratorResponse(content);

    expect(result.narrativeText).toBe('你核对完军报，将竹简收入匣中。');
    expect(result.narrativeText).not.toMatch(/```json|"statePatches"\s*:|"writeback"\s*:/i);
  });

  it('keeps plain text model output playable when JSON parsing fails', () => {
    const result = parseNarratorResponse('你在县衙前停下，门内传来急促脚步声。');

    expect(result).toEqual({
      narrativeText: '你在县衙前停下，门内传来急促脚步声。',
      suggestedActions: [],
      statePatch: null,
    });
  });
});

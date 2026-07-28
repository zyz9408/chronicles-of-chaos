import { describe, expect, it } from 'vitest';
import { extractLuanShiCommandFromPatch, normalizeLuanShiCommandPatch } from './LuanShiCommandPatch';

describe('LuanShiCommandPatch StatePatch normalization', () => {
  it.each([
    ['locationChange', 'toLocationId', 'place_yangdi'],
    ['updateLocation', 'locationId', 'place_yangdi'],
  ])('normalizes misnested %s into a top-level locationChange patch', (action, locationKey, locationId) => {
    const patch = normalizeLuanShiCommandPatch({
      type: 'luanshiCommand',
      reason: '主角从县衙移至城门',
      payload: {
        command: {
          action,
          [locationKey]: locationId,
          sceneId: 'scene_yangdi_gate',
        },
      },
    } as any);

    expect(patch).toEqual({
      type: 'locationChange',
      reason: '主角从县衙移至城门',
      payload: {
        toLocationId: 'place_yangdi',
        toSceneId: 'scene_yangdi_gate',
      },
    });
  });

  it('normalizes the legacy updateNpcProfile command action into upsertNpcProfile', () => {
    const command = extractLuanShiCommandFromPatch({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'updateNpcProfile',
          npcId: 'npc_yingchuan_clerk',
          name: '颍川郡吏',
        },
      },
    } as any);

    expect(command).toMatchObject({
      action: 'upsertNpcProfile',
      npcId: 'npc_yingchuan_clerk',
      name: '颍川郡吏',
    });
  });

  it('normalizes a top-level updateNpcPresence patch into a luanshiCommand', () => {
    const patch = normalizeLuanShiCommandPatch({
      type: 'updateNpcPresence' as any,
      reason: 'NPC leaves the current group',
      payload: {
        npcId: 'npc_yingchuan_clerk',
        locationId: 'place_yingchuan_office',
        isPresent: false,
      },
    } as any);

    expect(patch).toMatchObject({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'updateNpcPresence',
          npcId: 'npc_yingchuan_clerk',
          locationId: 'place_yingchuan_office',
          isPresent: false,
        },
      },
    });
  });

  it('normalizes a miswrapped worldCommand with a nested NPC background activity payload', () => {
    const patch = normalizeLuanShiCommandPatch({
      type: 'worldCommand',
      reason: 'The model used a generic command wrapper.',
      payload: {
        command: {
          action: 'updateNpcBackgroundActivity',
          payload: {
            npcId: 'npc_yingchuan_clerk',
            activity: {
              activityId: 'activity_yingchuan_patrol',
              summary: 'The clerk checks the patrol roster.',
              status: 'active',
            },
          },
        },
      },
    } as any);

    expect(patch).toEqual({
      type: 'luanshiCommand',
      reason: 'The model used a generic command wrapper.',
      payload: {
        command: {
          action: 'updateNpcBackgroundActivity',
          npcId: 'npc_yingchuan_clerk',
          activity: {
            activityId: 'activity_yingchuan_patrol',
            summary: 'The clerk checks the patrol roster.',
            status: 'active',
          },
        },
      },
    });
  });

  it('normalizes historical war vocabulary and the Luomagu score overflow before validation', () => {
    const command = extractLuanShiCommandFromPatch({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'upsertConflictRecord',
          conflictId: 'conflict_luomagu_ambush',
          type: '奇袭',
          title: '落马谷伏击战',
          occurredAt: '公元194年04月30日',
          outcome: '伏击大胜，敌军主将被俘。',
          resultLevel: '大胜',
          judgement: {
            method: 'warJudgementV1',
            scoreBreakdown: {
              troopBase: 85,
              commander: 90,
              tactical: 95,
              turningPoint: 0,
              playerAction: 20,
              uniqueArts: 0,
              total: 290,
            },
          },
          turningPoints: [{
            type: 'ambushSuccess',
            summary: '伏兵从谷口两侧齐出。',
            impact: '决定性影响',
            scoreModifier: 120,
          }],
        },
      },
      reason: '记录落马谷伏击结果',
    } as any);

    expect(command).toMatchObject({
      action: 'upsertConflictRecord',
      conflictId: 'conflict_luomagu_ambush',
      type: '伏击',
      resultLevel: 'decisiveWin',
      judgement: {
        method: 'warJudgementV1',
        scoreBreakdown: { total: 250 },
      },
      turningPoints: [{
        type: 'ambush',
        impact: 'critical',
        scoreModifier: 100,
      }],
    });
  });
});

describe('LuanShiCommandPatch NPC loadout normalization', () => {
  it('normalizes top-level updateNpcLoadout into luanshiCommand', () => {
    const patch = normalizeLuanShiCommandPatch({
      type: 'updateNpcLoadout' as any,
      payload: {
        npcId: 'npc_chen_heng',
        npcName: '陈衡',
        inventoryChanges: [{ action: 'add', item: { id: 'item_token', name: '木符', quantity: 1 } }],
      },
    } as any);

    expect(patch).toMatchObject({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'updateNpcLoadout',
          npcId: 'npc_chen_heng',
          inventoryChanges: [{ action: 'upsert' }],
        },
      },
    });
  });

  it('normalizes NPC equipment upsert equipSlot into slot', () => {
    const command = extractLuanShiCommandFromPatch({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'updateNpcLoadout',
          npcId: 'npc_chen_heng',
          npcName: '陈衡',
          equipmentChanges: [
            {
              action: 'upsert',
              item: {
                id: 'eq_hidden',
                equipSlot: 'weapon',
                name: '短刀',
                quality: '旧制',
                description: '旧短刀。',
              },
            },
          ],
        },
      },
    } as any);

    expect(command).toMatchObject({
      action: 'updateNpcLoadout',
      equipmentChanges: [{ item: { slot: 'weapon' } }],
    });
  });

  it('keeps NPC blank equipFromInventory changes visible for validation', () => {
    const command = extractLuanShiCommandFromPatch({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'updateNpcLoadout',
          npcId: 'npc_chen_heng',
          npcName: '陈衡',
          equipmentChanges: [
            {
              action: 'equipFromInventory',
              itemId: '   ',
              slot: 'weapon',
            },
          ],
        },
      },
    } as any);

    expect(command).toMatchObject({
      action: 'updateNpcLoadout',
      equipmentChanges: [{ action: 'equipFromInventory' }],
    });
    expect((command as any)?.equipmentChanges).toHaveLength(1);
  });
});

describe('LuanShiCommandPatch player loadout normalization', () => {
  it('keeps blank inventory targets visible for validation and trims a concrete itemId', () => {
    const command = extractLuanShiCommandFromPatch({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'updatePlayerLoadout',
          inventoryChanges: [
            { action: 'remove', itemId: '   ' },
            { action: 'setQuantity', itemId: '\t', quantity: 0 },
            { action: 'remove', itemId: ' item_token ', quantity: 1 },
          ],
        },
      },
    } as any);

    expect(command).toMatchObject({
      action: 'updatePlayerLoadout',
      inventoryChanges: [
        { action: 'remove', itemId: '' },
        { action: 'setQuantity', itemId: '', quantity: 0 },
        { action: 'remove', itemId: 'item_token', quantity: 1 },
      ],
    });
    expect((command as any)?.inventoryChanges).toHaveLength(3);
  });
});

describe('LuanShiCommandPatch resource ledger normalization', () => {
  it.each(['weapons', 'documents', 'tokens', 'importantSupplies'])(
    'wraps a single %s entry in the required string array',
    (field) => {
      const command = extractLuanShiCommandFromPatch({
        type: 'luanshiCommand',
        payload: {
          command: {
            action: 'updateResourceLedger',
            [field]: ' 箭矢三箱 ',
          },
        },
      } as any);

      expect(command).toMatchObject({
        action: 'updateResourceLedger',
        [field]: ['箭矢三箱'],
      });
    },
  );
});

describe('LuanShiCommandPatch faction ledger normalization', () => {
  it('normalizes common English faction type aliases before validation', () => {
    const command = extractLuanShiCommandFromPatch({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'upsertFactionLedger',
          factionId: 'faction_jingzhou_liubiao',
          name: '荆州牧刘表',
          type: 'warlord',
          summary: '刘表入荆州后形成的具体行动主体。',
          stanceToPlayer: 'neutral',
          knownLevel: '亲历',
          recentActions: '驻防汉水渡口',
        },
      },
    } as any);

    expect(command).toMatchObject({
      action: 'upsertFactionLedger',
      type: '军阀集团',
      recentActions: ['驻防汉水渡口'],
    });
  });

  it('normalizes numeric faction stance into player-facing text before validation', () => {
    const command = extractLuanShiCommandFromPatch({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'upsertFactionLedger',
          factionId: 'faction_jingzhou_liubiao',
          name: '荆州牧刘表',
          type: 'warlord',
          summary: '刘表入荆州后形成的具体行动主体。',
          stanceToPlayer: 10,
          knownLevel: '亲历',
          recentActions: [],
        },
      },
    } as any);

    expect(command).toMatchObject({
      action: 'upsertFactionLedger',
      stanceToPlayer: '略有善意',
    });
  });

  it('fills missing recentActions from existing faction facts before validation', () => {
    const command = extractLuanShiCommandFromPatch({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'upsertFactionLedger',
          factionId: 'faction_regional_actor',
          name: '地方军府',
          type: '地方官府',
          summary: '地方长官临时整顿郡兵与城防。',
          stanceToPlayer: '自势力相关',
          knownLevel: '亲历',
          knownSphere: '郡城、渡口与城外军营',
        },
      },
    } as any);

    expect(command).toMatchObject({
      action: 'upsertFactionLedger',
      recentActions: ['地方长官临时整顿郡兵与城防。'],
    });
  });

  it('replaces malformed recentActions with a factual fallback before validation', () => {
    const command = extractLuanShiCommandFromPatch({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'upsertFactionLedger',
          factionId: 'faction_militia_office',
          name: '郡兵军府',
          type: '军府',
          summary: '郡兵军府正在清点麾下士卒与粮械。',
          stanceToPlayer: '自势力相关',
          knownLevel: '亲历',
          recentActions: { text: '清点士卒' },
        },
      },
    } as any);

    expect(command).toMatchObject({
      action: 'upsertFactionLedger',
      recentActions: ['郡兵军府正在清点麾下士卒与粮械。'],
    });
  });
});

describe('LuanShiCommandPatch troop ledger normalization', () => {
  it('normalizes the common ordered alias into the issued order status', () => {
    const command = extractLuanShiCommandFromPatch({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'upsertTroopLedger',
          troopId: 'troop_yingchuan_guard',
          orderStatus: 'ordered',
          orderIssuedAt: '公元184年03月02日 11:00（午时）',
          orderSummary: '奉命整顿城防。',
        },
      },
    } as any);

    expect(command).toMatchObject({
      action: 'upsertTroopLedger',
      orderStatus: 'issued',
    });
  });

  it('normalizes numeric relationToPlayer into a non-empty relation before validation', () => {
    const command = extractLuanShiCommandFromPatch({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'upsertTroopLedger',
          troopId: 'troop_player_qu',
          name: '刘峙部曲',
          size: 200,
          morale: 60,
          training: 75,
          supplies: 20,
          task: '戍卫襄阳北亭',
          relationToPlayer: 100,
          factionId: 'faction_jingzhou_liubiao',
          leaderNpcId: 'player',
        },
      },
    } as any);

    expect(command).toMatchObject({
      action: 'upsertTroopLedger',
      relationToPlayer: 'self',
      leaderNpcId: 'player',
    });
  });

  it('infers self relation when the player is written as troop leader', () => {
    const command = extractLuanShiCommandFromPatch({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'upsertTroopLedger',
          troopId: 'troop_player_guard',
          name: '主角亲兵',
          size: 80,
          morale: 62,
          training: 66,
          supplies: 40,
          task: '随主角行军',
          relationToPlayer: '',
          leaderNpcId: 'player',
        },
      },
    } as any);

    expect(command).toMatchObject({
      action: 'upsertTroopLedger',
      relationToPlayer: 'self',
    });
  });

  it('normalizes Chinese upkeep source labels for troop ledger writes', () => {
    const command = extractLuanShiCommandFromPatch({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'upsertTroopLedger',
          troopId: 'troop_player_guard',
          name: '主角亲兵',
          size: 80,
          morale: 62,
          training: 66,
          supplies: 40,
          task: '随主角行军',
          relationToPlayer: 'self',
          leaderNpcId: 'player',
          upkeepSource: '上级拨付军粮',
        },
      },
    } as any);

    expect(command).toMatchObject({
      action: 'upsertTroopLedger',
      upkeepSource: 'superior_provision',
    });
  });
});

describe('LuanShiCommandPatch NPC profile normalization', () => {
  it('fills missing NPC trait sources before validation', () => {
    const command = extractLuanShiCommandFromPatch({
      type: 'luanshiCommand',
      payload: {
        command: {
          action: 'upsertNpcProfile',
          npcId: 'npc_chenwu',
          name: '陈伍',
          sex: '男',
          age: 32,
          role: '副将/亲兵',
          currentIdentity: '襄阳北营军侯',
          locationId: 'place_jingzhou_xiangyang',
          isPresent: true,
          isFocused: true,
          summary: '追随主角两年的荆州老卒。',
          appearance: '满面风霜。',
          personality: '本分忠诚。',
          motivation: '保住弟兄的命和饭碗。',
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
            {
              id: 'trait_blank_source',
              label: '营伍熟手',
              rarity: 'white',
              description: '熟悉营中规矩。',
              source: '   ',
            },
          ],
        },
      },
    } as any);

    expect(command).toMatchObject({
      action: 'upsertNpcProfile',
      isFocused: true,
      traits: [
        { id: 'trait_veteran_soldier', source: 'writeback' },
        { id: 'trait_blank_source', source: 'writeback' },
      ],
    });
  });
});

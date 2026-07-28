import { describe, expect, it } from 'vitest';
import type { RuntimeState, StatePatch, WorldBook } from '../types';
import { validatePatch } from './StatePatchValidator';

const worldBook = {} as WorldBook;
const mapWorldBook = {
  mapSeed: [
    {
      id: 'region_root',
      name: 'Root Region',
      level: 'region',
      mapLayer: 'region',
      summary: 'Base region.',
      connectedRegionIds: [],
      controlHint: '',
      tensionHint: '',
      subLocations: [
        {
          id: 'place_base',
          name: 'Base Place',
          level: 'place',
          mapLayer: 'place',
          summary: 'A base concrete place.',
          connectedRegionIds: [],
          controlHint: '',
          tensionHint: '',
          subLocations: [
            {
              id: 'scene_base_gate',
              name: 'Base Gate',
              level: 'scene',
              mapLayer: 'scene',
              summary: 'A scene inside the base place.',
              connectedRegionIds: [],
              controlHint: '',
              tensionHint: '',
            },
          ],
        },
      ],
    },
  ],
  openingLocationSeed: [
    {
      id: 'region_root',
      name: 'Root Region',
      level: 'region',
      mapLayer: 'region',
      summary: 'Opening overlay region.',
      connectedRegionIds: [],
      controlHint: '',
      tensionHint: '',
      subLocations: [
        {
          id: 'place_opening',
          name: 'Opening Place',
          level: 'place',
          mapLayer: 'place',
          summary: 'A concrete place from openingLocationSeed.',
          connectedRegionIds: [],
          controlHint: '',
          tensionHint: '',
          subLocations: [
            {
              id: 'scene_opening_yard',
              name: 'Opening Yard',
              level: 'scene',
              mapLayer: 'scene',
              summary: 'A scene under the opening place.',
              connectedRegionIds: [],
              controlHint: '',
              tensionHint: '',
            },
          ],
        },
      ],
    },
  ],
} as unknown as WorldBook;

function makeBoundaryRuntimeState(): RuntimeState {
  return {
    engineVersion: '0.1.0',
    worldBookId: 'test-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '公元194年04月01日',
    currentDate: '公元194年04月01日',
    player: {
      id: 'player',
      name: '刘峙',
      courtesyName: '临渊',
      age: 24,
      roleType: '建威校尉',
      currentIdentity: '建威校尉',
      militaryTitle: '建威校尉',
      summary: '主角。',
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
    npcs: [],
  };
}

function makeNpcProfilePatch(overrides: Record<string, unknown> = {}): StatePatch {
  return {
    type: 'luanshiCommand',
    reason: '写入 NPC 档案',
    payload: {
      command: {
        action: 'upsertNpcProfile',
        npcId: 'npc_gate_guard',
        name: '门候',
        sex: '男',
        age: 36,
        role: '城门守军',
        currentIdentity: '城门门候',
        locationId: 'loc_market_town',
        isPresent: true,
        isFocused: true,
        summary: '守门军士。',
        appearance: '甲衣半旧。',
        personality: '谨慎。',
        motivation: '守住差事。',
        relationToPlayer: '初识。',
        contactLevel: 8,
        recentAttitude: '戒备',
        abilityScores: { 武力: 55, 统率: 42, 智力: 45, 政治: 30, 魅力: 36, 机运: 48 },
        traits: [
          {
            id: 'trait_gate_guard',
            label: '城门老卒',
            description: '熟悉城门盘查。',
            source: 'event',
          },
        ],
        ...overrides,
      },
    },
  } as StatePatch;
}

describe('validatePatch with luanshiCommand', () => {
  it('允许结构完整的 luanshiCommand patch', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: '记录 NPC 记忆',
      payload: {
        command: {
          action: 'pushNpcMemory',
          npcId: 'npc_chen_heng',
          npcName: '陈衡',
          source: '亲历',
          value: '陈衡亲眼见到主角救人。',
        },
      },
    };

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('拒绝缺少 command 对象的 luanshiCommand patch', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: '缺少命令对象',
      payload: {},
    };

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('command');
  });

  it('允许模型把 luanshiCommand 近似输出为 payload.action 并继续校验命令字段', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: '登记玩家直辖庄园',
      payload: {
        action: 'upsertHoldingLedger',
        holdingId: 'holding_gushui_estate',
        name: '谷水庄园',
        type: 'estate',
        status: 'controlled',
        summary: '洛阳近郊一处可供整顿的庄园。',
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

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('normalizes common top-level LuanShi action names before validation', () => {
    const eventPatch = {
      type: 'recordTurnEvent',
      reason: 'model wrote the command action as patch type',
      payload: {
        locationId: 'loc_market_town',
        summary: '主角在市镇救下伤者，陈衡在场目睹。',
        presentNpcIds: [],
        visibility: '公开',
      },
    } as unknown as StatePatch;

    const heroinePatch = {
      type: 'upsertHeroineThread',
      reason: 'model wrote relationship command as patch type',
      payload: {
        heroineThreadId: 'heroine_lady_he',
        npcId: 'npc_lady_he',
        npcName: '何氏',
        status: 'active',
        stage: '互信成形',
        relationshipRole: '宫廷盟友',
        summary: '她与主角已有私下互信。',
        lastUpdatedAt: '乱世元年2月',
      },
    } as unknown as StatePatch;

    expect(validatePatch(eventPatch, worldBook, []).valid).toBe(true);
    expect(validatePatch(heroinePatch, worldBook, []).valid).toBe(true);
  });

  it('rejects direct upsertNpcProfile patches that try to create the protagonist as an NPC', () => {
    const patch = makeNpcProfilePatch({
      npcId: 'npc_liuzhi',
      name: '刘峙',
      courtesyName: '临渊',
      age: 24,
      role: '建威校尉',
      currentIdentity: '建威校尉',
      militaryTitle: '建威校尉',
      relationToPlayer: '本人',
    });

    const result = validatePatch(patch, worldBook, [], makeBoundaryRuntimeState());

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('不得把主角本人创建或更新为 NPC 档案');
  });

  it('allows direct same-name NPC upsert patches when the identity evidence is distinct', () => {
    const patch = makeNpcProfilePatch({
      npcId: 'npc_liuzhi_namesake',
      name: '刘峙',
      courtesyName: '伯山',
      age: 36,
      role: '同名宗族旁支',
      currentIdentity: '汝南逃难士人',
      relationToPlayer: '同名族人，正寻求投靠。',
      summary: '与主角同名但履历不同。',
    });

    const result = validatePatch(patch, worldBook, [], makeBoundaryRuntimeState());

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('surfaces dangling relationship NPC ids through the existing patch diagnostics', () => {
    const runtimeState = {
      currentDate: '公元189年09月01日',
      player: { id: 'player', name: '主角', roleType: 'player', summary: '测试角色' },
      npcs: [],
    } as unknown as RuntimeState;
    const patch = {
      type: 'upsertHeroineThread',
      reason: 'model referenced an NPC that does not exist',
      payload: {
        heroineThreadId: 'heroine_missing',
        npcId: 'npc_missing',
        npcName: 'Invented Name',
        status: 'active',
        stage: 'trust-forming',
        relationshipRole: 'confidante',
        summary: 'This relationship must be rejected.',
      },
    } as unknown as StatePatch;

    const result = validatePatch(patch, worldBook, [], runtimeState);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('npc_missing');
  });

  it('surfaces an existing dangling bond id when a later patch only changes summary', () => {
    const runtimeState = {
      currentDate: '公元189年09月01日',
      player: { id: 'player', name: '主角', roleType: 'player', summary: '测试角色' },
      npcs: [],
      bondThreads: [{
        bondThreadId: 'bond_dangling',
        targetNpcIds: ['npc_missing'],
        targetNames: ['Invented Name'],
        bondType: 'ally',
        status: 'active',
        summary: 'An invalid legacy bond.',
        lastUpdatedAt: '公元189年08月01日',
      }],
    } as unknown as RuntimeState;
    const patch = {
      type: 'upsertBondThread',
      reason: 'only update the summary',
      payload: {
        bondThreadId: 'bond_dangling',
        summary: 'The summary changed but the dangling id remains.',
      },
    } as unknown as StatePatch;

    const result = validatePatch(patch, worldBook, [], runtimeState);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('npc_missing');
  });

  it('normalizes common holding ledger field drift before validation', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'record a holding ledger with common LLM near-miss types',
      payload: {
        command: {
          action: 'upsertHoldingLedger',
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
          localTreasury: '30000钱',
          localGranary: '300石',
          riskNotes: 'Bandit pressure remains high.',
          recentChanges: 'The player ordered a full inventory.',
          updatedAt: '189-09-01 14:15',
        },
      },
    };

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('normalizes string reputation tags before validation', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'model wrote a simple reputation tag',
      payload: {
        command: {
          action: 'updateCharacterReputation',
          characterType: 'player',
          characterId: 'player',
          fameDelta: 1,
          tags: ['洛阳小有名声'],
          summary: '在洛阳宫门前压住逃兵。',
          updatedAt: '中平六年（189年）09月01日（巳时）',
        },
      },
    };

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('normalizes inventory add changes to upsert changes before validation', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'model used add for an acquired backpack item',
      payload: {
        command: {
          action: 'updatePlayerLoadout',
          characterId: 'player',
          inventoryChanges: [
            {
              action: 'add',
              item: {
                id: 'item_jinchuangyao',
                name: '金疮药',
                quantity: 2,
                category: 'supply',
                description: '军中常用的止血敷药。',
              },
            },
          ],
          summary: '获得两份金疮药。',
        },
      },
    };

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('drops blank equipFromInventory candidates before loadout validation', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'model emitted an empty equipment candidate without a real equip action',
      payload: {
        command: {
          action: 'updatePlayerLoadout',
          characterId: 'player',
          equipmentChanges: [
            {
              action: 'equipFromInventory',
              itemId: '',
              slot: 'weapon',
            },
          ],
          summary: '本回合没有实际更换装备。',
        },
      },
    };

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects blank player inventory targets instead of silently dropping the writeback', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'model emitted an empty inventory removal candidate without a concrete target',
      payload: {
        command: {
          action: 'updatePlayerLoadout',
          characterId: 'player',
          inventoryChanges: [{ action: 'remove', itemId: '', quantity: 1 }],
          summary: '本回合没有可确认的背包物品变更。',
        },
      },
    };

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('updatePlayerLoadout.inventoryChanges[0].itemId 不能为空。');
  });

  it('rejects a player inventory removal whose itemId is missing', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'model omitted the stable item target while selling an item',
      payload: {
        command: {
          action: 'updatePlayerLoadout',
          characterId: 'player',
          personalMoneyDelta: 11,
          inventoryChanges: [{ action: 'remove', quantity: 1 } as any],
          summary: '卖出旧铜灯并收款。',
        },
      },
    };

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('updatePlayerLoadout.inventoryChanges[0].itemId 不能为空。');
  });

  it('normalizes legacy updateNpcProfile before NPC profile validation', () => {
    const patch = makeNpcProfilePatch() as any;
    patch.payload.command.action = 'updateNpcProfile';

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('normalizes equipmentChanges upsert items that use equipSlot instead of slot', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: 'opening loadout used inventory-style equipSlot for worn equipment',
      payload: {
        command: {
          action: 'updatePlayerLoadout',
          characterId: 'player',
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
          summary: '按真开局身份生成初始武器。',
        },
      },
    };

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('拒绝字段非法的 upsertConflictRecord 战事命令', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: '错误地把战果当作战事类型',
      payload: {
        command: {
          action: 'upsertConflictRecord',
          conflictId: 'battle_bad_result_type',
          type: '招降',
          title: '错误战事',
          summary: '',
          occurredAt: '公元189年09月01日',
          outcome: '招降成功。',
        },
      },
    };

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('upsertConflictRecord.summary');
    expect(result.errors.join('\n')).toContain('upsertConflictRecord.type');
    expect(result.errors.join('\n')).toContain('覆灭/招降/合并/溃退');
  });

  it('允许 NPC 档案描述字段包含历史官职和兵权词汇', () => {
    const patch: StatePatch = {
      type: 'luanshiCommand',
      reason: '写入女性 NPC 档案',
      payload: {
        command: {
          action: 'upsertNpcProfile',
          npcId: 'npc_adult_woman',
          name: '某氏',
          sex: '女',
          age: 33,
          role: '重要女性 NPC',
          currentIdentity: '皇太后',
          locationId: 'loc_capital',
          isPresent: true,
          isFocused: true,
          identitySummary: '其兄曾为大将军，家族卷入朝官与外戚的权力倾轧。',
          summary: '成年女性角色，正受地方军阀兵权威胁。',
          appearance: '衣饰合乎身份。',
          personality: '谨慎而惶恐。',
          motivation: '希望保全自身和亲族。',
          relationToPlayer: '危局中的求助者。',
          contactLevel: 1,
          recentAttitude: '试探',
          abilityScores: { 武力: 10, 统率: 20, 智力: 50, 政治: 55, 魅力: 70, 机运: 30 },
          traits: [
            {
              id: 'trait_court_pressure',
              label: '朝局余波',
              description: '官职、宗族与兵权纠葛都只是人物背景描述。',
              source: 'event',
              rarity: 'white',
            },
          ],
        },
      },
    };

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('defaults missing isFocused for top-level upsertNpcProfile patches from isPresent', () => {
    const patch = {
      type: 'upsertNpcProfile',
      reason: 'model wrote an important present NPC as a top-level command patch',
      payload: {
        npcId: 'npc_liu_shan',
        name: '刘禅',
        sex: '男',
        age: 48,
        role: '蜀汉皇帝',
        currentIdentity: '蜀汉天子',
        locationId: 'place_yizhou_chengdu',
        isPresent: true,
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
    } as unknown as StatePatch;

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('拒绝绕过 luanshiCommand 的结构化权力字段写入', () => {
    const patch: StatePatch = {
      type: 'localSituationChanged',
      reason: '错误地直接写入权力状态',
      payload: {
        characterId: 'player',
        officeTitle: 'field marshal',
        militaryPower: 3000,
      },
    };

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('结构化权力');
  });
});

describe('validatePatch with Map V1 locationChange', () => {
  it('accepts concrete places and optional child scenes from merged worldbook map roots', () => {
    const result = validatePatch(
      {
        type: 'locationChange',
        reason: 'move to opening place scene',
        payload: {
          toLocationId: 'place_opening',
          toSceneId: 'scene_opening_yard',
        },
      },
      mapWorldBook,
      [],
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects region and scene ids as locationChange.toLocationId', () => {
    const regionResult = validatePatch(
      {
        type: 'locationChange',
        reason: 'bad region movement',
        payload: {
          toLocationId: 'region_root',
        },
      },
      mapWorldBook,
      [],
    );
    const sceneResult = validatePatch(
      {
        type: 'locationChange',
        reason: 'bad scene movement',
        payload: {
          toLocationId: 'scene_base_gate',
        },
      },
      mapWorldBook,
      [],
    );

    expect(regionResult.valid).toBe(false);
    expect(regionResult.errors.join('\n')).toContain('concrete place');
    expect(sceneResult.valid).toBe(false);
    expect(sceneResult.errors.join('\n')).toContain('concrete place');
  });

  it('rejects a scene that is not under the target concrete place', () => {
    const result = validatePatch(
      {
        type: 'locationChange',
        reason: 'scene belongs to another place',
        payload: {
          toLocationId: 'place_opening',
          toSceneId: 'scene_base_gate',
        },
      },
      mapWorldBook,
      [],
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('scene');
  });

  it('accepts runtime map nodes when runtime state is supplied', () => {
    const runtimeState = {
      mapNodes: [
        {
          id: 'place_runtime',
          name: 'Runtime Place',
          level: 'place',
          mapLayer: 'place',
          summary: 'A place created during play.',
          connectedRegionIds: [],
          controlHint: '',
          tensionHint: '',
        },
      ],
    } as unknown as RuntimeState;

    const result = validatePatch(
      {
        type: 'locationChange',
        reason: 'move to runtime place',
        payload: {
          toLocationId: 'place_runtime',
        },
      },
      mapWorldBook,
      [],
      runtimeState,
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('validatePatch with actorDiscovered', () => {
  it('不按具体历史人物姓名硬编码拦截关系描述', () => {
    const patch: StatePatch = {
      type: 'actorDiscovered',
      reason: '发现一名时代包提供的人物',
      payload: {
        name: '曹操',
        relationshipWithPlayer: '因当前剧情暂时愿意跟随玩家行动，但后续仍受世界书与剧情约束。',
      },
    };

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('validatePatch with timeAdvance', () => {
  it('rejects timeAdvance patches without an explicit elapsed amount', () => {
    const patch: StatePatch = {
      type: 'timeAdvance',
      reason: '模型只说明了原因，但没有给出经过时间',
      payload: {
        reason: '与守门军士交谈等待',
        category: 'conversation',
      },
    };

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('timeAdvance');
    expect(result.errors.join('\n')).toContain('minutesAdvanced');
  });

  it('allows explicit long-term training and waiting to advance several months', () => {
    const patch: StatePatch = {
      type: 'timeAdvance',
      reason: '玩家明确要求长期屯田练兵，推进约三个月',
      payload: {
        daysAdvanced: 91,
        hoursAdvanced: 7,
        minutesAdvanced: 15,
        reason: '三个月屯田练兵与打造装备',
        category: 'military',
      },
    };

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('still rejects implausibly huge single-turn day advances', () => {
    const patch: StatePatch = {
      type: 'timeAdvance',
      reason: '模型误把多年时间塞进单回合',
      payload: {
        daysAdvanced: 366,
        reason: '过久的跳时',
        category: 'waiting',
      },
    };

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('daysAdvanced 必须在 1 到 365 之间');
  });
});

describe('validatePatch with canonical resourceChanged contracts', () => {
  const validateResource = (payload: unknown) => validatePatch({
    type: 'resourceChanged',
    reason: 'resource contract test',
    payload,
  } as unknown as StatePatch, worldBook, []);

  it.each([
    { resource: 'grain', mode: 'delta', change: 5 },
    { resource: 'grain', mode: 'delta', change: '-2.5' },
    { resource: 'grain', mode: 'absolute', newValue: '12' },
    { resource: 'grain', change: '3' },
    { resource: 'grain', newValue: 8 },
  ])('accepts explicit and legacy unambiguous payload %#', (payload) => {
    expect(validateResource(payload).valid).toBe(true);
  });

  it.each([
    { resource: 'grain', change: 1, newValue: 2 },
    { resource: 'grain' },
    { resource: 'grain', mode: 'delta', newValue: 2 },
    { resource: 'grain', mode: 'absolute', change: 2 },
    { resource: 'grain', mode: 'delta', change: 1, newValue: 2 },
    { resource: '', mode: 'delta', change: 1 },
    { resource: '   ', mode: 'delta', change: 1 },
  ])('rejects ambiguous or mismatched payload %#', (payload) => {
    expect(validateResource(payload).valid).toBe(false);
  });

  it.each([
    '',
    ' 1',
    '1 ',
    '1kg',
    '0x10',
    true,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    'Infinity',
    '由系统计算',
  ])('rejects non-finite or ambiguous numeric value %#', (value) => {
    expect(validateResource({ resource: 'grain', mode: 'delta', change: value }).valid).toBe(false);
  });

  it('rejects a non-object payload without throwing', () => {
    const patch = {
      type: 'resourceChanged',
      reason: 'malformed resource payload',
      payload: null,
    } as unknown as StatePatch;

    expect(() => validatePatch(patch, worldBook, [])).not.toThrow();
    expect(validatePatch(patch, worldBook, []).valid).toBe(false);
  });

  it.each([
    ['string', 'bad'],
    ['number', 1],
    ['array', []],
  ])('returns the resource contract error for a %s payload and remains usable', (_label, payload) => {
    expect(() => validateResource(payload)).not.toThrow();
    expect(validateResource(payload)).toMatchObject({
      valid: false,
      errors: ['resourceChanged.payload 必须是对象'],
    });
    expect(validateResource({ resource: 'grain', change: 1 }).valid).toBe(true);
  });
});

describe('validatePatch with canonical relationshipChange contracts', () => {
  const validateRelationship = (payload: unknown) => validatePatch({
    type: 'relationshipChange',
    reason: 'relationship contract test',
    payload,
  } as unknown as StatePatch, worldBook, []);

  it.each([
    { actorId: 'actor_source', targetId: 'actor_target', targetKind: 'actor', value: 25 },
    { actorId: 'actor_source', targetId: 'faction_target', targetKind: 'faction', value: '-100' },
    {
      actorId: 'actor_source',
      targetId: 'actor_target',
      targetKind: 'actor',
      targetType: 'actor',
      value: 25,
    },
    {
      actorId: 'actor_source',
      targetId: 'faction_target',
      factionId: 'faction_target',
      targetKind: 'faction',
      value: 100,
    },
  ])('accepts canonical payloads and consistent aliases %#', (payload) => {
    expect(validateRelationship(payload).valid).toBe(true);
  });

  it('rejects targetType-only new patches even when the legacy alias is otherwise valid', () => {
    const result = validateRelationship({
      actorId: 'actor_source',
      targetId: 'faction_target',
      targetType: 'faction',
      value: 25,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('relationshipChange.targetKind 必须明确为 actor 或 faction');
  });

  it.each([
    { factionId: 'faction_target', value: 0 },
    { actorId: 'actor_source', factionId: 'faction_target', value: 0 },
    { actorId: 'actor_source', targetKind: 'actor', value: 0 },
    { actorId: '', targetId: 'actor_target', targetKind: 'actor', value: 0 },
    { actorId: 'actor_source', targetId: '', targetKind: 'actor', value: 0 },
    { actorId: 'actor_source', targetId: 'actor_target', targetKind: 'unknown', value: 0 },
    { actorId: 'actor_source', targetId: 'actor_target', value: 0 },
    { actorId: 'actor_source', targetId: 'actor_target', targetKind: 'actor', targetType: 'faction', value: 0 },
    {
      actorId: 'actor_source',
      targetId: 'faction_target_a',
      factionId: 'faction_target_b',
      targetKind: 'faction',
      targetType: 'faction',
      value: 0,
    },
    { actorId: 'actor_source', targetId: 'actor_target', targetKind: 'actor', value: -101 },
    { actorId: 'actor_source', targetId: 'actor_target', targetKind: 'actor', value: 101 },
    { actorId: 'actor_source', targetId: 'actor_target', targetKind: 'actor', value: Number.NaN },
    { actorId: 'actor_source', targetId: 'actor_target', targetKind: 'actor', value: Number.POSITIVE_INFINITY },
  ])('rejects incomplete or invalid payload %#', (payload) => {
    expect(validateRelationship(payload).valid).toBe(false);
  });

  it('rejects a non-object payload without throwing', () => {
    const patch = {
      type: 'relationshipChange',
      reason: 'malformed relationship payload',
      payload: null,
    } as unknown as StatePatch;

    expect(() => validatePatch(patch, worldBook, [])).not.toThrow();
    expect(validatePatch(patch, worldBook, []).valid).toBe(false);
  });

  it.each([
    ['string', 'bad'],
    ['number', 1],
    ['array', []],
  ])('returns the relationship contract error for a %s payload and remains usable', (_label, payload) => {
    expect(() => validateRelationship(payload)).not.toThrow();
    expect(validateRelationship(payload)).toMatchObject({
      valid: false,
      errors: ['relationshipChange.payload 必须是对象'],
    });
    expect(validateRelationship({
      actorId: 'actor_source',
      targetId: 'actor_target',
      targetKind: 'actor',
      value: 0,
    }).valid).toBe(true);
  });
});

describe('validatePatch raw payload global restrictions', () => {
  it.each([
    {
      type: 'resourceChanged',
      payload: {
        resource: 'grain',
        mode: 'delta',
        change: 1,
        officeTitle: 'field marshal',
        wholeWorldState: { injected: true },
      },
    },
    {
      type: 'relationshipChange',
      payload: {
        actorId: 'actor_source',
        targetId: 'actor_target',
        targetKind: 'actor',
        value: 10,
        officeTitle: 'field marshal',
        wholeWorldState: { injected: true },
      },
    },
  ] as const)('reports forbidden raw fields before $type canonical payload contraction', ({ type, payload }) => {
    const result = validatePatch({
      type,
      reason: 'raw payload must retain global diagnostics',
      payload,
    }, worldBook, []);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('不允许通过 patch 直接修改 wholeWorldState');
    expect(result.errors.join('\n')).toContain('结构化权力');
    expect(result.errors.join('\n')).toContain('officeTitle');
  });

  it('checks forbidden fields inside a recognized misnested command without mutating it', () => {
    const patch = {
      type: 'luanshiCommand',
      reason: 'misnested rumor must retain raw diagnostics',
      payload: {
        command: {
          action: 'rumorAdded',
          content: 'A courier claims the city gates will close tonight.',
          officeTitle: 'field marshal',
          wholeWorldState: { injected: true },
        },
      },
    } as unknown as StatePatch;
    const snapshot = structuredClone(patch);

    const result = validatePatch(patch, worldBook, []);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('不允许通过 patch 直接修改 wholeWorldState');
    expect(result.errors.join('\n')).toContain('结构化权力');
    expect(result.errors.join('\n')).toContain('officeTitle');
    expect(patch).toEqual(snapshot);
  });

  it('does not treat fields allowed by a canonical LuanShi action as direct privilege writes', () => {
    const result = validatePatch({
      type: 'luanshiCommand',
      reason: 'record an explicit identity update',
      payload: {
        command: {
          action: 'updateCharacterIdentity',
          characterType: 'player',
          characterId: 'player',
          officeTitle: '粮曹属吏',
        },
      },
    }, worldBook, []);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('validatePatch rumorAdded payload safety', () => {
  const validateRumor = (payload: unknown) => validatePatch({
    type: 'rumorAdded',
    reason: 'rumor payload safety test',
    payload,
  } as unknown as StatePatch, worldBook, []);

  it.each([
    ['string', 'bad'],
    ['number', 1],
    ['array', []],
    ['null', null],
  ])('returns invalid without throwing for a %s payload', (_label, payload) => {
    expect(() => validateRumor(payload)).not.toThrow();
    expect(validateRumor(payload)).toMatchObject({
      valid: false,
      errors: ['rumorAdded.payload 必须是对象'],
    });
  });

  it('does not mutate a valid payload while validating verified semantics', () => {
    const payload = {
      content: 'A test rumor.',
      verified: 'false',
      signalType: 'rumor',
      consequenceTags: ['test'],
    };
    const snapshot = structuredClone(payload);

    const result = validateRumor(payload);

    expect(result.valid).toBe(true);
    expect(payload).toEqual(snapshot);
  });
});

describe('validatePatch troop canonical location references', () => {
  const makeTroopPatch = (locationId: string): StatePatch => ({
    type: 'luanshiCommand',
    reason: 'write troop position',
    payload: {
      command: {
        action: 'upsertTroopLedger',
        troopId: `troop_${locationId}`,
        name: '位置测试部队',
        size: 100,
        morale: 50,
        training: 50,
        supplies: 30,
        task: '驻守',
        relationToPlayer: 'self',
        quality: '中',
        readiness: '中',
        fatigue: '低',
        lifecycleStatus: 'active',
        knownLevel: '亲历',
        certainty: 'confirmed',
        locationId,
        lastKnownLocationId: locationId,
      },
    },
  });

  it('accepts runtime Map V1 nodes, worldbook seeds, and current location ids', () => {
    const runtimeState = {
      ...makeBoundaryRuntimeState(),
      mapNodes: [{
        id: 'place_runtime_camp',
        name: '运行时军营',
        level: 'place',
        mapLayer: 'place',
        summary: '本局新登记军营。',
        connectedRegionIds: [],
        controlHint: '',
        tensionHint: '',
      }],
    } as RuntimeState;

    expect(validatePatch(makeTroopPatch('place_runtime_camp'), mapWorldBook, [], runtimeState).valid).toBe(true);
    expect(validatePatch(makeTroopPatch('place_base'), mapWorldBook, [], runtimeState).valid).toBe(true);
    expect(validatePatch(makeTroopPatch('loc_market_town'), mapWorldBook, [], runtimeState).valid).toBe(true);
  });

  it('rejects an explicitly written dangling troop location id', () => {
    const result = validatePatch(
      makeTroopPatch('loc_unknown_remote'),
      mapWorldBook,
      [],
      makeBoundaryRuntimeState(),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('引用了未登记地点 loc_unknown_remote');
    expect(result.errors.join('\n')).toContain('locationWriteSuggestions');
  });
});

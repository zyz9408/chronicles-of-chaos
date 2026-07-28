import { describe, expect, it } from 'vitest';
import type { Relationship, RuntimeState } from '../types';
import { ensureLuanShiState } from './createInitialRuntimeState';
import {
  CURRENT_RUNTIME_STATE_MIGRATION_VERSION,
  normalizeRuntimeStateForPersistence,
} from './RuntimeStateMigration';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'migration-test',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: 'day 1',
    currentDate: 'day 1',
    player: {
      id: 'player',
      name: 'Player',
      roleType: 'traveler',
      summary: 'Migration test player.',
    },
    currentLocationId: 'place_test',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
  });
}

function relationship(overrides: Record<string, unknown> = {}) {
  return {
    id: 'relationship_legacy',
    actorId: 'actor_source',
    targetId: 'faction_target',
    targetType: 'faction',
    type: 'neutral',
    value: 10,
    description: 'Legacy relationship.',
    ...overrides,
  };
}

describe('RuntimeStateMigration relationship invariant', () => {
  it('uses a dedicated migration version for canonical relationship kinds', () => {
    expect(CURRENT_RUNTIME_STATE_MIGRATION_VERSION).toBe(8);
  });

  it('closes a persisted quest-linked NPC plan whose canonical matter is already terminal', () => {
    const state = makeState();
    state.activeQuests = [{
      id: 'quest_supplies_delivered',
      title: '兑现精料承诺',
      description: '把约定的精料送入营库。',
      status: 'completed',
      outcomeSummary: '约定物资已经交付并完成入库。',
      archivedAt: 'day 1',
      createdAt: 'day 0',
      updatedAt: 'day 1',
    }];
    state.npcs = [{
      npcId: 'npc_supplier',
      name: '供货人',
      sex: '男',
      age: 40,
      role: '豪族管事',
      locationId: 'place_test',
      isPresent: false,
      isFocused: true,
      summary: '负责履行旧供应承诺。',
      appearance: '衣着整洁。',
      personality: '谨慎。',
      motivation: '维护家族利益。',
      relationToPlayer: '合作',
      contactLevel: 3,
      recentAttitude: '恭谨',
      memories: [],
      backgroundActivity: {
        activityId: 'activity_prepare_supplies',
        summary: '继续筹备尚未交付的物资。',
        status: 'active',
        sourceType: 'quest',
        sourceIds: ['quest_supplies_delivered'],
        dueAt: 'day 1',
      },
    }];

    const normalized = normalizeRuntimeStateForPersistence(state);

    expect(normalized.npcs?.[0].backgroundActivity).toMatchObject({
      activityId: 'activity_prepare_supplies',
      status: 'completed',
      lastEvaluatedAt: 'day 1',
    });
  });

  it('normalizes a legacy targetType-only relationship to consistent canonical fields', () => {
    const state = makeState();
    const legacyRelationship: Relationship = {
      id: 'relationship_legacy',
      actorId: 'actor_source',
      targetId: 'faction_target',
      targetType: 'faction',
      type: 'neutral',
      value: 10,
      description: 'Legacy relationship.',
    };
    state.relationships = [legacyRelationship];

    const normalized = normalizeRuntimeStateForPersistence(state);

    expect(normalized.relationships).toEqual([
      expect.objectContaining({
        id: 'relationship_legacy',
        targetKind: 'faction',
        targetType: 'faction',
      }),
    ]);
  });

  it('recovers a recent structured firsthand NPC memory that the stale presence flag rejected', () => {
    const state = makeState();
    state.npcs = [{
      npcId: 'npc_zoushi',
      name: '邹氏',
      sex: '女',
      age: 32,
      role: '内宅女眷',
      locationId: 'place_test',
      isPresent: false,
      isFocused: true,
      summary: '测试人物。',
      appearance: '端庄。',
      personality: '谨慎。',
      motivation: '安身。',
      relationToPlayer: '亲近',
      contactLevel: 80,
      recentAttitude: '依恋',
      memories: [],
    }];
    state.turnLog = [{
      turnNumber: 251,
      date: '公元194年05月03日 15:00（申时）',
      playerInput: '与邹氏交谈',
      narrativeText: '邹氏在内宅应答。',
      fullNarrativeText: '【邹氏】\n“夫君回来了。”',
      statePatchSummary: '已忽略无效写回建议：NPC记忆：NPC 邹氏 当前不在场，不能写入亲历记忆。',
      timestamp: '2026-07-18T08:30:00.000Z',
      displayMeta: {
        rawResponse: JSON.stringify({
          narrativeText: '【邹氏】\n“夫君回来了。”',
          suggestedActions: [],
          writeback: {
            npcMemorySuggestions: [{
              npcId: 'npc_zoushi',
              npcName: '邹氏',
              source: '亲历',
              content: '邹氏在内宅亲自迎接主角。',
            }],
          },
        }),
      },
    }];

    const normalized = normalizeRuntimeStateForPersistence(state);

    expect(normalized.npcs?.[0].memories).toEqual([
      expect.objectContaining({
        source: '亲历',
        content: '邹氏在内宅亲自迎接主角。',
        createdAt: '公元194年05月03日 15:00（申时）',
      }),
    ]);
  });

  it('repairs a legacy player identity description from the paired structured writeback', () => {
    const state = makeState();
    state.player = {
      ...state.player,
      currentIdentity: '讨寇校尉',
      currentIdentityDescription: '统领一曲步卒的基层带兵武官。',
      identitySummary: '以别部司马身份统领一曲步卒。',
    };
    state.turnLog = [{
      turnNumber: 273,
      date: '公元194年05月05日 07:00（辰时）',
      playerInput: '询问州牧府回信',
      narrativeText: '州牧府正式加封主角为讨寇校尉。',
      statePatchSummary: 'luanshiCommand: 正式加封为讨寇校尉。',
      timestamp: '2026-07-20T12:00:00.000Z',
      displayMeta: {
        rawResponse: JSON.stringify({
          narrativeText: '州牧府正式加封主角为讨寇校尉。',
          suggestedActions: [],
          statePatches: [{
            type: 'luanshiCommand',
            payload: {
              command: {
                action: 'updateCharacterIdentity',
                characterId: 'player',
                currentIdentity: '讨寇校尉',
                militaryTitle: '讨寇校尉',
              },
            },
          }],
          writeback: {
            protagonistProfile: {
              currentIdentity: '讨寇校尉',
              currentIdentityDescription: '受州牧府正式加封，可独立统领数千兵马的校尉。',
              identitySummary: '受封讨寇校尉，奉命扼守云梦泽水路。',
            },
          },
        }),
      },
    }];

    const normalized = normalizeRuntimeStateForPersistence(state);

    expect(normalized.player.currentIdentityDescription)
      .toBe('受州牧府正式加封，可独立统领数千兵马的校尉。');
    expect(normalized.player.identitySummary).toBe('受封讨寇校尉，奉命扼守云梦泽水路。');
  });

  it('clears legacy dependent identity text when the latest structured promotion omitted replacements', () => {
    const state = makeState();
    state.player = {
      ...state.player,
      currentIdentity: '讨寇校尉',
      currentIdentityDescription: '统领一曲步卒的基层带兵武官。',
      identitySummary: '以别部司马身份统领一曲步卒。',
    };
    state.turnLog = [{
      turnNumber: 273,
      date: '公元194年05月05日 07:00（辰时）',
      playerInput: '询问州牧府回信',
      narrativeText: '州牧府正式加封主角为讨寇校尉。',
      statePatchSummary: 'luanshiCommand: 正式加封为讨寇校尉。',
      timestamp: '2026-07-20T12:00:00.000Z',
      displayMeta: {
        rawResponse: JSON.stringify({
          narrativeText: '州牧府正式加封主角为讨寇校尉。',
          suggestedActions: [],
          statePatches: [{
            type: 'luanshiCommand',
            payload: {
              command: {
                action: 'updateCharacterIdentity',
                characterId: 'player',
                currentIdentity: '讨寇校尉',
              },
            },
          }],
        }),
      },
    }];

    const normalized = normalizeRuntimeStateForPersistence(state);

    expect(normalized.player.currentIdentityDescription).toBeUndefined();
    expect(normalized.player.identitySummary).toBeUndefined();
  });

  it.each([
    relationship({ targetKind: 'actor', targetType: 'faction' }),
    relationship({ targetKind: 'invalid', targetType: 'faction' }),
    relationship({ targetKind: 'faction', targetType: 'invalid' }),
  ])('rejects conflicting or invalid persisted relationship kinds %#', (invalidRelationship) => {
    const state = makeState();
    state.relationships = [invalidRelationship as RuntimeState['relationships'][number]];

    expect(() => normalizeRuntimeStateForPersistence(state)).toThrow(/relationship|targetKind|targetType|关系/);
  });

  it.each([-101, 101])('rejects a persisted relationship value outside -100..100: %s', (value) => {
    const state = makeState();
    state.relationships = [relationship({ targetKind: 'faction', value }) as Relationship];

    expect(() => normalizeRuntimeStateForPersistence(state)).toThrow(/value|关系值|-100|100/);
  });

  it.each([-100, 100])('preserves an inclusive relationship boundary value: %s', (value) => {
    const state = makeState();
    state.relationships = [relationship({ targetKind: 'faction', value }) as Relationship];

    expect(normalizeRuntimeStateForPersistence(state).relationships[0].value).toBe(value);
  });
});

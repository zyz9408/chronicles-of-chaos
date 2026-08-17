import { describe, expect, it } from 'vitest';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState, WorldBook } from '../types';
import { executeTurn } from './TurnOrchestrator';

const worldBook = {
  manifest: {
    id: 'relationship-test', name: '关系测试', version: '1', author: 'test', language: 'zh-CN',
    genre: '乱世', source: 'official', compatibleEngineVersion: '1',
  },
  ontology: { regionLevels: [], factionTypes: [], actorRoleTypes: [], socialClasses: [], resourceTypes: [], conflictTypes: [], actionTypes: [], relationshipTypes: [] },
  lore: '', mapSeed: [], factionsSeed: [], timelineAnchors: [], startBookmarks: [], openingCrisisTemplates: [],
  prompts: { narrativeBaseline: '', forbiddenTopics: [], outputFormat: '', toneGuide: '' },
  validationRules: [],
} as unknown as WorldBook;

const apiConfig = {
  id: 'relationship-test-api', name: 'test', provider: 'openai_compatible', baseUrl: 'https://example.com/v1',
  apiKey: 'test', model: 'test', createdAt: '', updatedAt: '',
} as ApiConfigArchive;

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '1', worldBookId: 'relationship-test', worldBookVersion: '1', worldBookSource: 'official',
    startDate: '公元184年03月01日 08:00（辰时）', currentDate: '公元184年03月01日 08:00（辰时）',
    currentTime: { year: 184, month: 3, day: 1, hour: 8, minute: 0 },
    player: { id: 'player', name: '主角', roleType: '游侠', summary: '' }, currentLocationId: 'place_test',
    knownActors: [], knownFactions: [], relationships: [], knownRumors: [], activeQuests: [], playerResources: {},
    worldStateDelta: {}, turnLog: [], localSituationNotes: [],
    locations: [{ locationId: 'place_test', name: '测试地点', type: '聚落', summary: '', knownLevel: '亲历', recentEvents: [] }],
    npcs: [{
      npcId: 'npc_ally', name: '盟友甲', sex: '男', age: 30, role: '游侠', isPresent: false, isFocused: false,
      summary: '', appearance: '', personality: '', motivation: '', relationToPlayer: '盟友', contactLevel: 20,
      recentAttitude: '信任', memories: [],
    }, {
      npcId: 'npc_heroine', name: '红颜乙', sex: '女', age: 24, birthDate: '公元160年04月18日', role: '士人',
      isPresent: false, isFocused: false, summary: '', appearance: '', personality: '', motivation: '',
      relationToPlayer: '彼此牵挂', contactLevel: 30, recentAttitude: '亲近', memories: [],
    }],
  } as RuntimeState);
}

describe('structured relationship admissions', () => {
  it('仅依据结构化成立事实补建严格红颜与羁绊命令', async () => {
    const response = {
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: '主角与盟友甲约定长期互助，也与红颜乙确认彼此牵挂。',
      suggestedActions: [],
      statePatches: [{
        type: 'timeAdvance', reason: '交谈耗时',
        payload: { minutesAdvanced: 10, reason: '确认长期关系', category: 'conversation' },
      }],
      statePatch: null,
      writeback: {
        turnSummary: {
          brief: '两条长期关系正式成立。',
          relationshipAdmissions: [{
            sourceRefId: 'relationship-bond-turn-1', relationshipKind: 'bond', targetNames: ['盟友甲'],
            bondType: 'ally', summary: '双方明确约定长期互助。',
          }, {
            sourceRefId: 'relationship-heroine-turn-1', relationshipKind: 'heroine', npcId: 'npc_heroine',
            stage: '相知', relationshipRole: '彼此牵挂的知己', summary: '双方明确承认长期情感牵引。',
          }],
        },
        npcMemorySuggestions: [], locationWriteSuggestions: [], routeWriteSuggestions: [], questChanges: [], debugNotes: [],
      },
    };
    const result = await executeTurn(worldBook, makeState(), '确认关系', {
      apiConfig,
      llmClient: { generate: async () => ({ content: JSON.stringify(response), provider: 'openai_compatible', model: 'test' }) },
    });

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.newRuntimeState.bondThreads).toHaveLength(1);
    expect(result.newRuntimeState.bondThreads?.[0]).toMatchObject({
      targetNpcIds: ['npc_ally'], targetNames: ['盟友甲'], bondType: 'ally', status: 'active',
    });
    expect(result.newRuntimeState.heroineThreads).toHaveLength(1);
    expect(result.newRuntimeState.heroineThreads?.[0]).toMatchObject({
      npcId: 'npc_heroine', npcName: '红颜乙', stage: '相知', status: 'active',
    });
  });

  it('先补全同回合新人物志，再以相同稳定 ID 建立羁绊', async () => {
    const mainResponse = {
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: '许褚接受招募，正式成为主角长期同行的盟友。',
      suggestedActions: [],
      statePatches: [{
        type: 'timeAdvance', reason: '招募交谈耗时',
        payload: { minutesAdvanced: 10, reason: '许褚接受招募', category: 'conversation' },
      }],
      statePatch: null,
      writeback: {
        turnSummary: {
          brief: '许褚正式接受招募。',
          npcAdmissions: [{
            sourceRefId: 'npc-admission-turn-1-xuchu', npcId: 'npc_xuchu', name: '许褚',
            persistenceReason: 'historical_figure',
            persistenceEvidence: '许褚已经正式接受招募并约定长期同行。',
            summary: '许褚成为主角长期阵营中的历史人物。',
          }],
          relationshipAdmissions: [{
            sourceRefId: 'relationship-turn-1-xuchu', relationshipKind: 'bond',
            targetNpcIds: ['npc_xuchu'], targetNames: ['许褚'], bondType: 'ally',
            summary: '许褚接受招募，双方建立长期盟友关系。',
          }],
        },
        npcProfileSuggestions: [], npcMemorySuggestions: [], locationWriteSuggestions: [],
        routeWriteSuggestions: [], questChanges: [], debugNotes: [],
      },
    };
    const repairResponse = {
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: mainResponse.narrativeText,
      suggestedActions: [],
      statePatches: [],
      statePatch: null,
      writeback: {
        npcProfileSuggestions: [{
          npcId: 'npc_xuchu', name: '许褚', persistenceReason: 'historical_figure',
          persistenceEvidence: '许褚已经正式接受招募并约定长期同行。',
          sex: '男', age: 15, birthDate: '公元169年06月12日', role: '豪杰',
          locationId: 'place_test', isPresent: true, isFocused: true, currentIdentity: '受募豪杰',
          summary: '已接受主角招募的豪杰。', appearance: '体格雄壮。', personality: '忠直勇烈。',
          motivation: '守护新近认可的主君。', relationToPlayer: '新近投效', contactLevel: 12,
          recentAttitude: '郑重认可',
          abilityScores: { 武力: 50, 统率: 50, 智力: 50, 政治: 50, 魅力: 50, 机运: 50 },
          traits: [{ id: 'trait_xuchu_brave', label: '勇烈', description: '临阵敢战。', source: 'history' }],
        }],
        npcMemorySuggestions: [], locationWriteSuggestions: [], routeWriteSuggestions: [],
        questChanges: [], debugNotes: [],
      },
    };
    let requestCount = 0;
    const result = await executeTurn(worldBook, makeState(), '正式招募许褚', {
      apiConfig,
      llmClient: {
        generate: async () => ({
          content: JSON.stringify(requestCount++ === 0 ? mainResponse : repairResponse),
          provider: 'openai_compatible',
          model: 'test',
        }),
      },
    });

    expect(requestCount).toBe(2);
    expect(result.patchValidation?.valid).toBe(true);
    expect(result.newRuntimeState.npcs?.find((npc) => npc.npcId === 'npc_xuchu')).toMatchObject({
      name: '许褚',
    });
    expect(result.newRuntimeState.bondThreads).toHaveLength(1);
    expect(result.newRuntimeState.bondThreads?.[0]).toMatchObject({
      targetNpcIds: ['npc_xuchu'], targetNames: ['许褚'], bondType: 'ally', status: 'active',
    });
  });

  it('同回合完整人物志建议可在应用前建立稳定红颜关系', async () => {
    const response = {
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: '杜若与主角确认长期相守的约定。',
      suggestedActions: [],
      statePatches: [{
        type: 'timeAdvance', reason: '交谈耗时',
        payload: { minutesAdvanced: 10, reason: '确认长期关系', category: 'conversation' },
      }],
      statePatch: null,
      writeback: {
        turnSummary: {
          brief: '杜若与主角确认长期关系。',
          npcAdmissions: [{
            sourceRefId: 'npc-admission-turn-1-du-ruo', npcId: 'npc_du_ruo', name: '杜若',
            persistenceReason: 'player_committed_relationship',
            persistenceEvidence: '双方已经确认长期相守并约定此后保持联络。',
            summary: '杜若进入主角的长期人物关系。',
          }],
          relationshipAdmissions: [{
            sourceRefId: 'relationship-turn-1-du-ruo', relationshipKind: 'heroine', npcId: 'npc_du_ruo',
            stage: '相知', relationshipRole: '相守知己', summary: '双方确认长期情感牵引。',
          }],
        },
        npcProfileSuggestions: [{
          npcId: 'npc_du_ruo', name: '杜若', persistenceReason: 'player_committed_relationship',
          persistenceEvidence: '双方已经确认长期相守并约定此后保持联络。',
          sex: '女', age: 22, birthDate: '公元162年05月09日', role: '士人',
          locationId: 'place_test', isPresent: true, isFocused: true, currentIdentity: '主角知己',
          summary: '与主角确认长期关系的士人。', appearance: '举止端凝。', personality: '沉静坚定。',
          motivation: '维系双方已经确认的长期承诺。', relationToPlayer: '相知相守', contactLevel: 35,
          recentAttitude: '亲近而郑重',
          abilityScores: { 武力: 50, 统率: 50, 智力: 50, 政治: 50, 魅力: 50, 机运: 50 },
          traits: [{ id: 'trait_du_ruo_steady', label: '坚定', description: '重视长期承诺。', source: 'event' }],
        }],
        npcMemorySuggestions: [], locationWriteSuggestions: [], routeWriteSuggestions: [],
        questChanges: [], debugNotes: [],
      },
    };
    const result = await executeTurn(worldBook, makeState(), '确认与杜若的关系', {
      apiConfig,
      llmClient: {
        generate: async () => ({
          content: JSON.stringify(response), provider: 'openai_compatible', model: 'test',
        }),
      },
    });

    expect(result.patchValidation?.valid).toBe(true);
    expect(result.newRuntimeState.npcs?.find((npc) => npc.npcId === 'npc_du_ruo')).toMatchObject({ name: '杜若' });
    expect(result.newRuntimeState.heroineThreads).toHaveLength(1);
    expect(result.newRuntimeState.heroineThreads?.[0]).toMatchObject({
      npcId: 'npc_du_ruo', npcName: '杜若', stage: '相知', status: 'active',
    });
  });
});

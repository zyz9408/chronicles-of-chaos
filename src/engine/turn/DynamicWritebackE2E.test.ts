import { describe, expect, it, vi } from 'vitest';
import type { LlmGenerateRequest } from '../llm/LlmClient';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import type { LuanShiNpc, RuntimeState, WorldBook } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { selectPromptContext } from '../state/selectPromptContext';
import { buildDynamicPanelModel } from '../../ui/dynamicPanelModel';
import { applyNarratorWriteback } from './NarratorWritebackApplier';
import { parseNarratorResponse } from './NarratorResponseParser';
import { composePrompt } from './PromptComposer';
import { executeTurn } from './TurnOrchestrator';

const worldBook: WorldBook = {
  manifest: {
    id: 'dynamic-e2e-world',
    name: 'Dynamic E2E World',
    version: '0.1.0',
    author: 'test',
    language: 'zh-CN',
    genre: 'historical-chaos',
    source: 'official',
    compatibleEngineVersion: '0.1.0',
  },
  ontology: {
    regionLevels: [],
    factionTypes: [],
    actorRoleTypes: [],
    socialClasses: [],
    resourceTypes: [],
    conflictTypes: [],
    actionTypes: [],
    relationshipTypes: [],
  },
  lore: '',
  mapSeed: [
    {
      id: 'region_root',
      name: 'Root Region',
      level: 'region',
      mapLayer: 'region',
      summary: 'A test region.',
      connectedRegionIds: [],
      controlHint: '',
      tensionHint: '',
      subLocations: [
        {
          id: 'place_market',
          name: 'Market Gate',
          level: 'place',
          mapLayer: 'place',
          summary: 'A gate beside the market.',
          connectedRegionIds: [],
          controlHint: '',
          tensionHint: '',
        },
      ],
    },
  ],
  factionsSeed: [],
  timelineAnchors: [],
  startBookmarks: [],
  openingCrisisTemplates: [],
  prompts: {
    narrativeBaseline: 'Run the world from current facts.',
    forbiddenTopics: [],
    outputFormat: 'Return JSON.',
    toneGuide: 'Plain, grounded prose.',
  },
  validationRules: [],
};

const apiConfig: ApiConfigArchive = {
  id: 'api_dynamic_writeback_e2e',
  name: 'Dynamic writeback E2E API',
  provider: 'openai_compatible',
  baseUrl: 'https://example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'dynamic-e2e-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: 'day 10',
    currentDate: 'day 10',
    player: {
      id: 'player',
      name: 'Player',
      roleType: 'captain',
      summary: 'A local captain near the market gate.',
    },
    currentLocationId: 'place_market',
    currentPlaceId: 'place_market',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    locations: [
      {
        locationId: 'place_market',
        name: 'Market Gate',
        type: 'gate',
        summary: 'The current gate under pressure.',
        knownLevel: '亲历',
        recentEvents: [],
      },
    ],
    npcs: [
      {
        npcId: 'npc_bridge_guard',
        name: 'Bridge Guard',
        sex: '男',
        age: 32,
        role: 'gate guard',
        locationId: 'place_market',
        isPresent: true,
        isFocused: false,
        summary: 'A guard who knows the market gate.',
        appearance: 'Plain armor.',
        personality: 'Cautious.',
        motivation: 'Keep the gate from falling.',
        relationToPlayer: 'Works with the player.',
        contactLevel: 12,
        recentAttitude: 'alert',
        memories: [],
      },
    ],
  });
}

describe('dynamic writeback end-to-end smoke', () => {
  it('projects dynamic writeback into next-turn context, prompt, and visible panels without mutating linked entities', () => {
    const initialState = makeState();
    const parsed = parseNarratorResponse(JSON.stringify({
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: 'The gate grows tense.',
      suggestedActions: [],
      statePatches: [],
      writeback: {
        protagonistMemory: null,
        npcMemorySuggestions: [],
        locationWriteSuggestions: [],
        routeWriteSuggestions: [],
        questChanges: [
          {
            action: 'add',
            questId: 'quest_hold_bridge',
            title: 'Hold the market bridge',
            summary: 'The player is now responsible for keeping the market bridge open.',
            currentStep: 'Find whether the eastern patrol has crossed.',
            stakes: 'If delayed, refugees may be trapped outside the gate.',
            source: 'Bridge Guard',
            priority: 'high',
            relatedNpcIds: ['npc_bridge_guard'],
            relatedLocationIds: ['place_market'],
            outcomeSummary: 'Pressure increases, but no force or holding state changes yet.',
            consequenceTags: ['bridge-pressure'],
            affectedForceIds: ['force_eastern_patrol'],
            affectedHoldingIds: ['holding_market_bridge'],
            followUpHooks: ['confirm patrol movement'],
            severity: 'major',
            threadId: 'thread_bridge_pressure',
          },
        ],
        signalChanges: [
          {
            action: 'add',
            rumorId: 'signal_remote_ally',
            title: 'Remote ally asks after the gate',
            content: 'A remote ally may send a messenger if the bridge remains open.',
            source: 'merchant talk',
            signalType: 'rumor',
            confidence: 'medium',
            severity: 'major',
            potentialOutcomeSummary: 'If true, the ally can re-enter the story through a messenger.',
            relatedLocationIds: ['place_market'],
            npcAwarenessRefs: [
              {
                npcId: 'npc_remote_ally',
                name: 'Remote Ally',
                contactLevel: 35,
                historicalImportance: 20,
                playerRelevance: ['old alliance'],
                unresolvedHooks: ['may invite player'],
              },
            ],
          },
        ],
        plotPlanSuggestions: [
          {
            action: 'add',
            plotId: 'plot_hidden_bridge_pressure',
            title: 'Hidden bridge pressure',
            horizon: '\u4e2d\u671f',
            status: '\u8fdb\u884c\u4e2d',
            priority: '\u9ad8',
            summary: 'A rival faction is testing whether the player can hold the bridge.',
          },
        ],
        worldEventSummary: {
          eventId: 'trend_gate_pressure',
          title: 'Market bridge pressure spreads',
          summary: 'Reports of pressure around the market bridge begin to spread.',
          visibility: '\u516c\u5f00',
          scope: 'regional',
          certainty: 'reported',
          severity: 'high',
          locationId: 'place_market',
          affectedNpcIds: ['npc_bridge_guard'],
          affectedForceIds: ['force_eastern_patrol'],
          affectedHoldingIds: ['holding_market_bridge'],
          consequenceTags: ['regional-pressure'],
          outcomeSummary: 'Nearby travelers now treat the gate as risky.',
          status: 'active',
          progressSummary: 'The regional gate pressure remains unresolved.',
          nextCheckAt: 'day 11',
          followUpHooks: ['track who benefits from the pressure'],
          sourceQuestIds: ['quest_hold_bridge'],
          sourceSignalIds: ['signal_remote_ally'],
          threadId: 'thread_bridge_pressure',
          knownToPlayer: true,
          npcAwarenessRefs: [
            {
              npcId: 'npc_remote_ally',
              name: 'Remote Ally',
              contactLevel: 35,
              playerRelevance: ['old alliance'],
              unresolvedHooks: ['may invite player'],
            },
          ],
        },
        debugNotes: [],
      },
    }));

    const application = applyNarratorWriteback(initialState, parsed.writeback!, worldBook);
    const nextState = application.state;
    const selected = selectPromptContext(nextState) as any;
    const prompt = composePrompt(worldBook, undefined, [], undefined, nextState, 'What happens next?');
    const panel = buildDynamicPanelModel(nextState);

    expect(nextState.activeQuests).toHaveLength(1);
    expect(nextState.knownRumors).toHaveLength(1);
    expect(nextState.plotPlan).toHaveLength(1);
    expect(nextState.worldTrends).toHaveLength(1);
    expect(nextState.npcAwarenessIndex?.[0]).toMatchObject({
      npcId: 'npc_remote_ally',
      name: 'Remote Ally',
      sourceIds: ['signal_remote_ally', 'trend_gate_pressure'],
    });

    expect(nextState.npcs).toEqual(initialState.npcs);
    expect(nextState.locations).toEqual(initialState.locations);
    expect(nextState.factions).toEqual(initialState.factions);
    expect(nextState.troops).toEqual(initialState.troops);

    expect(selected.relevantCurrentQuests.map((quest: any) => quest.id)).toEqual(['quest_hold_bridge']);
    expect(selected.relevantSignals.map((signal: any) => signal.id)).toEqual(['signal_remote_ally']);
    expect(selected.relevantWorldTrends.map((trend: any) => trend.trendId)).toEqual(['trend_gate_pressure']);
    expect(selected.relevantPlotPlans.map((plot: any) => plot.plotId)).toEqual(['plot_hidden_bridge_pressure']);
    expect(selected.remoteNpcPresenceBeats.map((beat: any) => beat.npcId)).toEqual(['npc_remote_ally']);

    expect(prompt.narrativeContext).toContain('Hold the market bridge');
    expect(prompt.narrativeContext).toContain('Remote ally asks after the gate');
    expect(prompt.narrativeContext).toContain('Market bridge pressure spreads');
    expect(prompt.narrativeContext).toContain('Hidden bridge pressure');
    expect(prompt.narrativeContext).toContain('Remote Ally');
    expect(prompt.stateWriterContext).toContain('plot_hidden_bridge_pressure');

    expect(panel.itemsByStage.urgent.currentMatters.map((item) => item.id)).toEqual(['quest_hold_bridge']);
    expect(panel.itemsByStage.developing.signals.map((item) => item.id)).toEqual(['signal_remote_ally']);
    expect(panel.itemsByStage.developing.chronicles.map((item) => item.id)).toEqual(['trend_gate_pressure']);
    expect(JSON.stringify(panel)).not.toContain('plot_hidden_bridge_pressure');
    expect(JSON.stringify(panel)).not.toContain('Hidden bridge pressure');
  });

  it('repairs, canonicalizes, preserves, and reprojects NPC identities through the next real turn', async () => {
    const archivedNpc: LuanShiNpc = {
      npcId: 'npc_shen_lan',
      name: '沈岚',
      courtesyName: '清和',
      aliases: ['兰娘'],
      sex: '女' as const,
      age: 28,
      role: '旧部参军',
      factionId: 'faction_old_guard',
      factionName: '旧部',
      locationId: 'place_market',
      isPresent: false,
      isFocused: true,
      birthOrigin: '河东安邑',
      birthOriginDescription: '安邑旧族旁支，自幼随军学习文书。',
      currentIdentity: '旧部参军',
      identitySummary: '安邑出身、长期随军的旧部参军。',
      summary: '此前只通过军报与主角联系。',
      appearance: '眉目沉静，衣着利落。',
      personality: '谨慎细致。',
      motivation: '保全旧部并查清军粮账目。',
      relationToPlayer: '可信旧部',
      contactLevel: 35,
      recentAttitude: '信任',
      abilityScores: { 武力: 35, 统率: 55, 智力: 76, 政治: 68, 魅力: 62, 机运: 50 },
      traits: [{ id: 'trait_old_staff', label: '旧部参军', description: '熟悉旧部军务。', source: 'history' }],
      uniqueArts: [{
        id: 'art_old_ledger', name: '军簿推演', rarity: 'blue', domain: 'strategy', level: 2,
        description: '从军簿中追查异常。', effectSummary: '核账时更易发现矛盾。', source: 'history',
      }],
      effects: [{
        id: 'effect_old_concern', label: '牵挂旧部', type: 'mixed', duration: 'long',
        description: '涉及旧部安危时更加审慎。', source: 'history',
      }],
      equipment: [{
        id: 'eq_old_dagger', slot: 'weapon', name: '旧部短剑', quality: '精良', description: '随身多年的短剑。',
      }],
      inventory: [{ id: 'item_old_ledger', name: '旧军簿', quantity: 1, category: 'document' }],
      femaleProfile: {
        appearanceDescription: '眉目沉静，衣着利落。',
        relationshipNotes: '与主角有旧部信任。',
        adultPrivateProfile: {
          enabled: true,
          ageConfirmedAdult: true,
          summary: '既有长期私密档案。',
        },
      },
      memories: [{
        memoryId: 'memory_old_city_watch', source: '亲历' as const,
        content: '曾与主角共同核对城防军簿。', createdAt: 'day 9',
      }],
    };
    const initialState = ensureLuanShiState({
      ...makeState(),
      npcs: [...(makeState().npcs ?? []), archivedNpc],
      relationships: [{
        id: 'relationship_player_shen_lan', actorId: 'player', targetId: 'npc_shen_lan',
        targetKind: 'actor', targetType: 'actor', type: '旧部', value: 35, description: '长期共事形成的信任。',
      }],
      npcAwarenessIndex: [{
        awarenessId: 'awareness_shen_lan', npcId: 'npc_shen_lan', name: '沈岚', sourceType: 'npcProfile',
        sourceIds: ['npc_shen_lan'], contactLevel: 35, playerRelevance: ['旧部军务'], knownToPlayer: true,
        archiveVisible: true, updatedAt: 'day 9',
      }],
      worldTrends: [{
        trendId: 'event_ledger_pressure', title: '账册疑点', severity: '中', summary: '账册疑点尚未厘清。',
        knownToPlayer: true, status: 'active', scope: 'regional', sourceConflictIds: ['conflict_supply'],
        progressSummary: '区域军粮核验仍在推进。', nextCheckAt: 'day 10',
        happenedAt: 'day 9', learnedAt: 'day 9', updatedAt: 'day 9',
      }],
    });
    const mainResponse = {
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: '风停了。顾衡：营门账册已经送到。顾衡随后又请主角核验签押。',
      suggestedActions: [],
      statePatches: [{
        type: 'timeAdvance',
        payload: { minutesAdvanced: 15, reason: '核验账册', category: 'conversation' },
        reason: '核验账册耗时',
      }],
      statePatch: null,
      writeback: {
        npcProfileSuggestions: [{
          npcId: 'npc_gu_heng', name: '顾衡', courtesyName: '子正',
          persistenceReason: 'active_system_role',
          persistenceEvidence: '本回合确认顾衡长期担任营门校尉并持续负责军簿与营门事务。',
          sex: '男', age: 0,
          role: '营门校尉', locationId: 'place_market', isPresent: true, currentIdentity: '营门校尉',
          summary: '前来递交账册。', appearance: '披甲持簿。', personality: '沉稳。', motivation: '核清账册。',
          relationToPlayer: '初次共事', contactLevel: 5, recentAttitude: '恭谨',
          abilityScores: { 武力: 55, 统率: 60, 智力: 62, 政治: 50, 魅力: 48, 机运: 50 },
          traits: [{ id: 'trait_gate_officer', label: '营门校尉', description: '熟悉营门事务。', source: 'identity' }],
          uniqueArts: [{
            id: 'art_gu_heng_ledger', name: '军簿核验', rarity: 'green', domain: 'strategy', level: 1,
            description: '熟悉营门军簿与签押核验。', effectSummary: '强化军务核验和账册判断。', source: 'identity',
            acquisition: { kind: 'background', occurredAt: '乱世元年2月', sourceRefId: 'npc-profile:npc_gu_heng_compliance:background', summary: '长期营门军务身份与经历已经确立该能力。' },
          }],
        }],
        npcMemorySuggestions: [{
          npcId: 'npc_lan_niang_drift', npcName: '兰娘', source: '亲历', content: '与主角当面复核了新军粮账册。',
        }],
        locationWriteSuggestions: [], routeWriteSuggestions: [],
        questChanges: [{
          action: 'add', questId: 'quest_verify_ledger', title: '复核军粮账册', summary: '与沈岚复核账册。',
          relatedNpcIds: ['npc_lan_niang_drift'], affectedNpcIds: ['npc_lan_niang_drift'],
        }],
        signalChanges: [{
          action: 'add', rumorId: 'signal_ledger_checked', content: '军粮账册已经复核。',
          affectedNpcIds: ['npc_lan_niang_drift'],
          npcAwarenessRefs: [{ name: '兰娘', npcId: 'npc_lan_niang_drift' }],
        }],
        worldEventUpdates: [{
          eventId: 'event_ledger_pressure', summary: '账册疑点正在扩散。',
          affectedNpcIds: ['npc_lan_niang_drift'],
          npcAwarenessRefs: [{ name: '兰娘', npcId: 'npc_lan_niang_drift' }],
        }],
        worldEventSummary: {
          eventId: 'event_ledger_meeting', title: '区域军粮复核', summary: '主角与沈岚复核账册。',
          scope: 'regional', severity: 'high', status: 'historical', sourceConflictIds: ['conflict_supply'],
          locationId: 'place_market',
          presentNpcIds: ['npc_lan_niang_drift'], involvedNpcIds: ['npc_lan_niang_drift'],
          affectedNpcIds: ['npc_lan_niang_drift'],
          npcAwarenessRefs: [{ name: '兰娘', npcId: 'npc_lan_niang_drift' }],
        },
        debugNotes: [],
      },
    };
    const profileBase = {
      sex: '女', age: 28, role: '新军参军', factionName: '新军', locationId: 'place_market', isPresent: true,
      currentIdentity: '新军粮务参军', summary: '本回合明确转任新军粮务参军。', appearance: '眉目沉静，衣着利落。',
      personality: '谨慎细致。', motivation: '查清军粮账目。', relationToPlayer: '可信同僚', contactLevel: 40,
      recentAttitude: '信任', abilityScores: { 武力: 35, 统率: 55, 智力: 76, 政治: 68, 魅力: 62, 机运: 50 },
      traits: [], uniqueArts: [], inventory: [],
    };
    const repairResponse = {
      protocolVersion: 'lsfy.turn.v1', narrativeText: mainResponse.narrativeText, suggestedActions: [],
      statePatches: [], statePatch: null,
      writeback: {
        npcProfileSuggestions: [
          {
            npcId: 'npc_gu_heng', name: '顾衡', courtesyName: '子正',
            persistenceReason: 'active_system_role',
            persistenceEvidence: '本回合确认顾衡长期担任营门校尉并持续负责军簿与营门事务。',
            sex: '男', age: 31,
            role: '营门校尉', locationId: 'place_market', isPresent: true, isFocused: true,
            currentIdentity: '营门校尉', summary: '前来递交账册。', appearance: '披甲持簿。', personality: '沉稳。',
            motivation: '核清账册。', relationToPlayer: '初次共事', contactLevel: 5, recentAttitude: '恭谨',
            abilityScores: { 武力: 55, 统率: 60, 智力: 62, 政治: 50, 魅力: 48, 机运: 50 },
            traits: [{ id: 'trait_gate_officer', label: '营门校尉', description: '熟悉营门事务。', source: 'identity' }],
            uniqueArts: [{
              id: 'art_gu_heng_ledger', name: '军簿核验', rarity: 'green', domain: 'strategy', level: 1,
              description: '熟悉营门军簿与签押核验。', effectSummary: '强化军务核验和账册判断。', source: 'identity',
              acquisition: { kind: 'background', occurredAt: '乱世元年2月', sourceRefId: 'npc-profile:npc_gu_heng_compliance:background', summary: '长期营门军务身份与经历已经确立该能力。' },
            }],
          },
          {
            ...profileBase, npcId: 'npc_qing_he_drift', name: '清和', courtesyName: null, aliases: ['沈岚', '兰娘'],
            identitySummary: null,
            femaleProfile: {
              relationshipNotes: '本回合与主角共同核账。',
              relationshipNetwork: [
                { targetName: '子正', relationship: '账册交接人' },
                { targetName: '陌生人', relationship: '未确认' },
              ],
              adultPrivateProfile: { enabled: true, ageConfirmedAdult: true, firstNightPartner: '子正' },
            },
          },
          { ...profileBase, npcId: 'npc_lan_niang_drift', name: '兰娘', courtesyName: '清和', aliases: ['沈岚'] },
        ],
        npcMemorySuggestions: [], locationWriteSuggestions: [], routeWriteSuggestions: [], questChanges: [], debugNotes: [],
      },
    };
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify(mainResponse), provider: 'openai_compatible' as const, model: 'test-model',
    })) };
    const npcCompletionLlmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify(repairResponse), provider: 'openai_compatible' as const, model: 'npc-completion-model',
    })) };

    const firstTurn = await executeTurn(worldBook, initialState, '核验营门账册', {
      apiConfig, llmClient,
      npcCompletionApiConfig: { ...apiConfig, id: 'npc-completion', model: 'npc-completion-model' },
      npcCompletionLlmClient,
    });
    const npc = firstTurn.newRuntimeState.npcs?.find((item) => item.npcId === 'npc_shen_lan');

    expect(npcCompletionLlmClient.generate).toHaveBeenCalledOnce();
    expect(firstTurn.newRuntimeState.npcs?.find((item) => item.npcId === 'npc_gu_heng')).toMatchObject({ age: 31 });
    expect(firstTurn.newRuntimeState.npcs?.filter((item) => item.name === '沈岚')).toHaveLength(1);
    expect(npc).toMatchObject({
      courtesyName: '清和', aliases: ['兰娘'], birthOrigin: '河东安邑', factionId: 'faction_old_guard',
      factionName: '新军', identitySummary: '安邑出身、长期随军的旧部参军。', isFocused: true,
      uniqueArts: archivedNpc.uniqueArts, effects: archivedNpc.effects, equipment: archivedNpc.equipment,
      inventory: archivedNpc.inventory, memories: expect.arrayContaining([
        expect.objectContaining({ content: '曾与主角共同核对城防军簿。' }),
        expect.objectContaining({ content: '与主角当面复核了新军粮账册。' }),
      ]),
    });
    expect(npc?.femaleProfile).toMatchObject({
      appearanceDescription: '眉目沉静，衣着利落。',
      relationshipNetwork: [
        { targetName: '顾衡', relationship: '账册交接人' },
        { targetName: '陌生人', relationship: '未确认' },
      ],
      adultPrivateProfile: { summary: '既有长期私密档案。', firstNightPartner: '顾衡' },
    });
    expect(firstTurn.newRuntimeState.relationships).toEqual(initialState.relationships);
    expect(firstTurn.newRuntimeState.activeQuests.find((quest) => quest.id === 'quest_verify_ledger')).toMatchObject({
      relatedNpcIds: ['npc_shen_lan'], affectedNpcIds: ['npc_shen_lan'],
    });
    expect(firstTurn.newRuntimeState.knownRumors.find((rumor) => rumor.id === 'signal_ledger_checked')).toMatchObject({
      affectedNpcIds: ['npc_shen_lan'], npcAwarenessRefs: [{ name: '沈岚', npcId: 'npc_shen_lan' }],
    });
    expect(firstTurn.newRuntimeState.worldTrends?.filter((event) => event.trendId.startsWith('event_ledger')))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ affectedNpcIds: ['npc_shen_lan'], npcAwarenessRefs: [{ name: '沈岚', npcId: 'npc_shen_lan' }] }),
        expect.objectContaining({ relatedNpcIds: ['npc_shen_lan'], npcAwarenessRefs: [{ name: '沈岚', npcId: 'npc_shen_lan' }] }),
      ]));
    expect(firstTurn.newRuntimeState.npcAwarenessIndex).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: '沈岚', npcId: 'npc_shen_lan', contactLevel: 35, playerRelevance: ['旧部军务'],
      }),
    ]));
    const businessIdentityState = {
      npcs: firstTurn.newRuntimeState.npcs,
      relationships: firstTurn.newRuntimeState.relationships,
      npcAwarenessIndex: firstTurn.newRuntimeState.npcAwarenessIndex,
      activeQuests: firstTurn.newRuntimeState.activeQuests,
      knownRumors: firstTurn.newRuntimeState.knownRumors,
      worldTrends: firstTurn.newRuntimeState.worldTrends,
      turnEvents: firstTurn.newRuntimeState.turnEvents,
    };
    expect(JSON.stringify(businessIdentityState)).not.toContain('npc_qing_he_drift');
    expect(JSON.stringify(businessIdentityState)).not.toContain('npc_lan_niang_drift');

    const nextTurnClient = { generate: vi.fn(async (_request: LlmGenerateRequest) => ({
      content: JSON.stringify({
        narrativeText: '众人继续核账。', suggestedActions: [],
        statePatches: [{ type: 'timeAdvance', payload: { minutesAdvanced: 5, reason: '继续核账' }, reason: '继续核账' }],
        statePatch: null,
      }),
      provider: 'openai_compatible' as const, model: 'test-model',
    })) };
    await executeTurn(worldBook, firstTurn.newRuntimeState, '继续核账', { apiConfig, llmClient: nextTurnClient });
    const nextPrompt = (nextTurnClient.generate.mock.calls[0]?.[0] as LlmGenerateRequest).messages
      .map((message) => message.content).join('\n');
    expect(nextPrompt).toContain('npcId: npc_shen_lan');
    expect(nextPrompt).toContain('npcName: 沈岚');
    expect(nextPrompt).toContain('与主角当面复核了新军粮账册');
    expect(nextPrompt).toContain('顾衡=账册交接人');
    expect(nextPrompt).not.toContain('npc_qing_he_drift');
    expect(nextPrompt).not.toContain('npc_lan_niang_drift');
  });

  it('rolls back an invalid model transaction but still applies the local annual settlement', async () => {
    const initialState = ensureLuanShiState({
      ...makeState(),
      startDate: '公元189年09月01日 08:00（辰时）',
      currentDate: '公元189年09月01日 08:00（辰时）',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      resources: {
        money: 100,
        grain: 1000,
        horses: 10,
        arms: 20,
        recruits: 30,
        weapons: [],
        documents: [],
        tokens: [],
        importantSupplies: [],
      },
      privateAssets: [
        {
          privateAssetId: 'asset_failed_turn_estate',
          name: 'Failed Turn Estate',
          type: 'estate',
          ownerScope: 'personal',
          status: 'active',
          summary: 'An estate due for annual settlement.',
          mu: 120,
          households: 18,
          workers: 12,
          updatedAt: '189-08-30',
        },
      ],
      domesticReports: [],
    });
    const businessStateBefore = {
      activeQuests: structuredClone(initialState.activeQuests),
      knownRumors: structuredClone(initialState.knownRumors),
      resources: structuredClone(initialState.resources),
      privateAssets: structuredClone(initialState.privateAssets),
      domesticReports: structuredClone(initialState.domesticReports),
    };
    const narrativeText = 'The estate steward reports in, but the state batch is malformed.';
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText,
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 30 },
              reason: 'The report takes half an hour.',
            },
            {
              type: 'luanshiCommand',
              payload: {
                command: {
                  action: 'upsertDomesticReport',
                  reportId: 'SYSTEM:holding-annual:189',
                  source: 'system',
                  kind: 'holdingAnnualSettlement',
                  year: 189,
                  settledAt: '189-09-01',
                  title: 'Illegal model system report',
                  summary: 'The model must not write this reserved report.',
                  income: { money: 999, grain: 999, horses: 999, arms: 999, recruits: 999 },
                  expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
                  netChange: { money: 999, grain: 999, horses: 999, arms: 999, recruits: 999 },
                  readByPlayer: false,
                },
              },
              reason: 'Invalid reserved system report write.',
            },
          ],
          statePatch: null,
          writeback: {
            questChanges: [
              {
                action: 'add',
                questId: 'quest_should_not_apply',
                title: 'This quest must not be written',
                summary: 'A failed patch transaction must isolate narrator writeback.',
              },
            ],
            signalChanges: [
              {
                action: 'add',
                rumorId: 'signal_should_not_apply',
                content: 'This signal must not be written.',
                source: 'failed response',
              },
            ],
          },
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, initialState, 'Review the estate report.', {
      apiConfig,
      llmClient,
    });

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.newRuntimeState.activeQuests).toEqual(businessStateBefore.activeQuests);
    expect(result.newRuntimeState.knownRumors).toEqual(businessStateBefore.knownRumors);
    expect(result.newRuntimeState.currentTime).toEqual(initialState.currentTime);
    expect(result.newRuntimeState.resources?.money).toBe(126);
    expect(result.newRuntimeState.resources?.grain).toBe(1516);
    expect(result.newRuntimeState.privateAssets).toEqual(businessStateBefore.privateAssets);
    expect(result.newRuntimeState.domesticReports).toEqual([
      expect.objectContaining({
        reportId: 'system:holding-annual:189',
        source: 'system',
        kind: 'holdingAnnualSettlement',
        year: 189,
      }),
    ]);
    expect(result.newRuntimeState.domesticReports?.[0].summary).not.toContain('model must not write');
    expect(result.turnDisplayMeta.holdingAnnualSettlement?.status).toBe('applied');
    expect(result.newRuntimeState.turnLog).toHaveLength(1);
    expect(result.newRuntimeState.turnLog[0].fullNarrativeText).toBe(narrativeText);
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('reserved for local system reports');
    expect(result.newRuntimeState.turnLog[0].statePatchSummary).toContain('年度结算[system:holding-annual:189]');
  });

  it.each([
    { status: 'active' as const, expectedMoney: 106 },
    { status: 'damaged' as const, expectedMoney: 103 },
  ])('settles a newly written $status private asset in September and does not repeat that year', async ({ status, expectedMoney }) => {
    const initialState = ensureLuanShiState({
      ...makeState(),
      startDate: '公元189年09月01日 08:00（辰时）',
      currentDate: '公元189年09月01日 08:00（辰时）',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      resources: {
        money: 100,
        grain: 0,
        horses: 0,
        arms: 0,
        recruits: 0,
        weapons: [],
        documents: [],
        tokens: [],
        importantSupplies: [],
      },
      holdings: [],
      troops: [],
      privateAssets: [],
      privateAssetProjects: [],
      domesticReports: [],
    });
    const firstTurnClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'A new estate is entered into the household ledger.',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 5, reason: 'Register the estate.' },
              reason: 'Register the estate.',
            },
            {
              type: 'luanshiCommand',
              payload: {
                command: {
                  action: 'upsertPrivateAsset',
                  operation: 'create',
                  privateAssetId: `asset_post_writeback_${status}`,
                  name: `${status} post-writeback estate`,
                  type: 'estate',
                  ownerScope: 'personal',
                  status,
                  summary: 'A newly confirmed estate eligible for annual settlement.',
                  mu: 0,
                  households: 0,
                  workers: 5,
                  workshopScale: 1,
                  ranchCapacity: 0,
                  acquisition: {
                    kind: 'grant',
                    occurredAt: '189-09-01',
                    sourceRefId: `turn:grant-estate-${status}`,
                    summary: 'The estate is formally granted this turn.',
                  },
                  updatedAt: '189-09-01',
                },
              },
              reason: 'Persist the newly confirmed estate.',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const firstTurn = await executeTurn(worldBook, initialState, 'Register the estate.', {
      apiConfig,
      llmClient: firstTurnClient,
    });

    expect(firstTurn.patchValidation?.valid).toBe(true);
    expect(firstTurn.newRuntimeState.privateAssets?.[0]).toMatchObject({ status });
    expect(firstTurn.newRuntimeState.resources?.money).toBe(expectedMoney);
    expect(firstTurn.newRuntimeState.domesticReports).toEqual([
      expect.objectContaining({
        reportId: 'system:holding-annual:189',
        source: 'system',
        kind: 'holdingAnnualSettlement',
      }),
    ]);

    const secondTurnClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'The ledger remains unchanged.',
          suggestedActions: [],
          statePatches: [{
            type: 'timeAdvance',
            payload: { minutesAdvanced: 5, reason: 'Continue reviewing.' },
            reason: 'Continue reviewing.',
          }],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };
    const secondTurn = await executeTurn(worldBook, firstTurn.newRuntimeState, 'Continue reviewing.', {
      apiConfig,
      llmClient: secondTurnClient,
    });

    expect(secondTurn.newRuntimeState.resources?.money).toBe(expectedMoney);
    expect(secondTurn.newRuntimeState.domesticReports).toHaveLength(1);
    expect(secondTurn.turnDisplayMeta.holdingAnnualSettlement).toBeUndefined();
  });

  it('does not settle a private asset that exists only inside a failed model transaction', async () => {
    const initialState = ensureLuanShiState({
      ...makeState(),
      startDate: '公元189年09月01日 08:00（辰时）',
      currentDate: '公元189年09月01日 08:00（辰时）',
      currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
      resources: {
        money: 100,
        grain: 0,
        horses: 0,
        arms: 0,
        recruits: 0,
        weapons: [],
        documents: [],
        tokens: [],
        importantSupplies: [],
      },
      holdings: [],
      troops: [],
      privateAssets: [],
      privateAssetProjects: [],
      domesticReports: [],
    });
    const llmClient = {
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          narrativeText: 'The model emits one valid-looking asset inside an invalid batch.',
          suggestedActions: [],
          statePatches: [
            {
              type: 'timeAdvance',
              payload: { minutesAdvanced: 5, reason: 'Attempt registration.' },
              reason: 'Attempt registration.',
            },
            {
              type: 'luanshiCommand',
              payload: {
                command: {
                  action: 'upsertPrivateAsset',
                  operation: 'create',
                  privateAssetId: 'asset_failed_batch_only',
                  name: 'Failed batch estate',
                  type: 'estate',
                  ownerScope: 'personal',
                  status: 'active',
                  summary: 'This asset must roll back with the failed batch.',
                  households: 5,
                  acquisition: {
                    kind: 'grant',
                    occurredAt: '189-09-01',
                    sourceRefId: 'turn:failed-grant',
                    summary: 'The invalid batch attempts to grant the estate.',
                  },
                  updatedAt: '189-09-01',
                },
              },
              reason: 'Attempt to persist an estate.',
            },
            {
              type: 'luanshiCommand',
              payload: {
                command: {
                  action: 'upsertDomesticReport',
                  reportId: 'SYSTEM:holding-annual:189',
                  source: 'system',
                  kind: 'holdingAnnualSettlement',
                  year: 189,
                  settledAt: '189-09-01',
                  title: 'Invalid reserved report',
                  summary: 'This makes the entire model transaction fail.',
                  income: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
                  expenses: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
                  netChange: { money: 0, grain: 0, horses: 0, arms: 0, recruits: 0 },
                  readByPlayer: false,
                },
              },
              reason: 'Invalid reserved write.',
            },
          ],
          statePatch: null,
        }),
        provider: 'openai_compatible' as const,
        model: 'test-model',
      })),
    };

    const result = await executeTurn(worldBook, initialState, 'Attempt to register an estate.', {
      apiConfig,
      llmClient,
    });

    expect(result.patchValidation?.valid).toBe(false);
    expect(result.newRuntimeState.currentTime).toEqual(initialState.currentTime);
    expect(result.newRuntimeState.privateAssets).toEqual([]);
    expect(result.newRuntimeState.resources?.money).toBe(100);
    expect(result.newRuntimeState.domesticReports).toEqual([]);
    expect(result.turnDisplayMeta.holdingAnnualSettlement).toBeUndefined();
  });

  it('deduplicates state-writeback repair facts without collapsing different outcomes or times', async () => {
    const initialState = ensureLuanShiState({
      ...makeState(),
      worldTrends: [{
        trendId: 'event_gate_watch',
        title: 'Gate watch chronicle',
        summary: 'The gate watch has begun.',
        status: 'active',
        severity: '低',
        knownToPlayer: true,
        scope: 'regional',
        affectedFactionIds: ['faction_market_guard'],
        progressSummary: 'The gate watch remains active.',
        nextCheckAt: 'day 10',
        happenedAt: 'day 9',
        learnedAt: 'day 9',
        updatedAt: 'day 9',
      }],
    });
    const timeAdvancePatch = {
      type: 'timeAdvance',
      payload: { minutesAdvanced: 10, reason: 'Review the gate reports.', category: 'conversation' },
      reason: 'Reviewing the gate reports takes ten minutes.',
    };
    const mainResponse = {
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: 'The bridge guard reports several changes around the market gate.',
      suggestedActions: [],
      statePatches: [timeAdvancePatch],
      statePatch: null,
      writeback: {
        npcMemorySuggestions: [{
          npcId: 'npc_bridge_guard',
          npcName: 'Bridge Guard',
          source: '亲历',
          content: 'Scouts checked the east road.',
        }],
        questChanges: [{
          action: 'add',
          questId: 'quest_gate_patrol',
          title: 'Verify the east-road patrol',
          summary: 'Confirm whether the patrol returned.',
          affectedNpcIds: ['npc_bridge_guard', 'npc_absent_scout'],
        }],
        signalChanges: [
          {
            action: 'add',
            title: 'East-road movement',
            source: 'Gate scouts',
            content: 'Three riders passed the old marker.',
            potentialOutcomeSummary: 'The riders may approach the market gate.',
            relatedLocationIds: ['place_market', 'place_east_road'],
          },
          {
            action: 'add',
            title: 'Night watch timing',
            source: 'Gate scouts',
            content: 'A signal fire may appear after dusk.',
            potentialOutcomeSummary: 'The watch may need reinforcements.',
            expiresAt: 'day 11',
          },
          {
            action: 'add',
            title: 'Merchant convoy consequence',
            source: 'Gate scouts',
            content: 'A merchant convoy waits east of the gate.',
            potentialOutcomeSummary: 'The convoy may enter peacefully.',
          },
        ],
        worldEventUpdates: [{
          eventId: 'event_gate_watch',
          summary: 'The original report keeps the gate watch cautious.',
          affectedNpcIds: ['npc_bridge_guard'],
        }],
        debugNotes: [' Gate report checked. '],
      },
    };
    const repairResponse = {
      protocolVersion: 'lsfy.turn.v1',
      narrativeText: 'Repair text must not replace the narrative.',
      suggestedActions: [],
      statePatches: [timeAdvancePatch],
      statePatch: null,
      writeback: {
        npcMemorySuggestions: [{
          content: ' scouts checked the east road! ',
          source: ' 亲历 ',
          npcName: ' bridge guard ',
          npcId: ' npc_bridge_guard ',
        }],
        questChanges: [{
          affectedNpcIds: ['npc_absent_scout', 'npc_bridge_guard'],
          outcomeSummary: 'Repair may add this missing field without completing the quest.',
          summary: 'Repair must not replace the original quest summary.',
          title: ' verify the east road patrol ',
          questId: ' quest_gate_patrol ',
          action: 'complete',
        }],
        signalChanges: [
          {
            relatedLocationIds: ['place_east_road', 'place_market'],
            potentialOutcomeSummary: ' the riders may approach the market gate ',
            content: ' three riders passed the old marker! ',
            source: ' gate scouts ',
            title: ' east road movement ',
            action: 'add',
            confidence: 'high',
          },
          {
            action: 'add',
            title: 'Night watch timing',
            source: 'Gate scouts',
            content: 'A signal fire may appear after dusk.',
            potentialOutcomeSummary: 'The watch may need reinforcements.',
            expiresAt: 'day 12',
          },
          {
            action: 'add',
            title: 'Merchant convoy consequence',
            source: 'Gate scouts',
            content: 'A merchant convoy waits east of the gate.',
            potentialOutcomeSummary: 'The convoy may be an ambush.',
          },
        ],
        worldEventUpdates: [{
          affectedNpcIds: ['npc_bridge_guard'],
          summary: 'Repair must not overwrite the original legal chronicle.',
          eventId: ' event_gate_watch ',
          severity: 'high',
        }],
        debugNotes: ['gate report checked!'],
      },
    };
    const llmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify(mainResponse),
      provider: 'openai_compatible' as const,
      model: 'main-model',
    })) };
    const stateWritebackLlmClient = { generate: vi.fn(async () => ({
      content: JSON.stringify(repairResponse),
      provider: 'openai_compatible' as const,
      model: 'state-writeback-model',
    })) };

    const result = await executeTurn(worldBook, initialState, 'Review the gate reports.', {
      apiConfig,
      llmClient,
      stateWritebackApiConfig: { ...apiConfig, id: 'state-writeback', model: 'state-writeback-model' },
      stateWritebackLlmClient,
    });

    expect(stateWritebackLlmClient.generate).toHaveBeenCalledOnce();
    expect(result.writeback?.npcMemorySuggestions).toHaveLength(1);
    expect(result.writeback?.questChanges).toHaveLength(1);
    expect(result.writeback?.questChanges[0]).toMatchObject({
      action: 'add',
      summary: 'Confirm whether the patrol returned.',
      outcomeSummary: 'Repair may add this missing field without completing the quest.',
    });
    expect(result.writeback?.signalChanges).toHaveLength(5);
    expect(result.writeback?.signalChanges?.[0]).toMatchObject({
      title: 'East-road movement',
      confidence: 'high',
    });
    expect(result.writeback?.worldEventUpdates).toEqual([expect.objectContaining({
      eventId: 'event_gate_watch',
      summary: 'The original report keeps the gate watch cautious.',
      severity: 'high',
    })]);
    expect(result.writeback?.debugNotes).toEqual([' Gate report checked. ']);
    expect(result.newRuntimeState.npcs?.find((npc) => npc.npcId === 'npc_bridge_guard')?.memories).toHaveLength(1);
    expect(result.newRuntimeState.activeQuests).toEqual([
      expect.objectContaining({ id: 'quest_gate_patrol', status: 'active' }),
    ]);
    expect(result.newRuntimeState.worldTrends?.find((event) => event.trendId === 'event_gate_watch')).toMatchObject({
      summary: 'The original report keeps the gate watch cautious.',
      severity: 'high',
    });
  });
});

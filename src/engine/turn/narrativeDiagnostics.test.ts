import { describe, expect, it } from 'vitest';
import type { RuntimeState, WorldBook } from '../types';
import type { NarrativeRenderEntry } from './narrativeDisplay';
import { buildNarrativeDiagnosticExport } from './narrativeDiagnostics';

const worldBook: WorldBook = {
  manifest: {
    id: 'three-kingdoms',
    name: '三国演义',
    version: '0.1.0',
    author: 'test',
    language: 'zh-CN',
    genre: '乱世',
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
  mapSeed: [],
  factionsSeed: [],
  timelineAnchors: [],
  startBookmarks: [{
    id: 'bm_189',
    label: '189 洛阳风暴',
    startDate: '189年9月',
    relatedTimelineAnchorIds: [],
    description: '董卓入京。',
    recommendedRegions: [],
    recommendedOrigins: [],
    situationSummary: '董卓入京。',
  }],
  openingCrisisTemplates: [],
  prompts: {
    narrativeBaseline: '',
    toneGuide: '',
    forbiddenTopics: [],
    outputFormat: '',
  },
  validationRules: [],
};

const runtimeState: RuntimeState = {
  engineVersion: '0.1.0',
  worldBookId: 'three-kingdoms',
  worldBookVersion: '0.1.0',
  worldBookSource: 'official',
  startBookmarkId: 'bm_189',
  startDate: '公元189年09月01日 08:00（辰时）',
  currentDate: '公元189年09月01日 08:15（辰时）',
  player: {
    id: 'player',
    name: '刘达',
    roleType: '原创角色',
    summary: '军中小吏',
  },
  currentLocationId: 'loc_luoyang',
  knownActors: [],
  knownFactions: [],
  relationships: [],
  knownRumors: [],
  activeQuests: [],
  playerResources: {},
  worldStateDelta: {},
  turnLog: [
    {
      turnNumber: 1,
      date: '公元189年09月01日 08:15（辰时）',
      playerInput: '我去找同营士卒打听消息',
      narrativeText: '简短摘要',
      fullNarrativeText: '营门外的士卒压低声音，说西园军已经乱作一团。',
      statePatchSummary: 'timeAdvance + recordTurnEvent',
      timestamp: '2026-01-01T00:00:01.000Z',
      displayMeta: {
        title: '第 1 回合',
        rawResponse: '{"narrativeText":"营门外的士卒压低声音","rawResponse":"nested raw","adultPrivateProfile":{"summary":"何氏私密摘要锚点","breastDescription":"私密胸部描述"},"apiKey":"sk-test-diagnostic-secret","headers":{"Authorization":"Bearer sk-test-bearer-secret","x-api-key":"sk-test-x-api-key"}}',
        reasoningSummary: '公开思路摘要 Authorization: Bearer sk-test-reasoning-secret',
        promptTokens: 1877,
        completionTokens: 977,
        elapsedMs: 39000,
        provider: 'gemini',
        model: 'gemini-3-flash',
        processingStages: [
          {
            stage: 'generatingNarrative',
            label: '生成正文',
            status: 'finished',
            elapsedMs: 39000,
            model: 'gemini-3-flash',
          },
          {
            stage: 'repairingStateWriteback',
            label: '整理状态写回',
            status: 'failed',
            elapsedMs: 6000,
            detail: '502 Bad Gateway',
            model: 'gemini-3-flash',
          },
        ],
        promptTokenEstimate: {
          total: {
            chars: 5600,
            estimatedTokens: 1877,
            lowerBound: 1500,
            upperBound: 2300,
          },
          layers: [
            {
              id: 'systemPrompt',
              label: '系统提示词',
              chars: 1200,
              estimatedTokens: 450,
              lowerBound: 360,
              upperBound: 580,
            },
            {
              id: 'userPrompt',
              label: '主回合用户提示词',
              chars: 2600,
              estimatedTokens: 880,
              lowerBound: 720,
              upperBound: 1120,
            },
            {
              id: 'stateWriterContext',
              label: '状态写入上下文',
              chars: 1500,
              estimatedTokens: 480,
              lowerBound: 390,
              upperBound: 620,
            },
            {
              id: 'turnOutputRequirements',
              label: '最终输出提醒',
              chars: 300,
              estimatedTokens: 67,
              lowerBound: 54,
              upperBound: 86,
            },
          ],
          contextBreakdown: [
            {
              id: 'narrativeContext',
              label: '叙事上下文',
              chars: 1000,
              estimatedTokens: 350,
              lowerBound: 287,
              upperBound: 448,
            },
            {
              id: 'memoryContext',
              label: '记忆上下文',
              chars: 600,
              estimatedTokens: 210,
              lowerBound: 172,
              upperBound: 269,
            },
            {
              id: 'situationProjection',
              label: '局势投影',
              chars: 260,
              estimatedTokens: 92,
              lowerBound: 75,
              upperBound: 118,
            },
            {
              id: 'stateWriterContext',
              label: '状态写入上下文',
              chars: 1500,
              estimatedTokens: 480,
              lowerBound: 390,
              upperBound: 620,
            },
          ],
        },
        npcIntentSimulation: {
          status: 'completed',
          targetNpcIds: ['npc_guard'],
          provider: 'openai_compatible',
          model: 'fast-npc-model',
          usage: {
            promptTokens: 321,
            completionTokens: 123,
            totalTokens: 444,
          },
          package: {
            protocolVersion: 'coc.v2.npcIntent.v1',
            generatedAt: '公元189年09月01日 08:15（辰时）',
            source: 'npcSimulation',
            intents: [
              {
                npcId: 'npc_guard',
                npcName: '门候',
                shouldAct: true,
                intent: '抬手拦住主角，要求说明来意。',
                trigger: '看见主角靠近营门时触发',
                perceptionBasis: '门候在场能看见主角。',
                relationshipBasis: '初识且职责要求盘问。',
                emotionalState: '谨慎警惕',
                confidence: 0.82,
              },
            ],
          },
        },
      },
    },
  ],
  localSituationNotes: [],
  locations: [
    {
      locationId: 'loc_luoyang',
      name: '洛阳城',
      type: '城邑',
      summary: '东汉都城。',
      knownLevel: '亲历',
      recentEvents: [],
    },
  ],
};

const renderedEntries: NarrativeRenderEntry[] = [
  {
    key: '1-2026-01-01T00:00:01.000Z',
    turnNumber: 1,
    title: '第 1 回合',
    date: '公元189年09月01日 08:15（辰时）',
    playerInput: '我去找同营士卒打听消息',
    narrativeText: '营门外的士卒压低声音，说西园军已经乱作一团。',
    displayMeta: runtimeState.turnLog[0].displayMeta,
    isLive: false,
  },
];

describe('narrativeDiagnostics', () => {
  it('exports displayed narrative, player actions, and safe generation stats by default', () => {
    const text = buildNarrativeDiagnosticExport({
      runtimeState,
      worldBook,
      renderedEntries,
      saveId: 'save-test',
      generatedAt: '2026-06-18T12:00:00.000Z',
      getLocationName: () => '洛阳城',
    });

    expect(text).toContain('乱世风云录诊断导出');
    expect(text).toContain('存档：save-test');
    expect(text).toContain('当前时间：公元189年09月01日 08:15（辰时）');
    expect(text).toContain('当前位置：洛阳城');
    expect(text).toContain('玩家：刘达');
    expect(text).toContain('世界书：三国演义 three-kingdoms v0.1.0');
    expect(text).toContain('## 第 1 回合');
    expect(text).toContain('玩家输入：我去找同营士卒打听消息');
    expect(text).toContain('正文：');
    expect(text).toContain('营门外的士卒压低声音');
    expect(text).toContain('生成信息：provider=gemini, model=gemini-3-flash, prompt=1877, completion=977, elapsed=39s');
    expect(text).toContain('处理阶段：');
    expect(text).toContain('- 生成正文：finished，耗时 39s，模型 gemini-3-flash');
    expect(text).toContain('- 整理状态写回：failed，耗时 6s，模型 gemini-3-flash，详情：502 Bad Gateway');
    expect(text).toContain('Prompt Token 分层估算：');
    expect(text).toContain('总计：约 1877 tokens');
    expect(text).toContain('- 系统提示词：约 450 tokens');
    expect(text).toContain('- 状态写入上下文：约 480 tokens');
    expect(text).toContain('上下文拆分：');
    expect(text).toContain('- 局势投影：约 92 tokens');
    expect(text).toContain('状态补丁摘要：timeAdvance + recordTurnEvent');
    expect(text).toContain('NPC 动态模拟：');
    expect(text).toContain('状态：completed');
    expect(text).toContain('目标 NPC：npc_guard');
    expect(text).toContain('模型：openai_compatible / fast-npc-model');
    expect(text).toContain('消耗：prompt=321, completion=123, total=444');
    expect(text).toContain('门候(npc_guard)：抬手拦住主角，要求说明来意。');
    expect(text).toContain('触发：看见主角靠近营门时触发');
    expect(text).toContain('公开思路摘要');
    expect(text).not.toContain('原文：');
    expect(text).not.toContain('{"narrativeText":"营门外的士卒压低声音"');
    expect(text).not.toContain('rawResponse');
    expect(text).not.toContain('adultPrivateProfile');
    expect(text).not.toContain('何氏私密摘要锚点');
    expect(text).not.toContain('私密胸部描述');
    expect(text).not.toContain('Authorization');
    expect(text).not.toContain('Bearer');
    expect(text).not.toContain('apiKey');
    expect(text).not.toContain('x-api-key');
    expect(text).not.toContain('sk-test');
  });

  it('keeps full diagnostic export explicit and able to include raw response and private diagnostic material', () => {
    const text = buildNarrativeDiagnosticExport({
      runtimeState,
      worldBook,
      renderedEntries,
      saveId: 'save-test',
      generatedAt: '2026-06-18T12:00:00.000Z',
      getLocationName: () => '洛阳城',
      mode: 'full',
    });

    expect(text).toContain('原文：');
    expect(text).toContain('"narrativeText":"营门外的士卒压低声音"');
    expect(text).toContain('adultPrivateProfile');
    expect(text).toContain('何氏私密摘要锚点');
    expect(text).not.toContain('Authorization');
    expect(text).not.toContain('Bearer');
    expect(text).not.toContain('apiKey');
    expect(text).not.toContain('x-api-key');
    expect(text).not.toContain('sk-test');
  });

  it('does not export API settings archives through narrative diagnostics', () => {
    const text = buildNarrativeDiagnosticExport({
      runtimeState,
      worldBook,
      renderedEntries,
      saveId: 'save-test',
    });

    expect(text).not.toContain('coc.v2.api-settings');
    expect(text).not.toContain('"configs"');
    expect(text).not.toContain('"routes"');
  });

  it('labels a live narrative draft as uncommitted when diagnostics are exported mid-generation', () => {
    const text = buildNarrativeDiagnosticExport({
      runtimeState,
      worldBook,
      renderedEntries: [
        ...renderedEntries,
        {
          key: 'live-narrative',
          title: '生成中',
          playerInput: '继续追问军械数量',
          narrativeText: '这是尚未提交的流式正文。',
          isLive: true,
        },
      ],
      saveId: 'save-test',
    });

    expect(text).toContain('提交状态：未提交预览（不属于存档回合）');
  });

  it('exports persisted structured location diagnostics without putting candidate IDs into narrative text', () => {
    const state = structuredClone(runtimeState);
    const locationWriteback = {
      errors: ['#1 地点 canonical 身份歧义'],
      routeErrors: ['路线 #1 toPlaceId 不存在：place_missing'],
      diagnostics: [{
        code: 'location-canonical-ambiguous',
        message: '地点 canonical 身份歧义：incoming_xinye 同时匹配 place_a、place_b',
        incomingLocationId: 'incoming_xinye',
        candidateIds: ['place_a', 'place_b'],
        suggestionIndex: 0,
      }],
    };
    state.turnLog[0].displayMeta = {
      ...state.turnLog[0].displayMeta,
      locationWriteback,
    } as NonNullable<RuntimeState['turnLog'][number]['displayMeta']>;
    const entries = [{
      ...renderedEntries[0],
      displayMeta: state.turnLog[0].displayMeta,
      narrativeText: '地图记录存在冲突，本回合继续。',
    }];

    const text = buildNarrativeDiagnosticExport({
      runtimeState: state,
      worldBook,
      renderedEntries: entries,
      saveId: 'save-location-diagnostic',
    });

    expect(text).toContain('Location Writeback Diagnostics');
    expect(text).toContain('code=location-canonical-ambiguous');
    expect(text).toContain('incomingLocationId=incoming_xinye');
    expect(text).toContain('candidateIds=place_a,place_b');
    expect(text).toContain('locationError=#1 地点 canonical 身份歧义');
    expect(text).toContain('routeError=路线 #1 toPlaceId 不存在：place_missing');
    expect(entries[0].narrativeText).not.toContain('place_a');
    expect(entries[0].narrativeText).not.toContain('place_b');
  });

  it('exports a map writeback rollback warning without internal location candidates', () => {
    const state = structuredClone(runtimeState);
    const locationWriteback = {
      errors: ['因状态补丁校验失败，本回合地图写回已回滚。'],
      routeErrors: [],
      diagnostics: [{
        code: 'location-writeback-rolled-back' as const,
        message: '因状态补丁校验失败，本回合地图写回已回滚。',
        incomingLocationId: '',
        candidateIds: [],
      }],
    };
    state.turnLog[0].displayMeta = {
      ...state.turnLog[0].displayMeta,
      locationWriteback,
    } as NonNullable<RuntimeState['turnLog'][number]['displayMeta']>;
    const entries = [{
      ...renderedEntries[0],
      displayMeta: state.turnLog[0].displayMeta,
    }];

    const text = buildNarrativeDiagnosticExport({
      runtimeState: state,
      worldBook,
      renderedEntries: entries,
      saveId: 'save-location-rollback-diagnostic',
    });

    expect(text).toContain('code=location-writeback-rolled-back');
    expect(text).toContain('因状态补丁校验失败，本回合地图写回已回滚。');
    expect(text).not.toContain('incoming_outpost');
    expect(text).not.toContain('place_candidate');
  });

  it('exports situation projection diagnostics for dynamic-system hand testing', () => {
    const text = buildNarrativeDiagnosticExport({
      runtimeState: {
        ...runtimeState,
        activeQuests: [
          {
            id: 'quest_local',
            title: 'Hold the south gate',
            description: 'Keep the south gate secure.',
            status: 'active',
            priority: 'high',
            createdAt: runtimeState.currentDate,
            updatedAt: runtimeState.currentDate,
          },
        ],
        knownRumors: [
          {
            id: 'signal_grain',
            title: 'Grain carts',
            content: 'Grain carts may be moving near the market.',
            source: 'market rumor',
            status: 'open',
            severity: 'major',
            verified: false,
            createdAt: runtimeState.currentDate,
          },
        ],
        worldTrends: [
          {
            trendId: 'trend_luoyang',
            title: 'Luoyang pressure',
            summary: 'The city is under pressure.',
            severity: '高',
            status: 'active',
            scope: 'regional',
            affectedFactionIds: ['faction_luoyang_guard'],
            progressSummary: 'The pressure is still building.',
            nextCheckAt: runtimeState.currentDate,
            knownToPlayer: true,
            updatedAt: runtimeState.currentDate,
          },
        ],
        npcAwarenessIndex: [
          {
            awarenessId: 'aware_remote',
            name: 'Remote Ally',
            sourceType: 'rumor',
            sourceIds: ['signal_grain'],
            contactLevel: 30,
            playerRelevance: ['old-relationship'],
            unresolvedHooks: ['may send help'],
            knownToPlayer: true,
            archiveVisible: false,
            updatedAt: runtimeState.currentDate,
          },
        ],
      },
      worldBook,
      renderedEntries: [],
      saveId: 'save-dynamic-diagnostic',
      generatedAt: '2026-06-23T00:00:00.000Z',
      getLocationName: () => 'Luoyang',
    });

    expect(text).toContain('Situation Projection Diagnostics');
    expect(text).toContain('- currentMatters: source=1 projected=1 omitted=0 truncated=0');
    expect(text).toContain('- signals: source=1 projected=1 omitted=0 truncated=0');
    expect(text).toContain('- chronicles: source=1 projected=1 omitted=0 truncated=0');
    expect(text).toContain('- remoteNpcBeats: source=1 projected=1 omitted=0 truncated=0');
    expect(text).toContain('Hold the south gate');
    expect(text).toContain('Remote Ally');
  });

  it('exports Map V1 projection diagnostics for route and location hand testing', () => {
    const text = buildNarrativeDiagnosticExport({
      runtimeState: {
        ...runtimeState,
        currentLocationId: 'place_luoyang',
        currentPlaceId: 'place_luoyang',
        currentSceneId: 'scene_luoyang_gate',
        routeEdges: [
          {
            routeId: 'route_luoyang_mengjin',
            fromPlaceId: 'place_luoyang',
            toPlaceId: 'place_mengjin',
            name: '洛阳孟津官道',
            routeKind: '官道',
            status: '可通行但有兵巡',
            source: 'llm',
            knownLevel: '亲历',
            standardTravelMinutes: 180,
          },
        ],
        memoryArchive: {
          recentTurnSummaries: [],
          midTermSummaries: [],
          longTermFacts: [],
          npcInteractionSummaries: [],
          locationMemorySummaries: [
            {
              locationId: 'scene_luoyang_gate',
              summary: '宫门近来盘查加严。',
              updatedAt: runtimeState.currentDate,
            },
          ],
          settings: {
            recentRawTurnLimit: 4,
            recentTurnLimit: 12,
            recentTurnCompressThreshold: 30,
            recentTurnKeepAfterCompress: 12,
            midTermSummaryLimit: 6,
            longTermFactLimit: 8,
            npcRecentMemoryDefaultLimit: 3,
            npcRecentMemoryImportantLimit: 5,
            focusedNpcRecentMemoryLimit: 2,
            npcMemoryCompressThreshold: 40,
            npcMemoryKeepAfterCompress: 12,
            locationMemoryCompressThreshold: 30,
            taskMemoryCompressThreshold: 30,
            vectorResultLimit: 6,
            maxPromptMemoryTokens: 40000,
            recentStoryTokenBudget: 12000,
            npcMemoryTokenBudget: 12000,
            midTermTokenBudget: 6000,
            longTermFactTokenBudget: 5000,
            locationMemoryTokenBudget: 3000,
            retrievalTokenBudget: 8000,
            enableAutoMemorySummary: true,
            preferDedicatedMemorySummaryApi: true,
          },
        },
      },
      worldBook: {
        ...worldBook,
        mapSeed: [
          {
            id: 'region_sili',
            name: '司隶',
            level: 'region',
            mapLayer: 'region',
            summary: '京畿区域。',
            connectedRegionIds: [],
            controlHint: '',
            tensionHint: '',
            subLocations: [
              {
                id: 'place_luoyang',
                name: '洛阳',
                level: 'capital',
                mapLayer: 'place',
                summary: '东汉都城。',
                connectedRegionIds: [],
                controlHint: '',
                tensionHint: '',
                subLocations: [
                  {
                    id: 'scene_luoyang_gate',
                    name: '宫门',
                    level: 'scene',
                    mapLayer: 'scene',
                    summary: '禁中出入之处。',
                    connectedRegionIds: [],
                    controlHint: '',
                    tensionHint: '',
                  },
                ],
              },
              {
                id: 'place_mengjin',
                name: '孟津',
                level: 'ferry',
                mapLayer: 'place',
                summary: '黄河渡口。',
                connectedRegionIds: [],
                controlHint: '',
                tensionHint: '',
              },
            ],
          },
        ],
      },
      renderedEntries: [],
      saveId: 'save-map-diagnostic',
      generatedAt: '2026-06-23T00:00:00.000Z',
      getLocationName: () => '洛阳',
    });

    expect(text).toContain('Map V1 Projection Diagnostics / 地图投影诊断：');
    expect(text).toContain('currentPlaceId=place_luoyang');
    expect(text).toContain('currentSceneId=scene_luoyang_gate');
    expect(text).toContain('displayPath=司隶 - 洛阳 - 宫门');
    expect(text).toContain('当前位置：司隶 - 洛阳 - 宫门');
    expect(text).toContain('runtimeMapNodes=0');
    expect(text).toContain('runtimeRouteEdges=1');
    expect(text).toContain('- scene scene_luoyang_gate | 宫门 | 禁中出入之处。');
    expect(text).toContain('- route route_luoyang_mengjin | 洛阳孟津官道 | to=孟津(place_mengjin) | kind=官道 | status=可通行但有兵巡 | travel=180 minutes');
    expect(text).toContain('- memory scene_luoyang_gate | 宫门近来盘查加严。');
  });
});

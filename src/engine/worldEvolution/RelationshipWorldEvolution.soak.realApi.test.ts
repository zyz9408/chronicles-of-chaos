import { describe, expect, it } from 'vitest';
// @ts-expect-error Vitest 在 Node 中运行；生产 tsconfig 刻意不引入 Node 全局类型。
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
// @ts-expect-error Vitest 在 Node 中运行；生产 tsconfig 刻意不引入 Node 全局类型。
import { dirname, resolve } from 'node:path';
import { BrowserLlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import {
  formatGameClock,
  setRuntimeClock,
  tryCreateGameClockFromDateLabel,
  type GameClock,
} from '../time/gameClock';
import type { RuntimeState } from '../types';
import { getWorldBook, initWorldBookRegistry } from '../worldbook/WorldBookLoader';
import {
  executeRelationshipWorldEvolution,
  selectRelationshipWorldEvolutionCandidates,
} from './RelationshipWorldEvolution';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const SOAK_ENABLED = TEST_ENV.COC_V2_WORLD_EVOLUTION_SOAK === '1';
const TARGET_VALID_TURNS = Math.max(1, Number(TEST_ENV.COC_V2_WORLD_EVOLUTION_SOAK_TURNS ?? 55));
const MAX_ATTEMPTS = TARGET_VALID_TURNS + 80;
const RESUME_ENABLED = TEST_ENV.COC_V2_WORLD_EVOLUTION_SOAK_RESUME === '1';
const CHECKPOINT_PATH = resolve('.tmp', 'relationship-world-evolution-soak-checkpoint.json');
const PLAYER_INPUT = '我继续处理自己的事务，并未与这些异地人物直接接触。';

interface SoakCheckpoint {
  targetValidTurns: number;
  state: RuntimeState;
  validTurns: number;
  attempts: number;
  nonValidAttempts: number;
  durations: number[];
  appliedByNpc: Record<string, number>;
}

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`关系人物后台演化长测缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_real_relationship_world_evolution_soak',
    name: '关系人物后台演化真实 API 长测',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0.2,
    maxOutputTokens: 4_096,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  };
}

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '1.4.2',
    worldBookId: 'threeKingdoms',
    worldBookVersion: '0.4.0',
    worldBookSource: 'official',
    startDate: '公元184年03月01日 08:00（辰时）',
    currentDate: '公元184年04月20日 08:00（辰时）',
    currentTime: { year: 184, month: 4, day: 20, hour: 8, minute: 0 },
    worldlineSettings: {
      knowledgeMode: 'default',
      knowledgeBaseId: 'threeKingdoms.coreKnowledge.v1',
      storyPackIds: [],
    },
    player: {
      id: 'player_soak',
      name: '刘兴',
      roleType: '荆州军司马',
      summary: '目前在襄阳任职，与三名异地关系人物保持联系。',
    },
    currentLocationId: 'place_xiangyang',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    locations: [{
      locationId: 'place_xiangyang', name: '襄阳', type: '城池', summary: '荆州重镇。', knownLevel: '亲历', recentEvents: [],
    }, {
      locationId: 'place_yingchuan', name: '颍川', type: '郡治', summary: '士族与人才聚集之地。', knownLevel: '听闻', recentEvents: [],
    }, {
      locationId: 'place_jiangling', name: '江陵', type: '城池', summary: '江汉水陆要冲。', knownLevel: '听闻', recentEvents: [],
    }, {
      locationId: 'place_wancheng', name: '宛城', type: '城池', summary: '南阳郡治。', knownLevel: '听闻', recentEvents: [],
    }, {
      locationId: 'place_player_waystation', name: '玩家测试驿站', type: '驿站', summary: '仅用于保持长测前后台人物异地。', knownLevel: '亲历', recentEvents: [],
    }, {
      locationId: 'place_player_waystation_2', name: '玩家测试别院', type: '宅院', summary: '仅用于保持长测前后台人物异地。', knownLevel: '亲历', recentEvents: [],
    }],
    factions: [{
      factionId: 'faction_caocao', name: '曹操部', type: '军阀', summary: '正在乱局中聚拢力量。', stanceToPlayer: '中立', knownLevel: '听闻', recentActions: [],
    }, {
      factionId: 'faction_jingzhou', name: '荆州官府', type: '官府', summary: '维持荆州郡县秩序。', stanceToPlayer: '友好', knownLevel: '亲历', recentActions: [],
    }, {
      factionId: 'faction_nanyang_healers', name: '南阳医者行会', type: '民间', summary: '往来南阳各县行医。', stanceToPlayer: '友好', knownLevel: '听闻', recentActions: [],
    }],
    npcs: [{
      npcId: 'npc_caocao', name: '曹操', sex: '男', age: 30, role: '骑都尉',
      factionId: 'faction_caocao', factionName: '曹操部', locationId: 'place_yingchuan',
      isPresent: false, isFocused: false, summary: '正在形成自己的政治与军事班底。', appearance: '身形精悍。',
      personality: '果断多疑', motivation: '在乱局中建立可自保并成事的力量', relationToPlayer: '洛阳旧识', contactLevel: 4,
      recentAttitude: '重视', memories: [],
      backgroundActivity: {
        activityId: 'activity_caocao_recruit', summary: '在颍川联络故旧并延揽人才', status: 'active',
        locationId: 'place_yingchuan', dueAt: '公元184年04月20日 08:00（辰时）', visibility: 'playerKnown',
      },
    }, {
      npcId: 'npc_shen_yan', name: '沈砚', sex: '男', age: 32, role: '荆州从事',
      factionId: 'faction_jingzhou', factionName: '荆州官府', locationId: 'place_jiangling',
      isPresent: false, isFocused: false, summary: '负责江陵仓曹与水运文书。', appearance: '衣冠整洁。',
      personality: '谨慎务实', motivation: '整顿江陵仓储与漕运弊端', relationToPlayer: '共事盟友', contactLevel: 5,
      recentAttitude: '信任', memories: [{
        memoryId: 'memory_shen_depart', eventId: 'event_shen_depart', source: '亲历',
        content: '受玩家所托前往江陵核查仓储。', createdAt: '公元184年04月10日 08:00（辰时）',
      }],
    }, {
      npcId: 'npc_su_wan', name: '苏婉', sex: '女', age: 25, role: '游方医者',
      factionId: 'faction_nanyang_healers', factionName: '南阳医者行会', locationId: 'place_wancheng',
      isPresent: false, isFocused: false, summary: '在南阳各县行医并搜集药材。', appearance: '携药囊与竹笠。',
      personality: '温和坚韧', motivation: '救治疫病并整理可靠药方', relationToPlayer: '相知恋人', contactLevel: 6,
      recentAttitude: '牵挂', memories: [{
        memoryId: 'memory_su_depart', eventId: 'event_su_depart', source: '亲历',
        content: '与玩家约定在南阳行医结束后寄信。', createdAt: '公元184年04月12日 08:00（辰时）',
      }],
    }],
    heroineThreads: [{
      heroineThreadId: 'heroine_su_wan', npcId: 'npc_su_wan', npcName: '苏婉', status: 'active',
      stage: '相知', relationshipRole: '恋人', summary: '异地相知，约定以书信互报平安。',
      lastUpdatedAt: '公元184年04月12日 08:00（辰时）',
    }],
    bondThreads: [{
      bondThreadId: 'bond_caocao', targetNpcIds: ['npc_caocao'], targetNames: ['曹操'], bondType: 'ally', status: 'active',
      summary: '洛阳结识后保持联系。', lastUpdatedAt: '公元184年04月01日 08:00（辰时）',
    }, {
      bondThreadId: 'bond_shen_yan', targetNpcIds: ['npc_shen_yan'], targetNames: ['沈砚'], bondType: 'ally', status: 'active',
      summary: '共同整顿荆州军需。', lastUpdatedAt: '公元184年04月10日 08:00（辰时）',
    }],
  } as unknown as RuntimeState);
}

function clockValue(clock: GameClock): number {
  return (((clock.year * 12 + clock.month) * 30 + clock.day) * 24 + clock.hour) * 60 + clock.minute;
}

function moveToNextEligibleTime(state: RuntimeState): RuntimeState {
  const separated = keepPlayerOffstage(state);
  if (selectRelationshipWorldEvolutionCandidates(separated, PLAYER_INPUT, 1).length > 0) return separated;
  const targetNpcIds = new Set(['npc_caocao', 'npc_shen_yan', 'npc_su_wan']);
  const current = separated.currentTime ?? tryCreateGameClockFromDateLabel(separated.currentDate);
  if (!current) throw new Error(`无法解析当前游戏时间：${separated.currentDate}`);
  const futureClocks = (separated.npcs ?? [])
    .filter((npc) => targetNpcIds.has(npc.npcId))
    .flatMap((npc) => [npc.backgroundEvolutionMeta?.nextRetryAt, npc.backgroundActivity?.dueAt])
    .filter((value): value is string => Boolean(value))
    .map(tryCreateGameClockFromDateLabel)
    .filter((value): value is GameClock => Boolean(value))
    .filter((value) => clockValue(value) > clockValue(current))
    .sort((left, right) => clockValue(left) - clockValue(right));
  if (futureClocks.length === 0) throw new Error('没有可推进到的下一次后台演化时间。');
  const next = structuredClone(separated);
  setRuntimeClock(next, futureClocks[0]);
  return next;
}

function keepPlayerOffstage(state: RuntimeState): RuntimeState {
  const occupied = new Set((state.npcs ?? [])
    .filter((npc) => ['npc_caocao', 'npc_shen_yan', 'npc_su_wan'].includes(npc.npcId))
    .map((npc) => npc.locationId)
    .filter((value): value is string => Boolean(value)));
  const safeLocation = ['place_player_waystation', 'place_player_waystation_2', 'place_xiangyang', 'place_jiangling', 'place_wancheng']
    .find((locationId) => !occupied.has(locationId));
  if (!safeLocation || state.currentLocationId === safeLocation) return state;
  const next = structuredClone(state);
  next.currentLocationId = safeLocation;
  next.currentPlaceId = safeLocation;
  return next;
}

function classifyFailure(reason: string | undefined): string {
  const text = (reason ?? '').toLowerCase();
  if (text.includes('429') || text.includes('rate')) return 'rate_limit';
  if (text.includes('timeout') || text.includes('超时')) return 'timeout';
  if (text.includes('empty') || text.includes('空正文')) return 'empty';
  if (text.includes('未返回可安全写入') || text.includes('valid')) return 'invalid_contract';
  if (text.includes('no due')) return 'no_due';
  return 'other';
}

function saveCheckpoint(checkpoint: SoakCheckpoint): void {
  mkdirSync(dirname(CHECKPOINT_PATH), { recursive: true });
  const temporaryPath = `${CHECKPOINT_PATH}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(checkpoint), 'utf8');
  renameSync(temporaryPath, CHECKPOINT_PATH);
}

function loadCheckpoint(): SoakCheckpoint | undefined {
  if (!RESUME_ENABLED || !existsSync(CHECKPOINT_PATH)) return undefined;
  const parsed = JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8')) as SoakCheckpoint;
  return parsed.targetValidTurns === TARGET_VALID_TURNS ? parsed : undefined;
}

function assertStateIntegrity(state: RuntimeState, validTurns: number): void {
  const relationNpcIds = new Set(['npc_caocao', 'npc_shen_yan', 'npc_su_wan']);
  const eventIds: string[] = [];
  for (const npc of state.npcs ?? []) {
    if (!relationNpcIds.has(npc.npcId)) continue;
    const hasBeenEvolved = Boolean(npc.backgroundEvolutionMeta?.lastEvaluationId);
    if (!hasBeenEvolved) continue;
    expect(npc.backgroundActivity?.summary).toBeTruthy();
    expect(npc.backgroundActivity?.status).toMatch(/active|blocked/);
    for (const memory of npc.memories ?? []) {
      if (memory.eventId?.startsWith('bg_')) eventIds.push(memory.eventId);
    }
    expect(new Set((npc.presenceUpdates ?? []).map((item) => item.id)).size)
      .toBe((npc.presenceUpdates ?? []).length);
  }
  expect(eventIds).toHaveLength(validTurns);
  expect(new Set(eventIds).size).toBe(eventIds.length);
  for (const faction of state.factions ?? []) {
    const records = faction.recentActionRecords ?? [];
    expect(new Set(records.map((item) => `${item.observedAt ?? ''}|${item.summary}|${item.sourceNote ?? ''}`)).size)
      .toBe(records.length);
  }
  const trends = state.worldTrends ?? [];
  expect(new Set(trends.map((item) => item.trendId)).size).toBe(trends.length);
}

describe.runIf(SOAK_ENABLED)('关系人物后台演化真实 API 长测', () => {
  it(`完成至少 ${TARGET_VALID_TURNS} 个有效演化回合`, async () => {
    initWorldBookRegistry();
    const worldBook = getWorldBook('threeKingdoms');
    if (!worldBook) throw new Error('三国官方世界书未注册。');
    const apiConfig = makeApiConfig();
    const client = new BrowserLlmClient();
    const checkpoint = loadCheckpoint();
    let state = checkpoint?.state ?? makeState();
    let validTurns = checkpoint?.validTurns ?? 0;
    let attempts = checkpoint?.attempts ?? 0;
    let nonValidAttempts = checkpoint?.nonValidAttempts ?? 0;
    const durations: number[] = checkpoint?.durations ?? [];
    const appliedByNpc = new Map<string, number>(Object.entries(checkpoint?.appliedByNpc ?? {}));

    if (validTurns === 0) {
      const initial = selectRelationshipWorldEvolutionCandidates(state, PLAYER_INPUT, 3);
      expect(initial.find((item) => item.npcId === 'npc_caocao')?.historicalDirection)
        .toContain('曹操 184-190 阶段惯性');
    } else {
      console.log(`[world-evolution-soak] resumed valid=${validTurns}/${TARGET_VALID_TURNS} attempts=${attempts}`);
    }

    while (validTurns < TARGET_VALID_TURNS && attempts < MAX_ATTEMPTS) {
      state = moveToNextEligibleTime(state);
      const beforeDate = state.currentDate;
      const startedAt = Date.now();
      const result = await executeRelationshipWorldEvolution(
        worldBook,
        state,
        PLAYER_INPUT,
        { apiConfig, llmClient: client, maxNpcCount: 1, timeoutMs: 60_000 },
      );
      attempts += 1;
      durations.push(Date.now() - startedAt);
      state = keepPlayerOffstage(result.state);

      if (result.status === 'completed' && result.appliedNpcIds.length === 1) {
        validTurns += 1;
        const npcId = result.appliedNpcIds[0];
        appliedByNpc.set(npcId, (appliedByNpc.get(npcId) ?? 0) + 1);
        const npc = state.npcs?.find((item) => item.npcId === npcId);
        const due = tryCreateGameClockFromDateLabel(npc?.backgroundActivity?.dueAt ?? '');
        const current = tryCreateGameClockFromDateLabel(beforeDate);
        expect(due).toBeTruthy();
        expect(current).toBeTruthy();
        const deltaMinutes = clockValue(due!) - clockValue(current!);
        expect(deltaMinutes).toBeGreaterThanOrEqual(24 * 60);
        expect(deltaMinutes).toBeLessThanOrEqual(30 * 24 * 60);
        assertStateIntegrity(state, validTurns);
        if (validTurns % 5 === 0 || validTurns === TARGET_VALID_TURNS) {
          console.log(`[world-evolution-soak] valid=${validTurns}/${TARGET_VALID_TURNS} attempts=${attempts} nonValidAttempts=${nonValidAttempts} gameDate=${formatGameClock(due!)} lastNpc=${npcId}`);
        }
      } else {
        nonValidAttempts += 1;
        console.log(`[world-evolution-soak] retry attempts=${attempts} valid=${validTurns}/${TARGET_VALID_TURNS} status=${result.status} reason=${classifyFailure(result.reason)}`);
      }
      saveCheckpoint({
        targetValidTurns: TARGET_VALID_TURNS,
        state,
        validTurns,
        attempts,
        nonValidAttempts,
        durations,
        appliedByNpc: Object.fromEntries(appliedByNpc),
      });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
    }

    expect(validTurns).toBeGreaterThanOrEqual(TARGET_VALID_TURNS);
    expect([...appliedByNpc.keys()].sort()).toEqual(['npc_caocao', 'npc_shen_yan', 'npc_su_wan']);
    const presenceCount = (state.npcs ?? []).reduce((sum, npc) => sum + (npc.presenceUpdates?.length ?? 0), 0);
    expect(presenceCount).toBeGreaterThan(0);
    const averageMs = Math.round(durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length));
    console.log(`[world-evolution-soak-summary] valid=${validTurns} attempts=${attempts} nonValidAttempts=${nonValidAttempts} avgMs=${averageMs} maxMs=${Math.max(...durations)} memories=${validTurns} presence=${presenceCount} factionRecords=${(state.factions ?? []).reduce((sum, faction) => sum + (faction.recentActionRecords?.length ?? 0), 0)} chronicles=${state.worldTrends?.length ?? 0} perNpc=${JSON.stringify(Object.fromEntries(appliedByNpc))}`);
    rmSync(CHECKPOINT_PATH, { force: true });
  }, 30 * 60_000);
});

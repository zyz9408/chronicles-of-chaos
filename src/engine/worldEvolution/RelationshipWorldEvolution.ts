import {
  BrowserLlmClient,
  type LlmClient,
  type LlmMessage,
  type LlmTimeoutErrorFactory,
  type LlmTokenUsage,
} from '../llm/LlmClient';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { isNpcPhysicallyPresent } from '../state/npcPresence';
import { resolveNpcBackgroundActivityAgainstCurrentMatters } from '../state/currentMatterLifecycle';
import { applyLuanShiCommand } from '../state/luanshiReducers';
import { validateLuanShiCommand, type LuanShiCommand } from '../state/luanshiCommands';
import { isWorldChronicleEligible } from '../state/worldChroniclePolicy';
import {
  advanceGameClock,
  ensureGameClock,
  formatGameClock,
  tryCreateGameClockFromDateLabel,
  type GameClock,
} from '../time/gameClock';
import type {
  BondThreadEntry,
  HeroineThreadEntry,
  LuanShiNpc,
  NpcPresenceUpdate,
  RuntimeState,
  WorldBook,
} from '../types';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import { buildWorldlineKnowledgeProjection } from '../worldline/WorldlineKnowledgeProjection';
import {
  createCorrespondenceDraft,
  findRapidRepeatedNpcFollowup,
  normalizeCorrespondenceEntries,
  queueCorrespondence,
  recordNpcSentCorrespondenceMemory,
  upsertCorrespondenceEntry,
} from '../correspondence';
import {
  getWorldlineKnowledgeBase,
  getWorldlineStoryPack,
} from '../worldline/WorldlineKnowledgeRegistry';

export type RelationshipWorldEvolutionTrigger = 'bootstrap' | 'due' | 'selfHeal';

export interface SameTurnNpcEvolutionExclusion {
  npcId: string;
  reason: 'same_turn_present' | 'same_turn_involved';
  eventId: string;
}

export function selectSameTurnNpcEvolutionExclusions(
  previousState: RuntimeState,
  nextState: RuntimeState,
): { npcIds: string[]; diagnostics: SameTurnNpcEvolutionExclusion[] } {
  const previousEventIds = new Set((previousState.turnEvents ?? []).map((event) => event.eventId));
  const exclusions: SameTurnNpcEvolutionExclusion[] = [];
  for (const event of nextState.turnEvents ?? []) {
    if (previousEventIds.has(event.eventId)) continue;
    for (const npcId of event.presentNpcIds) {
      exclusions.push({ npcId, reason: 'same_turn_present', eventId: event.eventId });
    }
    for (const npcId of event.involvedNpcIds) {
      if (!event.presentNpcIds.includes(npcId)) {
        exclusions.push({ npcId, reason: 'same_turn_involved', eventId: event.eventId });
      }
    }
  }
  const diagnostics = exclusions.filter((entry, index) => (
    exclusions.findIndex((candidate) => candidate.npcId === entry.npcId) === index
  ));
  return { npcIds: diagnostics.map((entry) => entry.npcId), diagnostics };
}

export interface RelationshipWorldEvolutionCandidate {
  npcId: string;
  npcName: string;
  trigger: RelationshipWorldEvolutionTrigger;
  evaluationId: string;
  relationRefs: Array<{ kind: 'heroine' | 'bond'; threadId: string }>;
  profile: {
    role: string;
    factionId?: string;
    factionName?: string;
    locationId?: string;
    summary: string;
    personality: string;
    motivation: string;
    relationToPlayer: string;
  };
  backgroundActivity?: LuanShiNpc['backgroundActivity'];
  recentMemories: Array<{ createdAt: string; content: string }>;
  historicalDirection?: string;
}

export interface RelationshipWorldEvolutionDecision {
  npcId: string;
  result: 'continue' | 'blocked' | 'completed' | 'cancelled' | 'replace';
  confirmedProgress: string;
  nextActivity: {
    summary: string;
    locationId?: string;
    dueAt: string;
    visibility: 'hidden' | 'playerKnown' | 'public';
  };
  completedMemory?: string;
  knowledgeDelivery?: {
    kind: NpcPresenceUpdate['kind'];
    summary: string;
    source: string;
    certainty?: NpcPresenceUpdate['certainty'];
    /** kind=letter 时为实际送出的信件内容；缺省时用 summary 作为兼容正文。 */
    subject?: string;
    body?: string;
    channel?: 'letter' | 'envoy';
  };
  relationshipProgress?: {
    summary: string;
    milestone?: string;
  };
  factionAction?: {
    factionId: string;
    summary: string;
    knownLevel: '亲历' | '听闻' | '推测';
  };
  macroImpact?: {
    title: string;
    summary: string;
    severity: '低' | '中' | '高' | '极高';
    scope: 'regional' | 'realm' | 'world';
    affectedFactionIds?: string[];
    affectedPlaceIds?: string[];
  };
}

export interface RelationshipWorldEvolutionPackage {
  protocolVersion: 'coc.v2.relationshipWorldEvolution.v1';
  decisions: RelationshipWorldEvolutionDecision[];
}

export interface RelationshipWorldEvolutionResult {
  status: 'completed' | 'skipped' | 'failed';
  reason?: string;
  state: RuntimeState;
  targetNpcIds: string[];
  appliedNpcIds: string[];
  provider?: string;
  model?: string;
  usage?: LlmTokenUsage;
  rawContent?: string;
}

export interface RelationshipWorldEvolutionOptions {
  apiConfig?: ApiConfigArchive | null;
  llmClient?: LlmClient;
  maxNpcCount?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  timeoutErrorFactory?: LlmTimeoutErrorFactory;
  /** NPCs already handled by the foreground intent simulator in this turn. */
  excludedNpcIds?: readonly string[];
}

const DEFAULT_MAX_NPC_COUNT = 3;
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_ACTIVITY_DAYS = 30;
const RETRY_DAYS = [1, 3, 7] as const;

export function selectRelationshipWorldEvolutionCandidates(
  state: RuntimeState,
  playerInput: string,
  maxNpcCount = DEFAULT_MAX_NPC_COUNT,
  excludedNpcIds: readonly string[] = [],
): RelationshipWorldEvolutionCandidate[] {
  const normalized = ensureLuanShiState(state);
  const refsByNpcId = collectActiveRelationRefs(normalized);
  const candidates: RelationshipWorldEvolutionCandidate[] = [];

  for (const npc of normalized.npcs) {
    const relationRefs = refsByNpcId.get(npc.npcId);
    if (!relationRefs?.length) continue;
    if (isForegroundNpc(normalized, npc, playerInput, excludedNpcIds)) continue;
    if (npc.backgroundEvolutionMeta?.nextRetryAt && !isReached(normalized, npc.backgroundEvolutionMeta.nextRetryAt)) {
      continue;
    }

    const activity = resolveNpcBackgroundActivityAgainstCurrentMatters(
      npc.backgroundActivity,
      normalized.activeQuests,
      normalized.currentDate,
    );
    const trigger = resolveEvolutionTrigger(normalized, activity);
    if (!trigger) continue;

    const evaluationId = buildEvaluationId(npc, activity, trigger, normalized.currentDate);
    if (npc.backgroundEvolutionMeta?.lastEvaluationId === evaluationId) continue;
    const worldline = buildNpcWorldlineDirection(normalized, npc);
    candidates.push({
      npcId: npc.npcId,
      npcName: npc.name,
      trigger,
      evaluationId,
      relationRefs,
      profile: {
        role: npc.currentIdentity ?? npc.role,
        factionId: npc.factionId,
        factionName: npc.factionName,
        locationId: npc.locationId,
        summary: npc.summary,
        personality: npc.personality,
        motivation: npc.motivation,
        relationToPlayer: npc.relationToPlayer,
      },
      backgroundActivity: activity ? structuredClone(activity) : undefined,
      recentMemories: (npc.memories ?? []).slice(-5).map((memory) => ({
        createdAt: memory.createdAt,
        content: memory.content,
      })),
      historicalDirection: worldline ? worldline.slice(0, 2400) : undefined,
    });
  }

  return candidates
    .sort((left, right) => {
      if (left.trigger !== right.trigger) return left.trigger === 'due' ? -1 : 1;
      return left.npcId.localeCompare(right.npcId);
    })
    .slice(0, Math.max(0, maxNpcCount));
}

export function parseRelationshipWorldEvolutionResponse(
  content: string,
  state: RuntimeState,
  candidates: RelationshipWorldEvolutionCandidate[],
  worldBook?: WorldBook,
): RelationshipWorldEvolutionPackage {
  const payload = parseJsonObject(content);
  const allowed = new Map(candidates.map((candidate) => [candidate.npcId, candidate]));
  const decisions = (Array.isArray(payload.decisions) ? payload.decisions : [])
    .map((value) => normalizeDecision(value, state, allowed, worldBook))
    .filter((value): value is RelationshipWorldEvolutionDecision => Boolean(value));

  return {
    protocolVersion: 'coc.v2.relationshipWorldEvolution.v1',
    decisions,
  };
}

export async function executeRelationshipWorldEvolution(
  worldBook: WorldBook,
  state: RuntimeState,
  playerInput: string,
  options: RelationshipWorldEvolutionOptions = {},
): Promise<RelationshipWorldEvolutionResult> {
  const candidates = selectRelationshipWorldEvolutionCandidates(
    state,
    playerInput,
    options.maxNpcCount,
    options.excludedNpcIds,
  );
  if (candidates.length === 0) {
    return {
      status: 'skipped',
      reason: explainNoRelationshipWorldEvolutionCandidate(state, playerInput, options.excludedNpcIds),
      state,
      targetNpcIds: [],
      appliedNpcIds: [],
    };
  }
  if (!options.apiConfig) {
    return { status: 'skipped', reason: 'world evolution api not configured', state, targetNpcIds: candidates.map((item) => item.npcId), appliedNpcIds: [] };
  }

  try {
    const client = options.llmClient ?? new BrowserLlmClient();
    const response = await client.generate({
      config: options.apiConfig,
      messages: buildMessages(worldBook, state, candidates),
      temperature: Math.min(options.apiConfig.temperature ?? 0.25, 0.35),
      maxOutputTokens: Math.min(options.apiConfig.maxOutputTokens ?? 4096, 4096),
      responseFormat: 'json_object',
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      timeoutErrorFactory: options.timeoutErrorFactory,
    });
    const parsed = parseRelationshipWorldEvolutionResponse(response.content, state, candidates, worldBook);
    if (parsed.decisions.length === 0) {
      throw new Error('后台世界演化未返回可安全写入的有效决定。');
    }
    const application = applyRelationshipWorldEvolutionPackage(state, parsed, candidates);
    const missingCandidates = candidates.filter((candidate) => !application.appliedNpcIds.includes(candidate.npcId));
    const appliedState = missingCandidates.length > 0
      ? applyFailureBackoff(application.state, missingCandidates)
      : application.state;
    return {
      status: 'completed',
      state: appliedState,
      reason: missingCandidates.length > 0
        ? `${application.appliedNpcIds.length} 名人物已演化，${missingCandidates.length} 名人物结果无效并已延后重试`
        : `已演化 ${application.appliedNpcIds.length} 名关系人物`,
      targetNpcIds: candidates.map((item) => item.npcId),
      appliedNpcIds: application.appliedNpcIds,
      provider: response.provider,
      model: response.model,
      usage: response.usage,
      rawContent: response.content,
    };
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? error;
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : 'unknown world evolution failure',
      state: applyFailureBackoff(state, candidates),
      targetNpcIds: candidates.map((item) => item.npcId),
      appliedNpcIds: [],
    };
  }
}

export function applyRelationshipWorldEvolutionPackage(
  state: RuntimeState,
  packageValue: RelationshipWorldEvolutionPackage,
  candidates: RelationshipWorldEvolutionCandidate[],
): { state: RuntimeState; appliedNpcIds: string[] } {
  let next = structuredClone(ensureLuanShiState(state)) as RuntimeState;
  const candidateByNpcId = new Map(candidates.map((candidate) => [candidate.npcId, candidate]));
  const appliedNpcIds: string[] = [];

  for (const decision of packageValue.decisions) {
    const candidate = candidateByNpcId.get(decision.npcId);
    const npc = next.npcs?.find((item) => item.npcId === decision.npcId);
    if (!candidate || !npc) continue;
    if (npc.backgroundEvolutionMeta?.lastEvaluationId === candidate.evaluationId) continue;

    const activityId = decision.result === 'continue' || decision.result === 'blocked'
      ? npc.backgroundActivity?.activityId ?? buildActivityId(npc, decision)
      : buildActivityId(npc, decision);
    npc.backgroundActivity = {
      activityId,
      summary: decision.nextActivity.summary,
      status: decision.result === 'blocked' ? 'blocked' : 'active',
      locationId: decision.nextActivity.locationId,
      startedAt: decision.result === 'continue' || decision.result === 'blocked'
        ? npc.backgroundActivity?.startedAt ?? next.currentDate
        : next.currentDate,
      dueAt: decision.nextActivity.dueAt,
      lastEvaluatedAt: next.currentDate,
      sourceType: 'system',
      sourceIds: [candidate.evaluationId],
      visibility: decision.nextActivity.visibility,
    };
    npc.locationId = decision.nextActivity.locationId ?? npc.locationId;
    npc.backgroundEvolutionMeta = {
      lastAttemptAt: next.currentDate,
      lastEvaluationId: candidate.evaluationId,
      consecutiveFailures: 0,
    };

    const settledMemory = decision.completedMemory?.trim() || decision.confirmedProgress.trim();
    if (settledMemory && !npc.memories.some((memory) => memory.eventId === candidate.evaluationId)) {
      npc.memories.push({
        memoryId: `${candidate.evaluationId}_memory`,
        eventId: candidate.evaluationId,
        source: '听闻',
        content: settledMemory,
        createdAt: next.currentDate,
      });
    }
    const visibleKnowledge = decision.knowledgeDelivery ?? (
      decision.nextActivity.visibility !== 'hidden' && decision.confirmedProgress.trim()
        ? {
            kind: decision.nextActivity.visibility === 'public' ? 'publicEvent' as const : 'rumor' as const,
            summary: decision.confirmedProgress.trim(),
            source: decision.nextActivity.visibility === 'public' ? '公开消息' : '关系人物近况',
            certainty: decision.nextActivity.visibility === 'public' ? 'confirmed' as const : 'reported' as const,
          }
        : undefined
    );
    if (visibleKnowledge?.kind === 'letter') {
      next = queueRelationshipEvolutionLetter(next, npc, candidate, visibleKnowledge);
      updateAwarenessCooldown(next, npc);
    } else if (visibleKnowledge) {
      npc.presenceUpdates ??= [];
      if (!npc.presenceUpdates.some((update) => update.id === candidate.evaluationId)) {
        npc.presenceUpdates.push({
          id: candidate.evaluationId,
          createdAt: next.currentDate,
          kind: visibleKnowledge.kind,
          summary: visibleKnowledge.summary,
          source: visibleKnowledge.source,
          certainty: visibleKnowledge.certainty,
          readByPlayer: false,
        });
        updateAwarenessCooldown(next, npc);
      }
    }
    const visibleRelationshipProgress = decision.relationshipProgress ?? (
      decision.nextActivity.visibility !== 'hidden' && decision.confirmedProgress.trim()
        ? { summary: decision.confirmedProgress.trim() }
        : undefined
    );
    if (visibleRelationshipProgress) {
      applyRelationshipProgress(next, candidate, visibleRelationshipProgress);
    }
    if (decision.factionAction) {
      next = applyValidatedCommand(next, {
        action: 'recordFactionRecentAction',
        factionId: decision.factionAction.factionId,
        summary: decision.factionAction.summary,
        knownLevel: decision.factionAction.knownLevel,
        observedAt: next.currentDate,
        sourceNote: `后台世界演化 ${candidate.evaluationId}`,
      });
    }
    if (decision.macroImpact) applyMacroImpact(next, npc, candidate, decision.macroImpact);
    appliedNpcIds.push(npc.npcId);
  }

  return { state: next, appliedNpcIds };
}

function collectActiveRelationRefs(state: ReturnType<typeof ensureLuanShiState>): Map<string, RelationshipWorldEvolutionCandidate['relationRefs']> {
  const refs = new Map<string, RelationshipWorldEvolutionCandidate['relationRefs']>();
  const add = (npcId: string, ref: RelationshipWorldEvolutionCandidate['relationRefs'][number]) => {
    if (!state.npcs.some((npc) => npc.npcId === npcId)) return;
    refs.set(npcId, [...(refs.get(npcId) ?? []), ref]);
  };
  for (const thread of state.heroineThreads) {
    if (thread.status === 'active') add(thread.npcId, { kind: 'heroine', threadId: thread.heroineThreadId });
  }
  for (const thread of state.bondThreads) {
    if (thread.status !== 'active') continue;
    for (const npcId of thread.targetNpcIds ?? []) add(npcId, { kind: 'bond', threadId: thread.bondThreadId });
  }
  return refs;
}

function isForegroundNpc(
  state: RuntimeState,
  npc: LuanShiNpc,
  playerInput: string,
  excludedNpcIds: readonly string[] = [],
): boolean {
  return isNpcPhysicallyPresent(state, npc)
    || excludedNpcIds.includes(npc.npcId)
    || Boolean(npc.name.trim() && playerInput.includes(npc.name.trim()));
}

function explainNoRelationshipWorldEvolutionCandidate(
  state: RuntimeState,
  playerInput: string,
  excludedNpcIds: readonly string[] = [],
): string {
  const normalized = ensureLuanShiState(state);
  const refsByNpcId = collectActiveRelationRefs(normalized);
  const unresolvedNameOnlyBonds = normalized.bondThreads.filter((thread) => (
    thread.status === 'active' && !(thread.targetNpcIds?.length)
  )).length;
  if (refsByNpcId.size === 0) {
    return unresolvedNameOnlyBonds > 0
      ? `没有可绑定人物志 NPC 的活跃关系人物（${unresolvedNameOnlyBonds} 条羁绊仍为姓名模式）`
      : '没有已激活且绑定人物志 NPC 的红颜或羁绊关系';
  }

  let foregroundCount = 0;
  let retryCount = 0;
  let pendingCount = 0;
  let duplicateCount = 0;
  for (const npc of normalized.npcs) {
    if (!refsByNpcId.has(npc.npcId)) continue;
    if (isForegroundNpc(normalized, npc, playerInput, excludedNpcIds)) {
      foregroundCount += 1;
      continue;
    }
    if (npc.backgroundEvolutionMeta?.nextRetryAt && !isReached(normalized, npc.backgroundEvolutionMeta.nextRetryAt)) {
      retryCount += 1;
      continue;
    }
    const activity = resolveNpcBackgroundActivityAgainstCurrentMatters(
      npc.backgroundActivity,
      normalized.activeQuests,
      normalized.currentDate,
    );
    const trigger = resolveEvolutionTrigger(normalized, activity);
    if (!trigger) {
      pendingCount += 1;
      continue;
    }
    const evaluationId = buildEvaluationId(npc, activity, trigger, normalized.currentDate);
    if (npc.backgroundEvolutionMeta?.lastEvaluationId === evaluationId) duplicateCount += 1;
  }
  return [
    '本回合没有到期的关系人物演化',
    foregroundCount > 0 ? `前台/本回合提及 ${foregroundCount} 人` : '',
    pendingCount > 0 ? `尚未到期 ${pendingCount} 人` : '',
    retryCount > 0 ? `失败退避 ${retryCount} 人` : '',
    duplicateCount > 0 ? `本阶段已结算 ${duplicateCount} 人` : '',
    unresolvedNameOnlyBonds > 0 ? `姓名模式羁绊 ${unresolvedNameOnlyBonds} 条` : '',
  ].filter(Boolean).join('；');
}

function resolveEvolutionTrigger(
  state: RuntimeState,
  activity: LuanShiNpc['backgroundActivity'],
): RelationshipWorldEvolutionTrigger | undefined {
  if (!activity || activity.status === 'completed' || activity.status === 'cancelled') return 'bootstrap';
  if (['active', 'planned', 'blocked'].includes(activity.status)) {
    if (!activity.dueAt || !tryCreateGameClockFromDateLabel(activity.dueAt)) return 'selfHeal';
    if (isReached(state, activity.dueAt)) return 'due';
  }
  return undefined;
}

function buildEvaluationId(
  npc: LuanShiNpc,
  activity: LuanShiNpc['backgroundActivity'],
  trigger: RelationshipWorldEvolutionTrigger,
  currentDate: string,
): string {
  const seed = trigger === 'due' ? activity?.dueAt ?? currentDate : currentDate;
  const fingerprint = stableIdFingerprint([
    npc.npcId,
    trigger,
    activity?.activityId ?? '',
    seed,
  ].join('|'));
  return `bg_${sanitizeId(npc.npcId).slice(0, 48)}_${fingerprint}`;
}

function buildActivityId(npc: LuanShiNpc, decision: RelationshipWorldEvolutionDecision): string {
  const fingerprint = stableIdFingerprint([
    npc.npcId,
    decision.result,
    decision.nextActivity.dueAt,
    decision.nextActivity.locationId ?? '',
    decision.nextActivity.summary,
  ].join('|'));
  return `activity_${sanitizeId(npc.npcId).slice(0, 48)}_${fingerprint}`;
}

function stableIdFingerprint(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
    second ^= second >>> 13;
  }
  return `${(first >>> 0).toString(36).padStart(7, '0')}${(second >>> 0).toString(36).padStart(7, '0')}`;
}

function buildNpcWorldlineDirection(state: RuntimeState, npc: LuanShiNpc): string {
  const settings = state.worldlineSettings;
  if (!settings || settings.knowledgeMode === 'off') return '';
  const projection = buildWorldlineKnowledgeProjection({
    state,
    knowledgeBase: getWorldlineKnowledgeBase(settings.knowledgeBaseId),
    storyPacks: (settings.storyPackIds ?? []).map(getWorldlineStoryPack).filter((item): item is NonNullable<typeof item> => Boolean(item)),
    mode: settings.knowledgeMode,
    queryTexts: [npc.name, npc.currentIdentity ?? npc.role, npc.factionName ?? ''],
  });
  return projection.text;
}

function buildMessages(worldBook: WorldBook, state: RuntimeState, candidates: RelationshipWorldEvolutionCandidate[]): LlmMessage[] {
  const schema = {
    protocolVersion: 'coc.v2.relationshipWorldEvolution.v1',
    decisions: [{
      npcId: '必须匹配候选 npcId',
      result: 'continue|blocked|completed|cancelled|replace',
      confirmedProgress: '本阶段已经发生的客观进展',
      nextActivity: { summary: '下一阶段正在做什么', locationId: '仅限已有地点ID或省略', dueAt: '未来1至30游戏日的完整时间', visibility: 'hidden|playerKnown|public' },
      completedMemory: '可选；值得固定进人物记忆的已发生事实',
      knowledgeDelivery: { kind: 'rumor|letter|envoy|sighting|publicEvent|absence', summary: '玩家此次能获知的近况', source: '消息来源', certainty: 'confirmed|reported|rumor|uncertain', subject: 'kind=letter时的信件主题', body: 'kind=letter时的完整信件正文', channel: 'letter|envoy' },
      relationshipProgress: { summary: '可选；关系线进展', milestone: '可选；真正的新里程碑' },
      factionAction: { factionId: '仅限已有势力ID', summary: '可选；势力近期动作', knownLevel: '亲历|听闻|推测' },
      macroImpact: { title: '可选；区域以上影响', summary: '宏观事实', severity: '低|中|高|极高', scope: 'regional|realm|world', affectedFactionIds: [], affectedPlaceIds: [] },
    }],
  };
  return [{
    role: 'system',
    content: [
      '你是《乱世风云录 V2》的后台世界演化执行器，不是当前回合 NPC 模拟器，也不写正文。',
      '仅结算给定的羁绊/红颜人物离场后的时间驱动进展。历史资料是人物行动方向；玩家没有干预时，人物应以若干3至30日的小阶段朝历史节点或合理动机推进，而非几个月毫无动静。',
      '不得让人物知道异地私密信息；不得修改玩家、物品、钱粮、领地、部队或战斗数据；不得生成候选外的新 NPC/势力/地点 ID。',
      '每项 nextActivity 必填，dueAt 必须晚于当前时间且不超过30游戏日。只有玩家合理能得知时才写 knowledgeDelivery。kind=letter 表示人物确实在本阶段寄出书信，必须给出适合人物和时代的完整 body；本地按路线计算送达时间，不会立即让玩家读到。局部私事不得写 macroImpact。',
      '只输出 JSON 对象。',
    ].join('\n'),
  }, {
    role: 'user',
    content: [
      `世界：${worldBook.manifest.name}`,
      `当前时间：${state.currentDate}`,
      `已有地点ID：${[...collectValidLocationIds(state, worldBook)].join(', ') || 'none'}`,
      `已有势力ID：${(state.factions ?? []).map((faction) => faction.factionId).join(', ') || 'none'}`,
      '候选人物：',
      JSON.stringify(candidates, null, 2),
      '输出结构：',
      JSON.stringify(schema, null, 2),
    ].join('\n\n'),
  }];
}

function normalizeDecision(
  value: unknown,
  state: RuntimeState,
  allowed: Map<string, RelationshipWorldEvolutionCandidate>,
  worldBook?: WorldBook,
): RelationshipWorldEvolutionDecision | undefined {
  if (!isRecord(value)) return undefined;
  const npcId = readString(value.npcId);
  if (!allowed.has(npcId)) return undefined;
  const results = ['continue', 'blocked', 'completed', 'cancelled', 'replace'] as const;
  const result = results.find((item) => item === value.result);
  const progress = readString(value.confirmedProgress).trim();
  const nextRaw = isRecord(value.nextActivity) ? value.nextActivity : undefined;
  const summary = nextRaw ? readString(nextRaw.summary).trim() : '';
  const dueAt = nextRaw ? normalizeFutureDueAt(state, readString(nextRaw.dueAt)) : undefined;
  if (!result || !progress || !nextRaw || !summary || !dueAt) return undefined;
  const validLocations = collectValidLocationIds(state, worldBook);
  const locationId = readOptionalString(nextRaw.locationId);
  if (locationId && !validLocations.has(locationId)) return undefined;
  const visibility = ['hidden', 'playerKnown', 'public'].includes(readString(nextRaw.visibility))
    ? readString(nextRaw.visibility) as RelationshipWorldEvolutionDecision['nextActivity']['visibility']
    : 'hidden';
  const decision: RelationshipWorldEvolutionDecision = {
    npcId,
    result,
    confirmedProgress: progress,
    nextActivity: { summary, dueAt, visibility, ...(locationId ? { locationId } : {}) },
  };
  const completedMemory = readOptionalString(value.completedMemory);
  if (completedMemory) decision.completedMemory = completedMemory;
  const delivery = normalizeKnowledgeDelivery(value.knowledgeDelivery);
  if (delivery) decision.knowledgeDelivery = delivery;
  const relation = normalizeRelationshipProgress(value.relationshipProgress);
  if (relation) decision.relationshipProgress = relation;
  const faction = normalizeFactionAction(value.factionAction, state);
  if (faction) decision.factionAction = faction;
  const macro = normalizeMacroImpact(value.macroImpact, state, worldBook);
  if (macro) decision.macroImpact = macro;
  return decision;
}

function normalizeKnowledgeDelivery(value: unknown): RelationshipWorldEvolutionDecision['knowledgeDelivery'] | undefined {
  if (!isRecord(value)) return undefined;
  const kinds: NpcPresenceUpdate['kind'][] = ['rumor', 'letter', 'envoy', 'sighting', 'publicEvent', 'absence'];
  const kind = kinds.find((item) => item === value.kind);
  const summary = readString(value.summary).trim();
  const source = readString(value.source).trim();
  if (!kind || !summary || !source) return undefined;
  const certainties: NonNullable<NpcPresenceUpdate['certainty']>[] = ['confirmed', 'reported', 'rumor', 'uncertain'];
  const certainty = certainties.find((item) => item === value.certainty);
  const subject = readOptionalString(value.subject);
  const body = readOptionalString(value.body);
  const channel = value.channel === 'envoy' ? 'envoy' : value.channel === 'letter' ? 'letter' : undefined;
  return {
    kind,
    summary,
    source,
    certainty,
    ...(subject ? { subject } : {}),
    ...(body ? { body } : {}),
    ...(channel ? { channel } : {}),
  };
}

function queueRelationshipEvolutionLetter(
  state: RuntimeState,
  npc: LuanShiNpc,
  candidate: RelationshipWorldEvolutionCandidate,
  delivery: NonNullable<RelationshipWorldEvolutionDecision['knowledgeDelivery']>,
): RuntimeState {
  const sourceRefId = `relationship_letter:${candidate.evaluationId}`;
  const correspondence = normalizeCorrespondenceEntries(state.correspondence);
  const existing = correspondence
    .find((entry) => entry.sourceRefId === sourceRefId);
  if (existing) return state;
  const letterId = `letter_${candidate.evaluationId}`;
  const draft = createCorrespondenceDraft({
    letterId,
    sender: { kind: 'npc', npcId: npc.npcId, name: npc.name },
    recipient: { kind: 'player', playerId: state.player.id, name: state.player.name },
    subject: delivery.subject ?? `${npc.name}来书`,
    body: delivery.body ?? delivery.summary,
    source: 'npcEvolution',
    sourceRefId,
    sourceTurnNumber: state.turnLog.length,
    channel: delivery.channel ?? 'letter',
    originLocationId: npc.locationId,
    targetLocationId: state.currentPlaceId ?? state.currentLocationId,
    createdAt: state.currentDate,
  });
  draft.summary = delivery.summary;
  if (findRapidRepeatedNpcFollowup(correspondence, draft)) return state;
  let next = upsertCorrespondenceEntry(state, draft);
  next = queueCorrespondence(next, letterId, { sentAt: state.currentDate });
  recordNpcSentCorrespondenceMemory(next, letterId, npc.npcId);
  return next;
}

function normalizeRelationshipProgress(value: unknown): RelationshipWorldEvolutionDecision['relationshipProgress'] | undefined {
  if (!isRecord(value)) return undefined;
  const summary = readString(value.summary).trim();
  if (!summary) return undefined;
  return { summary, milestone: readOptionalString(value.milestone) };
}

function normalizeFactionAction(value: unknown, state: RuntimeState): RelationshipWorldEvolutionDecision['factionAction'] | undefined {
  if (!isRecord(value)) return undefined;
  const factionId = readString(value.factionId).trim();
  const summary = readString(value.summary).trim();
  const knownLevels = ['亲历', '听闻', '推测'] as const;
  const knownLevel = knownLevels.find((item) => item === value.knownLevel);
  if (!factionId || !summary || !knownLevel || !(state.factions ?? []).some((item) => item.factionId === factionId)) return undefined;
  return { factionId, summary, knownLevel };
}

function normalizeMacroImpact(
  value: unknown,
  state: RuntimeState,
  worldBook?: WorldBook,
): RelationshipWorldEvolutionDecision['macroImpact'] | undefined {
  if (!isRecord(value)) return undefined;
  const title = readString(value.title).trim();
  const summary = readString(value.summary).trim();
  const scopes = ['regional', 'realm', 'world'] as const;
  const severities = ['低', '中', '高', '极高'] as const;
  const scope = scopes.find((item) => item === value.scope);
  const severity = severities.find((item) => item === value.severity);
  if (!title || !summary || !scope || !severity) return undefined;
  const factionIds = new Set((state.factions ?? []).map((item) => item.factionId));
  const locationIds = collectValidLocationIds(state, worldBook);
  const affectedFactionIds = readStringArray(value.affectedFactionIds).filter((id) => factionIds.has(id));
  const affectedPlaceIds = readStringArray(value.affectedPlaceIds).filter((id) => locationIds.has(id));
  if (affectedFactionIds.length + affectedPlaceIds.length === 0) return undefined;
  return { title, summary, scope, severity, affectedFactionIds, affectedPlaceIds };
}

function applyRelationshipProgress(
  state: RuntimeState,
  candidate: RelationshipWorldEvolutionCandidate,
  progress: NonNullable<RelationshipWorldEvolutionDecision['relationshipProgress']>,
): void {
  for (const ref of candidate.relationRefs) {
    if (ref.kind === 'heroine') {
      const thread = state.heroineThreads?.find((item) => item.heroineThreadId === ref.threadId);
      if (thread) mergeThreadProgress(thread, progress, candidate.evaluationId, state.currentDate);
    } else {
      const thread = state.bondThreads?.find((item) => item.bondThreadId === ref.threadId);
      if (thread) mergeThreadProgress(thread, progress, candidate.evaluationId, state.currentDate);
    }
  }
}

function mergeThreadProgress(
  thread: HeroineThreadEntry | BondThreadEntry,
  progress: NonNullable<RelationshipWorldEvolutionDecision['relationshipProgress']>,
  evaluationId: string,
  currentDate: string,
): void {
  thread.recentProgress = progress.summary;
  thread.lastUpdatedAt = currentDate;
  thread.source = `后台世界演化 ${evaluationId}`;
  if (progress.milestone && !(thread.milestones ?? []).some((item) => item.milestoneId === evaluationId)) {
    thread.milestones = [...(thread.milestones ?? []), {
      milestoneId: evaluationId,
      happenedAt: currentDate,
      summary: progress.milestone,
      source: '后台世界演化',
    }];
  }
}

function applyMacroImpact(
  state: RuntimeState,
  npc: LuanShiNpc,
  candidate: RelationshipWorldEvolutionCandidate,
  impact: NonNullable<RelationshipWorldEvolutionDecision['macroImpact']>,
): void {
  state.worldTrends ??= [];
  const trendId = candidate.evaluationId;
  if (state.worldTrends.some((trend) => trend.trendId === trendId)) return;
  const trend = {
    trendId,
    title: impact.title,
    severity: impact.severity,
    summary: impact.summary,
    knownToPlayer: Boolean(npc.backgroundActivity?.visibility !== 'hidden'),
    status: 'active',
    happenedAt: state.currentDate,
    learnedAt: state.currentDate,
    visibility: npc.backgroundActivity?.visibility === 'public' ? 'public' : 'known',
    scope: impact.scope,
    certainty: 'reported',
    source: `后台世界演化 ${npc.name}`,
    relatedNpcIds: [npc.npcId],
    affectedNpcIds: [npc.npcId],
    affectedFactionIds: impact.affectedFactionIds,
    affectedPlaceIds: impact.affectedPlaceIds,
    progressSummary: impact.summary,
    lastAdvancedAt: state.currentDate,
    updatedAt: state.currentDate,
  } satisfies NonNullable<RuntimeState['worldTrends']>[number];
  if (isWorldChronicleEligible(trend)) state.worldTrends.push(trend);
}

function updateAwarenessCooldown(state: RuntimeState, npc: LuanShiNpc): void {
  state.npcAwarenessIndex ??= [];
  let entry = state.npcAwarenessIndex.find((item) => item.npcId === npc.npcId);
  if (!entry) {
    entry = {
      awarenessId: `awareness_${npc.npcId}`,
      npcId: npc.npcId,
      name: npc.name,
      sourceType: 'npcProfile',
      sourceIds: [npc.npcId],
      contactLevel: npc.contactLevel,
      playerRelevance: ['activeRelationship'],
      knownToPlayer: true,
      archiveVisible: true,
      updatedAt: state.currentDate,
    };
    state.npcAwarenessIndex.push(entry);
  }
  entry.lastPresenceBeatAt = state.currentDate;
  entry.cooldownUntil = formatGameClock(advanceGameClock(ensureGameClock(state), { daysAdvanced: 7 }));
  entry.updatedAt = state.currentDate;
}

function applyValidatedCommand(state: RuntimeState, command: LuanShiCommand): RuntimeState {
  const validation = validateLuanShiCommand(state, command);
  return validation.valid ? applyLuanShiCommand(state, command) : state;
}

function applyFailureBackoff(state: RuntimeState, candidates: RelationshipWorldEvolutionCandidate[]): RuntimeState {
  const next = structuredClone(ensureLuanShiState(state)) as RuntimeState;
  for (const candidate of candidates) {
    const npc = next.npcs?.find((item) => item.npcId === candidate.npcId);
    if (!npc) continue;
    const failures = Math.min(3, (npc.backgroundEvolutionMeta?.consecutiveFailures ?? 0) + 1);
    npc.backgroundEvolutionMeta = {
      ...npc.backgroundEvolutionMeta,
      lastAttemptAt: next.currentDate,
      consecutiveFailures: failures,
      nextRetryAt: formatGameClock(advanceGameClock(ensureGameClock(next), { daysAdvanced: RETRY_DAYS[failures - 1] })),
    };
  }
  return next;
}

function normalizeFutureDueAt(state: RuntimeState, value: string): string | undefined {
  const due = tryCreateGameClockFromDateLabel(value);
  if (!due) return undefined;
  const current = ensureGameClock(state);
  const min = advanceGameClock(current, { daysAdvanced: 1 });
  const max = advanceGameClock(current, { daysAdvanced: MAX_ACTIVITY_DAYS });
  if (clockValue(due) < clockValue(min) || clockValue(due) > clockValue(max)) return undefined;
  return formatGameClock(due);
}

function isReached(state: RuntimeState, target: string): boolean {
  const clock = tryCreateGameClockFromDateLabel(target);
  return Boolean(clock && clockValue(ensureGameClock(state)) >= clockValue(clock));
}

function clockValue(clock: GameClock): number {
  return (((clock.year * 12 + clock.month) * 30 + clock.day) * 24 + clock.hour) * 60 + clock.minute;
}

function collectValidLocationIds(state: RuntimeState, worldBook?: WorldBook): Set<string> {
  const ids = new Set<string>([
    state.currentLocationId,
    state.currentPlaceId ?? '',
    ...(state.locations ?? []).map((item) => item.locationId),
    ...(state.mapNodes ?? []).map((item) => item.id),
    ...(worldBook?.mapSeed ?? []).map((item) => item.id),
    ...(worldBook?.openingLocationSeed ?? []).map((item) => item.id),
  ].filter(Boolean));
  return ids;
}

function parseJsonObject(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content);
    return isRecord(parsed) ? parsed : {};
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) return {};
    const parsed = JSON.parse(content.slice(start, end + 1));
    return isRecord(parsed) ? parsed : {};
  }
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_\-]+/g, '_').replace(/_+/g, '_').slice(0, 160);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readOptionalString(value: unknown): string | undefined {
  const text = readString(value).trim();
  return text || undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

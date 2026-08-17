import type {
  CorrespondenceCommitment,
  CorrespondenceEntry,
  CorrespondenceParty,
  LuanShiNpc,
  MapNode,
  RuntimeState,
} from '../types';
import {
  advanceGameClock,
  createGameClockFromDateLabel,
  formatGameClock,
  type GameClock,
} from '../time/gameClock';
import { v4 as uuidv4 } from '../turn/uuid';

const DEFAULT_REMOTE_DELIVERY_MINUTES = 12 * 24 * 60;
const SAME_REGION_DELIVERY_MINUTES = 3 * 24 * 60;
const SAME_PLACE_DELIVERY_MINUTES = 12 * 60;
const MAX_PENDING_LETTERS_PER_TURN = 3;
const MAX_DUE_COMMITMENTS_PER_TURN = 3;
const MAX_ACTIVE_COMMITMENTS_PER_TURN = 5;
const RAPID_NPC_FOLLOWUP_WINDOW_MINUTES = 8 * 60;

export interface CreateCorrespondenceDraftInput {
  sender: CorrespondenceParty;
  recipient: CorrespondenceParty;
  subject?: string;
  body?: string;
  source?: CorrespondenceEntry['source'];
  sourceRefId?: string;
  sourceTurnNumber?: number;
  replyToLetterId?: string;
  channel?: CorrespondenceEntry['channel'];
  originLocationId?: string;
  targetLocationId?: string;
  relatedCommitmentIds?: string[];
  createdAt: string;
  letterId?: string;
}

export interface QueueCorrespondenceOptions {
  sentAt?: string;
  originLocationId?: string;
  targetLocationId?: string;
}

export interface CorrespondenceAdvanceResult {
  state: RuntimeState;
  deliveredLetterIds: string[];
  dueCommitmentIds: string[];
}

export interface CorrespondencePromptProjection {
  text: string;
  pendingLetterIds: string[];
  dueCommitmentIds: string[];
  activeCommitmentIds: string[];
}

export function normalizeCorrespondenceEntries(value: unknown): CorrespondenceEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: CorrespondenceEntry[] = [];
  for (const candidate of value) {
    const normalized = normalizeCorrespondenceEntry(candidate);
    if (!normalized) continue;
    const letterId = resolveCorrespondenceLetterId(entries, normalized);
    const repaired = letterId === normalized.letterId
      ? normalized
      : { ...normalized, letterId };
    const existingIndex = entries.findIndex((entry) => entry.letterId === repaired.letterId);
    if (existingIndex >= 0) {
      entries[existingIndex] = mergeSameCorrespondenceEntry(entries[existingIndex], repaired);
    } else {
      entries.push(repaired);
    }
  }
  return entries.sort((a, b) => compareGameDate(a.createdAt, b.createdAt));
}

/**
 * A normal reply closes one player-to-NPC exchange. Some models subsequently emit the
 * same NPC's answer again as an unsolicited `send`, with a fresh ID but no new player
 * letter. Keep later genuine news, while treating this narrow same-shift pattern as a
 * duplicate. The rule is deliberately based on ledger links and game time, not prose.
 */
export function findRapidRepeatedNpcFollowup(
  entries: readonly CorrespondenceEntry[],
  candidate: CorrespondenceEntry,
): CorrespondenceEntry | undefined {
  if (
    candidate.direction !== 'incoming'
    || candidate.sender.kind !== 'npc'
    || candidate.recipient.kind !== 'player'
    || candidate.replyToLetterId
    || candidate.relatedCommitmentIds?.length
  ) return undefined;

  const candidateSenderNpcId = candidate.sender.npcId;
  const candidateRecipientPlayerId = candidate.recipient.playerId ?? candidate.recipient.name;
  const candidateAt = candidate.sentAt ?? candidate.createdAt;
  const previous = [...entries]
    .filter((entry) => (
      entry.letterId !== candidate.letterId
      && entry.direction === 'incoming'
      && entry.sender.kind === 'npc'
      && entry.sender.npcId === candidateSenderNpcId
      && entry.recipient.kind === 'player'
      && (entry.recipient.playerId ?? entry.recipient.name)
        === candidateRecipientPlayerId
      && compareGameDate(entry.sentAt ?? entry.createdAt, candidateAt) <= 0
    ))
    .sort((left, right) => compareGameDate(
      right.sentAt ?? right.createdAt,
      left.sentAt ?? left.createdAt,
    ))[0];
  if (!previous?.replyToLetterId) return undefined;

  const previousAt = previous.sentAt ?? previous.createdAt;
  const elapsedMinutes = compareGameDate(candidateAt, previousAt);
  if (elapsedMinutes <= 0 || elapsedMinutes > RAPID_NPC_FOLLOWUP_WINDOW_MINUTES) return undefined;

  const hasInterveningPlayerLetter = entries.some((entry) => (
    entry.direction === 'outgoing'
    && entry.recipient.kind === 'npc'
    && entry.recipient.npcId === candidateSenderNpcId
    && compareGameDate(entry.sentAt ?? entry.createdAt, previousAt) > 0
    && compareGameDate(entry.sentAt ?? entry.createdAt, candidateAt) <= 0
  ));
  return hasInterveningPlayerLetter ? undefined : previous;
}

/** Repairs the narrow duplicate pattern in existing saves and removes its UI/memory echoes. */
export function repairRapidRepeatedNpcFollowups(state: RuntimeState): string[] {
  const entries = normalizeCorrespondenceEntries(state.correspondence);
  const protectedLetterIds = new Set(
    normalizeCorrespondenceCommitments(state.correspondenceCommitments)
      .map((commitment) => commitment.sourceCorrespondenceId),
  );
  const kept: CorrespondenceEntry[] = [];
  const removedLetterIds: string[] = [];
  for (const entry of entries) {
    if (
      !protectedLetterIds.has(entry.letterId)
      && findRapidRepeatedNpcFollowup(kept, entry)
    ) {
      removedLetterIds.push(entry.letterId);
      continue;
    }
    kept.push(entry);
  }
  state.correspondence = kept;
  if (removedLetterIds.length === 0) return removedLetterIds;

  const removed = new Set(removedLetterIds);
  for (const npc of state.npcs ?? []) {
    npc.memories = (npc.memories ?? []).filter((memory) => !(
      memory.memoryId.startsWith('memory_correspondence')
      && (
        (memory.eventId ? removed.has(memory.eventId) : false)
        || removedLetterIds.some((letterId) => (
          memory.memoryId.endsWith(`:${letterId}`)
          || memory.memoryId.includes(`:${letterId}:`)
        ))
      )
    ));
    npc.presenceUpdates = npc.presenceUpdates?.filter((update) => (
      !removedLetterIds.some((letterId) => update.id === `correspondence:${letterId}`)
    ));
  }
  return removedLetterIds;
}

/**
 * 模型偶尔会把回复的 letterId 误写成原信或上一封回信的 ID。书信 ID 冲突时，
 * 以结构化 sourceRefId 与书信事实生成稳定的新 ID，既保留两封信，又让同一写回重放保持幂等。
 */
export function resolveCorrespondenceLetterId(
  entries: readonly CorrespondenceEntry[],
  entry: CorrespondenceEntry,
): string {
  const requestedId = entry.letterId.trim();
  const colliding = entries.find((candidate) => candidate.letterId === requestedId);
  if (!colliding || isSameCorrespondenceEntry(colliding, entry)) return requestedId;

  const identity = correspondenceEntryIdentity(entry);
  let recoveredId = `letter_recovered_${stableCorrespondenceFingerprint(`${requestedId}|${identity}`)}`;
  let suffix = 1;
  while (true) {
    const existing = entries.find((candidate) => candidate.letterId === recoveredId);
    if (!existing || isSameCorrespondenceEntry(existing, entry)) return recoveredId;
    suffix += 1;
    recoveredId = `letter_recovered_${stableCorrespondenceFingerprint(`${requestedId}|${identity}|${suffix}`)}`;
  }
}

export function normalizeCorrespondenceCommitments(value: unknown): CorrespondenceCommitment[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, CorrespondenceCommitment>();
  for (const candidate of value) {
    const normalized = normalizeCorrespondenceCommitment(candidate);
    if (normalized) byId.set(normalized.commitmentId, normalized);
  }
  return [...byId.values()].sort((a, b) => compareGameDate(a.expectedAt, b.expectedAt));
}

export function createCorrespondenceDraft(input: CreateCorrespondenceDraftInput): CorrespondenceEntry {
  const sender = normalizeParty(input.sender);
  const recipient = normalizeParty(input.recipient);
  if (!sender || !recipient) throw new Error('书信寄件人与收件人必须是合法角色。');
  if (sender.kind === recipient.kind) {
    throw new Error('书信账本只接受玩家与人物志 NPC 之间的往来。');
  }
  const direction = sender.kind === 'player' ? 'outgoing' : 'incoming';
  return {
    letterId: input.letterId?.trim() || `letter_${uuidv4()}`,
    direction,
    sender,
    recipient,
    subject: input.subject?.trim() || '无题',
    body: input.body?.trim() ?? '',
    source: input.source ?? 'ui',
    ...(input.sourceRefId?.trim() ? { sourceRefId: input.sourceRefId.trim() } : {}),
    ...(Number.isInteger(input.sourceTurnNumber) && (input.sourceTurnNumber ?? -1) >= 0
      ? { sourceTurnNumber: input.sourceTurnNumber }
      : {}),
    ...(input.replyToLetterId?.trim() ? { replyToLetterId: input.replyToLetterId.trim() } : {}),
    channel: input.channel ?? 'letter',
    status: 'draft',
    ...(input.originLocationId?.trim() ? { originLocationId: input.originLocationId.trim() } : {}),
    ...(input.targetLocationId?.trim() ? { targetLocationId: input.targetLocationId.trim() } : {}),
    ...(input.relatedCommitmentIds?.length
      ? { relatedCommitmentIds: [...new Set(input.relatedCommitmentIds.map((item) => item.trim()).filter(Boolean))] }
      : {}),
    createdAt: input.createdAt,
  };
}

export function upsertCorrespondenceEntry(state: RuntimeState, entry: CorrespondenceEntry): RuntimeState {
  const nextState = cloneState(state);
  const entries = normalizeCorrespondenceEntries(nextState.correspondence);
  const index = entries.findIndex((candidate) => candidate.letterId === entry.letterId);
  if (index >= 0 && !isSameCorrespondenceEntry(entries[index], entry)) {
    throw new Error(`书信 ID ${entry.letterId} 已被另一封信占用。`);
  }
  if (index >= 0) entries[index] = mergeSameCorrespondenceEntry(entries[index], entry);
  else entries.push(entry);
  nextState.correspondence = normalizeCorrespondenceEntries(entries);
  return nextState;
}

export function queueCorrespondence(
  state: RuntimeState,
  letterId: string,
  options: QueueCorrespondenceOptions = {},
): RuntimeState {
  const nextState = cloneState(state);
  const entries = normalizeCorrespondenceEntries(nextState.correspondence);
  const index = entries.findIndex((entry) => entry.letterId === letterId);
  if (index < 0) throw new Error('未找到要寄出的书信。');
  const entry = entries[index];
  if (entry.status !== 'draft') throw new Error('只有草稿可以寄出。');
  if (!entry.body.trim()) throw new Error('书信正文不能为空。');
  const sentAt = options.sentAt ?? state.currentDate;
  const originLocationId = options.originLocationId?.trim()
    || entry.originLocationId
    || resolvePartyLocationId(state, entry.sender)
    || state.currentPlaceId
    || state.currentLocationId;
  const targetLocationId = options.targetLocationId?.trim()
    || entry.targetLocationId
    || resolvePartyLocationId(state, entry.recipient)
    || state.currentPlaceId
    || state.currentLocationId;
  const travelMinutes = estimateCorrespondenceTravelMinutes(
    state,
    originLocationId,
    targetLocationId,
    entry.channel,
  );
  entries[index] = {
    ...entry,
    status: 'inTransit',
    sentAt,
    originLocationId,
    targetLocationId,
    deliveryDueAt: addGameMinutes(sentAt, travelMinutes),
  };
  nextState.correspondence = entries;
  return nextState;
}

/**
 * 将最终正文中已经实际送达的信件立即落到账本。该函数只接受已经排入投递链路的信，
 * 不根据正文关键词猜测是否收信；是否已收到必须由结构化书信动作明确给出。
 */
export function markCorrespondenceDelivered(
  state: RuntimeState,
  letterId: string,
  deliveredAt = state.currentDate,
): RuntimeState {
  const nextState = cloneState(state);
  const entries = normalizeCorrespondenceEntries(nextState.correspondence);
  const index = entries.findIndex((entry) => entry.letterId === letterId);
  if (index < 0) throw new Error('未找到要确认送达的书信。');
  const entry = entries[index];
  if (['deliveredPendingProcessing', 'delivered', 'read', 'processed'].includes(entry.status)) {
    return nextState;
  }
  if (!['queued', 'inTransit'].includes(entry.status)) {
    throw new Error('只有已经寄出的书信可以确认送达。');
  }

  const delivered: CorrespondenceEntry = {
    ...entry,
    status: entry.recipient.kind === 'npc' ? 'deliveredPendingProcessing' : 'delivered',
    deliveryDueAt: deliveredAt,
    deliveredAt,
  };
  entries[index] = delivered;
  nextState.correspondence = entries;
  if (delivered.recipient.kind === 'npc') {
    appendDeliveredLetterNpcMemory(nextState, delivered, deliveredAt);
  } else {
    appendIncomingLetterPresenceUpdate(nextState, delivered, deliveredAt);
    revealDeliveredCommitmentActivity(nextState, delivered);
  }
  return nextState;
}

export function markCorrespondenceRead(
  state: RuntimeState,
  letterId: string,
  readAt = state.currentDate,
): RuntimeState {
  const nextState = cloneState(state);
  nextState.correspondence = normalizeCorrespondenceEntries(nextState.correspondence).map((entry) => (
    entry.letterId === letterId && entry.direction === 'incoming' && ['delivered', 'read'].includes(entry.status)
      ? { ...entry, status: 'read' as const, readAt }
      : entry
  ));
  for (const npc of nextState.npcs ?? []) {
    if (!npc.presenceUpdates) continue;
    npc.presenceUpdates = npc.presenceUpdates.map((update) => (
      update.id === `correspondence:${letterId}` ? { ...update, readByPlayer: true } : update
    ));
  }
  return nextState;
}

export function markCorrespondenceProcessed(
  state: RuntimeState,
  letterId: string,
  processedAt = state.currentDate,
  processedBySourceRefId?: string,
): RuntimeState {
  const nextState = cloneState(state);
  nextState.correspondence = normalizeCorrespondenceEntries(nextState.correspondence).map((entry) => (
    entry.letterId === letterId && entry.status === 'deliveredPendingProcessing'
      ? {
          ...entry,
          status: 'processed' as const,
          processedAt,
          ...(processedBySourceRefId?.trim()
            ? { processedBySourceRefId: processedBySourceRefId.trim() }
            : {}),
        }
      : entry
  ));
  return nextState;
}

export function advanceCorrespondenceState(
  state: RuntimeState,
  now = state.currentDate,
): CorrespondenceAdvanceResult {
  const nextState = cloneState(state);
  const deliveredLetterIds: string[] = [];
  const dueCommitmentIds: string[] = [];
  nextState.correspondence = normalizeCorrespondenceEntries(nextState.correspondence).map((entry) => {
    if (entry.status === 'queued') {
      entry = { ...entry, status: 'inTransit' };
    }
    if (
      entry.status !== 'inTransit'
      || !entry.deliveryDueAt
      || compareGameDate(entry.deliveryDueAt, now) > 0
    ) return entry;

    deliveredLetterIds.push(entry.letterId);
    const delivered: CorrespondenceEntry = {
      ...entry,
      status: entry.recipient.kind === 'npc' ? 'deliveredPendingProcessing' : 'delivered',
      deliveredAt: now,
    };
    if (delivered.recipient.kind === 'npc') {
      appendDeliveredLetterNpcMemory(nextState, delivered, now);
    } else {
      appendIncomingLetterPresenceUpdate(nextState, delivered, now);
      revealDeliveredCommitmentActivity(nextState, delivered);
    }
    return delivered;
  });

  nextState.correspondenceCommitments = normalizeCorrespondenceCommitments(
    nextState.correspondenceCommitments,
  ).map((commitment) => {
    if (isClosedCommitmentStatus(commitment.status)) return commitment;
    if (compareGameDate(commitment.expectedAt, now) <= 0) {
      if (commitment.status !== 'due') dueCommitmentIds.push(commitment.commitmentId);
      return { ...commitment, status: 'due' as const, lastUpdatedAt: now };
    }
    if (commitment.status === 'accepted') {
      return { ...commitment, status: 'preparing' as const, lastUpdatedAt: now };
    }
    return commitment;
  });

  return { state: nextState, deliveredLetterIds, dueCommitmentIds };
}

export function buildCorrespondencePromptProjection(state: RuntimeState): CorrespondencePromptProjection {
  const pendingLetters = normalizeCorrespondenceEntries(state.correspondence)
    .filter((entry) => entry.status === 'deliveredPendingProcessing' && entry.recipient.kind === 'npc')
    .slice(0, MAX_PENDING_LETTERS_PER_TURN);
  const dueCommitments = normalizeCorrespondenceCommitments(state.correspondenceCommitments)
    .filter((commitment) => commitment.status === 'due')
    .slice(0, MAX_DUE_COMMITMENTS_PER_TURN);
  const activeCommitments = normalizeCorrespondenceCommitments(state.correspondenceCommitments)
    .filter((commitment) => (
      !isClosedCommitmentStatus(commitment.status)
      && commitment.status !== 'due'
      && isCorrespondenceCommitmentKnownToPlayer(state, commitment)
    ))
    .slice(0, MAX_ACTIVE_COMMITMENTS_PER_TURN);
  if (pendingLetters.length === 0 && dueCommitments.length === 0 && activeCommitments.length === 0) {
    return { text: '', pendingLetterIds: [], dueCommitmentIds: [], activeCommitmentIds: [] };
  }

  const parts = ['## Correspondence / 书信与到期承诺（结构化事实）'];
  if (pendingLetters.length > 0) {
    parts.push('以下书信已真实送达 NPC，但尚未在正常回合中处理。每封信默认都必须由收件 NPC 形成礼貌且符合关系与处境的回信；普通问候也应回信问候。只有 NPC 已死亡/失踪、通信客观断绝、明确敌对拒信或确实无法寄送等具体理由成立时才可 noReply，并必须说明理由。回信只写入 writeback.turnSummary.correspondenceActions，不得把读信或回信强塞进本回合 narrativeText，也不得打断玩家当前行动：');
    for (const letter of pendingLetters) {
      const recipient = letter.recipient.kind === 'npc' ? `${letter.recipient.name}(${letter.recipient.npcId})` : letter.recipient.name;
      parts.push(`- letterId=${letter.letterId} | 收件人=${recipient} | 正文=${letter.body}`);
    }
  }
  if (dueCommitments.length > 0) {
    parts.push('以下承诺已经到期。本回合必须在正文中让玩家获知履约、部分履约、延期或失败，并在 writeback.turnSummary.commitmentResolutions 逐项结算。不得静默跳过。钱粮、个人钱财、来访人物和既有部队由本地按承诺账本结算，不要另写重复状态补丁；partial 必须列 deliveredDeliverables 与未来 nextExpectedAt：');
    for (const commitment of dueCommitments) {
      const outstanding = commitment.remainingDeliverables?.length
        ? commitment.remainingDeliverables
        : commitment.deliverables;
      parts.push(`- commitmentId=${commitment.commitmentId} | 承诺人=${commitment.promisorName}(${commitment.promisorNpcId}) | 目标地点=${commitment.targetLocationId} | 内容=${commitment.summary} | 本次尚待交付=${JSON.stringify(outstanding)}`);
    }
  }
  if (activeCommitments.length > 0) {
    parts.push('以下承诺尚未到期，但已经对玩家公开。它们只是可被本回合实际互动影响的稳定事务，不要求每回合推进，也不得凭空提前履约。仅当本回合正文与合法状态写回已经明确完成、部分完成、延期、失败或取消该承诺时，才输出 commitmentResolutions；如果本回合只是继续赶路、等待或处理无关事项，保持不变：');
    for (const commitment of activeCommitments) {
      const outstanding = commitment.remainingDeliverables?.length
        ? commitment.remainingDeliverables
        : commitment.deliverables;
      parts.push(`- commitmentId=${commitment.commitmentId} | 承诺人=${commitment.promisorName}(${commitment.promisorNpcId}) | 预计=${commitment.expectedAt} | 目标地点=${commitment.targetLocationId} | 内容=${commitment.summary} | 尚待交付=${JSON.stringify(outstanding)}`);
    }
  }
  return {
    text: parts.join('\n'),
    pendingLetterIds: pendingLetters.map((entry) => entry.letterId),
    dueCommitmentIds: dueCommitments.map((entry) => entry.commitmentId),
    activeCommitmentIds: activeCommitments.map((entry) => entry.commitmentId),
  };
}

/** 承诺随 NPC 来信送达后才对玩家可见，避免在途回信提前泄露内容。 */
export function isCorrespondenceCommitmentKnownToPlayer(
  state: RuntimeState,
  commitment: CorrespondenceCommitment,
): boolean {
  const source = normalizeCorrespondenceEntries(state.correspondence)
    .find((entry) => entry.letterId === commitment.sourceCorrespondenceId);
  if (!source) return false;
  if (source.direction === 'outgoing') return true;
  return ['delivered', 'read', 'processed'].includes(source.status);
}

export function estimateCorrespondenceTravelMinutes(
  state: RuntimeState,
  originLocationId: string | undefined,
  targetLocationId: string | undefined,
  channel: CorrespondenceEntry['channel'] = 'letter',
): number {
  const origin = originLocationId?.trim();
  const target = targetLocationId?.trim();
  if (!origin || !target) return DEFAULT_REMOTE_DELIVERY_MINUTES;
  if (origin === target) return SAME_PLACE_DELIVERY_MINUTES;

  const directRoute = (state.routeEdges ?? []).find((route) => (
    (route.fromPlaceId === origin && route.toPlaceId === target)
    || (route.fromPlaceId === target && route.toPlaceId === origin)
  ));
  if (directRoute?.standardTravelMinutes && directRoute.standardTravelMinutes > 0) {
    const riskMultiplier = 1 + Math.max(0, directRoute.riskLevel ?? 0) / 200;
    return Math.max(6 * 60, Math.round(directRoute.standardTravelMinutes * riskMultiplier * (channel === 'envoy' ? 0.85 : 1)));
  }

  const parentById = buildNodeParentIndex(state.mapNodes ?? []);
  const originParent = parentById.get(origin);
  const targetParent = parentById.get(target);
  if (originParent && targetParent && originParent === targetParent) {
    return Math.round(SAME_REGION_DELIVERY_MINUTES * (channel === 'envoy' ? 0.85 : 1));
  }
  return Math.round(DEFAULT_REMOTE_DELIVERY_MINUTES * (channel === 'envoy' ? 0.85 : 1));
}

export function addGameMinutes(dateLabel: string, minutes: number): string {
  const clock = createGameClockFromDateLabel(dateLabel);
  return formatGameClock(advanceGameClock(clock, { minutesAdvanced: Math.max(0, Math.floor(minutes)) }));
}

export function compareGameDate(a: string, b: string): number {
  return gameClockOrdinal(createGameClockFromDateLabel(a)) - gameClockOrdinal(createGameClockFromDateLabel(b));
}

export function recordNpcSentCorrespondenceMemory(
  state: RuntimeState,
  letterId: string,
  npcId: string,
): void {
  const letter = normalizeCorrespondenceEntries(state.correspondence)
    .find((entry) => entry.letterId === letterId);
  const npc = (state.npcs ?? []).find((item) => item.npcId === npcId);
  if (!letter || !npc) return;
  const memoryId = `memory_correspondence_sent:${letterId}`;
  if (npc.memories.some((memory) => memory.memoryId === memoryId || memory.eventId === letterId)) return;
  npc.memories.push({
    memoryId,
    eventId: letterId,
    source: '亲历',
    content: buildSentLetterMemoryContent(letter),
    createdAt: state.currentDate,
  });
}

function appendDeliveredLetterNpcMemory(state: RuntimeState, letter: CorrespondenceEntry, now: string): void {
  recordNpcReceivedCorrespondenceMemory(state, letter.letterId, now);
}

export function recordNpcReceivedCorrespondenceMemory(
  state: RuntimeState,
  letterId: string,
  now: string,
): void {
  const letter = normalizeCorrespondenceEntries(state.correspondence)
    .find((entry) => entry.letterId === letterId);
  if (!letter) return;
  if (letter.recipient.kind !== 'npc') return;
  const recipientNpcId = letter.recipient.npcId;
  const npc = (state.npcs ?? []).find((candidate) => candidate.npcId === recipientNpcId);
  if (!npc) return;
  const memoryId = `memory_correspondence:${letter.letterId}`;
  const content = buildReceivedLetterMemoryContent(letter);
  const existing = npc.memories.find((memory) => (
    memory.memoryId === memoryId || memory.eventId === letter.letterId
  ));
  if (existing) {
    existing.content = content;
    return;
  }
  npc.memories.push({
    memoryId,
    eventId: letter.letterId,
    source: '亲历',
    content,
    createdAt: now,
  });
}

function appendIncomingLetterPresenceUpdate(state: RuntimeState, letter: CorrespondenceEntry, now: string): void {
  if (letter.sender.kind !== 'npc') return;
  const senderNpcId = letter.sender.npcId;
  const npc = (state.npcs ?? []).find((candidate) => candidate.npcId === senderNpcId);
  if (!npc) return;
  const id = `correspondence:${letter.letterId}`;
  const updates = npc.presenceUpdates ?? [];
  if (updates.some((update) => update.id === id)) return;
  npc.presenceUpdates = [
    ...updates,
    {
      id,
      createdAt: now,
      kind: 'letter',
      summary: normalizeCorrespondenceSummary(letter.summary)
        ?? `${letter.sender.name}来信，详细内容已归入书信账本。`,
      source: `${letter.sender.name}来信`,
      certainty: 'confirmed',
      readByPlayer: false,
    },
  ];
}

export function normalizeCorrespondenceSummary(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .replace(/\b(?:letter|correspondence)_[0-9a-z:_-]+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[：:；;，,、\s]+|[：:；;，,、\s]+$/g, '');
  if (!normalized) return undefined;
  return normalized.length > 180 ? `${normalized.slice(0, 180)}…` : normalized;
}

function buildReceivedLetterMemoryContent(letter: CorrespondenceEntry): string {
  const summary = normalizeCorrespondenceSummary(letter.summary);
  return summary
    ? `收到${letter.sender.name}来信：${summary}`
    : `收到${letter.sender.name}来信；详细内容已归入书信账本，待处理后形成摘要。`;
}

function buildSentLetterMemoryContent(letter: CorrespondenceEntry): string {
  const summary = normalizeCorrespondenceSummary(letter.summary);
  return summary
    ? `已向${letter.recipient.name}寄出书信：${summary}`
    : `已向${letter.recipient.name}寄出书信；详细内容已归入书信账本。`;
}

/**
 * Repairs user-visible correspondence text from older saves without touching
 * stable IDs used for replay and deduplication. Letter bodies remain canonical
 * only in the correspondence ledger; NPC memories and presence updates expose
 * a concise summary (or a neutral placeholder until the next normal turn).
 */
export function repairCorrespondenceVisibleMemoryArtifacts(state: RuntimeState): void {
  const letters = normalizeCorrespondenceEntries(state.correspondence);
  const lettersById = new Map(letters.map((letter) => [letter.letterId, letter]));
  const commitments = normalizeCorrespondenceCommitments(state.correspondenceCommitments);

  for (const npc of state.npcs ?? []) {
    for (const memory of npc.memories ?? []) {
      const commitment = memory.memoryId.startsWith('memory_correspondence_commitment:')
        ? commitments.find((candidate) => (
            memory.memoryId.includes(`:${candidate.commitmentId}:`)
            || memory.memoryId.endsWith(`:${candidate.commitmentId}`)
          ))
        : undefined;
      if (commitment) {
        const summary = normalizeCorrespondenceSummary(commitment.progressSummary ?? commitment.summary);
        memory.content = summary
          ? `书信承诺：${summary}`
          : '书信承诺已经记录在约定账本中。';
        continue;
      }

      const letter = findMemoryCorrespondenceEntry(memory.memoryId, memory.eventId, letters, lettersById);
      if (letter) {
        if (letter.recipient.kind === 'npc' && letter.recipient.npcId === npc.npcId) {
          memory.content = buildReceivedLetterMemoryContent(letter);
        } else if (letter.sender.kind === 'npc' && letter.sender.npcId === npc.npcId) {
          memory.content = buildSentLetterMemoryContent(letter);
        } else {
          memory.content = '书信往来已归入书信账本。';
        }
        continue;
      }

      if (
        memory.memoryId.startsWith('memory_correspondence')
        || /(?:收到|寄出|书信)[^\n]{0,24}(?:letter|correspondence)_[0-9a-z:_-]+/i.test(memory.content)
      ) {
        memory.content = memory.memoryId.startsWith('memory_correspondence_commitment:')
          ? '书信承诺已经记录在约定账本中。'
          : '书信往来已归入书信账本。';
      }
    }

    npc.presenceUpdates = npc.presenceUpdates?.map((update) => {
      if (update.kind !== 'letter') return update;
      const letterId = update.id.startsWith('correspondence:')
        ? update.id.slice('correspondence:'.length)
        : undefined;
      const letter = letterId ? lettersById.get(letterId) : undefined;
      if (letter?.sender.kind === 'npc') {
        return {
          ...update,
          summary: normalizeCorrespondenceSummary(letter.summary)
            ?? `${letter.sender.name}来信，详细内容已归入书信账本。`,
          source: `${letter.sender.name}来信`,
        };
      }
      if (
        /(?:letter|correspondence)_[0-9a-z:_-]+/i.test(`${update.source} ${update.summary}`)
      ) {
        return {
          ...update,
          summary: '书信近况已归入书信账本。',
          source: '书信往来',
        };
      }
      return update;
    });
  }
}

function findMemoryCorrespondenceEntry(
  memoryId: string,
  eventId: string | undefined,
  letters: CorrespondenceEntry[],
  lettersById: Map<string, CorrespondenceEntry>,
): CorrespondenceEntry | undefined {
  const byEventId = eventId ? lettersById.get(eventId) : undefined;
  if (byEventId && memoryId.startsWith('memory_correspondence')) return byEventId;
  if (!memoryId.startsWith('memory_correspondence')) return undefined;
  return letters.find((letter) => (
    memoryId.endsWith(`:${letter.letterId}`)
    || memoryId.includes(`:${letter.letterId}:`)
  ));
}

function normalizeCorrespondenceEntry(value: unknown): CorrespondenceEntry | undefined {
  if (!isRecord(value)) return undefined;
  const sender = normalizeParty(value.sender);
  const recipient = normalizeParty(value.recipient);
  const statuses: CorrespondenceEntry['status'][] = [
    'draft', 'queued', 'inTransit', 'deliveredPendingProcessing', 'delivered', 'read', 'processed', 'cancelled', 'lost',
  ];
  const sources: CorrespondenceEntry['source'][] = ['ui', 'narrative', 'npcEvolution', 'system'];
  if (
    typeof value.letterId !== 'string'
    || !value.letterId.trim()
    || !sender
    || !recipient
    || sender.kind === recipient.kind
    || typeof value.body !== 'string'
    || typeof value.createdAt !== 'string'
    || !statuses.includes(value.status as CorrespondenceEntry['status'])
    || !sources.includes(value.source as CorrespondenceEntry['source'])
  ) return undefined;
  const direction: CorrespondenceEntry['direction'] = sender.kind === 'player' ? 'outgoing' : 'incoming';
  return {
    letterId: value.letterId.trim(),
    direction,
    sender,
    recipient,
    subject: typeof value.subject === 'string' && value.subject.trim() ? value.subject.trim() : '无题',
    body: value.body.trim(),
    ...(optionalString(value.summary) ? { summary: optionalString(value.summary) } : {}),
    source: value.source as CorrespondenceEntry['source'],
    ...(optionalString(value.sourceRefId) ? { sourceRefId: optionalString(value.sourceRefId) } : {}),
    ...(Number.isInteger(value.sourceTurnNumber) && Number(value.sourceTurnNumber) >= 0
      ? { sourceTurnNumber: Number(value.sourceTurnNumber) }
      : {}),
    ...(optionalString(value.replyToLetterId) ? { replyToLetterId: optionalString(value.replyToLetterId) } : {}),
    channel: value.channel === 'envoy' ? 'envoy' : 'letter',
    status: value.status as CorrespondenceEntry['status'],
    ...(optionalString(value.originLocationId) ? { originLocationId: optionalString(value.originLocationId) } : {}),
    ...(optionalString(value.targetLocationId) ? { targetLocationId: optionalString(value.targetLocationId) } : {}),
    createdAt: value.createdAt,
    ...(optionalString(value.sentAt) ? { sentAt: optionalString(value.sentAt) } : {}),
    ...(optionalString(value.deliveryDueAt) ? { deliveryDueAt: optionalString(value.deliveryDueAt) } : {}),
    ...(optionalString(value.deliveredAt) ? { deliveredAt: optionalString(value.deliveredAt) } : {}),
    ...(optionalString(value.readAt) ? { readAt: optionalString(value.readAt) } : {}),
    ...(optionalString(value.processedAt) ? { processedAt: optionalString(value.processedAt) } : {}),
    ...(optionalString(value.processedBySourceRefId)
      ? { processedBySourceRefId: optionalString(value.processedBySourceRefId) }
      : {}),
    ...(Array.isArray(value.relatedCommitmentIds)
      ? { relatedCommitmentIds: [...new Set(value.relatedCommitmentIds.filter(isNonEmptyString).map((item) => item.trim()))] }
      : {}),
    ...(optionalString(value.cancelledAt) ? { cancelledAt: optionalString(value.cancelledAt) } : {}),
    ...(optionalString(value.cancelReason) ? { cancelReason: optionalString(value.cancelReason) } : {}),
  };
}

function isSameCorrespondenceEntry(
  left: CorrespondenceEntry,
  right: CorrespondenceEntry,
): boolean {
  return correspondenceEntryIdentity(left) === correspondenceEntryIdentity(right);
}

function mergeSameCorrespondenceEntry(
  existing: CorrespondenceEntry,
  incoming: CorrespondenceEntry,
): CorrespondenceEntry {
  return {
    ...existing,
    ...incoming,
    letterId: existing.letterId,
    direction: existing.direction,
    sender: existing.sender,
    recipient: existing.recipient,
    subject: existing.subject,
    body: existing.body,
    source: existing.source,
    ...(existing.sourceRefId ? { sourceRefId: existing.sourceRefId } : {}),
    ...(existing.replyToLetterId ? { replyToLetterId: existing.replyToLetterId } : {}),
    createdAt: existing.createdAt,
  };
}

function correspondenceEntryIdentity(entry: CorrespondenceEntry): string {
  const senderId = entry.sender.kind === 'npc'
    ? `npc:${entry.sender.npcId}`
    : `player:${entry.sender.playerId ?? entry.sender.name}`;
  const recipientId = entry.recipient.kind === 'npc'
    ? `npc:${entry.recipient.npcId}`
    : `player:${entry.recipient.playerId ?? entry.recipient.name}`;
  return [
    entry.sourceRefId ?? '',
    entry.direction,
    senderId,
    recipientId,
    entry.replyToLetterId ?? '',
    entry.createdAt,
    entry.body,
  ].join('|');
}

function stableCorrespondenceFingerprint(value: string): string {
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

function normalizeCorrespondenceCommitment(value: unknown): CorrespondenceCommitment | undefined {
  if (!isRecord(value)) return undefined;
  const promisee = normalizeParty(value.promisee);
  const statuses: CorrespondenceCommitment['status'][] = [
    'accepted', 'preparing', 'inTransit', 'due', 'fulfilled', 'partial', 'delayed', 'failed', 'cancelled',
  ];
  if (
    typeof value.commitmentId !== 'string'
    || !value.commitmentId.trim()
    || typeof value.sourceCorrespondenceId !== 'string'
    || !value.sourceCorrespondenceId.trim()
    || typeof value.promisorNpcId !== 'string'
    || !value.promisorNpcId.trim()
    || typeof value.promisorName !== 'string'
    || !value.promisorName.trim()
    || !promisee
    || typeof value.summary !== 'string'
    || !value.summary.trim()
    || !statuses.includes(value.status as CorrespondenceCommitment['status'])
    || typeof value.acceptedAt !== 'string'
    || typeof value.targetLocationId !== 'string'
    || !value.targetLocationId.trim()
    || typeof value.expectedAt !== 'string'
    || !Array.isArray(value.deliverables)
    || value.deliverables.length === 0
    || typeof value.lastUpdatedAt !== 'string'
  ) return undefined;
  const deliverables = value.deliverables.filter(isValidCommitmentDeliverable) as CorrespondenceCommitment['deliverables'];
  if (deliverables.length !== value.deliverables.length) return undefined;
  const remainingDeliverables = Array.isArray(value.remainingDeliverables)
    ? value.remainingDeliverables.filter(isValidCommitmentDeliverable) as CorrespondenceCommitment['deliverables']
    : undefined;
  if (Array.isArray(value.remainingDeliverables) && remainingDeliverables?.length !== value.remainingDeliverables.length) {
    return undefined;
  }
  const resolution = normalizeCommitmentResolution(value.resolution);
  const resolutionHistory = Array.isArray(value.resolutionHistory)
    ? value.resolutionHistory
      .map(normalizeCommitmentResolution)
      .filter((item): item is NonNullable<CorrespondenceCommitment['resolution']> => Boolean(item))
      .slice(-12)
    : [];
  return {
    commitmentId: value.commitmentId.trim(),
    sourceCorrespondenceId: value.sourceCorrespondenceId.trim(),
    ...(optionalString(value.sourceRefId) ? { sourceRefId: optionalString(value.sourceRefId) } : {}),
    promisorNpcId: value.promisorNpcId.trim(),
    promisorName: value.promisorName.trim(),
    promisee,
    summary: value.summary.trim(),
    status: value.status as CorrespondenceCommitment['status'],
    acceptedAt: value.acceptedAt,
    ...(optionalString(value.originLocationId) ? { originLocationId: optionalString(value.originLocationId) } : {}),
    targetLocationId: value.targetLocationId.trim(),
    expectedAt: value.expectedAt,
    deliverables,
    ...(remainingDeliverables?.length ? { remainingDeliverables } : {}),
    ...(Array.isArray(value.conditions)
      ? { conditions: value.conditions.filter(isNonEmptyString).map((item) => item.trim()) }
      : {}),
    ...(optionalString(value.progressSummary) ? { progressSummary: optionalString(value.progressSummary) } : {}),
    lastUpdatedAt: value.lastUpdatedAt,
    ...(resolution ? { resolution } : {}),
    ...(resolutionHistory.length > 0 ? { resolutionHistory } : {}),
  };
}

function normalizeCommitmentResolution(
  value: unknown,
): NonNullable<CorrespondenceCommitment['resolution']> | undefined {
  if (
    !isRecord(value)
    || !['fulfilled', 'partial', 'delayed', 'failed', 'cancelled'].includes(String(value.status))
    || !isNonEmptyString(value.summary)
    || !isNonEmptyString(value.resolvedAt)
  ) return undefined;
  const deliveredDeliverables = Array.isArray(value.deliveredDeliverables)
    ? value.deliveredDeliverables.filter(isValidCommitmentDeliverable) as CorrespondenceCommitment['deliverables']
    : undefined;
  if (
    Array.isArray(value.deliveredDeliverables)
    && deliveredDeliverables?.length !== value.deliveredDeliverables.length
  ) return undefined;
  return {
    ...(optionalString(value.sourceRefId) ? { sourceRefId: optionalString(value.sourceRefId) } : {}),
    status: value.status as NonNullable<CorrespondenceCommitment['resolution']>['status'],
    summary: value.summary.trim(),
    resolvedAt: value.resolvedAt,
    ...(optionalString(value.nextExpectedAt)
      ? { nextExpectedAt: optionalString(value.nextExpectedAt) }
      : {}),
    ...(deliveredDeliverables?.length ? { deliveredDeliverables } : {}),
    ...(Array.isArray(value.appliedOperationIds)
      ? { appliedOperationIds: value.appliedOperationIds.filter(isNonEmptyString).map((item) => item.trim()) }
      : {}),
  };
}

function isValidCommitmentDeliverable(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'visit') return isNonEmptyString(value.npcId);
  if (value.kind === 'troop') return Array.isArray(value.troopIds)
    && value.troopIds.length > 0
    && value.troopIds.every(isNonEmptyString);
  if (value.kind === 'resources') return isRecord(value.resources)
    && Object.values(value.resources).some((item) => typeof item === 'number' && Number.isFinite(item) && item > 0);
  if (value.kind === 'items') return Array.isArray(value.itemIds)
    && value.itemIds.length > 0
    && value.itemIds.every(isNonEmptyString);
  if (value.kind === 'intel' || value.kind === 'other') return isNonEmptyString(value.summary);
  return false;
}

function normalizeParty(value: unknown): CorrespondenceParty | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.name)) return undefined;
  if (value.kind === 'player') {
    return {
      kind: 'player',
      ...(isNonEmptyString(value.playerId) ? { playerId: value.playerId.trim() } : {}),
      name: value.name.trim(),
    };
  }
  if (value.kind === 'npc' && isNonEmptyString(value.npcId)) {
    return { kind: 'npc', npcId: value.npcId.trim(), name: value.name.trim() };
  }
  return undefined;
}

function resolvePartyLocationId(state: RuntimeState, party: CorrespondenceParty): string | undefined {
  if (party.kind === 'player') return state.currentPlaceId ?? state.currentLocationId;
  return (state.npcs ?? []).find((npc) => npc.npcId === party.npcId)?.locationId;
}

function buildNodeParentIndex(nodes: MapNode[]): Map<string, string | undefined> {
  const result = new Map<string, string | undefined>();
  const visit = (node: MapNode, inheritedParent?: string): void => {
    const parentId = node.parentId ?? inheritedParent;
    result.set(node.id, parentId);
    for (const child of node.subLocations ?? []) visit(child, node.id);
  };
  for (const node of nodes) visit(node);
  return result;
}

function isClosedCommitmentStatus(status: CorrespondenceCommitment['status']): boolean {
  return ['fulfilled', 'failed', 'cancelled'].includes(status);
}

function revealDeliveredCommitmentActivity(state: RuntimeState, letter: CorrespondenceEntry): void {
  for (const commitment of normalizeCorrespondenceCommitments(state.correspondenceCommitments)) {
    if (commitment.sourceCorrespondenceId !== letter.letterId) continue;
    const npc = (state.npcs ?? []).find((candidate) => candidate.npcId === commitment.promisorNpcId);
    if (
      npc?.backgroundActivity?.activityId
      === `correspondence_commitment:${commitment.commitmentId}`
    ) {
      npc.backgroundActivity.visibility = 'playerKnown';
    }
  }
}

function gameClockOrdinal(clock: GameClock): number {
  return (((clock.year * 12 + (clock.month - 1)) * 30 + (clock.day - 1)) * 24 + clock.hour) * 60 + clock.minute;
}

function cloneState(state: RuntimeState): RuntimeState {
  return JSON.parse(JSON.stringify(state)) as RuntimeState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value.trim() : undefined;
}

export function findCorrespondenceNpc(state: RuntimeState, npcId: string): LuanShiNpc | undefined {
  return (state.npcs ?? []).find((npc) => npc.npcId === npcId);
}

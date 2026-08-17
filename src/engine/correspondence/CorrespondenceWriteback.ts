import type {
  CorrespondenceCommitment,
  CorrespondenceCommitmentDeliverable,
  CorrespondenceEntry,
  RuntimeState,
} from '../types';
import type {
  NarratorCommitmentResolutionFact,
  NarratorCorrespondenceActionFact,
  NarratorTurnSummaryWriteback,
} from '../turn/MockNarrator';
import {
  compareGameDate,
  createCorrespondenceDraft,
  findRapidRepeatedNpcFollowup,
  markCorrespondenceDelivered,
  markCorrespondenceProcessed,
  normalizeCorrespondenceSummary,
  normalizeCorrespondenceCommitments,
  normalizeCorrespondenceEntries,
  queueCorrespondence,
  recordNpcReceivedCorrespondenceMemory,
  recordNpcSentCorrespondenceMemory,
  resolveCorrespondenceLetterId,
  upsertCorrespondenceEntry,
} from './CorrespondenceRuntime';

export interface CorrespondenceWritebackApplication {
  state: RuntimeState;
  appliedSummaries: string[];
  ignoredSummaries: string[];
}

export function applyCorrespondenceWriteback(
  state: RuntimeState,
  previousState: RuntimeState,
  turnSummary: NarratorTurnSummaryWriteback | null | undefined,
): CorrespondenceWritebackApplication {
  if (!turnSummary) return { state, appliedSummaries: [], ignoredSummaries: [] };
  let nextState = cloneState(state);
  const appliedSummaries: string[] = [];
  const ignoredSummaries: string[] = [];
  let appliedActions = 0;
  let appliedCommitments = 0;
  let appliedResolutions = 0;

  for (const action of turnSummary.correspondenceActions ?? []) {
    const result = applyCorrespondenceAction(nextState, action);
    nextState = result.state;
    if (result.applied) {
      appliedActions += 1;
      appliedCommitments += result.appliedCommitments;
    } else if (result.error) {
      ignoredSummaries.push(`书信：${result.error}`);
    }
  }

  for (const resolution of turnSummary.commitmentResolutions ?? []) {
    const result = applyCommitmentResolution(nextState, previousState, resolution);
    nextState = result.state;
    if (result.applied) appliedResolutions += 1;
    else if (result.error) ignoredSummaries.push(`书信承诺：${result.error}`);
  }

  if (appliedActions > 0) appliedSummaries.push(`书信动作x${appliedActions}`);
  if (appliedCommitments > 0) appliedSummaries.push(`书信承诺x${appliedCommitments}`);
  if (appliedResolutions > 0) appliedSummaries.push(`承诺结算x${appliedResolutions}`);
  return { state: nextState, appliedSummaries, ignoredSummaries };
}

function applyCorrespondenceAction(
  state: RuntimeState,
  action: NarratorCorrespondenceActionFact,
): { state: RuntimeState; applied: boolean; appliedCommitments: number; error?: string } {
  if (action.action === 'acknowledge') {
    const sourceLetterId = action.sourceLetterId?.trim();
    if (!sourceLetterId) return { state, applied: false, appliedCommitments: 0, error: '处理动作缺少 sourceLetterId。' };
    const source = normalizeCorrespondenceEntries(state.correspondence)
      .find((entry) => entry.letterId === sourceLetterId);
    if (!source || source.status !== 'deliveredPendingProcessing') {
      return { state, applied: false, appliedCommitments: 0, error: `待处理书信 ${sourceLetterId} 不存在或尚未送达。` };
    }
    // 兼容旧模型输出，但 acknowledge 不再关闭信件：下一正常回合仍会继续要求 NPC 回信。
    return {
      state: applySourceLetterSummary(state, sourceLetterId, action.sourceLetterSummary),
      applied: true,
      appliedCommitments: 0,
    };
  }
  if (action.action === 'noReply') {
    const sourceLetterId = action.sourceLetterId?.trim();
    if (!sourceLetterId) return { state, applied: false, appliedCommitments: 0, error: '处理动作缺少 sourceLetterId。' };
    const source = normalizeCorrespondenceEntries(state.correspondence)
      .find((entry) => entry.letterId === sourceLetterId);
    if (
      source?.status === 'processed'
      && source.processedBySourceRefId === action.sourceRefId
    ) {
      return { state, applied: true, appliedCommitments: 0 };
    }
    if (!source || source.status !== 'deliveredPendingProcessing') {
      return { state, applied: false, appliedCommitments: 0, error: `待处理书信 ${sourceLetterId} 不存在或尚未送达。` };
    }
    const summarizedState = applySourceLetterSummary(state, sourceLetterId, action.sourceLetterSummary);
    return {
      state: markCorrespondenceProcessed(summarizedState, sourceLetterId, state.currentDate, action.sourceRefId),
      applied: true,
      appliedCommitments: 0,
    };
  }

  const requestedLetterId = action.letterId?.trim();
  if (!requestedLetterId || !action.direction || !action.body?.trim()) {
    return { state, applied: false, appliedCommitments: 0, error: '寄信/回信缺少稳定 letterId、方向或正文。' };
  }

  const sender = resolveActionSender(state, action);
  const recipient = resolveActionRecipient(state, action);
  if (!sender || !recipient) {
    return { state, applied: false, appliedCommitments: 0, error: '寄件人或收件人不是人物志中的稳定角色。' };
  }
  let nextState = state;
  const requestedDraft = createCorrespondenceDraft({
    letterId: requestedLetterId,
    sender,
    recipient,
    subject: action.subject,
    body: action.body,
    source: 'narrative',
    sourceRefId: action.sourceRefId,
    sourceTurnNumber: state.turnLog.length,
    replyToLetterId: action.replyToLetterId ?? action.sourceLetterId,
    channel: action.channel,
    originLocationId: action.originLocationId,
    targetLocationId: action.targetLocationId,
    relatedCommitmentIds: normalizeExistingCommitmentIds(state, action.relatedCommitmentIds),
    createdAt: state.currentDate,
  });
  const existingAction = findExistingCorrespondenceAction(
    normalizeCorrespondenceEntries(state.correspondence),
    action,
    requestedDraft,
  );
  if (existingAction) {
    const replayState = action.deliveryState === 'received'
      && !['cancelled', 'failed'].includes(existingAction.status)
      ? markCorrespondenceDelivered(state, existingAction.letterId, state.currentDate)
      : state;
    const sourceLetterId = action.sourceLetterId ?? action.replyToLetterId;
    if (!sourceLetterId) {
      return { state: replayState, applied: true, appliedCommitments: 0 };
    }
    const summarizedState = applySourceLetterSummary(replayState, sourceLetterId, action.sourceLetterSummary);
    return {
      state: markCorrespondenceProcessed(
        summarizedState,
        sourceLetterId,
        state.currentDate,
        action.sourceRefId,
      ),
      applied: true,
      appliedCommitments: 0,
    };
  }
  if (
    action.action === 'send'
    && !action.commitments?.length
    && findRapidRepeatedNpcFollowup(
      normalizeCorrespondenceEntries(state.correspondence),
      requestedDraft,
    )
  ) {
    return { state, applied: false, appliedCommitments: 0 };
  }
  const letterId = resolveCorrespondenceLetterId(
    normalizeCorrespondenceEntries(state.correspondence),
    requestedDraft,
  );
  const draft = letterId === requestedDraft.letterId
    ? requestedDraft
    : { ...requestedDraft, letterId };
  draft.summary = action.summary?.trim();
  nextState = upsertCorrespondenceEntry(nextState, draft);
  nextState = queueCorrespondence(nextState, letterId, {
    sentAt: state.currentDate,
    originLocationId: action.originLocationId,
    targetLocationId: action.targetLocationId,
  });
  if (sender.kind === 'npc') recordNpcSentCorrespondenceMemory(nextState, letterId, sender.npcId);

  const sourceLetterId = action.sourceLetterId ?? action.replyToLetterId;
  if (sourceLetterId) {
    nextState = applySourceLetterSummary(nextState, sourceLetterId, action.sourceLetterSummary);
    nextState = markCorrespondenceProcessed(
      nextState,
      sourceLetterId,
      state.currentDate,
      action.sourceRefId,
    );
  }

  let appliedCommitments = 0;
  if (action.commitments?.length) {
    if (sender.kind !== 'npc' || recipient.kind !== 'player') {
      return { state, applied: false, appliedCommitments: 0, error: '只有 NPC 给玩家的明确回信可以成立未来承诺。' };
    }
    const commitments = normalizeCorrespondenceCommitments(nextState.correspondenceCommitments);
    for (const fact of action.commitments) {
      if (commitments.some((item) => item.commitmentId === fact.commitmentId)) continue;
      if (compareGameDate(fact.expectedAt, state.currentDate) <= 0) {
        return { state, applied: false, appliedCommitments: 0, error: `承诺 ${fact.commitmentId} 的预计时间必须晚于接受时间。` };
      }
      const commitment: CorrespondenceCommitment = {
        commitmentId: fact.commitmentId,
        sourceCorrespondenceId: letterId,
        sourceRefId: action.sourceRefId,
        promisorNpcId: sender.npcId,
        promisorName: sender.name,
        promisee: recipient,
        summary: fact.summary,
        status: 'accepted',
        acceptedAt: state.currentDate,
        ...(fact.originLocationId ? { originLocationId: fact.originLocationId } : {}),
        targetLocationId: fact.targetLocationId,
        expectedAt: fact.expectedAt,
        deliverables: fact.deliverables,
        ...(fact.conditions?.length ? { conditions: fact.conditions } : {}),
        lastUpdatedAt: state.currentDate,
      };
      commitments.push(commitment);
      appliedCommitments += 1;
      appendCommitmentBackgroundActivity(nextState, commitment);
    }
    nextState.correspondenceCommitments = commitments;
    nextState.correspondence = normalizeCorrespondenceEntries(nextState.correspondence).map((entry) => (
      entry.letterId === letterId
        ? {
            ...entry,
            relatedCommitmentIds: commitments
              .filter((item) => item.sourceCorrespondenceId === letterId)
              .map((item) => item.commitmentId),
          }
        : entry
    ));
  }
  if (action.deliveryState === 'received') {
    nextState = markCorrespondenceDelivered(nextState, letterId, state.currentDate);
  }
  return { state: nextState, applied: true, appliedCommitments };
}

/**
 * 回复以被回复原信为本地幂等锚；普通寄信以稳定 sourceRefId + 双方为事件身份。
 * 同一来源事件的重试即使模型改写了正文或发生在稍后的修复阶段，也只能落一封信。
 */
function findExistingCorrespondenceAction(
  entries: CorrespondenceEntry[],
  action: NarratorCorrespondenceActionFact,
  requested: CorrespondenceEntry,
): CorrespondenceEntry | undefined {
  const sourceLetterId = action.sourceLetterId?.trim() || action.replyToLetterId?.trim();
  if (action.action === 'reply' && sourceLetterId) {
    return entries.find((entry) => (
      entry.replyToLetterId === sourceLetterId
      && entry.direction === requested.direction
      && isSameCorrespondenceParty(entry.sender, requested.sender)
      && isSameCorrespondenceParty(entry.recipient, requested.recipient)
    ));
  }

  return entries.find((entry) => (
    entry.sourceRefId === action.sourceRefId
    && entry.direction === requested.direction
    && isSameCorrespondenceParty(entry.sender, requested.sender)
    && isSameCorrespondenceParty(entry.recipient, requested.recipient)
  ));
}

function normalizeExistingCommitmentIds(
  state: RuntimeState,
  value: string[] | undefined,
): string[] | undefined {
  if (!value?.length) return undefined;
  const existing = new Set(
    normalizeCorrespondenceCommitments(state.correspondenceCommitments)
      .map((commitment) => commitment.commitmentId),
  );
  const normalized = [...new Set(value.map((item) => item.trim()).filter((item) => existing.has(item)))];
  return normalized.length > 0 ? normalized : undefined;
}

function isSameCorrespondenceParty(
  left: CorrespondenceEntry['sender'],
  right: CorrespondenceEntry['sender'],
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'npc' && right.kind === 'npc') return left.npcId === right.npcId;
  if (left.kind === 'player' && right.kind === 'player') {
    return (left.playerId ?? left.name) === (right.playerId ?? right.name);
  }
  return false;
}

function applyCommitmentResolution(
  state: RuntimeState,
  previousState: RuntimeState,
  fact: NarratorCommitmentResolutionFact,
): { state: RuntimeState; applied: boolean; error?: string } {
  const nextState = cloneState(state);
  const commitments = normalizeCorrespondenceCommitments(nextState.correspondenceCommitments);
  const index = commitments.findIndex((item) => item.commitmentId === fact.commitmentId);
  if (index < 0) return { state, applied: false, error: `承诺 ${fact.commitmentId} 不存在。` };
  const commitment = commitments[index];
  const resolutionHistory = [
    ...(commitment.resolutionHistory ?? []),
    ...(commitment.resolution ? [commitment.resolution] : []),
  ];
  if (resolutionHistory.some((resolution) => resolution.sourceRefId === fact.sourceRefId)) {
    return { state, applied: true };
  }
  if (['fulfilled', 'failed', 'cancelled'].includes(commitment.status)) {
    return { state, applied: true };
  }
  if (fact.status === 'delayed' || fact.status === 'partial') {
    if (!fact.nextExpectedAt || compareGameDate(fact.nextExpectedAt, state.currentDate) <= 0) {
      return { state, applied: false, error: `${fact.status === 'partial' ? '部分履约' : '延期'}承诺 ${fact.commitmentId} 缺少未来的新日期。` };
    }
  }
  const outstanding = commitment.remainingDeliverables?.length
    ? commitment.remainingDeliverables
    : commitment.deliverables;
  let settledState = nextState;
  let remainingDeliverables = outstanding;
  let deliveredDeliverables: CorrespondenceCommitmentDeliverable[] = [];
  if (fact.status === 'fulfilled') {
    deliveredDeliverables = outstanding;
    const settlement = settleCommitmentDeliverables(
      nextState,
      previousState,
      commitment,
      deliveredDeliverables,
      fact,
    );
    if (!settlement.ok) return { state, applied: false, error: settlement.error };
    settledState = settlement.state;
    remainingDeliverables = [];
  } else if (fact.status === 'partial') {
    deliveredDeliverables = fact.deliveredDeliverables ?? [];
    if (deliveredDeliverables.length === 0) {
      return { state, applied: false, error: `部分履约承诺 ${fact.commitmentId} 缺少本次实际交付明细。` };
    }
    const subtraction = subtractDeliveredCommitmentSubset(outstanding, deliveredDeliverables);
    if (!subtraction.ok) return { state, applied: false, error: subtraction.error };
    if (subtraction.remaining.length === 0) {
      return { state, applied: false, error: `承诺 ${fact.commitmentId} 的本次交付已覆盖全部未交付内容，应标记 fulfilled。` };
    }
    const settlement = settleCommitmentDeliverables(
      nextState,
      previousState,
      commitment,
      deliveredDeliverables,
      fact,
    );
    if (!settlement.ok) return { state, applied: false, error: settlement.error };
    settledState = settlement.state;
    remainingDeliverables = subtraction.remaining;
  }

  const resolution = {
    sourceRefId: fact.sourceRefId,
    status: fact.status,
    summary: fact.summary,
    resolvedAt: state.currentDate,
    ...(fact.nextExpectedAt ? { nextExpectedAt: fact.nextExpectedAt } : {}),
    ...(deliveredDeliverables.length > 0 ? { deliveredDeliverables } : {}),
    ...(fact.appliedOperationIds?.length ? { appliedOperationIds: fact.appliedOperationIds } : {}),
  };
  const { remainingDeliverables: _previousRemaining, ...commitmentBase } = commitment;
  commitments[index] = {
    ...commitmentBase,
    status: fact.status,
    ...(fact.nextExpectedAt ? { expectedAt: fact.nextExpectedAt } : {}),
    ...(remainingDeliverables.length > 0 ? { remainingDeliverables } : {}),
    progressSummary: fact.summary,
    lastUpdatedAt: state.currentDate,
    resolution,
    resolutionHistory: [...(commitment.resolutionHistory ?? []), resolution].slice(-12),
  };
  settledState.correspondenceCommitments = commitments;
  if (['fulfilled', 'failed', 'cancelled'].includes(fact.status)) {
    settledState.correspondence = normalizeCorrespondenceEntries(settledState.correspondence)
      .map((entry) => (
        entry.relatedCommitmentIds?.includes(fact.commitmentId)
        && ['queued', 'inTransit'].includes(entry.status)
          ? {
              ...entry,
              status: 'cancelled' as const,
              cancelledAt: state.currentDate,
              cancelReason: `关联承诺已${commitmentResolutionStatusLabel(fact.status)}，在途提醒不再投递。`,
            }
          : entry
      ));
  }
  updateCommitmentBackgroundActivity(settledState, commitments[index]);
  appendCommitmentResolutionMemory(settledState, commitments[index], fact.sourceRefId);
  return { state: settledState, applied: true };
}

function commitmentResolutionStatusLabel(
  status: NarratorCommitmentResolutionFact['status'],
): string {
  if (status === 'fulfilled') return '履行';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '取消';
  return status;
}

function applySourceLetterSummary(
  state: RuntimeState,
  letterId: string,
  value: string | undefined,
): RuntimeState {
  const summary = normalizeCorrespondenceSummary(value);
  if (!summary) return state;
  const nextState = cloneState(state);
  nextState.correspondence = normalizeCorrespondenceEntries(nextState.correspondence).map((entry) => (
    entry.letterId === letterId ? { ...entry, summary } : entry
  ));
  const source = nextState.correspondence.find((entry) => entry.letterId === letterId);
  if (source) {
    recordNpcReceivedCorrespondenceMemory(
      nextState,
      letterId,
      source.deliveredAt ?? nextState.currentDate,
    );
  }
  return nextState;
}

type CommitmentSettlementResult =
  | { ok: true; state: RuntimeState }
  | { ok: false; error: string };

function settleCommitmentDeliverables(
  state: RuntimeState,
  previousState: RuntimeState,
  commitment: CorrespondenceCommitment,
  deliverables: CorrespondenceCommitmentDeliverable[],
  fact: NarratorCommitmentResolutionFact,
): CommitmentSettlementResult {
  const previousItemIds = new Set((previousState.player.inventory ?? []).map((item) => item.id));
  const currentItemIds = new Set((state.player.inventory ?? []).map((item) => item.id));
  for (const deliverable of deliverables) {
    if (deliverable.kind === 'visit') {
      if (!(state.npcs ?? []).some((npc) => npc.npcId === deliverable.npcId)) {
        return { ok: false, error: `承诺 ${commitment.commitmentId} 引用的来访人物 ${deliverable.npcId} 不存在。` };
      }
    } else if (deliverable.kind === 'troop') {
      const troops = deliverable.troopIds.map((troopId) => (
        (state.troops ?? []).find((troop) => troop.troopId === troopId)
      ));
      if (troops.some((troop) => !troop)) {
        return { ok: false, error: `承诺 ${commitment.commitmentId} 的部队尚未完成合法建制写入。` };
      }
      if (troops.some((troop) => ['destroyed', 'disbanded', 'archived'].includes(troop?.lifecycleStatus ?? 'active'))) {
        return { ok: false, error: `承诺 ${commitment.commitmentId} 引用了已销毁、解散或归档的部队。` };
      }
      const availableCount = troops.reduce((sum, troop) => sum + (troop?.size ?? 0), 0);
      if (deliverable.expectedCount && availableCount < deliverable.expectedCount) {
        return { ok: false, error: `承诺 ${commitment.commitmentId} 的已登记兵力不足约定数量。` };
      }
    } else if (deliverable.kind === 'items') {
      const missing = deliverable.itemIds.filter((itemId) => (
        !currentItemIds.has(itemId) || previousItemIds.has(itemId)
      ));
      if (missing.length > 0) {
        return { ok: false, error: `承诺 ${commitment.commitmentId} 的物品 ${missing.join('、')} 尚未通过合法物品写回新增。` };
      }
    }
  }

  const nextState = cloneState(state);
  for (const deliverable of deliverables) {
    if (deliverable.kind === 'resources') {
      applyCommittedResources(nextState, deliverable.resources);
    } else if (deliverable.kind === 'visit') {
      const npc = (nextState.npcs ?? []).find((item) => item.npcId === deliverable.npcId)!;
      npc.locationId = commitment.targetLocationId;
      npc.isPresent = [nextState.currentPlaceId, nextState.currentLocationId]
        .filter(Boolean)
        .includes(commitment.targetLocationId);
    } else if (deliverable.kind === 'troop') {
      for (const troopId of deliverable.troopIds) {
        const troop = (nextState.troops ?? []).find((item) => item.troopId === troopId)!;
        const eventId = `correspondence_commitment:${commitment.commitmentId}:${fact.sourceRefId}:${troopId}`;
        troop.locationId = commitment.targetLocationId;
        troop.lastKnownLocationId = commitment.targetLocationId;
        troop.lastKnownAt = nextState.currentDate;
        troop.destinationLocationId = commitment.targetLocationId;
        troop.movementStatus = 'arrived';
        troop.arrivedAt = nextState.currentDate;
        troop.updatedAt = nextState.currentDate;
        if (!(troop.changeHistory ?? []).some((entry) => entry.eventId === eventId)) {
          troop.changeHistory = [
            ...(troop.changeHistory ?? []),
            {
              eventId,
              kind: 'moved',
              occurredAt: nextState.currentDate,
              summary: fact.summary,
              sourceNote: '书信承诺',
            },
          ];
        }
      }
    }
  }
  return { ok: true, state: nextState };
}

function applyCommittedResources(
  state: RuntimeState,
  resources: Extract<CorrespondenceCommitmentDeliverable, { kind: 'resources' }>['resources'],
): void {
  if (resources.playerMoneyQian) {
    state.player.personalMoney = (state.player.personalMoney ?? 0) + resources.playerMoneyQian;
  }
  if (!state.resources) {
    state.resources = {
      money: 0,
      grain: 0,
      horses: 0,
      arms: 0,
      recruits: 0,
      weapons: [],
      documents: [],
      tokens: [],
      importantSupplies: [],
    };
  }
  for (const field of ['moneyGuan', 'grain', 'horses', 'arms', 'recruits'] as const) {
    const amount = resources[field];
    if (!amount) continue;
    const ledgerField = field === 'moneyGuan' ? 'money' : field;
    state.resources[ledgerField] = (state.resources[ledgerField] ?? 0) + amount;
  }
}

type CommitmentSubtractionResult =
  | { ok: true; remaining: CorrespondenceCommitmentDeliverable[] }
  | { ok: false; error: string };

function subtractDeliveredCommitmentSubset(
  outstanding: CorrespondenceCommitmentDeliverable[],
  delivered: CorrespondenceCommitmentDeliverable[],
): CommitmentSubtractionResult {
  const remaining = cloneDeliverables(outstanding);
  for (const delivery of delivered) {
    const index = remaining.findIndex((candidate) => deliverableCanContain(candidate, delivery));
    if (index < 0) {
      return { ok: false, error: `部分履约明细 ${JSON.stringify(delivery)} 超出尚待交付范围。` };
    }
    const next = subtractOneDeliverable(remaining[index], delivery);
    if (next) remaining[index] = next;
    else remaining.splice(index, 1);
  }
  return { ok: true, remaining };
}

function deliverableCanContain(
  outstanding: CorrespondenceCommitmentDeliverable,
  delivered: CorrespondenceCommitmentDeliverable,
): boolean {
  if (outstanding.kind !== delivered.kind) return false;
  if (outstanding.kind === 'visit' && delivered.kind === 'visit') {
    return outstanding.npcId === delivered.npcId;
  }
  if (outstanding.kind === 'troop' && delivered.kind === 'troop') {
    return delivered.troopIds.every((id) => outstanding.troopIds.includes(id))
      && (!delivered.expectedCount || !outstanding.expectedCount || delivered.expectedCount <= outstanding.expectedCount);
  }
  if (outstanding.kind === 'resources' && delivered.kind === 'resources') {
    return Object.entries(delivered.resources).every(([field, amount]) => (
      typeof amount === 'number'
      && amount > 0
      && amount <= Number(outstanding.resources[field as keyof typeof outstanding.resources] ?? 0)
    ));
  }
  if (outstanding.kind === 'items' && delivered.kind === 'items') {
    return delivered.itemIds.every((id) => outstanding.itemIds.includes(id));
  }
  if (outstanding.kind === 'intel' && delivered.kind === 'intel') {
    return outstanding.summary === delivered.summary;
  }
  if (outstanding.kind === 'other' && delivered.kind === 'other') {
    return outstanding.summary === delivered.summary;
  }
  return false;
}

function subtractOneDeliverable(
  outstanding: CorrespondenceCommitmentDeliverable,
  delivered: CorrespondenceCommitmentDeliverable,
): CorrespondenceCommitmentDeliverable | undefined {
  if (outstanding.kind === 'resources' && delivered.kind === 'resources') {
    const resources = { ...outstanding.resources };
    for (const [field, amount] of Object.entries(delivered.resources)) {
      const key = field as keyof typeof resources;
      const remainder = Number(resources[key] ?? 0) - Number(amount ?? 0);
      if (remainder > 0) resources[key] = remainder;
      else delete resources[key];
    }
    return Object.keys(resources).length > 0 ? { ...outstanding, resources } : undefined;
  }
  if (outstanding.kind === 'troop' && delivered.kind === 'troop') {
    const deliveredIds = new Set(delivered.troopIds);
    const troopIds = outstanding.troopIds.filter((id) => !deliveredIds.has(id));
    if (troopIds.length === 0) return undefined;
    const expectedCount = outstanding.expectedCount && delivered.expectedCount
      ? Math.max(0, outstanding.expectedCount - delivered.expectedCount)
      : undefined;
    return {
      ...outstanding,
      troopIds,
      ...(expectedCount ? { expectedCount } : {}),
    };
  }
  if (outstanding.kind === 'items' && delivered.kind === 'items') {
    const deliveredIds = new Set(delivered.itemIds);
    const itemIds = outstanding.itemIds.filter((id) => !deliveredIds.has(id));
    return itemIds.length > 0 ? { ...outstanding, itemIds } : undefined;
  }
  return undefined;
}

function cloneDeliverables(
  value: CorrespondenceCommitmentDeliverable[],
): CorrespondenceCommitmentDeliverable[] {
  return JSON.parse(JSON.stringify(value)) as CorrespondenceCommitmentDeliverable[];
}

function resolveActionSender(
  state: RuntimeState,
  action: NarratorCorrespondenceActionFact,
): CorrespondenceEntry['sender'] | undefined {
  if (action.direction === 'player_to_npc') {
    return { kind: 'player', playerId: state.player.id, name: state.player.name };
  }
  const npc = (state.npcs ?? []).find((item) => item.npcId === action.senderNpcId);
  return npc ? { kind: 'npc', npcId: npc.npcId, name: npc.name } : undefined;
}

function resolveActionRecipient(
  state: RuntimeState,
  action: NarratorCorrespondenceActionFact,
): CorrespondenceEntry['recipient'] | undefined {
  if (action.direction === 'npc_to_player') {
    return { kind: 'player', playerId: state.player.id, name: state.player.name };
  }
  const npc = (state.npcs ?? []).find((item) => item.npcId === action.recipientNpcId);
  return npc ? { kind: 'npc', npcId: npc.npcId, name: npc.name } : undefined;
}

function appendCommitmentBackgroundActivity(state: RuntimeState, commitment: CorrespondenceCommitment): void {
  const npc = (state.npcs ?? []).find((item) => item.npcId === commitment.promisorNpcId);
  if (!npc) return;
  const activityId = `correspondence_commitment:${commitment.commitmentId}`;
  if (npc.backgroundActivity && npc.backgroundActivity.activityId !== activityId) return;
  npc.backgroundActivity = {
    activityId,
    summary: commitment.summary,
    status: 'planned',
    locationId: commitment.originLocationId ?? npc.locationId,
    startedAt: commitment.acceptedAt,
    dueAt: commitment.expectedAt,
    sourceType: 'system',
    sourceIds: [commitment.commitmentId, commitment.sourceCorrespondenceId],
    visibility: 'hidden',
  };
}

function updateCommitmentBackgroundActivity(state: RuntimeState, commitment: CorrespondenceCommitment): void {
  const npc = (state.npcs ?? []).find((item) => item.npcId === commitment.promisorNpcId);
  if (!npc || npc.backgroundActivity?.activityId !== `correspondence_commitment:${commitment.commitmentId}`) return;
  const status = commitment.status === 'fulfilled'
    ? 'completed'
    : commitment.status === 'cancelled' ? 'cancelled'
      : commitment.status === 'failed' ? 'blocked' : 'active';
  npc.backgroundActivity = {
    ...npc.backgroundActivity,
    summary: commitment.progressSummary ?? commitment.summary,
    status,
    dueAt: commitment.expectedAt,
    lastEvaluatedAt: commitment.lastUpdatedAt,
  };
}

function appendCommitmentResolutionMemory(
  state: RuntimeState,
  commitment: CorrespondenceCommitment,
  sourceRefId: string,
): void {
  const npc = (state.npcs ?? []).find((item) => item.npcId === commitment.promisorNpcId);
  if (!npc) return;
  const memoryId = `memory_correspondence_commitment:${commitment.commitmentId}:${sourceRefId}`;
  if (npc.memories.some((memory) => memory.memoryId === memoryId || memory.eventId === sourceRefId)) return;
  npc.memories.push({
    memoryId,
    eventId: sourceRefId,
    source: '亲历',
    content: `书信承诺：${commitment.progressSummary ?? commitment.summary}`,
    createdAt: state.currentDate,
  });
}

function cloneState(state: RuntimeState): RuntimeState {
  return JSON.parse(JSON.stringify(state)) as RuntimeState;
}

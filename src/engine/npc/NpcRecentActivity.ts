import type { LuanShiNpc, RuntimeState } from '../types';
import { tryCreateGameClockFromDateLabel } from '../time/gameClock';

export type NpcRecentActivitySource = 'turnEvent' | 'relationship' | 'backgroundActivity' | 'presenceUpdate';

export interface NpcRecentActivityEntry {
  id: string;
  summary: string;
  occurredAt: string;
  source: NpcRecentActivitySource;
  sourceLabel: string;
  readByPlayer: boolean;
}

const sourcePriority: Record<NpcRecentActivitySource, number> = {
  turnEvent: 4,
  relationship: 3,
  backgroundActivity: 2,
  presenceUpdate: 1,
};

export function selectNpcRecentActivity(
  state: RuntimeState,
  npc: LuanShiNpc,
  limit = 5,
): NpcRecentActivityEntry[] {
  const candidates: NpcRecentActivityEntry[] = [];
  for (const event of state.turnEvents ?? []) {
    if ((event.presentNpcIds.includes(npc.npcId) || event.involvedNpcIds.includes(npc.npcId)) && hasText(event.summary)) {
      candidates.push({
        id: `turn-event:${event.eventId}`,
        summary: event.summary.trim(),
        occurredAt: event.happenedAt,
        source: 'turnEvent',
        sourceLabel: '亲历事件',
        readByPlayer: true,
      });
    }
  }
  candidates.push(...selectRelationshipActivity(state, npc.npcId));
  const activity = npc.backgroundActivity;
  if (activity && activity.visibility !== 'hidden' && hasText(activity.summary)) {
    candidates.push({
      id: `background-activity:${activity.activityId}`,
      summary: activity.summary.trim(),
      occurredAt: activity.lastEvaluatedAt ?? activity.startedAt ?? '',
      source: 'backgroundActivity',
      sourceLabel: activity.visibility === 'public' ? '公开动向' : '已知动向',
      readByPlayer: true,
    });
  }
  for (const update of npc.presenceUpdates ?? []) {
    if (!hasText(update.summary)) continue;
    candidates.push({
      id: `presence-update:${update.id}`,
      summary: update.summary.trim(),
      occurredAt: update.createdAt,
      source: 'presenceUpdate',
      sourceLabel: '远场近况',
      readByPlayer: update.readByPlayer,
    });
  }

  candidates.sort((left, right) => activityMinutes(right.occurredAt) - activityMinutes(left.occurredAt)
    || sourcePriority[right.source] - sourcePriority[left.source]
    || left.id.localeCompare(right.id));
  const summaries = new Set<string>();
  const selected: NpcRecentActivityEntry[] = [];
  for (const candidate of candidates) {
    const key = normalizeSummary(candidate.summary);
    if (!key || summaries.has(key)) continue;
    summaries.add(key);
    selected.push(candidate);
    if (selected.length >= Math.max(0, limit)) break;
  }
  return selected;
}

function selectRelationshipActivity(state: RuntimeState, npcId: string): NpcRecentActivityEntry[] {
  const entries: NpcRecentActivityEntry[] = [];
  for (const thread of state.heroineThreads ?? []) {
    if (thread.npcId !== npcId) continue;
    if (hasText(thread.recentProgress)) entries.push({
      id: `heroine-progress:${thread.heroineThreadId}`,
      summary: thread.recentProgress.trim(), occurredAt: thread.lastUpdatedAt,
      source: 'relationship', sourceLabel: '关系进展', readByPlayer: true,
    });
    for (const milestone of thread.milestones ?? []) if (hasText(milestone.summary)) entries.push({
      id: `heroine-milestone:${thread.heroineThreadId}:${milestone.milestoneId}`,
      summary: milestone.summary.trim(), occurredAt: milestone.happenedAt,
      source: 'relationship', sourceLabel: '关系里程碑', readByPlayer: true,
    });
  }
  for (const thread of state.bondThreads ?? []) {
    if (!(thread.targetNpcIds ?? []).includes(npcId)) continue;
    if (hasText(thread.recentProgress)) entries.push({
      id: `bond-progress:${thread.bondThreadId}`,
      summary: thread.recentProgress.trim(), occurredAt: thread.lastUpdatedAt,
      source: 'relationship', sourceLabel: '羁绊进展', readByPlayer: true,
    });
    for (const milestone of thread.milestones ?? []) if (hasText(milestone.summary)) entries.push({
      id: `bond-milestone:${thread.bondThreadId}:${milestone.milestoneId}`,
      summary: milestone.summary.trim(), occurredAt: milestone.happenedAt,
      source: 'relationship', sourceLabel: '羁绊里程碑', readByPlayer: true,
    });
  }
  return entries;
}

function activityMinutes(value: string): number {
  const clock = hasText(value) ? tryCreateGameClockFromDateLabel(value.trim()) : undefined;
  return clock
    ? (((clock.year * 12 + clock.month) * 30 + clock.day) * 24 + clock.hour) * 60 + clock.minute
    : Number.NEGATIVE_INFINITY;
}

function normalizeSummary(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
    .replace(/[\s，。！？；：、“”‘’（）()《》〈〉,.!?;:'"-]+/g, '');
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

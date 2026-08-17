import type { BondThreadEntry, NpcPresenceUpdate, RuntimeState } from '../engine/types';
import { normalizeBondThreads } from '../engine/state/BondThreadIdentity';

export interface BondPanelRosterItem {
  id: string;
  title: string;
  bondType: BondThreadEntry['bondType'];
  status: BondThreadEntry['status'];
  summary: string;
  lastUpdatedAt: string;
}

export interface BondPanelModel {
  rosterItems: BondPanelRosterItem[];
  selectedThreadId: string | null;
  selectedThread: BondThreadEntry | null;
  latestKnownUpdates: Array<{ npcId: string; npcName: string; update: NpcPresenceUpdate }>;
  evolutionTiming: { lastEvaluatedAt?: string; nextDueAt?: string } | null;
}

const statusRank: Record<BondThreadEntry['status'], number> = {
  active: 0,
  paused: 1,
  resolved: 2,
  archived: 3,
};

export function buildBondPanelModel(runtimeState: RuntimeState, selectedThreadId?: string | null): BondPanelModel {
  const threads = normalizeBondThreads(runtimeState.bondThreads ?? [], runtimeState.npcs ?? [])
    .sort(compareBondThreads);
  const selectedThread =
    threads.find((thread) => thread.bondThreadId === selectedThreadId) ??
    threads[0] ??
    null;

  return {
    rosterItems: threads.map((thread) => ({
      id: thread.bondThreadId,
      title: thread.targetNames.join('、'),
      bondType: thread.bondType,
      status: thread.status,
      summary: thread.summary,
      lastUpdatedAt: thread.lastUpdatedAt,
    })),
    selectedThreadId: selectedThread?.bondThreadId ?? null,
    selectedThread,
    latestKnownUpdates: selectedThread
      ? (selectedThread.targetNpcIds ?? []).flatMap((npcId) => {
          const npc = (runtimeState.npcs ?? []).find((item) => item.npcId === npcId);
          const update = [...(npc?.presenceUpdates ?? [])]
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
          return npc && update ? [{ npcId, npcName: npc.name, update }] : [];
        })
      : [],
    evolutionTiming: selectedThread
      ? findEvolutionTiming(runtimeState, selectedThread.targetNpcIds ?? [])
      : null,
  };
}

function findEvolutionTiming(
  state: RuntimeState,
  npcIds: string[],
): BondPanelModel['evolutionTiming'] {
  const npcs = (state.npcs ?? []).filter((npc) => npcIds.includes(npc.npcId));
  const lastEvaluatedAt = npcs
    .map((npc) => npc.backgroundActivity?.lastEvaluatedAt ?? npc.backgroundEvolutionMeta?.lastAttemptAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0];
  const nextDueAt = npcs
    .map((npc) => npc.backgroundActivity?.dueAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right))[0];
  return lastEvaluatedAt || nextDueAt ? { lastEvaluatedAt, nextDueAt } : null;
}

function compareBondThreads(a: BondThreadEntry, b: BondThreadEntry): number {
  const byStatus = statusRank[a.status] - statusRank[b.status];
  if (byStatus !== 0) return byStatus;
  return b.lastUpdatedAt.localeCompare(a.lastUpdatedAt);
}

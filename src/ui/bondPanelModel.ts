import type { BondThreadEntry, RuntimeState } from '../engine/types';

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
}

const statusRank: Record<BondThreadEntry['status'], number> = {
  active: 0,
  paused: 1,
  resolved: 2,
  archived: 3,
};

export function buildBondPanelModel(runtimeState: RuntimeState, selectedThreadId?: string | null): BondPanelModel {
  const threads = [...(runtimeState.bondThreads ?? [])].sort(compareBondThreads);
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
  };
}

function compareBondThreads(a: BondThreadEntry, b: BondThreadEntry): number {
  const byStatus = statusRank[a.status] - statusRank[b.status];
  if (byStatus !== 0) return byStatus;
  return b.lastUpdatedAt.localeCompare(a.lastUpdatedAt);
}

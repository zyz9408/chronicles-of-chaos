import type { HeroineThreadEntry, RuntimeState } from '../engine/types';
import { normalizeHeroineThreads } from '../engine/state/HeroineThreadIdentity';

export interface HeroinePanelRosterItem {
  id: string;
  npcId: string;
  name: string;
  stage: string;
  status: HeroineThreadEntry['status'];
  summary: string;
  lastUpdatedAt: string;
}

export interface HeroinePanelModel {
  rosterItems: HeroinePanelRosterItem[];
  selectedThreadId: string | null;
  selectedThread: HeroineThreadEntry | null;
}

const statusRank: Record<HeroineThreadEntry['status'], number> = {
  active: 0,
  paused: 1,
  resolved: 2,
  archived: 3,
};

export function buildHeroinePanelModel(runtimeState: RuntimeState, selectedThreadId?: string | null): HeroinePanelModel {
  const sourceThreads = runtimeState.heroineThreads ?? [];
  const selectedNpcId = sourceThreads.find((thread) => thread.heroineThreadId === selectedThreadId)?.npcId;
  const threads = normalizeHeroineThreads(sourceThreads, runtimeState.npcs ?? []).sort(compareHeroineThreads);
  const selectedThread =
    threads.find((thread) => thread.heroineThreadId === selectedThreadId) ??
    threads.find((thread) => selectedNpcId && thread.npcId === selectedNpcId) ??
    threads[0] ??
    null;

  return {
    rosterItems: threads.map((thread) => ({
      id: thread.heroineThreadId,
      npcId: thread.npcId,
      name: thread.npcName,
      stage: thread.stage,
      status: thread.status,
      summary: thread.summary,
      lastUpdatedAt: thread.lastUpdatedAt,
    })),
    selectedThreadId: selectedThread?.heroineThreadId ?? null,
    selectedThread,
  };
}

function compareHeroineThreads(a: HeroineThreadEntry, b: HeroineThreadEntry): number {
  const byStatus = statusRank[a.status] - statusRank[b.status];
  if (byStatus !== 0) return byStatus;
  return b.lastUpdatedAt.localeCompare(a.lastUpdatedAt);
}

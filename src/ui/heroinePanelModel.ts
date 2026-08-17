import type { HeroineThreadEntry, NpcPresenceUpdate, RuntimeState } from '../engine/types';
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
  latestKnownUpdate: NpcPresenceUpdate | null;
  evolutionTiming: { lastEvaluatedAt?: string; nextDueAt?: string } | null;
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
    latestKnownUpdate: selectedThread
      ? findLatestKnownUpdate(runtimeState, [selectedThread.npcId])
      : null,
    evolutionTiming: selectedThread
      ? findEvolutionTiming(runtimeState, [selectedThread.npcId])
      : null,
  };
}

function findEvolutionTiming(
  state: RuntimeState,
  npcIds: string[],
): HeroinePanelModel['evolutionTiming'] {
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

function findLatestKnownUpdate(state: RuntimeState, npcIds: string[]): NpcPresenceUpdate | null {
  return (state.npcs ?? [])
    .filter((npc) => npcIds.includes(npc.npcId))
    .flatMap((npc) => npc.presenceUpdates ?? [])
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

function compareHeroineThreads(a: HeroineThreadEntry, b: HeroineThreadEntry): number {
  const byStatus = statusRank[a.status] - statusRank[b.status];
  if (byStatus !== 0) return byStatus;
  return b.lastUpdatedAt.localeCompare(a.lastUpdatedAt);
}

import type { LuanShiNpc, NpcBackgroundActivity, Quest } from '../types';

export function isOpenCurrentMatter(quest: Pick<Quest, 'status'>): boolean {
  return quest.status === 'active';
}

export function synchronizeCurrentMatterLifecycle(
  quest: Quest,
  currentDate: string,
): void {
  if (isOpenCurrentMatter(quest)) {
    quest.archivedAt = undefined;
    return;
  }
  quest.archivedAt ||= currentDate;
}

/**
 * Project a quest-bound NPC activity against the canonical current-matter ledger.
 *
 * Only an explicit `sourceType: quest` + stable quest id link is authoritative
 * here. This deliberately avoids guessing from narrative text or activity names,
 * while ensuring an old plan cannot be reactivated after every linked matter has
 * reached a terminal state.
 */
export function resolveNpcBackgroundActivityAgainstCurrentMatters(
  activity: NpcBackgroundActivity | undefined,
  quests: Quest[],
  currentDate: string,
): NpcBackgroundActivity | undefined {
  if (!activity) return undefined;

  const projected: NpcBackgroundActivity = {
    ...activity,
    sourceIds: activity.sourceIds ? [...activity.sourceIds] : undefined,
  };
  if (
    projected.sourceType !== 'quest'
    || !projected.sourceIds?.length
    || projected.status === 'completed'
    || projected.status === 'cancelled'
  ) {
    return projected;
  }

  const linkedQuests = projected.sourceIds
    .map((questId) => quests.find((quest) => quest.id === questId))
    .filter((quest): quest is Quest => quest !== undefined);
  if (
    linkedQuests.length !== projected.sourceIds.length
    || linkedQuests.some(isOpenCurrentMatter)
  ) {
    return projected;
  }

  projected.status = linkedQuests.every((quest) => quest.status === 'completed')
    ? 'completed'
    : 'cancelled';
  projected.lastEvaluatedAt = currentDate;
  return projected;
}

export function synchronizeNpcBackgroundActivitiesWithCurrentMatters(
  npcs: LuanShiNpc[] | undefined,
  quests: Quest[],
  currentDate: string,
): void {
  if (!npcs) return;
  for (const npc of npcs) {
    if (!npc.backgroundActivity) continue;
    npc.backgroundActivity = resolveNpcBackgroundActivityAgainstCurrentMatters(
      npc.backgroundActivity,
      quests,
      currentDate,
    );
  }
}

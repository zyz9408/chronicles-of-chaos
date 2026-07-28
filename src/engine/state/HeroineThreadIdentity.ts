import type { HeroineThreadEntry, LuanShiNpc } from '../types';

/**
 * A heroine relationship is owned by one canonical NPC, not by a model-authored
 * thread label. Older saves may therefore contain several differently named
 * threads for the same npcId. Collapse only that proven identity match; never
 * merge by display name, because two distinct NPCs may legitimately share it.
 */
export function normalizeHeroineThreads(
  threads: readonly HeroineThreadEntry[],
  npcs: readonly LuanShiNpc[] = [],
): HeroineThreadEntry[] {
  const canonicalNpcNames = new Map(
    npcs
      .filter((npc) => nonBlank(npc?.npcId) && nonBlank(npc?.name))
      .map((npc) => [npc.npcId.trim(), npc.name.trim()]),
  );
  const normalized: HeroineThreadEntry[] = [];
  const firstIndexByNpcId = new Map<string, number>();

  for (const rawEntry of threads) {
    if (!isRecord(rawEntry) || !nonBlank(rawEntry.npcId) || !nonBlank(rawEntry.heroineThreadId)) {
      // Preserve malformed legacy values for the validator to diagnose instead
      // of silently dropping or laundering them during normalization.
      normalized.push(rawEntry);
      continue;
    }

    if (!isSemanticallyMergeableHeroineThread(rawEntry)) {
      // Do not let a malformed legacy sibling overwrite a valid canonical
      // relationship merely because both claim the same npcId. Keep it visible
      // to the existing validator/projection filter instead.
      normalized.push(cloneHeroineThread(rawEntry));
      continue;
    }

    const incoming = cloneHeroineThread(rawEntry);
    incoming.npcId = incoming.npcId.trim();
    incoming.heroineThreadId = incoming.heroineThreadId.trim();
    incoming.npcName = canonicalNpcNames.get(incoming.npcId) ?? incoming.npcName.trim();
    const existingIndex = firstIndexByNpcId.get(incoming.npcId);
    if (existingIndex === undefined) {
      firstIndexByNpcId.set(incoming.npcId, normalized.length);
      normalized.push(incoming);
      continue;
    }

    const existing = normalized[existingIndex];
    if (existing.heroineThreadId.trim() === incoming.heroineThreadId) {
      // Exact duplicate stable IDs are structural corruption. Keep both so the
      // existing validator can reject them with an explicit duplicate error.
      normalized.push(incoming);
      continue;
    }

    normalized[existingIndex] = mergeHeroineThreads(
      existing,
      incoming,
      canonicalNpcNames.get(incoming.npcId),
    );
  }

  return normalized;
}

export function findHeroineThreadByIdentity(
  threads: readonly HeroineThreadEntry[],
  heroineThreadId: string,
  npcId?: string,
): HeroineThreadEntry | undefined {
  const stableThreadId = heroineThreadId.trim();
  const byThreadId = threads.find((entry) => (
    isRecord(entry)
      && typeof entry.heroineThreadId === 'string'
      && entry.heroineThreadId.trim() === stableThreadId
  ));
  if (byThreadId) return byThreadId;

  const stableNpcId = npcId?.trim();
  if (!stableNpcId) return undefined;
  return threads.find((entry) => (
    isRecord(entry)
      && typeof entry.npcId === 'string'
      && entry.npcId.trim() === stableNpcId
  ));
}

function mergeHeroineThreads(
  canonical: HeroineThreadEntry,
  incoming: HeroineThreadEntry,
  canonicalNpcName?: string,
): HeroineThreadEntry {
  const incomingIsNewer = compareUpdatedAt(incoming.lastUpdatedAt, canonical.lastUpdatedAt) >= 0;
  const older = incomingIsNewer ? canonical : incoming;
  const newer = incomingIsNewer ? incoming : canonical;
  const merged = overlayDefined(older, newer);
  const tags = mergeUniqueStrings(canonical.tags, incoming.tags);
  const milestones = mergeMilestones(canonical.milestones, incoming.milestones);

  merged.heroineThreadId = canonical.heroineThreadId.trim();
  merged.npcId = canonical.npcId.trim();
  merged.npcName = canonicalNpcName ?? newer.npcName.trim();
  if (tags.length > 0) merged.tags = tags;
  else delete merged.tags;
  if (milestones.length > 0) merged.milestones = milestones;
  else delete merged.milestones;
  return merged;
}

function mergeMilestones(
  left: HeroineThreadEntry['milestones'],
  right: HeroineThreadEntry['milestones'],
): NonNullable<HeroineThreadEntry['milestones']> {
  const merged: NonNullable<HeroineThreadEntry['milestones']> = [];
  const indexById = new Map<string, number>();
  const leftItems = Array.isArray(left) ? left : [];
  const rightItems = Array.isArray(right) ? right : [];
  for (const milestone of [...leftItems, ...rightItems]) {
    const milestoneId = milestone.milestoneId.trim();
    const next = { ...milestone, milestoneId };
    const existingIndex = indexById.get(milestoneId);
    if (existingIndex === undefined) {
      indexById.set(milestoneId, merged.length);
      merged.push(next);
      continue;
    }
    if (compareUpdatedAt(next.happenedAt, merged[existingIndex].happenedAt) >= 0) {
      merged[existingIndex] = next;
    }
  }
  return merged;
}

function mergeUniqueStrings(...lists: Array<readonly string[] | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of lists.flatMap((list) => Array.isArray(list) ? list : [])) {
    const clean = value.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }
  return result;
}

function cloneHeroineThread(entry: HeroineThreadEntry): HeroineThreadEntry {
  return {
    ...entry,
    ...(Array.isArray(entry.tags) ? { tags: [...entry.tags] } : {}),
    ...(Array.isArray(entry.milestones)
      ? { milestones: entry.milestones.map((milestone) => ({ ...milestone })) }
      : {}),
  };
}

function overlayDefined<T extends object>(older: T, newer: T): T {
  const merged: Record<string, unknown> = { ...(older as Record<string, unknown>) };
  for (const [key, value] of Object.entries(newer)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as T;
}

function compareUpdatedAt(left: string, right: string): number {
  return left.trim().localeCompare(right.trim());
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSemanticallyMergeableHeroineThread(
  value: Record<string, unknown>,
): value is HeroineThreadEntry & Record<string, unknown> {
  return nonBlank(value.heroineThreadId)
    && nonBlank(value.npcId)
    && nonBlank(value.npcName)
    && typeof value.status === 'string'
    && ['active', 'paused', 'resolved', 'archived'].includes(value.status)
    && nonBlank(value.stage)
    && nonBlank(value.relationshipRole)
    && nonBlank(value.summary)
    && nonBlank(value.lastUpdatedAt)
    && optionalString(value.currentPull)
    && optionalString(value.riskNotes)
    && optionalString(value.promiseNotes)
    && optionalString(value.recentProgress)
    && optionalStringArray(value.tags)
    && optionalMilestoneArray(value.milestones);
}

function optionalString(value: unknown): boolean {
  return value === undefined || nonBlank(value);
}

function optionalStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

function optionalMilestoneArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((milestone) => (
    isRecord(milestone)
      && nonBlank(milestone.milestoneId)
      && nonBlank(milestone.happenedAt)
      && nonBlank(milestone.summary)
  )));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

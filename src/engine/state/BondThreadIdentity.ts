import type { BondThreadEntry, LuanShiNpc } from '../types';

/**
 * Resolve only canonical-name matches that identify exactly one NPC. This is a
 * deterministic legacy repair, not fuzzy semantic inference.
 */
export function resolveBondTargetNpcIdsByExactName(
  targetNames: readonly string[],
  npcs: readonly LuanShiNpc[],
): string[] {
  const idsByName = new Map<string, string[]>();
  for (const npc of npcs) {
    const name = npc.name?.trim();
    const npcId = npc.npcId?.trim();
    if (!name || !npcId) continue;
    idsByName.set(name, [...(idsByName.get(name) ?? []), npcId]);
  }

  const resolved: string[] = [];
  for (const rawName of targetNames) {
    const name = rawName.trim();
    if (!name) continue;
    const matches = idsByName.get(name) ?? [];
    if (matches.length !== 1 || resolved.includes(matches[0])) continue;
    resolved.push(matches[0]);
  }
  return resolved;
}

/**
 * Older saves allowed NPC-backed bonds to remain name-only. Attach stable IDs
 * only where an exact canonical name has a unique match, preserving ambiguous
 * or institutional name-only bonds unchanged.
 */
export function normalizeBondThreads(
  threads: readonly BondThreadEntry[],
  npcs: readonly LuanShiNpc[] = [],
): BondThreadEntry[] {
  return threads.map((thread) => {
    if (
      (thread.targetNpcIds !== undefined && !Array.isArray(thread.targetNpcIds))
      || thread.targetNpcIds?.length
      || !Array.isArray(thread.targetNames)
    ) {
      return cloneBondThread(thread);
    }
    const targetNpcIds = resolveBondTargetNpcIdsByExactName(thread.targetNames, npcs);
    return targetNpcIds.length > 0
      ? { ...cloneBondThread(thread), targetNpcIds }
      : cloneBondThread(thread);
  });
}

function cloneBondThread(thread: BondThreadEntry): BondThreadEntry {
  return {
    ...thread,
    targetNames: Array.isArray(thread.targetNames) ? [...thread.targetNames] : thread.targetNames,
    ...(Array.isArray(thread.targetNpcIds) ? { targetNpcIds: [...thread.targetNpcIds] } : {}),
    ...(Array.isArray(thread.tags) ? { tags: [...thread.tags] } : {}),
    ...(Array.isArray(thread.milestones)
      ? { milestones: thread.milestones.map((milestone) => ({ ...milestone })) }
      : {}),
  };
}

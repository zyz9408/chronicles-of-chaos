import type { RuntimeState, StatePatch } from '../types';
import type { NarratorWritebackProtocol } from './MockNarrator';
import { extractLuanShiCommandFromPatch } from './LuanShiCommandPatch';

export interface JudgementMarkerIntegrityIssue {
  kind: 'battle' | 'combat';
  recordId: string;
  message: string;
}

export interface ConflictReferenceSanitizationResult {
  writeback: NarratorWritebackProtocol | undefined;
  removedConflictIds: string[];
}

const judgementMarkerPattern = /\[\[判定:(battle|combat):([^\]\r\n]+)\]\]/g;

export function findOrphanJudgementMarkers(
  narrativeText: string,
  statePatches: StatePatch[],
): JudgementMarkerIntegrityIssue[] {
  const conflictIds = new Set<string>();
  const combatIds = new Set<string>();

  for (const patch of statePatches) {
    const command = extractLuanShiCommandFromPatch(patch);
    if (command?.action === 'upsertConflictRecord' && command.conflictId?.trim()) {
      conflictIds.add(command.conflictId.trim());
    }
    if (command?.action === 'upsertCombatRecord' && command.combatId?.trim()) {
      combatIds.add(command.combatId.trim());
    }
  }

  const issues: JudgementMarkerIntegrityIssue[] = [];
  const seen = new Set<string>();
  for (const match of narrativeText.matchAll(judgementMarkerPattern)) {
    const kind = match[1] as 'battle' | 'combat';
    const recordId = match[2].trim();
    if (!recordId) continue;
    const issueKey = `${kind}:${recordId}`;
    if (seen.has(issueKey)) continue;
    seen.add(issueKey);

    const hasRecord = kind === 'battle' ? conflictIds.has(recordId) : combatIds.has(recordId);
    if (hasRecord) continue;
    issues.push({
      kind,
      recordId,
      message: kind === 'battle'
        ? `正文包含战事判定标记 ${recordId}，但缺少同 ID 的 upsertConflictRecord。`
        : `正文包含个人战判定标记 ${recordId}，但缺少同 ID 的 upsertCombatRecord。`,
    });
  }
  return issues;
}

export function sanitizeDanglingConflictReferences(
  runtimeState: RuntimeState,
  writeback: NarratorWritebackProtocol | undefined,
): ConflictReferenceSanitizationResult {
  if (!writeback) return { writeback, removedConflictIds: [] };

  const knownConflictIds = new Set((runtimeState.conflicts ?? []).map((conflict) => conflict.conflictId));
  const removedConflictIds = new Set<string>();
  const filterIds = (ids: string[] | undefined): string[] | undefined => {
    if (!ids) return undefined;
    const filtered = ids.filter((id) => {
      if (knownConflictIds.has(id)) return true;
      removedConflictIds.add(id);
      return false;
    });
    return filtered.length > 0 ? filtered : undefined;
  };

  const worldEventSummary = writeback.worldEventSummary
    ? {
        ...writeback.worldEventSummary,
        sourceConflictIds: filterIds(writeback.worldEventSummary.sourceConflictIds),
      }
    : writeback.worldEventSummary;
  const worldEventUpdates = writeback.worldEventUpdates?.map((update) => ({
    ...update,
    sourceConflictIds: filterIds(update.sourceConflictIds),
  }));

  return {
    writeback: {
      ...writeback,
      worldEventSummary,
      worldEventUpdates,
    },
    removedConflictIds: [...removedConflictIds],
  };
}

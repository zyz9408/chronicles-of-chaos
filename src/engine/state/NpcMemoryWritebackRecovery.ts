import type { LuanShiNpc, NpcMemoryEntry, RuntimeState, TurnLogEntry } from '../types';
import { parseNarratorResponse } from '../turn/NarratorResponseParser';
import { narrativeHasNpcSpeakerTag } from './npcPresence';

const RECENT_RECOVERY_TURN_LIMIT = 12;

function normalizeMemoryContent(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasHistoricalPresenceRejection(log: TurnLogEntry, npc: LuanShiNpc): boolean {
  return log.statePatchSummary.includes(
    `NPC记忆：NPC ${npc.name} 当前不在场，不能写入亲历记忆。`,
  );
}

function isDuplicateMemory(
  npc: LuanShiNpc,
  candidate: Pick<NpcMemoryEntry, 'eventId' | 'source' | 'content' | 'createdAt'>,
): boolean {
  if (candidate.eventId) {
    return npc.memories.some((memory) => (
      memory.eventId === candidate.eventId
      && memory.source === candidate.source
    ));
  }
  const content = normalizeMemoryContent(candidate.content);
  return npc.memories.some((memory) => (
    memory.createdAt === candidate.createdAt
    && memory.source === candidate.source
    && normalizeMemoryContent(memory.content) === content
  ));
}

function buildRecoveryMemoryId(log: TurnLogEntry, npcId: string, suggestionIndex: number): string {
  const safeNpcId = npcId.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return `memory_recovered_presence_${log.turnNumber}_${safeNpcId}_${suggestionIndex + 1}`;
}

/**
 * Repairs the narrow historical defect where structured firsthand memories
 * were rejected by the stale `npc.isPresent` flag even though the same
 * committed turn explicitly rendered that NPC as a tagged speaker.
 *
 * This intentionally does not infer facts from prose. Recovery requires the
 * original structured suggestion, the exact historical rejection marker, and
 * an explicit speaker tag in the committed narrative.
 */
export function recoverRejectedCurrentSceneNpcMemories(state: RuntimeState): RuntimeState {
  const logs = state.turnLog.slice(-RECENT_RECOVERY_TURN_LIMIT);
  if (logs.length === 0 || !state.npcs?.length) return state;

  const recoveredByNpcId = new Map<string, NpcMemoryEntry[]>();
  const workingNpcById = new Map(state.npcs.map((npc) => [
    npc.npcId,
    { ...npc, memories: [...npc.memories] },
  ]));

  for (const log of logs) {
    const rawResponse = log.displayMeta?.rawResponse;
    if (!hasText(rawResponse)) continue;
    const response = parseNarratorResponse(rawResponse);
    const suggestions = response.writeback?.npcMemorySuggestions ?? [];
    const narrativeText = log.fullNarrativeText || response.narrativeText || log.narrativeText;

    suggestions.forEach((suggestion, suggestionIndex) => {
      if (
        suggestion.source !== '亲历'
        || !hasText(suggestion.npcId)
        || !hasText(suggestion.npcName)
        || !hasText(suggestion.content)
      ) {
        return;
      }

      const npc = workingNpcById.get(suggestion.npcId.trim());
      if (
        !npc
        || suggestion.npcName.trim() !== npc.name
        || !hasHistoricalPresenceRejection(log, npc)
        || !narrativeHasNpcSpeakerTag(narrativeText, npc)
      ) {
        return;
      }

      const memory: NpcMemoryEntry = {
        memoryId: buildRecoveryMemoryId(log, npc.npcId, suggestionIndex),
        ...(hasText(suggestion.eventId) ? { eventId: suggestion.eventId.trim() } : {}),
        source: '亲历',
        content: suggestion.content.trim(),
        createdAt: log.date,
      };
      if (npc.memories.some((entry) => entry.memoryId === memory.memoryId) || isDuplicateMemory(npc, memory)) {
        return;
      }

      npc.memories.push(memory);
      const recovered = recoveredByNpcId.get(npc.npcId) ?? [];
      recovered.push(memory);
      recoveredByNpcId.set(npc.npcId, recovered);
    });
  }

  if (recoveredByNpcId.size === 0) return state;
  return {
    ...state,
    npcs: state.npcs.map((npc) => {
      const recovered = recoveredByNpcId.get(npc.npcId);
      return recovered ? { ...npc, memories: [...npc.memories, ...recovered] } : npc;
    }),
  };
}

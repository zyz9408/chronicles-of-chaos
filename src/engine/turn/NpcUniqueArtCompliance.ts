import type { LuanShiNpc, RuntimeState } from '../types';
import { isNpcPhysicallyPresent } from '../state/npcPresence';
import { extractLuanShiCommandFromPatch } from './LuanShiCommandPatch';
import type { NarratorResponse } from './MockNarrator';
import {
  evaluateNpcUniqueArtCompliance,
  type NpcUniqueArtRequirement,
} from '../character/NpcUniqueArtPolicy';

export interface NpcUniqueArtComplianceCandidate {
  npcId: string;
  name: string;
  npc: LuanShiNpc;
  requirement: NpcUniqueArtRequirement;
  reasons: string[];
  existedBeforeTurn: boolean;
  relevanceReasons: string[];
}

export function detectNpcUniqueArtComplianceCandidates(input: {
  runtimeState: RuntimeState;
  acceptedRuntimeState: RuntimeState;
  response: NarratorResponse;
  playerInput: string;
  limit?: number;
}): NpcUniqueArtComplianceCandidate[] {
  const relevantIds = collectRelevantNpcIds(input);
  const originalIds = new Set((input.runtimeState.npcs ?? []).map((npc) => npc.npcId));
  const relevanceText = `${input.playerInput}\n${input.response.narrativeText}`;
  const candidates: NpcUniqueArtComplianceCandidate[] = [];

  for (const npc of input.acceptedRuntimeState.npcs ?? []) {
    const relevanceReasons: string[] = [];
    if (relevantIds.has(npc.npcId)) relevanceReasons.push('本回合结构化写回或参战');
    if (isNpcPhysicallyPresent(input.acceptedRuntimeState, npc)) relevanceReasons.push('当前在场');
    if (npc.isFocused) relevanceReasons.push('当前焦点');
    if (npc.name && relevanceText.includes(npc.name)) relevanceReasons.push('本回合正文或行动点名');
    if (relevanceReasons.length === 0) continue;

    const compliance = evaluateNpcUniqueArtCompliance(npc);
    if (compliance.compliant || !compliance.requirement) continue;
    candidates.push({
      npcId: npc.npcId,
      name: npc.name,
      npc,
      requirement: compliance.requirement,
      reasons: compliance.reasons,
      existedBeforeTurn: originalIds.has(npc.npcId),
      relevanceReasons,
    });
  }

  return candidates
    .sort((left, right) => (
      Number(right.relevanceReasons.includes('本回合结构化写回或参战'))
      - Number(left.relevanceReasons.includes('本回合结构化写回或参战'))
      || right.requirement.highestScore - left.requirement.highestScore
      || left.name.localeCompare(right.name, 'zh-CN')
    ))
    .slice(0, input.limit ?? 4);
}

function collectRelevantNpcIds(input: {
  response: NarratorResponse;
}): Set<string> {
  const relevantIds = new Set<string>();
  for (const profile of input.response.writeback?.npcProfileSuggestions ?? []) {
    if (profile.npcId.trim()) relevantIds.add(profile.npcId.trim());
  }
  for (const patch of [
    ...(input.response.statePatches ?? []),
    ...(input.response.statePatch ? [input.response.statePatch] : []),
  ]) {
    const command = extractLuanShiCommandFromPatch(patch);
    if (!command) continue;
    if (command.action === 'upsertNpcProfile' || command.action === 'updateCharacterUniqueArts') {
      const npcId = command.action === 'upsertNpcProfile'
        ? command.npcId
        : command.characterType === 'npc' ? command.characterId : undefined;
      if (npcId?.trim()) relevantIds.add(npcId.trim());
    }
  }
  const intent = input.response.writeback?.encounterStartIntent;
  if (intent?.kind === 'personal_combat') {
    for (const actorId of [...intent.playerParty.actorIds, ...intent.enemyParty.actorIds]) {
      if (actorId.trim()) relevantIds.add(actorId.trim());
    }
  } else if (intent?.kind === 'war') {
    for (const actorId of [
      intent.playerForce.commanderActorId,
      intent.enemyForce.commanderActorId,
    ]) {
      if (actorId?.trim()) relevantIds.add(actorId.trim());
    }
  }
  return relevantIds;
}

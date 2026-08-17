import type { CharacterUniqueArt, RuntimeState } from '../types';
import type { EncounterStartIntent } from '../encounterV2/EncounterContracts';

export type NpcProfileDeletionBlockerKind =
  | 'troop_assignment'
  | 'holding_steward'
  | 'holding_governance_officer'
  | 'holding_governance_project'
  | 'private_asset_manager'
  | 'faction_core'
  | 'active_quest'
  | 'heroine_thread'
  | 'bond_thread'
  | 'family_link'
  | 'active_encounter';

export interface NpcProfileDeletionBlocker {
  kind: NpcProfileDeletionBlockerKind;
  label: string;
  sourceId: string;
}

export interface NpcProfileDeletionAnalysis {
  npcId: string;
  npcName: string;
  exists: boolean;
  canDelete: boolean;
  blockers: NpcProfileDeletionBlocker[];
}

export interface NpcProfileDeletionResult {
  state: RuntimeState;
  deleted: boolean;
  analysis: NpcProfileDeletionAnalysis;
}

const nonCommandingTroopStatuses = new Set([
  'merged',
  'split',
  'destroyed',
  'surrendered',
  'disbanded',
  'archived',
]);

function includesNpcId(values: readonly string[] | undefined, npcId: string): boolean {
  return values?.includes(npcId) ?? false;
}

function addBlocker(
  blockers: NpcProfileDeletionBlocker[],
  blocker: NpcProfileDeletionBlocker,
): void {
  if (blockers.some((item) => item.kind === blocker.kind && item.sourceId === blocker.sourceId)) return;
  blockers.push(blocker);
}

function encounterIntentReferencesNpc(intent: EncounterStartIntent, npcId: string): boolean {
  if (intent.kind === 'personal_combat') {
    return intent.playerParty.actorIds.includes(npcId) || intent.enemyParty.actorIds.includes(npcId);
  }
  return intent.playerForce.commanderActorId === npcId || intent.enemyForce.commanderActorId === npcId;
}

function childHistoryReferencesNpc(state: RuntimeState, npcId: string): boolean {
  return (state.npcs ?? []).some((npc) => {
    if (npc.parentLinks?.motherNpcId === npcId || npc.parentLinks?.fatherCharacterId === npcId) {
      return true;
    }
    const wombProfile = npc.femaleProfile?.adultPrivateProfile?.wombProfile;
    return wombProfile?.pregnancy?.childNpcId === npcId
      || wombProfile?.pregnancy?.fatherCharacterIds.includes(npcId)
      || (wombProfile?.pendingPregnancyChecks ?? []).some(
        (entry) => entry.childNpcId === npcId || entry.fatherCharacterIds.includes(npcId),
      )
      || (wombProfile?.pregnancyHistory ?? []).some((entry) => entry.childNpcId === npcId);
  });
}

export function analyzeNpcProfileDeletion(
  state: RuntimeState,
  npcId: string,
): NpcProfileDeletionAnalysis {
  const npc = (state.npcs ?? []).find((candidate) => candidate.npcId === npcId);
  if (!npc) {
    return {
      npcId,
      npcName: '',
      exists: false,
      canDelete: false,
      blockers: [],
    };
  }

  const blockers: NpcProfileDeletionBlocker[] = [];

  for (const troop of state.troops ?? []) {
    if (troop.lifecycleStatus && nonCommandingTroopStatuses.has(troop.lifecycleStatus)) continue;
    if (
      troop.leaderNpcId === npcId
      || troop.strategistNpcId === npcId
      || includesNpcId(troop.deputyNpcIds, npcId)
    ) {
      addBlocker(blockers, {
        kind: 'troop_assignment',
        label: `仍在部队“${troop.name}”担任主将、副将或军师`,
        sourceId: troop.troopId,
      });
    }
  }

  for (const holding of state.holdings ?? []) {
    if (holding.status !== 'archived' && holding.stewardNpcId === npcId) {
      addBlocker(blockers, {
        kind: 'holding_steward',
        label: `仍是领地“${holding.name}”的管事`,
        sourceId: holding.holdingId,
      });
    }
    if (holding.status !== 'archived' && includesNpcId(holding.governanceOfficerNpcIds, npcId)) {
      addBlocker(blockers, {
        kind: 'holding_governance_officer',
        label: `仍是领地“${holding.name}”已任命的治理官员`,
        sourceId: holding.holdingId,
      });
    }
  }

  for (const project of state.holdingGovernanceProjects ?? []) {
    if (
      project.status === 'active'
      && (
        (project.host.actorType === 'npc' && project.host.actorId === npcId)
        || (project.assistant?.actorType === 'npc' && project.assistant.actorId === npcId)
      )
    ) {
      addBlocker(blockers, {
        kind: 'holding_governance_project',
        label: '仍在进行中的领地治理项目任职',
        sourceId: project.projectId,
      });
    }
  }

  for (const asset of state.privateAssets ?? []) {
    if (asset.status !== 'archived' && asset.managerNpcId === npcId) {
      addBlocker(blockers, {
        kind: 'private_asset_manager',
        label: `仍是私人产业“${asset.name}”的管理者`,
        sourceId: asset.privateAssetId,
      });
    }
  }

  for (const faction of state.factions ?? []) {
    if (includesNpcId(faction.corePersonNpcIds, npcId)) {
      addBlocker(blockers, {
        kind: 'faction_core',
        label: `仍是势力“${faction.name}”的核心人物`,
        sourceId: faction.factionId,
      });
    }
  }

  for (const quest of state.activeQuests ?? []) {
    if (
      quest.status === 'active'
      && (
        quest.giverId === npcId
        || includesNpcId(quest.relatedNpcIds, npcId)
        || includesNpcId(quest.affectedNpcIds, npcId)
      )
    ) {
      addBlocker(blockers, {
        kind: 'active_quest',
        label: `仍被进行中事项“${quest.title}”引用`,
        sourceId: quest.id,
      });
    }
  }

  for (const thread of state.heroineThreads ?? []) {
    if (thread.npcId === npcId && (thread.status === 'active' || thread.status === 'paused')) {
      addBlocker(blockers, {
        kind: 'heroine_thread',
        label: `仍有${thread.status === 'active' ? '进行中' : '暂停中'}的红颜关系线`,
        sourceId: thread.heroineThreadId,
      });
    }
  }

  for (const thread of state.bondThreads ?? []) {
    if (
      includesNpcId(thread.targetNpcIds, npcId)
      && (thread.status === 'active' || thread.status === 'paused')
    ) {
      addBlocker(blockers, {
        kind: 'bond_thread',
        label: `仍被${thread.status === 'active' ? '进行中' : '暂停中'}的羁绊关系线引用`,
        sourceId: thread.bondThreadId,
      });
    }
  }

  if (childHistoryReferencesNpc(state, npcId)) {
    addBlocker(blockers, {
      kind: 'family_link',
      label: '仍被子嗣或父母关系引用',
      sourceId: npcId,
    });
  }

  const activeIntent = state.encounterV2?.active?.session.intent;
  const pendingIntent = state.encounterV2?.pendingOffer?.intent;
  if (
    (activeIntent && encounterIntentReferencesNpc(activeIntent, npcId))
    || (pendingIntent && encounterIntentReferencesNpc(pendingIntent, npcId))
  ) {
    addBlocker(blockers, {
      kind: 'active_encounter',
      label: '仍在尚未完成的战斗或战争中',
      sourceId: state.encounterV2?.active?.session.sessionId
        ?? state.encounterV2?.pendingOffer?.offerId
        ?? npcId,
    });
  }

  return {
    npcId,
    npcName: npc.name,
    exists: true,
    canDelete: blockers.length === 0,
    blockers,
  };
}

function removeNpcFromUniqueArts(
  uniqueArts: CharacterUniqueArt[] | undefined,
  npcId: string,
): CharacterUniqueArt[] | undefined {
  if (!uniqueArts) return undefined;
  return uniqueArts.map((art) => (
    art.relatedNpcIds?.includes(npcId)
      ? { ...art, relatedNpcIds: art.relatedNpcIds.filter((id) => id !== npcId) }
      : art
  ));
}

export function deleteNpcProfileSafely(
  state: RuntimeState,
  npcId: string,
): NpcProfileDeletionResult {
  const analysis = analyzeNpcProfileDeletion(state, npcId);
  if (!analysis.canDelete) {
    return { state, deleted: false, analysis };
  }

  const nextState: RuntimeState = {
    ...state,
    player: {
      ...state.player,
      uniqueArts: removeNpcFromUniqueArts(state.player.uniqueArts, npcId),
    },
    knownActors: (state.knownActors ?? []).filter((actor) => actor.id !== npcId),
    relationships: (state.relationships ?? []).filter(
      (relationship) => relationship.actorId !== npcId && relationship.targetId !== npcId,
    ),
    npcs: (state.npcs ?? [])
      .filter((npc) => npc.npcId !== npcId)
      .map((npc) => ({
        ...npc,
        uniqueArts: removeNpcFromUniqueArts(npc.uniqueArts, npcId),
      })),
    npcAwarenessIndex: (state.npcAwarenessIndex ?? []).filter((entry) => entry.npcId !== npcId),
    factions: (state.factions ?? []).map((faction) => ({
      ...faction,
      knownMemberNpcIds: faction.knownMemberNpcIds?.filter((id) => id !== npcId),
    })),
    holdings: (state.holdings ?? []).map((holding) => ({
      ...holding,
      ...(holding.stewardNpcId === npcId ? { stewardNpcId: undefined } : {}),
      governanceOfficerNpcIds: holding.governanceOfficerNpcIds?.filter((id) => id !== npcId),
      relatedNpcIds: holding.relatedNpcIds?.filter((id) => id !== npcId),
    })),
    privateAssets: (state.privateAssets ?? []).map((asset) => ({
      ...asset,
      ...(asset.managerNpcId === npcId ? { managerNpcId: undefined } : {}),
    })),
  };

  return {
    state: nextState,
    deleted: true,
    analysis,
  };
}

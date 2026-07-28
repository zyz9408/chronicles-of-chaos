import type {
  Actor,
  FactionLedgerEntry,
  Quest,
  Relationship,
  Rumor,
  RuntimeState,
  WorldTrendEntry,
} from '../types';

export interface FactionLedgerIdentityNormalization {
  state: RuntimeState;
  remappedFactionIds: Map<string, string>;
}

export function normalizeFactionLedgerIdentities(
  state: RuntimeState,
): FactionLedgerIdentityNormalization {
  const factions = state.factions ?? [];
  const byIdentity = new Map<string, FactionLedgerEntry>();
  const normalizedFactions: FactionLedgerEntry[] = [];
  const remappedFactionIds = new Map<string, string>();

  for (const faction of factions) {
    const identity = factionDisplayIdentity(faction);
    const canonical = byIdentity.get(identity);
    if (!canonical || canonical.factionId === faction.factionId) {
      byIdentity.set(identity, faction);
      normalizedFactions.push(faction);
      continue;
    }

    remappedFactionIds.set(faction.factionId, canonical.factionId);
    const merged = mergeFactionEntries(canonical, faction);
    byIdentity.set(identity, merged);
    const canonicalIndex = normalizedFactions.findIndex(
      (candidate) => candidate.factionId === canonical.factionId,
    );
    normalizedFactions[canonicalIndex] = merged;
  }

  if (remappedFactionIds.size === 0) {
    return { state, remappedFactionIds };
  }

  const remapId = (factionId: string | undefined): string | undefined => {
    if (!factionId) return factionId;
    let current = factionId;
    const visited = new Set<string>();
    while (remappedFactionIds.has(current) && !visited.has(current)) {
      visited.add(current);
      current = remappedFactionIds.get(current)!;
    }
    return current;
  };
  const remapIds = (factionIds: string[] | undefined): string[] | undefined => {
    if (!factionIds) return factionIds;
    return Array.from(new Set(factionIds.map((factionId) => remapId(factionId)!).filter(Boolean)));
  };

  return {
    remappedFactionIds,
    state: {
      ...state,
      player: remapActor(state.player, remapId, remapIds),
      knownActors: state.knownActors.map((actor) => remapActor(actor, remapId, remapIds)),
      knownFactions: remapIds(state.knownFactions) ?? [],
      relationships: state.relationships.map((relationship) => remapRelationship(relationship, remapId)),
      knownRumors: state.knownRumors.map((rumor) => remapRumor(rumor, remapId, remapIds)),
      activeQuests: state.activeQuests.map((quest) => remapQuest(quest, remapIds)),
      factions: normalizedFactions,
      npcs: state.npcs?.map((npc) => ({
        ...npc,
        factionId: remapId(npc.factionId),
      })),
      troops: state.troops?.map((troop) => ({
        ...troop,
        factionId: remapId(troop.factionId),
        previousFactionId: remapId(troop.previousFactionId),
      })),
      holdings: state.holdings?.map((holding) => ({
        ...holding,
        factionId: remapId(holding.factionId),
      })),
      worldTrends: state.worldTrends?.map((trend) => remapWorldTrend(trend, remapIds)),
      conflicts: state.conflicts?.map((conflict) => ({
        ...conflict,
        involvedFactionIds: remapIds(conflict.involvedFactionIds),
      })),
    },
  };
}

function factionDisplayIdentity(faction: FactionLedgerEntry): string {
  return `${normalizeIdentityText(faction.name)}|${normalizeIdentityText(faction.type)}`;
}

function normalizeIdentityText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[，,。；;：:、/／\\|_\-—\s（）()【】[\]《》<>]/g, '');
}

function mergeFactionEntries(
  canonical: FactionLedgerEntry,
  duplicate: FactionLedgerEntry,
): FactionLedgerEntry {
  return {
    ...canonical,
    ...duplicate,
    factionId: canonical.factionId,
    name: canonical.name,
    type: canonical.type,
    aliases: mergeStringLists(canonical.aliases, duplicate.aliases),
    corePersonNpcIds: mergeStringLists(canonical.corePersonNpcIds, duplicate.corePersonNpcIds),
    knownMemberNpcIds: mergeStringLists(canonical.knownMemberNpcIds, duplicate.knownMemberNpcIds),
    relatedTroopIds: mergeStringLists(canonical.relatedTroopIds, duplicate.relatedTroopIds),
    recentActions: mergeStringLists(canonical.recentActions, duplicate.recentActions) ?? [],
  };
}

function mergeStringLists(left?: string[], right?: string[]): string[] | undefined {
  if (!left && !right) return undefined;
  const merged = Array.from(new Set(
    [...(left ?? []), ...(right ?? [])]
      .map((value) => value.trim())
      .filter(Boolean),
  ));
  return merged.length > 0 ? merged : undefined;
}

function remapActor(
  actor: Actor,
  remapId: (factionId: string | undefined) => string | undefined,
  remapIds: (factionIds: string[] | undefined) => string[] | undefined,
): Actor {
  return {
    ...actor,
    factionId: remapId(actor.factionId),
    uniqueArts: actor.uniqueArts?.map((art) => ({
      ...art,
      relatedFactionIds: remapIds(art.relatedFactionIds),
    })),
    factionAssetAccess: actor.factionAssetAccess
      ? {
          ...actor.factionAssetAccess,
          factionId: remapId(actor.factionAssetAccess.factionId),
        }
      : undefined,
  };
}

function remapRelationship(
  relationship: Relationship,
  remapId: (factionId: string | undefined) => string | undefined,
): Relationship {
  if (relationship.targetKind !== 'faction' && relationship.targetType !== 'faction') {
    return relationship;
  }
  return {
    ...relationship,
    targetId: remapId(relationship.targetId) ?? relationship.targetId,
  };
}

function remapRumor(
  rumor: Rumor,
  remapId: (factionId: string | undefined) => string | undefined,
  remapIds: (factionIds: string[] | undefined) => string[] | undefined,
): Rumor {
  return {
    ...rumor,
    relatedFactionId: remapId(rumor.relatedFactionId),
    affectedFactionIds: remapIds(rumor.affectedFactionIds),
  };
}

function remapQuest(
  quest: Quest,
  remapIds: (factionIds: string[] | undefined) => string[] | undefined,
): Quest {
  return {
    ...quest,
    relatedFactionIds: remapIds(quest.relatedFactionIds),
    affectedFactionIds: remapIds(quest.affectedFactionIds),
  };
}

function remapWorldTrend(
  trend: WorldTrendEntry,
  remapIds: (factionIds: string[] | undefined) => string[] | undefined,
): WorldTrendEntry {
  return {
    ...trend,
    relatedFactionIds: remapIds(trend.relatedFactionIds),
    affectedFactionIds: remapIds(trend.affectedFactionIds),
  };
}

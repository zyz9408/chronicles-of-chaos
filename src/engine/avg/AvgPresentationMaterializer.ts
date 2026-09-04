import type { RuntimeState, TurnDisplayMeta } from '../types';
import type { AvgPlayerPortraitMode } from '../settings/DisplaySettings';
import { deriveCurrentWeather } from '../time/weather';
import { resolveThreeKingdomsPortraitSet, resolveThreeKingdomsSceneResource } from './ThreeKingdomsAvgResolver';

export interface AvgPresentationMaterializationResult { state: RuntimeState; changed: boolean; materializedActorIds: string[] }

export function materializeAvgPresentation(state: RuntimeState, options: { saveId: string; turnNumber: number; playerPortraitMode: AvgPlayerPortraitMode }): AvgPresentationMaterializationResult {
  const turnIndex = state.turnLog.findIndex((turn) => turn.turnNumber === options.turnNumber);
  if (turnIndex < 0) return { state, changed: false, materializedActorIds: [] };
  const turn = state.turnLog[turnIndex];
  const facts = turn.displayMeta?.presentationSpeakerFacts ?? [];
  const partitionId = state.avgPresentation?.visualPartitionId?.trim() || options.saveId.trim();
  const existing = state.avgPresentation?.portraitBindings ?? [];
  const additions: typeof existing = [];
  for (const fact of facts) {
    if (!fact.speakerActorId.trim() || existing.some((binding) => binding.actorId === fact.speakerActorId) || additions.some((binding) => binding.actorId === fact.speakerActorId)) continue;
    if (fact.speakerActorId === state.player.id && options.playerPortraitMode === 'hidden') continue;
    const actor = fact.speakerActorId === state.player.id
      ? state.player
      : state.npcs?.find((npc) => npc.npcId === fact.speakerActorId) ?? state.knownActors.find((known) => known.id === fact.speakerActorId);
    const roleType = actor && 'role' in actor ? actor.role : actor?.roleType;
    const resolved = state.worldBookId === 'threeKingdoms' ? resolveThreeKingdomsPortraitSet({
      actorId: fact.speakerActorId,
      name: actor?.name ?? fact.speakerLabel,
      aliases: actor?.aliases,
      roleType,
      sex: actor?.sex ?? fact.sex,
    }) : undefined;
    if (!resolved) continue;
    additions.push({ bindingKey: `avg-binding:${partitionId}:${state.worldBookId}:${fact.speakerActorId}`, saveId: options.saveId, worldBookId: state.worldBookId, actorId: fact.speakerActorId, portraitSetId: resolved.portraitSetId, profileSnapshot: { sex: fact.sex, ageBand: fact.ageBand, roleFamily: fact.roleFamily, professionTags: fact.professionTags ?? [], socialTierTags: fact.socialTierTags ?? [] } });
  }
  const needsSnapshot = !turn.avgVisualSnapshot;
  const baseVisualContext = turn.avgVisualSnapshot ?? {
    schemaVersion: 1 as const,
    ...(state.currentPlaceId || state.currentLocationId ? { runtimePlaceId: state.currentPlaceId || state.currentLocationId } : {}),
    ...(state.currentSceneId ? { runtimeSceneId: state.currentSceneId } : {}),
    timeText: state.currentDate,
    weatherText: deriveCurrentWeather(state).label,
    presentActorIds: [...new Set([state.player.id, ...(state.npcs ?? []).filter((npc) => npc.isPresent).map((npc) => npc.npcId)])].sort(),
  };
  const sceneResource = state.worldBookId === 'threeKingdoms' ? resolveThreeKingdomsSceneResource({
    runtimeSceneId: baseVisualContext.runtimeSceneId,
    runtimePlaceId: baseVisualContext.runtimePlaceId,
    locationId: state.currentLocationId,
    labels: baseVisualContext.structuredSceneAliases,
  }) : undefined;
  const visualContext = turn.avgVisualSnapshot ?? {
    ...baseVisualContext,
    source: 'committed-structured' as const,
    ...(sceneResource ? {
      structuredSceneAliases: [...sceneResource.aliases],
      sceneSemantic: {
        ...sceneResource.semanticProfile,
        environment: sceneResource.semanticProfile.environment === 'indoor' || sceneResource.semanticProfile.environment === 'outdoor'
          ? sceneResource.semanticProfile.environment
          : undefined,
      },
    } : {}),
  };
  const needsSceneBinding = Boolean(sceneResource) && !turn.avgPresentation?.sceneBinding;
  const needsPartition = state.avgPresentation?.visualPartitionId !== partitionId;
  if (!additions.length && !needsSnapshot && !needsSceneBinding && !needsPartition) return { state, changed: false, materializedActorIds: [] };
  const next = structuredClone(state); const nextTurn = next.turnLog[turnIndex];
  next.avgPresentation = { ...next.avgPresentation, visualPartitionId: partitionId, portraitBindings: [...existing, ...additions] };
  if (needsSnapshot) nextTurn.avgVisualSnapshot = visualContext;
  if (needsSceneBinding && sceneResource) nextTurn.avgPresentation = {
    ...nextTurn.avgPresentation,
    sceneBinding: { sceneResourceId: sceneResource.sceneResourceId, source: 'registry-exact' },
  };
  return { state: next, changed: true, materializedActorIds: additions.map((binding) => binding.actorId) };
}

export function countAvgSpeakerBindingStatus(displayMeta: TurnDisplayMeta | undefined): { frozen: number; unbound: number } {
  const facts = displayMeta?.presentationSpeakerFacts ?? [];
  return { frozen: facts.filter((fact) => Boolean(fact.speakerActorId.trim())).length, unbound: facts.filter((fact) => !fact.speakerActorId.trim()).length };
}

import type { RuntimeState, TurnLogEntry } from '../types';
import { AvgResourcePackManager } from './AvgResourcePackManager';
import {
  IndexedDbAvgVisualOverrideRepository,
  createAvgActorTarget,
  createAvgSceneTarget,
} from './AvgVisualOverrideRepository';
import { resolveThreeKingdomsPortraitSet, resolveThreeKingdomsSceneResource } from './ThreeKingdomsAvgResolver';

export interface AvgPlaybackPreflightResult {
  status: 'ready' | 'warning';
  missingResourceIds: string[];
}

function visualPartitionId(state: RuntimeState, saveId: string): string {
  return state.avgPresentation?.visualPartitionId?.trim() || saveId.trim();
}

function portraitSubject(state: RuntimeState, actorId: string, fact?: NonNullable<NonNullable<TurnLogEntry['displayMeta']>['presentationSpeakerFacts']>[number]) {
  if (actorId === state.player.id) return { actorId, name: state.player.name, aliases: state.player.aliases, roleType: state.player.roleType, sex: state.player.sex };
  const npc = state.npcs?.find((item) => item.npcId === actorId);
  if (npc) return { actorId, name: npc.name, aliases: npc.aliases, roleType: npc.role, sex: npc.sex };
  const known = state.knownActors.find((item) => item.id === actorId);
  if (known) return { actorId, name: known.name, aliases: known.aliases, roleType: known.roleType, sex: known.sex };
  const presentation = state.avgPresentation?.speakerActors?.find((item) => item.actorId === actorId);
  return { actorId, name: presentation?.labels[0] ?? fact?.speakerLabel, aliases: presentation?.labels, roleType: presentation?.profileSnapshot.roleFamily, sex: presentation?.profileSnapshot.sex ?? fact?.sex };
}

export async function preflightAvgPlayback(
  state: RuntimeState,
  saveId: string,
  turn: TurnLogEntry,
  playerPortraitMode: 'hidden' | 'show',
  dependencies: {
    packs?: AvgResourcePackManager;
    overrides?: IndexedDbAvgVisualOverrideRepository;
  } = {},
): Promise<AvgPlaybackPreflightResult> {
  const packs = dependencies.packs ?? new AvgResourcePackManager();
  const overrides = dependencies.overrides ?? new IndexedDbAvgVisualOverrideRepository();
  const partition = visualPartitionId(state, saveId);
  const missing = new Set<string>();
  const sceneResourceId = turn.avgPresentation?.sceneBinding?.sceneResourceId
    ?? (state.worldBookId === 'threeKingdoms' ? resolveThreeKingdomsSceneResource({
      runtimeSceneId: turn.avgVisualSnapshot?.runtimeSceneId,
      runtimePlaceId: turn.avgVisualSnapshot?.runtimePlaceId,
      labels: turn.avgVisualSnapshot?.structuredSceneAliases,
    })?.sceneResourceId : undefined);
  if (sceneResourceId) {
    const sceneTarget = createAvgSceneTarget(partition, state.worldBookId, { kind: 'frozen-scene-resource', id: sceneResourceId });
    const local = await overrides.lookup(sceneTarget);
    if (local.status !== 'found' && !await packs.lookupActiveAsset(state.worldBookId, `${sceneResourceId}:base`)
      && !await packs.lookupActiveResource(state.worldBookId, 'scene', sceneResourceId)) missing.add(sceneResourceId);
  }

  const facts = turn.displayMeta?.presentationSpeakerFacts ?? [];
  const actorIds = [...new Set((turn.avgPresentation?.speakerBindings ?? [])
    .filter((binding) => binding.status === 'frozen' && binding.actorId)
    .map((binding) => binding.actorId!))];
  for (const actorId of actorIds) {
    if (actorId === state.player.id && playerPortraitMode === 'hidden') continue;
    const target = createAvgActorTarget(partition, state.worldBookId, actorId);
    const local = await overrides.lookup(target);
    if (local.status === 'found') continue;
    const frozenSetId = state.avgPresentation?.portraitBindings?.find((binding) => binding.actorId === actorId)?.portraitSetId;
    const fact = facts.find((item) => item.speakerActorId === actorId);
    const resolved = state.worldBookId === 'threeKingdoms' ? resolveThreeKingdomsPortraitSet(portraitSubject(state, actorId, fact)) : undefined;
    const portraitSetId = frozenSetId ?? resolved?.portraitSetId;
    if (!portraitSetId) continue;
    const variant = resolved?.defaultVariant ?? 'default';
    const blob = await packs.lookupActiveAsset(state.worldBookId, `${portraitSetId}:${variant}`)
      ?? await packs.lookupActiveResource(state.worldBookId, portraitSetId.includes(':fixed:') ? 'fixed-portrait' : 'generic-portrait', portraitSetId, variant);
    if (!blob) missing.add(portraitSetId);
  }
  return { status: missing.size ? 'warning' : 'ready', missingResourceIds: [...missing].sort() };
}

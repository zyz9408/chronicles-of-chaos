import type { RuntimeState, TurnDisplayMeta, TurnLogEntry } from '../types';
import { deriveActorCurrentAge, deriveNpcCurrentAge } from '../time/npcAge';
import { buildAvgActorImagePrompt, type AvgImagePromptDraft } from './AvgImagePrompt';
import { createAvgPortraitMatchProfile, type AvgPortraitMatchProfile } from './AvgPortraitLibrary';
import { resolveThreeKingdomsPortraitSet } from './ThreeKingdomsAvgResolver';

export interface AvgActorVisualContext {
  actorId: string;
  name: string;
  prompt: AvgImagePromptDraft;
  portraitProfile?: AvgPortraitMatchProfile;
  dedicated: boolean;
  bindingReason: string;
}

export function getAvgActorVisualContext(
  state: RuntimeState,
  actorId: string,
  displayMeta?: TurnDisplayMeta,
): AvgActorVisualContext | undefined {
  const player = actorId === state.player.id ? state.player : undefined;
  const npc = player ? undefined : state.npcs?.find((item) => item.npcId === actorId);
  const known = player || npc ? undefined : state.knownActors.find((item) => item.id === actorId);
  const actor = player ?? npc ?? known;
  const presentation = state.avgPresentation?.speakerActors?.find((item) => item.actorId === actorId);
  const fact = displayMeta?.presentationSpeakerFacts?.find((item) => item.speakerActorId === actorId);
  if (!actor && !presentation) return undefined;
  const name = actor?.name ?? presentation?.labels[0] ?? fact?.speakerLabel ?? '当前人物';
  const sex = actor?.sex ?? presentation?.profileSnapshot.sex ?? fact?.sex;
  const age = npc ? deriveNpcCurrentAge(npc, state.currentDate)
    : player || known ? deriveActorCurrentAge((player ?? known)!, state.currentDate) : undefined;
  const role = npc?.role ?? player?.roleType ?? known?.roleType;
  const profile = presentation?.profileSnapshot ?? fact;
  const portraitProfile = createAvgPortraitMatchProfile({
    sex, age, ageBand: age === undefined ? profile?.ageBand : undefined,
    roleFamily: profile?.roleFamily ?? role,
    professionTags: [...(profile?.professionTags ?? []), role],
    socialTierTags: profile?.socialTierTags,
  });
  const resolved = state.worldBookId === 'threeKingdoms' ? resolveThreeKingdomsPortraitSet({
    actorId, name, aliases: actor?.aliases ?? presentation?.labels, roleType: role, sex,
  }) : undefined;
  const historical = Boolean(resolved?.portraitSetId.includes(':fixed:'));
  const dedicated = Boolean(player || historical || npc?.isFocused);
  return {
    actorId, name, portraitProfile, dedicated,
    bindingReason: player ? '主角专属' : historical ? '特殊人物专属' : npc?.isFocused ? '关注人物专属' : '普通人物',
    prompt: buildAvgActorImagePrompt({
      name, sex, age, ageBand: profile?.ageBand,
      identity: actor?.currentIdentity,
      occupation: role ?? profile?.roleFamily,
      appearance: actor?.appearance,
    }),
  };
}

export function collectAvgCurrentActors(
  state: RuntimeState,
  displayMeta?: TurnDisplayMeta,
  snapshot?: TurnLogEntry['avgVisualSnapshot'],
  bindings?: TurnLogEntry['avgPresentation'],
): AvgActorVisualContext[] {
  const ids = [...new Set([
    ...(bindings?.speakerBindings ?? []).flatMap((binding) => binding.status === 'frozen' && binding.actorId ? [binding.actorId] : []),
    ...(displayMeta?.presentationSpeakerFacts ?? []).map((fact) => fact.speakerActorId),
    ...(snapshot?.presentActorIds ?? (state.npcs ?? []).filter((npc) => npc.isPresent).map((npc) => npc.npcId)),
    state.player.id,
  ])];
  return ids.flatMap((id) => {
    const actor = getAvgActorVisualContext(state, id, displayMeta);
    return actor ? [actor] : [];
  });
}

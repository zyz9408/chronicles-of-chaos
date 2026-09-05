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
  visualOnly?: boolean;
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
  if (!actor && !presentation && !fact) return undefined;
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
    ...(snapshot?.presentActorIds ?? []),
    ...(state.npcs ?? []).filter((npc) => npc.isPresent).map((npc) => npc.npcId),
    state.player.id,
  ])];
  return ids.flatMap((id) => {
    const actor = getAvgActorVisualContext(state, id, displayMeta);
    return actor ? [actor] : [];
  });
}

/** Visual-only identities never create NPCs or amend frozen turn facts. */
export function resolveAvgDialogueActor(state: RuntimeState, label: string, displayMeta?: TurnDisplayMeta, placeId?: string): AvgActorVisualContext | undefined {
  const name = label.normalize('NFKC').trim();
  if (!name || name.length > 80 || /^(众|群|全体)|们$|^(旁白|人群|声音|广播|广播声|传声|传音|喊声|号令声|场外声音|不明声音|远处声音|画外音|chorus|crowd|everyone|all|broadcast|voice|offscreen voice)$/iu.test(name)) return undefined;
  const matches = [
    { id: state.player.id, labels: [state.player.name, state.player.courtesyName, state.player.artName, state.player.commonAddress, ...(state.player.aliases ?? []), '你'] },
    ...(state.npcs ?? []).map((actor) => ({ id: actor.npcId, labels: [actor.name, actor.courtesyName, actor.artName, actor.commonAddress, ...(actor.aliases ?? [])] })),
    ...state.knownActors.map((actor) => ({ id: actor.id, labels: [actor.name, actor.courtesyName, actor.artName, actor.commonAddress, ...(actor.aliases ?? [])] })),
    ...(state.avgPresentation?.speakerActors ?? []).map((actor) => ({ id: actor.actorId, labels: actor.labels })),
    ...(displayMeta?.presentationSpeakerFacts ?? []).map((fact) => ({ id: fact.speakerActorId, labels: [fact.speakerLabel] })),
  ].filter((actor) => actor.labels.some((value) => value?.normalize('NFKC').trim() === name));
  const ids = [...new Set(matches.map((actor) => actor.id))];
  if (ids.length > 1) return undefined; // Do not merge two real people with the same label.
  if (ids.length === 1) return getAvgActorVisualContext(state, ids[0], displayMeta);
  const location = placeId ?? state.currentPlaceId ?? state.currentLocationId ?? 'unknown-place';
  const actorId = `avg-local:${encodeURIComponent(location)}:${encodeURIComponent(name)}`;
  // These are neutral artwork archetypes, not inferred simulation facts.
  const guard = /守卒|守军|守卫|卫兵|士卒|军士|士兵|步卒|差役|门卒|什长/u.test(name);
  const female = /女子|妇人|女掌柜|侍女|宫女|老妪/u.test(name);
  const male = guard || /男子|老翁|老汉/u.test(name);
  const elderly = /老翁|老汉|老妪/u.test(name);
  const minor = /少年|少女|孩|童/u.test(name);
  const role = guard ? '军士' : /掌柜|商贩|商人|店家|伙计/u.test(name) ? '商人' : '';
  const sex = female ? 'female' : male ? 'male' : undefined;
  const ageBand = minor ? 'teen' : elderly ? 'elderly' : guard ? 'adult' : 'unknown';
  const historical = state.worldBookId === 'threeKingdoms' && resolveThreeKingdomsPortraitSet({ actorId, name, sex })?.portraitSetId.includes(':fixed:');
  return {
    actorId, name, visualOnly: true, dedicated: Boolean(historical),
    bindingReason: historical ? '特殊人物专属' : '路人形象 · 地点与称呼固定',
    portraitProfile: createAvgPortraitMatchProfile({ sex, ageBand, roleFamily: role, professionTags: [role] }),
    prompt: buildAvgActorImagePrompt({ name, sex, ageBand, occupation: role, identity: '仅用于本地 AVG 的中性美术形象，不代表新增人物事实' }),
  };
}

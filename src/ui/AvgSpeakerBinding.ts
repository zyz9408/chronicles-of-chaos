import type { RuntimeState } from '../engine/types';
import type { PresentationSpeakerFact } from '../engine/turn/MockNarrator';
import { parseNarrativeTextSegments } from './narrativeTextSegments';

export type AvgSpeakerIdentityKind = 'player' | 'npc' | 'knownActor' | 'presentationActor';

export interface FrozenAvgSpeakerBinding {
  segmentIndex: number;
  label: string;
  status: 'frozen' | 'unbound';
  actorId?: string;
  identityKind?: AvgSpeakerIdentityKind;
  diagnosticCode: 'frozen-speaker' | 'speaker-unbound';
}

export interface AvgSpeakerBindingResult {
  bindings: FrozenAvgSpeakerBinding[];
  diagnostics: string[];
}

interface StableSpeakerActor {
  actorId: string;
  identityKind: AvgSpeakerIdentityKind;
  labels: string[];
  sex: '男' | '女' | '其他' | 'male' | 'female' | 'unknown' | 'other' | undefined;
}

const nonIndividualLabels = new Set([
  '众人', '众声', '人群', '全体', '众将', '众将士', '众军士', '众士卒', '众臣', '群臣', '群雄', '众官',
  '众百姓', '百姓们', '将士们', '军士们', '士卒们', '侍从们', '仆从们', '门客们', '宾客们',
  '广播', '广播声', '传声', '传音', '喊声', '号令声', '场外声音', '远处声音', '不明声音', '声音',
  '匿名', '匿名者', '无名者', '无名氏', '某人', '不明人士', '不明人物', '陌生人', '路人', '旁人',
  'crowd', 'chorus', 'everyone', 'all', 'broadcast', 'anonymous', 'unknown speaker', 'voice', 'offscreen voice',
]);

const genericRoleLabels = new Set([
  '宫女', '侍女', '侍卫', '卫兵', '士兵', '军士', '士卒', '使者', '内侍', '宦官', '仆人', '侍从', '门客',
  '官吏', '书吏', '文吏', '将领', '校尉', '店家', '掌柜', '伙计', '郎中', '医者', '百姓', '老者', '女子', '男子',
]);

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

function isNonIndividual(label: string): boolean {
  const normalized = normalizeLabel(label);
  return nonIndividualLabels.has(normalized) || genericRoleLabels.has(normalized);
}

function actorLabels(actor: {
  name: string;
  courtesyName?: string;
  artName?: string;
  aliases?: string[];
  commonAddress?: string;
}, includePlayerPronoun = false): string[] {
  return [...new Set([
    actor.name,
    actor.courtesyName,
    actor.artName,
    ...(actor.aliases ?? []),
    actor.commonAddress,
    ...(includePlayerPronoun ? ['你'] : []),
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function collectStableActors(state: RuntimeState): StableSpeakerActor[] {
  return [
    {
      actorId: state.player.id,
      identityKind: 'player' as const,
      labels: actorLabels(state.player, true),
      sex: state.player.sex,
    },
    ...(state.npcs ?? []).map((npc) => ({
      actorId: npc.npcId,
      identityKind: 'npc' as const,
      labels: actorLabels(npc),
      sex: npc.sex,
    })),
    ...state.knownActors.map((actor) => ({
      actorId: actor.id,
      identityKind: 'knownActor' as const,
      labels: actorLabels(actor),
      sex: actor.sex,
    })),
    ...(state.avgPresentation?.speakerActors ?? []).map((actor) => ({
      actorId: actor.actorId,
      identityKind: 'presentationActor' as const,
      labels: actor.labels,
      sex: actor.profileSnapshot.sex,
    })),
  ];
}

function hasPortraitSafeSex(actor: StableSpeakerActor): boolean {
  return actor.sex === '男' || actor.sex === '女' || actor.sex === 'male' || actor.sex === 'female';
}

export function freezeAvgSpeakerBindings(
  narrativeText: string,
  state: RuntimeState,
  speakerFacts: readonly PresentationSpeakerFact[] = [],
  existingBindings: readonly FrozenAvgSpeakerBinding[] = [],
): AvgSpeakerBindingResult {
  const actors = collectStableActors(state);
  const actorsById = new Map(actors.map((actor) => [actor.actorId, actor]));
  const factsBySegment = new Map(speakerFacts.map((fact) => [fact.segmentIndex, fact]));
  const existingBySegment = new Map(existingBindings.map((binding) => [binding.segmentIndex, binding]));
  const bindings: FrozenAvgSpeakerBinding[] = [];
  const diagnostics: string[] = [];

  parseNarrativeTextSegments(narrativeText).forEach((segment, segmentIndex) => {
    if (segment.type !== 'dialogue') return;
    const label = segment.speaker.trim();
    let actor: StableSpeakerActor | undefined;

    const existing = existingBySegment.get(segmentIndex);
    if (existing?.status === 'frozen' && existing.label.trim() === label && existing.actorId) {
      const candidate = actorsById.get(existing.actorId);
      if (candidate && candidate.identityKind === existing.identityKind && hasPortraitSafeSex(candidate)) actor = candidate;
    }

    if (!actor && !isNonIndividual(label)) {
      const fact = factsBySegment.get(segmentIndex);
      if (fact && fact.speakerLabel.trim() === label) {
        const candidate = actorsById.get(fact.speakerActorId);
        if (candidate && hasPortraitSafeSex(candidate)) actor = candidate;
      }
    }

    if (!actor && !isNonIndividual(label)) {
      const matches = actors.filter((candidate) => candidate.labels.includes(label));
      const uniqueIds = new Set(matches.map((candidate) => candidate.actorId));
      if (uniqueIds.size === 1 && hasPortraitSafeSex(matches[0])) actor = matches[0];
      if (uniqueIds.size > 1) diagnostics.push(`speaker-binding-ambiguous:segment:${segmentIndex}`);
    }

    if (actor) {
      bindings.push({
        segmentIndex,
        label,
        actorId: actor.actorId,
        identityKind: actor.identityKind,
        status: 'frozen',
        diagnosticCode: 'frozen-speaker',
      });
    } else {
      bindings.push({ segmentIndex, label, status: 'unbound', diagnosticCode: 'speaker-unbound' });
      diagnostics.push(`speaker-binding-${isNonIndividual(label) ? 'non-individual' : 'unresolved'}:segment:${segmentIndex}`);
    }
  });

  return { bindings, diagnostics: [...new Set(diagnostics)] };
}

import type { RuntimeState, TurnLogEntry } from '../types';
import type { PresentationSpeakerFact } from '../turn/MockNarrator';
import { parseNarrativeTextSegments } from '../../ui/narrativeTextSegments';

export interface AvgSpeakerRepairTarget {
  segmentIndex: number;
  speakerLabel: string;
  occurrence: number;
}

const PRESENTATION_PREFIX = 'avg-presentation:';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/u;
const nonIndividualLabels = new Set([
  '众人', '众声', '人群', '全体', '众将', '众将士', '众军士', '众士卒', '众臣', '群臣', '群雄', '众官',
  '众百姓', '百姓们', '将士们', '军士们', '士卒们', '侍从们', '仆从们', '门客们', '宾客们',
  '广播', '广播声', '传声', '传音', '喊声', '号令声', '场外声音', '远处声音', '不明声音', '声音',
  '匿名', '匿名者', '无名者', '无名氏', '某人', '不明人士', '不明人物', '陌生人', '路人', '旁人',
  '宫女', '侍女', '侍卫', '卫兵', '士兵', '军士', '士卒', '使者', '内侍', '宦官', '仆人', '侍从',
  '门客', '官吏', '书吏', '文吏', '将领', '校尉', '店家', '掌柜', '伙计', '郎中', '医者', '百姓',
  '老者', '女子', '男子', 'crowd', 'chorus', 'everyone', 'all', 'broadcast', 'anonymous', 'unknown speaker',
  'voice', 'offscreen voice',
].map((label) => label.toLowerCase()));

interface StableActor {
  actorId: string;
  source: PresentationSpeakerFact['identitySource'];
  labels: string[];
  sex?: 'male' | 'female';
}

function normalizedSex(value: string | undefined): 'male' | 'female' | undefined {
  if (value === '男' || value === 'male') return 'male';
  if (value === '女' || value === 'female') return 'female';
  return undefined;
}

function labels(actor: { name: string; courtesyName?: string; artName?: string; aliases?: string[]; commonAddress?: string }, player = false): string[] {
  return [...new Set([actor.name, actor.courtesyName, actor.artName, ...(actor.aliases ?? []), actor.commonAddress, ...(player ? ['你'] : [])]
    .map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function stableActors(state: RuntimeState): StableActor[] {
  return [
    { actorId: state.player.id, source: 'player', labels: labels(state.player, true), sex: normalizedSex(state.player.sex) },
    ...(state.npcs ?? []).map((actor) => ({ actorId: actor.npcId, source: 'full_npc' as const, labels: labels(actor), sex: normalizedSex(actor.sex) })),
    ...state.knownActors.map((actor) => ({ actorId: actor.id, source: 'known_actor' as const, labels: labels(actor), sex: normalizedSex(actor.sex) })),
    ...(state.avgPresentation?.speakerActors ?? []).map((actor) => ({ actorId: actor.actorId, source: 'presentation_only' as const, labels: actor.labels, sex: actor.profileSnapshot.sex })),
  ];
}

function identityKind(source: PresentationSpeakerFact['identitySource']): 'player' | 'npc' | 'knownActor' | 'presentationActor' {
  if (source === 'player') return 'player';
  if (source === 'full_npc') return 'npc';
  if (source === 'known_actor') return 'knownActor';
  return 'presentationActor';
}

type PersistedSpeakerBinding = NonNullable<NonNullable<TurnLogEntry['avgPresentation']>['speakerBindings']>[number];

function buildSpeakerBindings(state: RuntimeState, narrativeText: string, facts: readonly PresentationSpeakerFact[]): PersistedSpeakerBinding[] {
  const actors = stableActors(state);
  const factsBySegment = new Map(facts.map((fact) => [fact.segmentIndex, fact]));
  return parseNarrativeTextSegments(narrativeText).flatMap<PersistedSpeakerBinding>((segment, segmentIndex) => {
    if (segment.type !== 'dialogue') return [];
    const label = segment.speaker.trim();
    const fact = factsBySegment.get(segmentIndex);
    if (fact) return [{ segmentIndex, label, status: 'frozen' as const, actorId: fact.speakerActorId, identityKind: identityKind(fact.identitySource), diagnosticCode: 'frozen-speaker' as const }];
    const matches = actors.filter((actor) => actor.sex && actor.labels.includes(label));
    const ids = new Set(matches.map((actor) => actor.actorId));
    if (!nonIndividualLabels.has(label.toLowerCase()) && ids.size === 1) {
      const actor = matches[0];
      return [{ segmentIndex, label, status: 'frozen' as const, actorId: actor.actorId, identityKind: identityKind(actor.source), diagnosticCode: 'frozen-speaker' as const }];
    }
    return [{ segmentIndex, label, status: 'unbound' as const, diagnosticCode: 'speaker-unbound' as const }];
  });
}

function explicitSpeakers(narrativeText: string): AvgSpeakerRepairTarget[] {
  const occurrences = new Map<string, number>();
  return parseNarrativeTextSegments(narrativeText).flatMap((segment, segmentIndex) => {
    if (segment.type !== 'dialogue' || segment.speakerSource !== 'explicit') return [];
    const speakerLabel = segment.speaker.trim();
    if (!speakerLabel || nonIndividualLabels.has(speakerLabel.toLowerCase())) return [];
    const occurrence = occurrences.get(speakerLabel) ?? 0;
    occurrences.set(speakerLabel, occurrence + 1);
    return [{ segmentIndex, speakerLabel, occurrence }];
  });
}

function acceptFact(state: RuntimeState, narrativeText: string, fact: PresentationSpeakerFact): PresentationSpeakerFact | undefined {
  const segment = parseNarrativeTextSegments(narrativeText)[fact.segmentIndex];
  if (segment?.type !== 'dialogue' || segment.speakerSource !== 'explicit' || segment.speaker.trim() !== fact.speakerLabel.trim()) return undefined;
  if (nonIndividualLabels.has(fact.speakerLabel.trim().toLowerCase())) return undefined;
  if (!SAFE_ID.test(fact.speakerActorId)) return undefined;
  if (fact.identitySource === 'presentation_only') {
    if (!fact.speakerActorId.startsWith(PRESENTATION_PREFIX) || (fact.sex !== 'male' && fact.sex !== 'female')) return undefined;
    const existing = state.avgPresentation?.speakerActors?.find((actor) => actor.actorId === fact.speakerActorId);
    if (existing && (
      existing.profileSnapshot.sex !== fact.sex
      || (existing.profileSnapshot.ageBand ?? '') !== (fact.ageBand ?? '')
      || (existing.profileSnapshot.roleFamily ?? '') !== (fact.roleFamily ?? '')
      || JSON.stringify(existing.profileSnapshot.professionTags ?? []) !== JSON.stringify(fact.professionTags ?? [])
      || JSON.stringify(existing.profileSnapshot.socialTierTags ?? []) !== JSON.stringify(fact.socialTierTags ?? [])
    )) return undefined;
    return fact;
  }
  const actor = stableActors(state).find((candidate) => candidate.actorId === fact.speakerActorId);
  return actor && actor.source === fact.identitySource && actor.labels.includes(fact.speakerLabel.trim())
    && actor.sex && actor.sex === fact.sex ? fact : undefined;
}

export function validateAvgSpeakerFacts(state: RuntimeState, narrativeText: string, facts: readonly PresentationSpeakerFact[] | undefined): PresentationSpeakerFact[] {
  const accepted: PresentationSpeakerFact[] = [];
  const segmentKeys = new Set<string>();
  const profiles = new Map<string, string>();
  for (const raw of facts ?? []) {
    const fact = acceptFact(state, narrativeText, raw);
    if (!fact) continue;
    const segmentKey = `${fact.segmentIndex}:${fact.speakerLabel.trim()}`;
    const profile = JSON.stringify({ label: fact.speakerLabel.trim(), sex: fact.sex, ageBand: fact.ageBand, roleFamily: fact.roleFamily, professionTags: fact.professionTags ?? [], socialTierTags: fact.socialTierTags ?? [] });
    if (segmentKeys.has(segmentKey) || (profiles.has(fact.speakerActorId) && profiles.get(fact.speakerActorId) !== profile)) continue;
    segmentKeys.add(segmentKey);
    profiles.set(fact.speakerActorId, profile);
    accepted.push({ ...fact, speakerLabel: fact.speakerLabel.trim() });
  }
  return accepted.sort((left, right) => left.segmentIndex - right.segmentIndex);
}

export function buildAvgSpeakerRepairTargets(state: RuntimeState, narrativeText: string, facts: readonly PresentationSpeakerFact[] | undefined): AvgSpeakerRepairTarget[] {
  const actors = stableActors(state);
  const acceptedBySegment = new Map(validateAvgSpeakerFacts(state, narrativeText, facts).map((fact) => [fact.segmentIndex, fact]));
  return explicitSpeakers(narrativeText).filter((target) => {
    if (acceptedBySegment.has(target.segmentIndex)) return false;
    const matches = new Set(actors.filter((actor) => actor.sex && actor.labels.includes(target.speakerLabel)).map((actor) => actor.actorId));
    return matches.size === 0;
  });
}

export function mergeAvgSpeakerRepairFacts(state: RuntimeState, narrativeText: string, original: readonly PresentationSpeakerFact[] | undefined, repaired: readonly PresentationSpeakerFact[] | undefined, targets: readonly AvgSpeakerRepairTarget[]): PresentationSpeakerFact[] {
  const allowed = new Set(targets.map((target) => `${target.segmentIndex}:${target.speakerLabel}`));
  const candidates = (repaired ?? []).filter((fact) => fact.identitySource === 'presentation_only' && allowed.has(`${fact.segmentIndex}:${fact.speakerLabel.trim()}`));
  return validateAvgSpeakerFacts(state, narrativeText, [...(original ?? []), ...candidates]);
}

export function materializeAvgSpeakerFacts(state: RuntimeState, turnNumber: number, facts: readonly PresentationSpeakerFact[] | undefined): RuntimeState {
  const turnIndex = state.turnLog.findIndex((turn) => turn.turnNumber === turnNumber);
  if (turnIndex < 0) return state;
  const turn = state.turnLog[turnIndex];
  const narrativeText = turn.fullNarrativeText ?? turn.narrativeText;
  const accepted = validateAvgSpeakerFacts(state, narrativeText, facts);
  const next = structuredClone(state);
  const nextTurn = next.turnLog[turnIndex];
  nextTurn.displayMeta = { ...nextTurn.displayMeta, presentationSpeakerFacts: accepted };
  const actors = next.avgPresentation?.speakerActors ?? [];
  for (const fact of accepted.filter((item) => item.identitySource === 'presentation_only' && (item.sex === 'male' || item.sex === 'female'))) {
    const existing = actors.find((actor) => actor.actorId === fact.speakerActorId);
    if (existing) {
      existing.labels = [...new Set([...existing.labels, fact.speakerLabel])];
      existing.lastSeenTurnNumber = turnNumber;
    } else actors.push({ actorId: fact.speakerActorId, identitySource: 'presentation_only', labels: [fact.speakerLabel], profileSnapshot: { sex: fact.sex as 'male' | 'female', ...(fact.ageBand ? { ageBand: fact.ageBand } : {}), ...(fact.roleFamily ? { roleFamily: fact.roleFamily } : {}), professionTags: fact.professionTags ?? [], socialTierTags: fact.socialTierTags ?? [] }, firstSeenTurnNumber: turnNumber, lastSeenTurnNumber: turnNumber });
  }
  next.avgPresentation = { ...next.avgPresentation, speakerActors: actors };
  nextTurn.avgPresentation = {
    ...nextTurn.avgPresentation,
    speakerFacts: accepted.map((fact) => ({ ...fact, validationStatus: 'accepted' as const })),
    speakerBindings: buildSpeakerBindings(next, narrativeText, accepted),
  };
  return next;
}

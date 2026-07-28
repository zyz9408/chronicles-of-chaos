import type {
  RuntimeState,
  HistoricalAnchorApplicabilityDisposition,
  WorldlineKnowledgeBase,
  WorldlineKnowledgeCard,
  WorldlineKnowledgeMode,
  WorldlineProjectionHint,
  WorldlineStoryPack,
  WorldlineStoryThread,
} from '../types';
import { isNpcPhysicallyPresent } from '../state/npcPresence';
import { isOpenCurrentMatter } from '../state/currentMatterLifecycle';
import { isWorldChronicleEligible } from '../state/worldChroniclePolicy';
import {
  evaluateHistoricalAnchorApplicability,
  type HistoricalAnchorApplicabilityResult,
} from './HistoricalAnchorApplicability';

export interface BuildWorldlineKnowledgeProjectionInput {
  state: RuntimeState;
  knowledgeBase?: WorldlineKnowledgeBase;
  storyPacks: WorldlineStoryPack[];
  mode: WorldlineKnowledgeMode;
  queryTexts?: string[];
}

export interface WorldlineKnowledgeProjection {
  hints: WorldlineProjectionHint[];
  text: string;
}

interface ScoredWorldlineHint {
  hint: WorldlineProjectionHint;
  score: number;
  sortId: string;
  selectionId: string;
  diversityId?: string;
  matchedNpcNames: string[];
}

type ProjectionRole = 'eraBaseline' | 'contextual';

interface WorldlineProjectionContext {
  worldBookId: string;
  presentNpcNames: Set<string>;
  activeTexts: string[];
  exactTags: Set<string>;
  placeIds: Set<string>;
  factionIds: Set<string>;
  currentYear?: number;
  mode: WorldlineKnowledgeMode;
}

interface ProjectionRelevance {
  role: ProjectionRole;
  score: number;
  reasons: string[];
  matchedNpcNames: string[];
}

export const KNOWLEDGE_BASE_MODE_LIMIT: Record<WorldlineKnowledgeMode, number> = {
  off: 0,
  light: 2,
  default: 4,
  strict: 6,
};

export const STORY_PACK_MODE_LIMIT: Record<WorldlineKnowledgeMode, number> = {
  off: 0,
  light: 2,
  default: 4,
  strict: 6,
};

export const STORY_PACK_CHARACTER_BUDGET: Record<WorldlineKnowledgeMode, number> = {
  off: 0,
  light: 2400,
  default: 4800,
  strict: 7200,
};

const IMPORTANCE_SCORE: Record<WorldlineKnowledgeCard['importance'], number> = {
  minor: 1,
  normal: 2,
  major: 3,
  critical: 5,
};

export function buildWorldlineKnowledgeProjection(
  input: BuildWorldlineKnowledgeProjectionInput,
): WorldlineKnowledgeProjection {
  if (input.mode === 'off') {
    return { hints: [], text: '' };
  }

  const context = buildProjectionContext(input.state, input.mode, input.queryTexts);

  const knowledgeHints = selectScoredWorldlineHints(
    sortScoredHints(scoreKnowledgeCards(input.knowledgeBase, context, input.state)),
    context,
    KNOWLEDGE_BASE_MODE_LIMIT[input.mode],
  );
  const storyPackHints = selectStoryPackHintsWithinCharacterBudget(
    selectScoredWorldlineHints(
      sortScoredHints(scoreStoryPackThreads(input.storyPacks, context)),
      context,
      STORY_PACK_MODE_LIMIT[input.mode],
    ),
    STORY_PACK_CHARACTER_BUDGET[input.mode],
  );
  const scoredHints = [...knowledgeHints, ...storyPackHints];
  const hints = scoredHints.map(({ hint }) => hint);

  return {
    hints,
    text: formatWorldlineKnowledgeProjectionText(hints),
  };
}

function sortScoredHints(hints: ScoredWorldlineHint[]): ScoredWorldlineHint[] {
  return hints
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.sortId.localeCompare(right.sortId);
    });
}

function selectStoryPackHintsWithinCharacterBudget(
  hints: ScoredWorldlineHint[],
  characterBudget: number,
): ScoredWorldlineHint[] {
  if (characterBudget <= 0) return [];
  const selected: ScoredWorldlineHint[] = [];
  let usedCharacters = 0;

  for (const hint of hints) {
    const nextCharacters = hint.hint.text.length;
    if (usedCharacters + nextCharacters > characterBudget) continue;
    selected.push(hint);
    usedCharacters += nextCharacters;
  }

  return selected;
}

function selectScoredWorldlineHints(
  sortedHints: ScoredWorldlineHint[],
  context: WorldlineProjectionContext,
  limit: number,
): ScoredWorldlineHint[] {
  if (limit <= 0) return [];

  const selectedIds = new Set<string>();
  const selectedDiversityIds = new Set<string>();
  const reservedNpcSlots = Math.min(context.presentNpcNames.size, Math.max(1, Math.floor(limit / 2)));
  const canSelect = (candidate: ScoredWorldlineHint): boolean => (
    !selectedIds.has(candidate.selectionId)
    && (
      !candidate.diversityId
      || !selectedDiversityIds.has(candidate.diversityId)
    )
  );
  const select = (candidate: ScoredWorldlineHint): void => {
    selectedIds.add(candidate.selectionId);
    if (candidate.diversityId) selectedDiversityIds.add(candidate.diversityId);
  };

  for (const presentNpcName of context.presentNpcNames) {
    if (selectedIds.size >= reservedNpcSlots) break;

    const candidate = sortedHints.find((entry) => (
      canSelect(entry)
      && entry.matchedNpcNames.some((matchedName) => normalizeTerm(matchedName) === normalizeTerm(presentNpcName))
    ));
    if (candidate) select(candidate);
  }

  for (const candidate of sortedHints) {
    if (selectedIds.size >= limit) break;
    if (canSelect(candidate)) select(candidate);
  }

  return sortedHints.filter((candidate) => selectedIds.has(candidate.selectionId)).slice(0, limit);
}

function buildProjectionContext(
  state: RuntimeState,
  mode: WorldlineKnowledgeMode,
  queryTexts: string[] | undefined,
): WorldlineProjectionContext {
  return {
    worldBookId: state.worldBookId,
    presentNpcNames: collectPresentNpcNames(state),
    activeTexts: [
      ...collectActiveTexts(state),
      ...(queryTexts ?? []).map((text) => text.trim()).filter(Boolean),
    ],
    exactTags: collectExactTags(state),
    placeIds: collectRelevantPlaceIds(state),
    factionIds: collectRelevantFactionIds(state),
    currentYear: extractYear(state.currentDate),
    mode,
  };
}

function scoreKnowledgeCards(
  knowledgeBase: WorldlineKnowledgeBase | undefined,
  context: WorldlineProjectionContext,
  state: RuntimeState,
): ScoredWorldlineHint[] {
  if (!knowledgeBase) return [];

  return knowledgeBase.cards
    .filter((card) => card.worldBookId === context.worldBookId)
    .filter((card) => isCardAllowedByMode(card, context.mode))
    .flatMap((card) => {
      const applicability = evaluateHistoricalAnchorApplicability(card, state);
      const explicitlyReferenced = isCardExplicitlyReferencedForTimeBypass(card, context.activeTexts);
      if (applicability && !applicability.eligible && !explicitlyReferenced) return [];
      if (
        !card.historicalEvent
        && !isCardRelevantForCurrentTime(card, context.currentYear, context.activeTexts)
      ) return [];

      const relevance = evaluateKnowledgeCardRelevance(card, context);
      if (!relevance) return [];

      return [{
        hint: knowledgeCardToHint(card, relevance, applicability),
        score: scoreKnowledgeCard(card, relevance),
        sortId: card.id,
        selectionId: `card:${card.id}`,
        matchedNpcNames: relevance.matchedNpcNames,
      }];
    });
}

function scoreStoryPackThreads(
  storyPacks: WorldlineStoryPack[],
  context: WorldlineProjectionContext,
): ScoredWorldlineHint[] {
  return storyPacks.flatMap((storyPack) => storyPack.threads
    .filter((thread) => thread.worldBookId === context.worldBookId)
    .flatMap((thread) => {
      if (!isStoryThreadRelevantForCurrentTime(thread, context.currentYear, context.activeTexts)) return [];

      const relevance = evaluateStoryThreadRelevance(thread, context);
      if (!relevance) return [];

      return {
        hint: storyThreadToHint(thread, storyPack, relevance),
        score: scoreStoryThread(relevance),
        sortId: thread.id,
        selectionId: `thread:${thread.id}`,
        diversityId: thread.domain && thread.motifId
          ? `story-motif:${thread.domain}/${thread.motifId}`
          : undefined,
        matchedNpcNames: relevance.matchedNpcNames,
      };
    }));
}

function isCardAllowedByMode(card: WorldlineKnowledgeCard, mode: WorldlineKnowledgeMode): boolean {
  if (mode === 'light') return card.strictness === 'light';
  if (mode === 'default') return card.strictness === 'light' || card.strictness === 'default';
  if (mode === 'strict') return true;
  return false;
}

function isCardRelevantForCurrentTime(
  card: WorldlineKnowledgeCard,
  currentYear: number | undefined,
  activeTexts: string[],
): boolean {
  if (!currentYear || !card.timeRange) return true;

  const startYear = extractYear(card.timeRange.start);
  const endYear = extractYear(card.timeRange.end);
  const startsAfterCurrentYear = startYear !== undefined && currentYear < startYear;
  const endedBeforeCurrentYear = endYear !== undefined && currentYear > endYear;

  if (!startsAfterCurrentYear && !endedBeforeCurrentYear) return true;

  return isCardExplicitlyReferencedForTimeBypass(card, activeTexts);
}

function isStoryThreadRelevantForCurrentTime(
  thread: WorldlineStoryThread,
  currentYear: number | undefined,
  activeTexts: string[],
): boolean {
  if (!currentYear || !thread.timeRange) return true;

  const startYear = extractYear(thread.timeRange.start);
  const endYear = extractYear(thread.timeRange.end);
  const startsAfterCurrentYear = startYear !== undefined && currentYear < startYear;
  const endedBeforeCurrentYear = endYear !== undefined && currentYear > endYear;

  if (!startsAfterCurrentYear && !endedBeforeCurrentYear) return true;

  return isStoryThreadExplicitlyReferencedForTimeBypass(thread, activeTexts);
}

function isCardExplicitlyReferencedForTimeBypass(
  card: WorldlineKnowledgeCard,
  activeTexts: string[],
): boolean {
  const normalizedTexts = activeTexts.map(normalizeTerm).filter(Boolean);
  if (!normalizedTexts.length) return false;

  const titleTerm = normalizeTerm(card.title);
  if (titleTerm.length >= 2 && normalizedTexts.some((text) => text.includes(titleTerm))) {
    return true;
  }

  const tagTerms = (card.relatedTags ?? [])
    .map(normalizeTerm)
    .filter((term) => term.length >= 2);

  return tagTerms.some((term) => normalizedTexts.some((text) => text === term));
}

function isStoryThreadExplicitlyReferencedForTimeBypass(
  thread: WorldlineStoryThread,
  activeTexts: string[],
): boolean {
  const normalizedTexts = activeTexts.map(normalizeTerm).filter(Boolean);
  if (!normalizedTexts.length) return false;

  const titleTerm = normalizeTerm(thread.title);
  if (titleTerm.length >= 2 && normalizedTexts.some((text) => text.includes(titleTerm))) {
    return true;
  }

  const tagTerms = (thread.relatedTags ?? [])
    .map(normalizeTerm)
    .filter((term) => term.length >= 2);

  const entrySignalTerms = (thread.entrySignals ?? [])
    .map(normalizeTerm)
    .filter((term) => term.length >= 2);

  return [...tagTerms, ...entrySignalTerms]
    .some((term) => normalizedTexts.some((text) => text === term));
}

function evaluateKnowledgeCardRelevance(
  card: WorldlineKnowledgeCard,
  context: WorldlineProjectionContext,
): ProjectionRelevance | undefined {
  const role: ProjectionRole = card.kind === 'eraAnchor' ? 'eraBaseline' : 'contextual';
  const contextual = collectContextualRelevance(
    {
      title: card.title,
      relatedNpcNames: card.relatedNpcNames,
      relatedPlaceIds: card.relatedPlaceIds,
      relatedFactionIds: card.relatedFactionIds,
      relatedTags: card.relatedTags,
    },
    context,
  );

  if (role === 'eraBaseline') {
    const reasons = [`year=${context.currentYear ?? 'unknown'}`, ...contextual.reasons];
    return {
      role,
      reasons,
      score: 12 + contextual.score,
      matchedNpcNames: contextual.matchedNpcNames,
    };
  }

  if (!contextual.reasons.length) return undefined;

  return {
    role,
    reasons: contextual.reasons,
    score: contextual.score,
    matchedNpcNames: contextual.matchedNpcNames,
  };
}

function evaluateStoryThreadRelevance(
  thread: WorldlineStoryThread,
  context: WorldlineProjectionContext,
): ProjectionRelevance | undefined {
  const contextual = collectContextualRelevance(
    {
      title: thread.title,
      relatedNpcNames: thread.relatedNpcNames,
      relatedPlaceIds: thread.relatedPlaceIds,
      relatedFactionIds: thread.relatedFactionIds,
      relatedTags: thread.relatedTags,
      entrySignals: thread.entrySignals,
    },
    context,
  );

  if (!contextual.reasons.length) return undefined;

  return {
    role: 'contextual',
    reasons: contextual.reasons,
    score: contextual.score,
    matchedNpcNames: contextual.matchedNpcNames,
  };
}

function collectContextualRelevance(
  entry: {
    title: string;
    relatedNpcNames?: string[];
    relatedPlaceIds?: string[];
    relatedFactionIds?: string[];
    relatedTags?: string[];
    entrySignals?: string[];
  },
  context: WorldlineProjectionContext,
): { score: number; reasons: string[]; matchedNpcNames: string[] } {
  const reasons: string[] = [];
  const matchedNpcNames: string[] = [];
  let score = 0;

  if (isTermMentioned(entry.title, context.activeTexts)) {
    reasons.push(`title=${entry.title}`);
    score += 60;
  }

  const presentNpcMatches = (entry.relatedNpcNames ?? [])
    .filter((name) => hasSetValue(context.presentNpcNames, name));
  const npcMatch = presentNpcMatches[0] ?? findMentionedTerm(entry.relatedNpcNames, context.activeTexts);
  if (npcMatch) {
    reasons.push(`npc=${npcMatch}`);
    matchedNpcNames.push(...presentNpcMatches);
    score += 40;
  }

  const placeMatch = findSetMatch(entry.relatedPlaceIds, context.placeIds);
  if (placeMatch) {
    reasons.push(`place=${placeMatch}`);
    score += 32;
  }

  const factionMatch = findSetMatch(entry.relatedFactionIds, context.factionIds);
  if (factionMatch) {
    reasons.push(`faction=${factionMatch}`);
    score += 28;
  }

  const exactTagMatch = findSetMatch(entry.relatedTags, context.exactTags);
  if (exactTagMatch) {
    reasons.push(`tag=${exactTagMatch}`);
    score += 60;
  } else {
    const textTagMatch = findMentionedTerm(entry.relatedTags, context.activeTexts);
    if (textTagMatch) {
      reasons.push(`tagRef=${textTagMatch}`);
      score += 36;
    }
  }

  const exactEntrySignal = findSetMatch(entry.entrySignals, context.exactTags);
  if (exactEntrySignal) {
    reasons.push(`entrySignal=${exactEntrySignal}`);
    score += 72;
  } else {
    const textEntrySignal = findMentionedTerm(entry.entrySignals, context.activeTexts);
    if (textEntrySignal) {
      reasons.push(`entrySignalRef=${textEntrySignal}`);
      score += 44;
    }
  }

  return { score, reasons, matchedNpcNames };
}

function findSetMatch(values: string[] | undefined, candidates: Set<string>): string | undefined {
  return (values ?? []).find((value) => hasSetValue(candidates, value));
}

function findMentionedTerm(values: string[] | undefined, activeTexts: string[]): string | undefined {
  return (values ?? []).find((value) => isTermMentioned(value, activeTexts));
}

function hasSetValue(candidates: Set<string>, value: string | undefined): boolean {
  const normalizedValue = normalizeTerm(value);
  if (!normalizedValue) return false;
  return Array.from(candidates).some((candidate) => normalizeTerm(candidate) === normalizedValue);
}

function isTermMentioned(term: string | undefined, activeTexts: string[]): boolean {
  const normalizedTerm = normalizeTerm(term);
  if (normalizedTerm.length < 2) return false;
  return activeTexts.some((text) => normalizeTerm(text).includes(normalizedTerm));
}

function extractYear(value?: string): number | undefined {
  if (!value) return undefined;
  const match = value.match(/(?:公元)?\s*(\d{2,4})\s*年/);
  if (!match) return undefined;
  const year = Number.parseInt(match[1], 10);
  return Number.isFinite(year) ? year : undefined;
}

function normalizeTerm(value?: string): string {
  return value?.trim().toLowerCase() ?? '';
}

function scoreKnowledgeCard(
  card: WorldlineKnowledgeCard,
  relevance: ProjectionRelevance,
): number {
  return relevance.score + IMPORTANCE_SCORE[card.importance];
}

function scoreStoryThread(relevance: ProjectionRelevance): number {
  return relevance.score + IMPORTANCE_SCORE.normal;
}

function knowledgeCardToHint(
  card: WorldlineKnowledgeCard,
  relevance: ProjectionRelevance,
  applicability?: HistoricalAnchorApplicabilityResult,
): WorldlineProjectionHint {
  return {
    id: card.id,
    ...(card.historicalAnchorId ? { historicalAnchorId: card.historicalAnchorId } : {}),
    sourceType: 'knowledgeBase',
    title: card.title,
    text: formatKnowledgeCardText(card, applicability),
    importance: card.importance,
    strictness: card.strictness,
    reason: formatKnowledgeCardReason(card, relevance, applicability),
    ...(applicability ? { applicability: applicability.disposition } : {}),
  };
}

function storyThreadToHint(
  thread: WorldlineStoryThread,
  storyPack: WorldlineStoryPack,
  relevance: ProjectionRelevance,
): WorldlineProjectionHint {
  const sourceRef = thread.sourceRef ?? {
    providerId: storyPack.id,
    sourceType: 'storyThread' as const,
    sourceId: thread.id,
  };
  return {
    id: thread.id,
    sourceRef,
    sourceType: 'storyPack',
    title: thread.title,
    text: formatStoryThreadText(thread, storyPack),
    importance: 'normal',
    strictness: 'default',
    reason: formatStoryThreadReason(thread, storyPack, relevance),
  };
}

function formatKnowledgeCardText(
  card: WorldlineKnowledgeCard,
  applicability?: HistoricalAnchorApplicabilityResult,
): string {
  const parts = [card.summary];
  if (applicability) {
    parts.push(`历史适用性：${formatApplicabilityBoundary(applicability.disposition)}`);
  }
  if (
    card.historicalEvent?.structuralPressure
    && applicability
    && ['delayed_candidate', 'transformed_candidate'].includes(applicability.disposition)
  ) {
    parts.push(`仍存结构压力：${card.historicalEvent.structuralPressure}`);
  }
  if (card.contradictionHint) {
    parts.push(`边界：${card.contradictionHint}`);
  }
  if (card.sourceLabel) {
    parts.push(`来源：${card.sourceLabel}`);
  }
  return parts.join(' ');
}

function formatStoryThreadText(thread: WorldlineStoryThread, storyPack: WorldlineStoryPack): string {
  return [
    thread.summary,
    thread.kind ? `类型：${thread.kind}` : '',
    thread.domain ? `领域：${thread.domain}/${thread.subdomain ?? 'unspecified'}` : '',
    thread.facet ? `切面：${thread.facet}` : '',
    thread.escalationShapes?.length ? `升级形态：${thread.escalationShapes.join('；')}` : '',
    `边界：${thread.usageBoundary}`,
    `来源：${storyPack.name}`,
  ].filter(Boolean).join(' ');
}

function formatKnowledgeCardReason(
  card: WorldlineKnowledgeCard,
  relevance: ProjectionRelevance,
  applicability?: HistoricalAnchorApplicabilityResult,
): string {
  const reasons = [
    `role=${relevance.role}`,
    `relevance=${relevance.reasons.join('/')}`,
    `importance=${card.importance}`,
    `strictness=${card.strictness}`,
    ...(applicability
      ? [
          `applicability=${applicability.disposition}`,
          `applicabilityReason=${applicability.reasons.join('/')}`,
        ]
      : []),
  ];
  return reasons.join('; ');
}

function formatApplicabilityBoundary(
  disposition: HistoricalAnchorApplicabilityDisposition,
): string {
  if (disposition === 'not_yet') return '尚未进入可用时间窗，只能作为明确提及的未来背景。';
  if (disposition === 'baseline_possible') return '前置事实未见冲突，但不代表必然发生。';
  if (disposition === 'delayed_candidate') return '常见时点已经偏移，只能结合本局事实判断是否延后发生，不代表必然发生。';
  if (disposition === 'transformed_candidate') {
    return '原史实前置已经偏转，只能借用结构压力生成本局版本，不得换名复演原事件。';
  }
  if (disposition === 'diverged') return '本局已确认偏转，不得按原史实发生。';
  if (disposition === 'realized') return '本局已发生原事件或等价结果，只能作为既成历史引用，不得重演。';
  return '正常发生窗口已经结束，只能作为历史背景引用。';
}

function formatStoryThreadReason(
  thread: WorldlineStoryThread,
  storyPack: WorldlineStoryPack,
  relevance: ProjectionRelevance,
): string {
  const reasons = [
    `role=${relevance.role}`,
    `relevance=${relevance.reasons.join('/')}`,
    `storyPack=${storyPack.id}`,
    `sourceRef=${thread.sourceRef?.providerId ?? storyPack.id}/storyThread/${thread.sourceRef?.sourceId ?? thread.id}`,
    ...(thread.kind ? [`kind=${thread.kind}`] : []),
    ...(thread.domain ? [`domain=${thread.domain}`] : []),
    ...(thread.subdomain ? [`subdomain=${thread.subdomain}`] : []),
    ...(thread.motifId ? [`motif=${thread.motifId}`] : []),
    ...(thread.facet ? [`facet=${thread.facet}`] : []),
    ...(thread.reusePolicy ? [`reuse=${thread.reusePolicy}`] : []),
    ...(thread.cooldownTurns !== undefined ? [`cooldown=${thread.cooldownTurns}`] : []),
    'importance=normal',
    'strictness=default',
  ];
  return reasons.join('; ');
}

function formatWorldlineKnowledgeProjectionText(hints: WorldlineProjectionHint[]): string {
  if (!hints.length) return '';

  return [
    'Worldline Knowledge / 世界线资料提示',
    ...hints.map(
      (hint) =>
        `- ${hint.title} (${hint.sourceType}; ${hint.importance}; ${hint.strictness}): ${hint.text}`,
    ),
  ].join('\n');
}

function collectPresentNpcNames(state: RuntimeState): Set<string> {
  return new Set(
    (state.npcs ?? [])
      .filter((npc) => isNpcPhysicallyPresent(state, npc) || npc.isFocused)
      .map((npc) => npc.name?.trim())
      .filter((name): name is string => Boolean(name)),
  );
}

function collectExactTags(state: RuntimeState): Set<string> {
  const tags = [
    ...(state.activeQuests ?? []).filter(isOpenCurrentMatter).flatMap((quest) => quest.consequenceTags ?? []),
    ...(state.knownRumors ?? []).flatMap((rumor) => rumor.consequenceTags ?? []),
    ...(state.worldTrends ?? []).filter(isWorldChronicleEligible).flatMap((trend) => trend.consequenceTags ?? []),
  ];

  return new Set(tags.map((tag) => tag?.trim()).filter((tag): tag is string => Boolean(tag)));
}

function collectRelevantPlaceIds(state: RuntimeState): Set<string> {
  const placeIds = new Set<string>();
  addValues(placeIds, [state.currentLocationId, state.currentPlaceId, state.currentSceneId]);

  (state.activeQuests ?? []).filter(isOpenCurrentMatter).forEach((quest) => {
    addValues(placeIds, [
      quest.targetLocationId,
      ...(quest.relatedLocationIds ?? []),
      ...(quest.affectedPlaceIds ?? []),
    ]);
  });

  (state.knownRumors ?? []).forEach((rumor) => {
    addValues(placeIds, [
      rumor.relatedRegionId,
      ...(rumor.relatedLocationIds ?? []),
      ...(rumor.affectedPlaceIds ?? []),
    ]);
  });

  (state.worldTrends ?? []).filter(isWorldChronicleEligible).forEach((trend) => {
    addValues(placeIds, [
      trend.locationId,
      ...(trend.relatedPlaceIds ?? []),
      ...(trend.affectedPlaceIds ?? []),
    ]);
  });

  (state.turnEvents ?? []).forEach((event) => {
    addValues(placeIds, [event.locationId]);
  });

  return placeIds;
}

function collectRelevantFactionIds(state: RuntimeState): Set<string> {
  const factionIds = new Set<string>();
  addValues(factionIds, [state.player?.factionId, ...(state.knownFactions ?? [])]);

  (state.npcs ?? [])
    .filter((npc) => isNpcPhysicallyPresent(state, npc) || npc.isFocused)
    .forEach((npc) => {
      addValues(factionIds, [npc.factionId]);
    });

  (state.activeQuests ?? []).filter(isOpenCurrentMatter).forEach((quest) => {
    addValues(factionIds, [
      ...(quest.relatedFactionIds ?? []),
      ...(quest.affectedFactionIds ?? []),
    ]);
  });

  (state.knownRumors ?? []).forEach((rumor) => {
    addValues(factionIds, [
      rumor.relatedFactionId,
      ...(rumor.affectedFactionIds ?? []),
    ]);
  });

  (state.worldTrends ?? []).filter(isWorldChronicleEligible).forEach((trend) => {
    addValues(factionIds, [
      ...(trend.relatedFactionIds ?? []),
      ...(trend.affectedFactionIds ?? []),
    ]);
  });

  return factionIds;
}

function addValues(target: Set<string>, values: Array<string | undefined>): void {
  values.forEach((value) => {
    const normalized = value?.trim();
    if (normalized) target.add(normalized);
  });
}

function collectActiveTexts(state: RuntimeState): string[] {
  const texts = [
    ...(state.activeQuests ?? []).filter(isOpenCurrentMatter).flatMap((quest) => [
      quest.title,
      quest.description,
      quest.source,
      quest.currentStep,
      quest.stakes,
      quest.outcomeSummary,
      ...(quest.followUpHooks ?? []),
      ...(quest.consequenceTags ?? []),
    ]),
    ...(state.knownRumors ?? []).flatMap((rumor) => [
      rumor.title,
      rumor.content,
      rumor.source,
      rumor.potentialOutcomeSummary,
      ...(rumor.followUpHooks ?? []),
      ...(rumor.consequenceTags ?? []),
    ]),
    ...(state.worldTrends ?? []).filter(isWorldChronicleEligible).flatMap((trend) => [
      trend.title,
      trend.summary,
      trend.source,
      trend.outcomeSummary,
      ...(trend.followUpHooks ?? []),
      ...(trend.consequenceTags ?? []),
    ]),
    ...(state.turnEvents ?? []).map((event) => event.summary),
  ];

  return texts.map((text) => text?.trim()).filter((text): text is string => Boolean(text));
}

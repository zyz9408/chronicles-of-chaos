import type {
  HistoricalAnchorApplicabilityDisposition,
  HistoricalAnchorStateEntry,
  HistoricalFactRef,
  RuntimeState,
  WorldlineKnowledgeCard,
  WorldTrendEntry,
} from '../types';

export interface HistoricalAnchorApplicabilityResult {
  disposition: HistoricalAnchorApplicabilityDisposition;
  eligible: boolean;
  reasons: string[];
}

type FactEvaluation = 'satisfied' | 'contradicted' | 'unknown';

const TERMINAL_DISPOSITIONS = new Set<HistoricalAnchorStateEntry['disposition']>([
  'diverged',
  'realized',
  'expired',
]);

const WORLDLINE_OUTCOME_TAG = /^worldline:(realized|diverged):(.+)$/;

export function evaluateHistoricalAnchorApplicability(
  card: WorldlineKnowledgeCard,
  state: RuntimeState,
): HistoricalAnchorApplicabilityResult | undefined {
  const terminal = normalizeHistoricalAnchorStates(
    state.worldlineAnchorStates,
    state.worldTrends,
    state.currentDate,
  ).find((entry) => (
    entry.cardId === card.id
    || (card.historicalAnchorId && entry.cardId === card.historicalAnchorId)
  ));
  if (terminal) {
    return {
      disposition: terminal.disposition,
      eligible: false,
      reasons: [
        `ledger=${terminal.disposition}`,
        ...terminal.factRefs.map((factRef) => `fact=${factRef}`),
      ],
    };
  }

  const applicability = card.historicalEvent;
  if (!applicability) return undefined;

  const prerequisiteResults = (applicability.hardPrerequisites ?? [])
    .map((factRef) => ({
      factRef,
      result: evaluateHistoricalFactRef(factRef, state),
    }));
  const contradicted = prerequisiteResults.filter((entry) => entry.result === 'contradicted');
  const unknown = prerequisiteResults.filter((entry) => entry.result === 'unknown');

  if (contradicted.length > 0) {
    const reasons = contradicted.map((entry) => `contradicted=${formatHistoricalFactRef(entry.factRef)}`);
    if (applicability.divergencePolicy.mayTransform && applicability.structuralPressure?.trim()) {
      return {
        disposition: 'transformed_candidate',
        eligible: true,
        reasons,
      };
    }
    if (applicability.divergencePolicy.suppressWhenContradicted) {
      return {
        disposition: 'diverged',
        eligible: false,
        reasons,
      };
    }
  }

  const currentYear = extractYear(state.currentDate);
  const earliestYear = extractYear(applicability.historicalWindow.earliest);
  const typicalYear = extractYear(applicability.historicalWindow.typical) ?? earliestYear;
  const latestYear = extractYear(applicability.historicalWindow.latest) ?? typicalYear;
  const afterlifeYear = extractYear(applicability.historicalWindow.afterlifeUntil);
  const evidenceReasons = [
    ...(unknown.length > 0 ? [`unknownPrerequisites=${unknown.length}`] : []),
    ...(currentYear !== undefined ? [`year=${currentYear}`] : []),
  ];

  if (currentYear !== undefined && earliestYear !== undefined && currentYear < earliestYear) {
    return {
      disposition: 'not_yet',
      eligible: false,
      reasons: [...evidenceReasons, `earliest=${earliestYear}`],
    };
  }

  if (currentYear !== undefined && latestYear !== undefined && currentYear > latestYear) {
    return {
      disposition: 'expired',
      eligible: false,
      reasons: [
        ...evidenceReasons,
        `latest=${latestYear}`,
        ...(afterlifeYear !== undefined ? [`afterlifeUntil=${afterlifeYear}`] : []),
      ],
    };
  }

  if (currentYear !== undefined && typicalYear !== undefined && currentYear > typicalYear) {
    if (applicability.divergencePolicy.mayDelay) {
      return {
        disposition: 'delayed_candidate',
        eligible: true,
        reasons: [...evidenceReasons, `typical=${typicalYear}`, ...(latestYear ? [`latest=${latestYear}`] : [])],
      };
    }
    if (applicability.divergencePolicy.mayTransform && applicability.structuralPressure?.trim()) {
      return {
        disposition: 'transformed_candidate',
        eligible: true,
        reasons: [...evidenceReasons, `typical=${typicalYear}`],
      };
    }
    return {
      disposition: 'expired',
      eligible: false,
      reasons: [...evidenceReasons, `typical=${typicalYear}`],
    };
  }

  return {
    disposition: 'baseline_possible',
    eligible: true,
    reasons: evidenceReasons,
  };
}

export function normalizeHistoricalAnchorStates(
  entries: HistoricalAnchorStateEntry[] | undefined,
  worldTrends: WorldTrendEntry[] | undefined,
  currentDate: string,
): HistoricalAnchorStateEntry[] {
  const normalized = new Map<string, HistoricalAnchorStateEntry>();

  for (const entry of entries ?? []) {
    const cardId = entry?.cardId?.trim();
    if (!cardId || !TERMINAL_DISPOSITIONS.has(entry.disposition)) continue;
    const factRefs = normalizeStringList(entry.factRefs);
    if (factRefs.length === 0) continue;
    normalized.set(cardId, {
      cardId,
      disposition: entry.disposition,
      assessedAt: entry.assessedAt?.trim() || currentDate,
      factRefs,
      ...(entry.outcomeRef?.trim() ? { outcomeRef: entry.outcomeRef.trim() } : {}),
      ...(entry.note?.trim() ? { note: entry.note.trim() } : {}),
    });
  }

  for (const trend of worldTrends ?? []) {
    if (trend.certainty !== 'confirmed') continue;
    if (!['regional', 'realm', 'world'].includes(trend.scope ?? '')) continue;

    for (const tag of trend.consequenceTags ?? []) {
      const match = tag.trim().match(WORLDLINE_OUTCOME_TAG);
      if (!match) continue;
      const disposition = match[1] as HistoricalAnchorStateEntry['disposition'];
      const cardId = match[2]?.trim();
      if (!cardId) continue;
      normalized.set(cardId, {
        cardId,
        disposition,
        assessedAt: trend.updatedAt || trend.happenedAt || currentDate,
        factRefs: [`worldTrend:${trend.trendId}`],
        outcomeRef: `worldTrend:${trend.trendId}`,
        note: `由天下纪事“${trend.title}”确认。`,
      });
    }
  }

  return [...normalized.values()].sort((left, right) => left.cardId.localeCompare(right.cardId));
}

function evaluateHistoricalFactRef(factRef: HistoricalFactRef, state: RuntimeState): FactEvaluation {
  if (factRef.kind === 'npcFaction') {
    const npc = state.npcs?.find((candidate) => candidate.npcId === factRef.npcId);
    if (!npc?.factionId) return 'unknown';
    return includesNormalized(factRef.allowedFactionIds, npc.factionId) ? 'satisfied' : 'contradicted';
  }

  if (factRef.kind === 'holdingController') {
    const holding = state.holdings?.find((candidate) => candidate.holdingId === factRef.holdingId);
    const controller = holding?.actualController ?? holding?.factionId;
    if (!controller) return 'unknown';
    return includesNormalized(factRef.allowedControllerIds, controller) ? 'satisfied' : 'contradicted';
  }

  if (factRef.kind === 'troopLifecycle') {
    const troop = state.troops?.find((candidate) => candidate.troopId === factRef.troopId);
    if (!troop?.lifecycleStatus) return 'unknown';
    return includesNormalized(factRef.allowedStatuses, troop.lifecycleStatus) ? 'satisfied' : 'contradicted';
  }

  if (factRef.kind === 'worldTrendStatus') {
    const trend = state.worldTrends?.find((candidate) => candidate.trendId === factRef.trendId);
    if (!trend) return 'unknown';
    return includesNormalized(factRef.allowedStatuses, trend.status ?? 'active') ? 'satisfied' : 'contradicted';
  }

  const quest = state.activeQuests.find((candidate) => candidate.id === factRef.questId);
  if (!quest) return 'unknown';
  return includesNormalized(factRef.allowedStatuses, quest.status) ? 'satisfied' : 'contradicted';
}

function formatHistoricalFactRef(factRef: HistoricalFactRef): string {
  if (factRef.kind === 'npcFaction') return `npcFaction:${factRef.npcId}`;
  if (factRef.kind === 'holdingController') return `holdingController:${factRef.holdingId}`;
  if (factRef.kind === 'troopLifecycle') return `troopLifecycle:${factRef.troopId}`;
  if (factRef.kind === 'worldTrendStatus') return `worldTrendStatus:${factRef.trendId}`;
  return `questStatus:${factRef.questId}`;
}

function extractYear(value?: string): number | undefined {
  if (!value) return undefined;
  const match = value.match(/(?:公元)?\s*(\d{2,4})\s*年/);
  if (!match) return undefined;
  const year = Number.parseInt(match[1], 10);
  return Number.isFinite(year) ? year : undefined;
}

function includesNormalized(values: string[], candidate: string): boolean {
  const normalizedCandidate = candidate.trim().toLowerCase();
  return values.some((value) => value.trim().toLowerCase() === normalizedCandidate);
}

function normalizeStringList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

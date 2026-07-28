import type { WorldTrendEntry } from '../types';

export interface WorldChronicleFacts {
  summary?: string;
  knownToPlayer?: boolean;
  updatedAt?: string;
  status?: WorldTrendEntry['status'];
  happenedAt?: string;
  scope?: WorldTrendEntry['scope'];
  severity?: WorldTrendEntry['severity'] | 'low' | 'medium' | 'high' | 'critical' | string;
  affectedNpcIds?: string[];
  affectedFactionIds?: string[];
  affectedPlaceIds?: string[];
  affectedForceIds?: string[];
  affectedHoldingIds?: string[];
  sourceQuestIds?: string[];
  sourceConflictIds?: string[];
  outcomeSummary?: string;
  progressSummary?: string;
  nextCheckAt?: string;
  lastAdvancedAt?: string;
}

export interface WorldChronicleEligibility {
  eligible: boolean;
  code: 'opening-baseline' | 'eligible' | 'local-scope' | 'missing-scope' | 'missing-macro-impact';
  reasonZh: string;
}

/** Preloaded opening context is the only scope-less chronicle entry. */
export function isPreloadedWorldBaseline(value: WorldChronicleFacts): boolean {
  return value.scope === undefined
    && value.status === undefined
    && value.happenedAt === undefined
    && value.knownToPlayer === true
    && Boolean(value.summary?.trim())
    && Boolean(value.updatedAt?.trim());
}

export function evaluateWorldChronicleEligibility(
  value: WorldChronicleFacts,
): WorldChronicleEligibility {
  if (isPreloadedWorldBaseline(value)) {
    return {
      eligible: true,
      code: 'opening-baseline',
      reasonZh: '预置世界开局基线',
    };
  }

  if (!value.scope) {
    return {
      eligible: false,
      code: 'missing-scope',
      reasonZh: '缺少 regional/realm/world 影响范围',
    };
  }
  if (value.scope === 'local') {
    return {
      eligible: false,
      code: 'local-scope',
      reasonZh: '仅属本地或主角个人行动，不构成区域以上纪事',
    };
  }

  const severityRank = getSeverityRank(value.severity);
  const hasConflictAnchor = hasValues(value.sourceConflictIds);
  const strategicAnchorCount = countStrategicImpactAnchors(value);
  const eligible = value.scope === 'regional'
    ? hasConflictAnchor || strategicAnchorCount >= 2 || (severityRank >= 3 && strategicAnchorCount >= 1)
    : hasConflictAnchor || strategicAnchorCount >= 1;

  return eligible
    ? {
        eligible: true,
        code: 'eligible',
        reasonZh: '具有区域以上范围和结构化宏观后果锚点',
      }
    : {
        eligible: false,
        code: 'missing-macro-impact',
        reasonZh: '缺少冲突、势力、部队、领地或跨地点等宏观后果锚点',
      };
}

export function isWorldChronicleEligible(value: WorldChronicleFacts): boolean {
  return evaluateWorldChronicleEligibility(value).eligible;
}

/** Runtime summaries are historical unless ongoing progress is explicit. */
export function resolveWorldChronicleStatus(
  value: WorldChronicleFacts,
): NonNullable<WorldTrendEntry['status']> {
  if (value.status === 'historical' || value.status === 'corrected') return value.status;
  if (isPreloadedWorldBaseline(value)) return 'active';

  const hasProgress = Boolean(value.progressSummary?.trim());
  const hasTemporalAnchor = Boolean(value.nextCheckAt?.trim() || value.lastAdvancedAt?.trim());
  if (hasProgress && hasTemporalAnchor) {
    return value.status === 'cooling' ? 'cooling' : 'active';
  }
  return 'historical';
}

export function isWorldChronicleOngoing(value: WorldChronicleFacts): boolean {
  const status = resolveWorldChronicleStatus(value);
  return status === 'active' || status === 'cooling';
}

function countStrategicImpactAnchors(value: WorldChronicleFacts): number {
  return [
    value.affectedFactionIds,
    value.affectedPlaceIds,
    value.affectedForceIds,
    value.affectedHoldingIds,
  ].reduce<number>((total, ids) => total + uniqueNonEmpty(ids).length, 0);
}

function hasValues(values: string[] | undefined): boolean {
  return uniqueNonEmpty(values).length > 0;
}

function uniqueNonEmpty(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)));
}

function getSeverityRank(value: WorldChronicleFacts['severity']): number {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'critical' || normalized === '极高') return 4;
  if (normalized === 'high' || normalized === '高') return 3;
  if (normalized === 'medium' || normalized === '中') return 2;
  if (normalized === 'low' || normalized === '低') return 1;
  return 0;
}

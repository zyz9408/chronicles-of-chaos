import type { GameClock } from './gameClock';
import { tryCreateGameClockFromDateLabel } from './gameClock';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { isNpcPhysicallyPresent } from '../state/npcPresence';
import {
  isWorldChronicleEligible,
  resolveWorldChronicleStatus,
} from '../state/worldChroniclePolicy';

export interface TemporalProjection {
  lines: string[];
  text: string;
}

interface TemporalAnchor extends GameClock {
  raw: string;
}

export function buildTemporalProjection(state: RuntimeState): TemporalProjection {
  const normalized = ensureLuanShiState(state);
  const current = normalizeCurrentAnchor(normalized);
  if (!current) return emptyProjection();

  const lines: string[] = [];

  const dueActivityLines: string[] = [];
  const reentryRefreshLines: string[] = [];
  const currentLocationIds = new Set(
    [normalized.currentLocationId, normalized.currentPlaceId, normalized.currentSceneId]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  for (const npc of normalized.npcs) {
    const activity = npc.backgroundActivity;
    if (!activity || isClosedNpcActivityStatus(activity.status)) continue;
    if (activity.dueAt) {
      const dueAt = parseTemporalAnchor(activity.dueAt);
      if (dueAt && compareTemporalAnchors(dueAt, current) <= 0 && dueActivityLines.length < 3) {
        dueActivityLines.push(
          `- npc activity ${activity.activityId} for ${npc.name}(${npc.npcId}): review due (${activity.dueAt}); current=${activity.status}; candidate only; do not auto-complete, move, succeed, or fail without visible narrative adjudication and structured writeback.`,
        );
      }
    }

    const activityLocationId = activity.locationId?.trim();
    const isConfirmedCurrent = isNpcPhysicallyPresent(normalized, npc);
    if (
      isConfirmedCurrent
      && activityLocationId
      && !currentLocationIds.has(activityLocationId)
      && reentryRefreshLines.length < 3
    ) {
      reentryRefreshLines.push(
        `- npc ${npc.name}(${npc.npcId}): re-entry refresh required; current scene presence conflicts with background activity ${activity.activityId} at ${activityLocationId}; reconcile location/status/activity before reusing the offstage state, and do not mutate facts without structured writeback.`,
      );
    }
  }
  lines.push(...dueActivityLines, ...reentryRefreshLines);

  for (const quest of normalized.activeQuests) {
    if (quest.status !== 'active' || !quest.deadlineAt) continue;
    const deadline = parseTemporalAnchor(quest.deadlineAt);
    if (!deadline || compareTemporalAnchors(deadline, current) > 0) continue;
    lines.push(
      `- quest ${quest.id} "${quest.title}": deadline reached (${quest.deadlineAt}); status remains ${quest.status}; needs adjudication through questChanges only when the story consequence is visible.`,
    );
  }

  for (const signal of normalized.knownRumors) {
    if (!signal.expiresAt || signal.verified) continue;
    const expiresAt = parseTemporalAnchor(signal.expiresAt);
    if (!expiresAt || compareTemporalAnchors(expiresAt, current) > 0) continue;
    lines.push(
      `- signal ${signal.id}: expiresAt reached (${signal.expiresAt}); possibly stale; verify before using and do not treat it as confirmed fact without structured writeback.`,
    );
  }

  for (const plan of normalized.plotPlan) {
    if (isClosedPlotStatus(plan.status) || !plan.notBeforeAt) continue;
    const notBeforeAt = parseTemporalAnchor(plan.notBeforeAt);
    if (!notBeforeAt) continue;
    if (compareTemporalAnchors(notBeforeAt, current) > 0) {
      lines.push(
        `- plot ${plan.plotId} "${plan.title}": not before ${plan.notBeforeAt}; foreshadow only and do not resolve, trigger, or fast-forward it yet.`,
      );
    } else {
      lines.push(
        `- plot ${plan.plotId} "${plan.title}": notBeforeAt reached (${plan.notBeforeAt}); eligible for evaluation only; do not auto-trigger or auto-complete without current conditions and visible narrative support.`,
      );
    }
  }

  let dueWorldEventCount = 0;
  for (const trend of normalized.worldTrends) {
    if (!isWorldChronicleEligible(trend)) continue;
    const lifecycleStatus = resolveWorldChronicleStatus(trend);
    if (
      trend.nextCheckAt
      && lifecycleStatus !== 'historical'
      && lifecycleStatus !== 'corrected'
      && dueWorldEventCount < 3
    ) {
      const nextCheckAt = parseTemporalAnchor(trend.nextCheckAt);
      if (nextCheckAt && compareTemporalAnchors(nextCheckAt, current) <= 0) {
        lines.push(
          `- world event ${trend.trendId} "${trend.title}": world event review due (${trend.nextCheckAt}); status=${lifecycleStatus}; progress=${trend.progressSummary ?? trend.summary}; candidate only; do not auto-complete or invent an outcome.`,
        );
        dueWorldEventCount += 1;
      }
    }
    if (!trend.knownToPlayer || !trend.happenedAt || !trend.learnedAt) continue;
    if (trend.happenedAt.trim() === trend.learnedAt.trim()) continue;
    lines.push(
      `- chronicle ${trend.trendId}: happenedAt=${trend.happenedAt}; learnedAt=${trend.learnedAt}; present it as delayed knowledge rather than an event happening now.`,
    );
  }

  return lines.length > 0
    ? { lines, text: ['timeProjection:', ...lines].join('\n') }
    : emptyProjection();
}

export function isTemporalTargetReached(state: RuntimeState, targetAt?: string | null): boolean {
  if (!targetAt) return false;
  const normalized = ensureLuanShiState(state);
  const current = normalizeCurrentAnchor(normalized);
  const target = parseTemporalAnchor(targetAt);
  return Boolean(current && target && compareTemporalAnchors(target, current) <= 0);
}

function normalizeCurrentAnchor(state: RuntimeState): TemporalAnchor | undefined {
  if (state.currentTime) {
    return { ...state.currentTime, raw: state.currentDate };
  }
  return parseTemporalAnchor(state.currentDate);
}

function parseTemporalAnchor(value?: string | null): TemporalAnchor | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return undefined;

  const clock = tryCreateGameClockFromDateLabel(raw) ?? parseNumericDateClock(raw);
  return clock ? { ...clock, raw } : undefined;
}

function parseNumericDateClock(value: string): GameClock | undefined {
  const match = value.match(/(\d{1,4})\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2}):(\d{1,2}))?/);
  if (!match) return undefined;

  return {
    year: Number(match[1]),
    month: clamp(Number(match[2]), 1, 12),
    day: clamp(Number(match[3]), 1, 30),
    hour: match[4] ? clamp(Number(match[4]), 0, 23) : 8,
    minute: match[5] ? clamp(Number(match[5]), 0, 59) : 0,
  };
}

function compareTemporalAnchors(left: TemporalAnchor, right: TemporalAnchor): number {
  return temporalToMinutes(left) - temporalToMinutes(right);
}

function temporalToMinutes(anchor: GameClock): number {
  return (
    ((((anchor.year * 12) + (anchor.month - 1)) * 30 + (anchor.day - 1)) * 24 + anchor.hour) * 60
  ) + anchor.minute;
}

function isClosedPlotStatus(status: string): boolean {
  return ['已完成', '废弃', '宸插畬鎴?', '搴熷純'].includes(status);
}

function isClosedNpcActivityStatus(status: string): boolean {
  return status === 'completed' || status === 'cancelled';
}

function emptyProjection(): TemporalProjection {
  return { lines: [], text: '' };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

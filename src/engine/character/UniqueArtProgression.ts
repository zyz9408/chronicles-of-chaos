import type {
  CharacterUniqueArt,
  CharacterUniqueArtProgressEvidence,
  CharacterUniqueArtProgressIntensity,
  CharacterUniqueArtProgressSource,
} from '../types';

export const UNIQUE_ART_PROGRESS_PER_LEVEL = 100;
export const UNIQUE_ART_DEFAULT_MAX_LEVEL = 10;
export const UNIQUE_ART_PROGRESS_HISTORY_LIMIT = 12;

export const UNIQUE_ART_PROGRESS_AWARDS: Record<
  CharacterUniqueArtProgressSource,
  Record<CharacterUniqueArtProgressIntensity, number>
> = {
  actual_use: { minor: 4, normal: 7, major: 10 },
  autonomous_practice: { minor: 5, normal: 9, major: 13 },
  instruction_or_manual: { minor: 6, normal: 11, major: 16 },
  major_achievement: { minor: 8, normal: 14, major: 20 },
};

export interface ApplyUniqueArtProgressResult {
  art: CharacterUniqueArt;
  applied: boolean;
  levelledUp: boolean;
}

export function buildUniqueArtProgressTurnKey(
  turnLogLength: number,
  currentDate: string,
): string {
  return `${Math.max(0, Math.floor(turnLogLength)) + 1}:${currentDate.trim()}`;
}

export function characterHasUniqueArtProgressEvent(
  arts: readonly CharacterUniqueArt[],
  eventId: string,
): boolean {
  const normalizedEventId = eventId.trim();
  return arts.some((art) => (
    art.progressHistory?.some((entry) => entry.eventId.trim() === normalizedEventId) ?? false
  ));
}

export function characterHasConsumedUniqueArtProgressSource(
  arts: readonly CharacterUniqueArt[],
  evidence: CharacterUniqueArtProgressEvidence,
): boolean {
  if (evidence.source !== 'instruction_or_manual') return false;
  const normalizedSourceRefId = evidence.sourceRefId.trim();
  return arts.some((art) => (
    art.acquisition?.sourceRefId.trim() === normalizedSourceRefId
    || art.progressHistory?.some((entry) => (
      entry.source === 'instruction_or_manual'
      && entry.sourceRefId.trim() === normalizedSourceRefId
    ))
  ));
}

export function applyUniqueArtProgressEvidence(
  sourceArt: CharacterUniqueArt,
  evidence: CharacterUniqueArtProgressEvidence,
  appliedTurnKey: string,
): ApplyUniqueArtProgressResult {
  const history = sourceArt.progressHistory ?? [];
  if (history.some((entry) => entry.eventId.trim() === evidence.eventId.trim())) {
    return { art: cloneArt(sourceArt), applied: false, levelledUp: false };
  }

  const levelBefore = clampInteger(sourceArt.level, 1, UNIQUE_ART_DEFAULT_MAX_LEVEL);
  const maxLevel = clampInteger(
    sourceArt.maxLevel ?? UNIQUE_ART_DEFAULT_MAX_LEVEL,
    levelBefore,
    UNIQUE_ART_DEFAULT_MAX_LEVEL,
  );
  const progressBefore = clampNumber(sourceArt.progress ?? 0, 0, UNIQUE_ART_PROGRESS_PER_LEVEL - 1);
  const bankedBefore = Math.max(0, finiteNumber(sourceArt.bankedProgress, 0));
  const alreadyLevelledThisTurn = history.some((entry) => (
    entry.appliedTurnKey === appliedTurnKey && entry.levelledUp
  ));
  const configuredAward = UNIQUE_ART_PROGRESS_AWARDS[evidence.source][evidence.intensity];
  const awardedProgress = levelBefore >= maxLevel ? 0 : configuredAward;
  const totalProgress = progressBefore + bankedBefore + awardedProgress;

  let levelAfter = levelBefore;
  let progressAfter = progressBefore;
  let bankedProgress = bankedBefore;
  let levelledUp = false;

  if (levelBefore >= maxLevel) {
    progressAfter = 0;
    bankedProgress = 0;
  } else if (totalProgress >= UNIQUE_ART_PROGRESS_PER_LEVEL && !alreadyLevelledThisTurn) {
    levelAfter = Math.min(maxLevel, levelBefore + 1);
    levelledUp = levelAfter > levelBefore;
    const remainder = totalProgress - UNIQUE_ART_PROGRESS_PER_LEVEL;
    if (levelAfter >= maxLevel) {
      progressAfter = 0;
      bankedProgress = 0;
    } else {
      progressAfter = Math.min(UNIQUE_ART_PROGRESS_PER_LEVEL - 1, remainder);
      bankedProgress = Math.max(0, remainder - progressAfter);
    }
  } else if (totalProgress >= UNIQUE_ART_PROGRESS_PER_LEVEL) {
    progressAfter = UNIQUE_ART_PROGRESS_PER_LEVEL - 1;
    bankedProgress = totalProgress - progressAfter;
  } else {
    progressAfter = totalProgress;
    bankedProgress = 0;
  }

  const record = {
    ...cloneEvidence(evidence),
    awardedProgress,
    levelBefore,
    progressBefore,
    levelAfter,
    progressAfter,
    levelledUp,
    appliedTurnKey,
  };

  return {
    art: {
      ...cloneArt(sourceArt),
      level: levelAfter,
      maxLevel,
      progress: progressAfter,
      ...(bankedProgress > 0 ? { bankedProgress } : { bankedProgress: undefined }),
      ...(levelledUp ? { upgradedAt: evidence.occurredAt.trim() } : {}),
      progressHistory: [...history.map((entry) => ({ ...entry })), record]
        .slice(-UNIQUE_ART_PROGRESS_HISTORY_LIMIT),
    },
    applied: true,
    levelledUp,
  };
}

function cloneEvidence(evidence: CharacterUniqueArtProgressEvidence): CharacterUniqueArtProgressEvidence {
  return {
    eventId: evidence.eventId.trim(),
    source: evidence.source,
    intensity: evidence.intensity,
    occurredAt: evidence.occurredAt.trim(),
    sourceRefId: evidence.sourceRefId.trim(),
    summary: evidence.summary.trim(),
    ...(evidence.instructorNpcId?.trim() ? { instructorNpcId: evidence.instructorNpcId.trim() } : {}),
    ...(evidence.sourceItemId?.trim() ? { sourceItemId: evidence.sourceItemId.trim() } : {}),
  };
}

function cloneArt(art: CharacterUniqueArt): CharacterUniqueArt {
  return {
    ...art,
    ...(art.acquisition ? { acquisition: { ...art.acquisition } } : {}),
    ...(art.checkHooks ? { checkHooks: art.checkHooks.map((hook) => ({ ...hook })) } : {}),
    ...(art.tags ? { tags: [...art.tags] } : {}),
    ...(art.relatedNpcIds ? { relatedNpcIds: [...art.relatedNpcIds] } : {}),
    ...(art.relatedFactionIds ? { relatedFactionIds: [...art.relatedFactionIds] } : {}),
    ...(art.progressHistory ? { progressHistory: art.progressHistory.map((entry) => ({ ...entry })) } : {}),
  };
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, finiteNumber(value, min)));
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(finiteNumber(value, min))));
}

import type { PregnancyModePreference } from '../settings/DisplaySettings';
import type {
  BondThreadEntry,
  LuanShiNpc,
  LuanShiNpcWombProfile,
  LuanShiPregnancyHistoryEntry,
  LuanShiPregnancyState,
  RuntimeState,
} from '../types';
import { deriveNpcCurrentAge, isAdultFemaleNpcAt } from '../time/npcAge';
import {
  createGameClockFromDateLabel,
  formatGameClock,
  tryCreateGameClockFromDateLabel,
  type GameClock,
} from '../time/gameClock';

export type PregnancyRiskType = 'unprotected' | 'tryingToConceive' | 'reducedRisk';

export interface PlayerPregnancyRiskInput {
  npcId: string;
  riskType: PregnancyRiskType;
  summary: string;
}

export interface PregnancyResolutionInput {
  npcId: string;
  outcome: 'liveBirth' | 'ended';
  summary: string;
  childName?: string;
  childSex?: '男' | '女';
}

export function getPregnancyStatusLabel(status: LuanShiPregnancyState['status']): string {
  const labels: Record<LuanShiPregnancyState['status'], string> = {
    pendingCheck: '待判定',
    suspected: '疑似怀孕',
    confirmed: '已确认怀孕',
    deliveryDue: '临产',
    postpartum: '产后恢复中',
  };
  return labels[status];
}

export function getPregnancyMonth(currentDate: string, pregnancy: LuanShiPregnancyState): number | undefined {
  const conceptionClock = pregnancy.conceptionAt ? resolveClock(pregnancy.conceptionAt) : undefined;
  const currentClock = resolveClock(currentDate);
  if (!conceptionClock || !currentClock || compareClocks(currentClock, conceptionClock) < 0) return undefined;
  return Math.min(10, Math.floor(differenceInDays(conceptionClock, currentClock) / DAYS_PER_MONTH) + 1);
}

const DAYS_PER_MONTH = 30;
const MONTHS_PER_YEAR = 12;
const MINUTES_PER_DAY = 24 * 60;
const CHECK_MIN_DAYS = 21;
const CHECK_DAY_SPREAD = 10;
const CONFIRMATION_DAYS = 45;
const DELIVERY_WINDOW_START_DAYS = 260;
const ESTIMATED_DUE_DAYS = 270;
const DELIVERY_WINDOW_END_DAYS = 280;
const POSTPARTUM_COOLDOWN_DAYS = 90;
const MAX_EXTRA_EXPOSURES = 3;
const EXTRA_EXPOSURE_BASIS_POINTS = 200;
const TRYING_TO_CONCEIVE_BONUS_BASIS_POINTS = 500;
const MAX_CHANCE_BASIS_POINTS = 3000;
const MAX_WOMB_RECORDS = 12;
const MAX_HISTORY_RECORDS = 8;

const MODE_MULTIPLIERS: Record<Exclude<PregnancyModePreference, 'off'>, number> = {
  low: 0.6,
  standard: 1,
  high: 1.5,
};

export function recordPlayerPregnancyRisk(
  state: RuntimeState,
  input: PlayerPregnancyRiskInput,
  mode: PregnancyModePreference,
): RuntimeState {
  const progressed = advancePregnancyLifecycle(state);
  if (mode === 'off') return progressed;

  const next = cloneState(progressed);
  const npc = next.npcs?.find((entry) => entry.npcId === input.npcId);
  if (!npc || npc.sex !== '女' || !isAdultFemaleNpcAt(npc, next.currentDate)) return next;

  const age = deriveNpcCurrentAge(npc, next.currentDate);
  if (age === undefined || age < 18) return next;

  const currentClock = resolveClock(next.currentDate, next.currentTime);
  if (!currentClock) return next;

  const wombProfile = ensureWombProfile(npc);
  const eventKey = stableKey([
    'pregnancy-risk',
    npc.npcId,
    next.currentDate,
    input.riskType,
    input.summary.trim(),
  ]);
  const active = wombProfile.pregnancy;

  if (active && active.status !== 'pendingCheck') return next;

  const pendingChecks = [
    ...(active?.status === 'pendingCheck' ? [active] : []),
    ...normalizePendingChecks(wombProfile.pendingPregnancyChecks),
  ];
  const sameDayCheck = pendingChecks.find((check) => (
    isSameGameDay(check.firstExposureAt, currentClock)
  ));

  if (sameDayCheck) {
    if (sameDayCheck.riskEventKeys?.includes(eventKey)) return next;

    sameDayCheck.exposureCount = Math.min(99, sameDayCheck.exposureCount + 1);
    sameDayCheck.riskEventKeys = [...(sameDayCheck.riskEventKeys ?? []), eventKey].slice(-8);
    sameDayCheck.tryingToConceive = sameDayCheck.tryingToConceive || input.riskType === 'tryingToConceive';
    sameDayCheck.hasUnprotectedExposure = sameDayCheck.hasUnprotectedExposure || input.riskType !== 'reducedRisk';
    sameDayCheck.chanceBasisPoints = calculateChanceBasisPoints(age, mode, sameDayCheck);
    appendWombRecord(wombProfile, next.currentDate, input.summary, sameDayCheck.checkAt);
    return next;
  }

  const cycleKey = `cycle_${toDayIndex(currentClock)}`;
  const seed = [
    next.worldBookId,
    next.startDate,
    next.player.id,
    npc.npcId,
    cycleKey,
    'player',
  ].join('|');
  const earliestPendingCheck = pendingChecks[0];
  const existingCheckDelay = earliestPendingCheck
    ? resolveCheckDelayDays(earliestPendingCheck)
    : undefined;
  const checkDays = existingCheckDelay
    ?? (CHECK_MIN_DAYS + stableHash(`${seed}|check`) % CHECK_DAY_SPREAD);
  const checkAt = formatGameClock(addDays(currentClock, checkDays));
  const pregnancy: LuanShiPregnancyState = {
    pregnancyId: `preg_${stableKey([seed, 'pregnancy'])}`,
    status: 'pendingCheck',
    cycleKey,
    firstExposureAt: next.currentDate,
    checkAt,
    exposureCount: 1,
    chanceBasisPoints: 0,
    rollBasisPoints: stableHash(`${seed}|roll`) % 10_000,
    fatherCharacterIds: ['player'],
    paternityStatus: 'known',
    disclosure: 'private',
    tryingToConceive: input.riskType === 'tryingToConceive',
    hasUnprotectedExposure: input.riskType !== 'reducedRisk',
    riskEventKeys: [eventKey],
  };
  pregnancy.chanceBasisPoints = calculateChanceBasisPoints(age, mode, pregnancy);
  if (!active) {
    wombProfile.pregnancy = pregnancy;
  } else {
    wombProfile.pendingPregnancyChecks = sortPendingChecks([
      ...normalizePendingChecks(wombProfile.pendingPregnancyChecks),
      pregnancy,
    ]);
  }
  wombProfile.status = '待怀孕判定';
  appendWombRecord(wombProfile, next.currentDate, input.summary, checkAt);
  return next;
}

export function advancePregnancyLifecycle(state: RuntimeState): RuntimeState {
  const next = cloneState(state);
  const currentClock = resolveClock(next.currentDate, next.currentTime);
  if (!currentClock) return next;

  for (const npc of next.npcs ?? []) {
    const wombProfile = npc.femaleProfile?.adultPrivateProfile?.wombProfile;
    if (!wombProfile) continue;

    promoteNextPendingCheck(wombProfile);
    let pregnancy = wombProfile.pregnancy;
    if (!pregnancy) continue;
    if (pregnancy.status !== 'pendingCheck') {
      delete wombProfile.pendingPregnancyChecks;
    }

    while (pregnancy.status === 'pendingCheck') {
      const checkClock = resolveClock(pregnancy.checkAt);
      if (!checkClock || compareClocks(currentClock, checkClock) < 0) break;

      const conceived = pregnancy.rollBasisPoints < pregnancy.chanceBasisPoints;
      wombProfile.lastPregnancyCheck = {
        cycleKey: pregnancy.cycleKey,
        firstExposureAt: pregnancy.firstExposureAt,
        checkedAt: pregnancy.checkAt,
        result: conceived ? 'pregnant' : 'notPregnant',
        chanceBasisPoints: pregnancy.chanceBasisPoints,
        rollBasisPoints: pregnancy.rollBasisPoints,
      };
      if (!conceived) {
        delete wombProfile.pregnancy;
        promoteNextPendingCheck(wombProfile);
        pregnancy = wombProfile.pregnancy;
        if (!pregnancy) {
          wombProfile.status = '未受孕';
          break;
        }
        wombProfile.status = '待怀孕判定';
        continue;
      }

      const conceptionClock = resolveClock(pregnancy.firstExposureAt) ?? checkClock;
      pregnancy.conceptionAt = formatGameClock(conceptionClock);
      pregnancy.confirmedAt = formatGameClock(addDays(conceptionClock, CONFIRMATION_DAYS));
      pregnancy.deliveryWindowStartAt = formatGameClock(addDays(conceptionClock, DELIVERY_WINDOW_START_DAYS));
      pregnancy.estimatedDueAt = formatGameClock(addDays(conceptionClock, ESTIMATED_DUE_DAYS));
      pregnancy.deliveryWindowEndAt = formatGameClock(addDays(conceptionClock, DELIVERY_WINDOW_END_DAYS));
      pregnancy.status = 'suspected';
      delete wombProfile.pendingPregnancyChecks;
      wombProfile.status = '疑似怀孕';
      break;
    }

    pregnancy = wombProfile.pregnancy;
    if (!pregnancy) continue;

    if (pregnancy.status === 'suspected' && isAtOrAfter(currentClock, pregnancy.confirmedAt)) {
      pregnancy.status = 'confirmed';
      wombProfile.status = '已确认怀孕';
    }

    if (pregnancy.status === 'confirmed' && isAtOrAfter(currentClock, pregnancy.deliveryWindowStartAt)) {
      pregnancy.status = 'deliveryDue';
      pregnancy.disclosure = 'public';
      wombProfile.status = '临产';
    }

    if (pregnancy.status === 'deliveryDue' && isAtOrAfter(currentClock, pregnancy.deliveryWindowEndAt)) {
      resolvePregnancyMutable(next, npc, {
        npcId: npc.npcId,
        outcome: 'liveBirth',
        summary: `${npc.name}已在临产期末平安分娩。`,
      });
      continue;
    }

    if (pregnancy.status === 'postpartum' && isAtOrAfter(currentClock, pregnancy.postpartumUntil)) {
      archivePregnancy(wombProfile, pregnancy);
      delete wombProfile.pregnancy;
      wombProfile.status = '未受孕';
    }
  }

  return next;
}

export function resolvePregnancy(
  state: RuntimeState,
  input: PregnancyResolutionInput,
): RuntimeState {
  const next = cloneState(state);
  const npc = next.npcs?.find((entry) => entry.npcId === input.npcId);
  if (!npc) return next;
  resolvePregnancyMutable(next, npc, input);
  return next;
}

function resolvePregnancyMutable(
  state: RuntimeState,
  mother: LuanShiNpc,
  input: PregnancyResolutionInput,
): void {
  const wombProfile = mother.femaleProfile?.adultPrivateProfile?.wombProfile;
  const pregnancy = wombProfile?.pregnancy;
  if (!wombProfile || !pregnancy || pregnancy.status === 'pendingCheck' || pregnancy.status === 'postpartum') return;
  if (input.outcome === 'liveBirth' && pregnancy.status !== 'confirmed' && pregnancy.status !== 'deliveryDue') return;

  pregnancy.resolvedAt = state.currentDate;
  pregnancy.outcome = input.outcome;
  pregnancy.outcomeSummary = input.summary.trim();

  if (input.outcome === 'ended') {
    delete wombProfile.pendingPregnancyChecks;
    archivePregnancy(wombProfile, pregnancy);
    delete wombProfile.pregnancy;
    wombProfile.status = '妊娠已结束';
    appendTurnEvent(state, mother, pregnancy, input.summary, undefined);
    return;
  }

  const childNpcId = `npc_child_${pregnancy.pregnancyId}`;
  const childSex = input.childSex ?? (stableHash(`${pregnancy.pregnancyId}|sex`) % 2 === 0 ? '男' : '女');
  const existingChild = state.npcs?.find((npc) => npc.npcId === childNpcId);
  const childName = input.childName?.trim() || buildPlaceholderChildName(state, mother, childSex);
  if (!existingChild) {
    const child: LuanShiNpc = {
      npcId: childNpcId,
      name: childName,
      sex: childSex,
      age: 0,
      birthDate: state.currentDate,
      ageKnownAtDate: state.currentDate,
      role: '婴儿',
      factionId: mother.factionId,
      factionName: mother.factionName,
      locationId: mother.locationId ?? state.currentLocationId,
      isPresent: mother.isPresent,
      isFocused: false,
      currentIdentity: '主角子嗣',
      identitySummary: `${mother.name}与${state.player.name}所生的孩子。`,
      summary: input.summary.trim(),
      appearance: '新生婴儿，外貌尚未长成。',
      personality: '尚在幼年，性情未定。',
      motivation: '在亲族照料下成长。',
      relationToPlayer: childSex === '男' ? '亲生儿子' : '亲生女儿',
      contactLevel: 100,
      recentAttitude: '依赖亲族照料',
      abilityScores: {},
      parentLinks: {
        motherNpcId: mother.npcId,
        fatherCharacterId: 'player',
      },
      memories: [],
    };
    state.npcs = [...(state.npcs ?? []), child];
  }

  pregnancy.childNpcId = childNpcId;
  pregnancy.status = 'postpartum';
  delete wombProfile.pendingPregnancyChecks;
  pregnancy.disclosure = 'public';
  pregnancy.postpartumUntil = formatGameClock(addDays(resolveClock(state.currentDate)!, POSTPARTUM_COOLDOWN_DAYS));
  wombProfile.status = '产后恢复中';
  appendKinshipBond(state, childNpcId, childName, input.summary);
  appendTurnEvent(state, mother, pregnancy, input.summary, childNpcId);
}

function calculateChanceBasisPoints(
  age: number,
  mode: Exclude<PregnancyModePreference, 'off'>,
  pregnancy: Pick<LuanShiPregnancyState, 'exposureCount' | 'tryingToConceive' | 'hasUnprotectedExposure'>,
): number {
  const base = age <= 29 ? 1800 : age <= 34 ? 1400 : age <= 39 ? 900 : age <= 44 ? 400 : 100;
  const modeAdjusted = Math.round(base * MODE_MULTIPLIERS[mode]);
  const exposureAdjusted = pregnancy.hasUnprotectedExposure ? modeAdjusted : Math.round(modeAdjusted * 0.25);
  const extraExposureCount = Math.min(MAX_EXTRA_EXPOSURES, Math.max(0, pregnancy.exposureCount - 1));
  return Math.min(
    MAX_CHANCE_BASIS_POINTS,
    exposureAdjusted
      + extraExposureCount * EXTRA_EXPOSURE_BASIS_POINTS
      + (pregnancy.tryingToConceive ? TRYING_TO_CONCEIVE_BONUS_BASIS_POINTS : 0),
  );
}

function normalizePendingChecks(
  checks: LuanShiPregnancyState[] | undefined,
): LuanShiPregnancyState[] {
  return sortPendingChecks(
    (checks ?? []).filter((check) => check.status === 'pendingCheck'),
  );
}

function sortPendingChecks(checks: LuanShiPregnancyState[]): LuanShiPregnancyState[] {
  return [...checks].sort((left, right) => {
    const leftClock = resolveClock(left.checkAt);
    const rightClock = resolveClock(right.checkAt);
    if (leftClock && rightClock) return compareClocks(leftClock, rightClock);
    return left.checkAt.localeCompare(right.checkAt);
  });
}

function promoteNextPendingCheck(wombProfile: LuanShiNpcWombProfile): void {
  if (wombProfile.pregnancy) return;
  const queue = normalizePendingChecks(wombProfile.pendingPregnancyChecks);
  const next = queue.shift();
  if (next) wombProfile.pregnancy = next;
  if (queue.length > 0) {
    wombProfile.pendingPregnancyChecks = queue;
  } else {
    delete wombProfile.pendingPregnancyChecks;
  }
}

function resolveCheckDelayDays(check: LuanShiPregnancyState): number | undefined {
  const exposureClock = resolveClock(check.firstExposureAt);
  const checkClock = resolveClock(check.checkAt);
  if (!exposureClock || !checkClock) return undefined;
  const days = differenceInDays(exposureClock, checkClock);
  return days >= CHECK_MIN_DAYS && days < CHECK_MIN_DAYS + CHECK_DAY_SPREAD
    ? days
    : undefined;
}

function isSameGameDay(label: string, currentClock: GameClock): boolean {
  const clock = resolveClock(label);
  return Boolean(clock && toDayIndex(clock) === toDayIndex(currentClock));
}

function appendWombRecord(
  wombProfile: LuanShiNpcWombProfile,
  date: string,
  description: string,
  pregnancyCheckDate: string,
): void {
  wombProfile.inseminationRecords = [
    ...(wombProfile.inseminationRecords ?? []),
    { date, description: description.trim(), pregnancyCheckDate },
  ].slice(-MAX_WOMB_RECORDS);
}

function ensureWombProfile(npc: LuanShiNpc): LuanShiNpcWombProfile {
  npc.femaleProfile ??= {};
  npc.femaleProfile.adultPrivateProfile ??= { enabled: true, ageConfirmedAdult: true };
  npc.femaleProfile.adultPrivateProfile.wombProfile ??= {};
  return npc.femaleProfile.adultPrivateProfile.wombProfile;
}

function appendKinshipBond(state: RuntimeState, childNpcId: string, childName: string, summary: string): void {
  const bondThreadId = `bond_kinship_${childNpcId}`;
  if (state.bondThreads?.some((entry) => entry.bondThreadId === bondThreadId)) return;
  const entry: BondThreadEntry = {
    bondThreadId,
    targetNpcIds: [childNpcId],
    targetNames: [childName],
    bondType: 'kinship',
    status: 'active',
    summary: summary.trim(),
    tags: ['子嗣', '亲属'],
    lastUpdatedAt: state.currentDate,
    source: 'pregnancyLifecycleV1',
  };
  state.bondThreads = [...(state.bondThreads ?? []), entry];
}

function appendTurnEvent(
  state: RuntimeState,
  mother: LuanShiNpc,
  pregnancy: LuanShiPregnancyState,
  summary: string,
  childNpcId: string | undefined,
): void {
  const eventId = `event_${pregnancy.pregnancyId}_resolved`;
  if (state.turnEvents?.some((event) => event.eventId === eventId)) return;
  state.turnEvents = [...(state.turnEvents ?? []), {
    eventId,
    happenedAt: state.currentDate,
    locationId: mother.locationId ?? state.currentLocationId,
    summary: summary.trim(),
    presentNpcIds: [mother.npcId, ...(childNpcId ? [childNpcId] : [])],
    involvedNpcIds: [mother.npcId, ...(childNpcId ? [childNpcId] : [])],
    visibility: pregnancy.disclosure === 'public' ? '公开' : '私密',
  }];
}

function archivePregnancy(wombProfile: LuanShiNpcWombProfile, pregnancy: LuanShiPregnancyState): void {
  if (!pregnancy.resolvedAt || !pregnancy.outcome) return;
  const entry: LuanShiPregnancyHistoryEntry = {
    pregnancyId: pregnancy.pregnancyId,
    outcome: pregnancy.outcome,
    resolvedAt: pregnancy.resolvedAt,
    summary: pregnancy.outcomeSummary ?? '妊娠已经结束。',
    ...(pregnancy.childNpcId ? { childNpcId: pregnancy.childNpcId } : {}),
  };
  const history = (wombProfile.pregnancyHistory ?? []).filter((item) => item.pregnancyId !== entry.pregnancyId);
  wombProfile.pregnancyHistory = [...history, entry].slice(-MAX_HISTORY_RECORDS);
}

function buildPlaceholderChildName(state: RuntimeState, mother: LuanShiNpc, sex: '男' | '女'): string {
  const siblingCount = (state.npcs ?? []).filter((npc) => npc.parentLinks?.motherNpcId === mother.npcId).length;
  return `未命名${sex === '男' ? '男婴' : '女婴'}（${mother.name}第${siblingCount + 1}胎）`;
}

function isAtOrAfter(currentClock: GameClock, label: string | undefined): boolean {
  const target = label ? resolveClock(label) : undefined;
  return Boolean(target && compareClocks(currentClock, target) >= 0);
}

function resolveClock(label: string, clock?: GameClock): GameClock | undefined {
  return clock ? { ...clock } : tryCreateGameClockFromDateLabel(label) ?? createGameClockFromDateLabel(label);
}

function addDays(clock: GameClock, days: number): GameClock {
  return fromMinuteIndex(toMinuteIndex(clock) + Math.max(0, Math.floor(days)) * MINUTES_PER_DAY, clock.hour, clock.minute);
}

function differenceInDays(from: GameClock, to: GameClock): number {
  return Math.floor((toMinuteIndex(to) - toMinuteIndex(from)) / MINUTES_PER_DAY);
}

function compareClocks(left: GameClock, right: GameClock): number {
  return toMinuteIndex(left) - toMinuteIndex(right);
}

function toDayIndex(clock: GameClock): number {
  return ((clock.year - 1) * MONTHS_PER_YEAR + (clock.month - 1)) * DAYS_PER_MONTH + (clock.day - 1);
}

function toMinuteIndex(clock: GameClock): number {
  return toDayIndex(clock) * MINUTES_PER_DAY + clock.hour * 60 + clock.minute;
}

function fromMinuteIndex(minutes: number, fallbackHour: number, fallbackMinute: number): GameClock {
  const dayIndex = Math.floor(minutes / MINUTES_PER_DAY);
  const minuteOfDay = minutes % MINUTES_PER_DAY;
  const year = Math.floor(dayIndex / (MONTHS_PER_YEAR * DAYS_PER_MONTH)) + 1;
  const dayOfYear = dayIndex % (MONTHS_PER_YEAR * DAYS_PER_MONTH);
  const month = Math.floor(dayOfYear / DAYS_PER_MONTH) + 1;
  const day = dayOfYear % DAYS_PER_MONTH + 1;
  const hour = Number.isFinite(minuteOfDay) ? Math.floor(minuteOfDay / 60) : fallbackHour;
  const minute = Number.isFinite(minuteOfDay) ? minuteOfDay % 60 : fallbackMinute;
  return { year, month, day, hour, minute };
}

function stableKey(parts: string[]): string {
  return stableHash(parts.join('|')).toString(36);
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function cloneState(state: RuntimeState): RuntimeState {
  return JSON.parse(JSON.stringify(state)) as RuntimeState;
}

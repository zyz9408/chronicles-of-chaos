import type { LuanShiNpc } from '../types';
import { tryCreateGameClockFromDateLabel, type GameClock } from './gameClock';

interface AgeAnchor {
  year: number;
  month?: number;
  day?: number;
}

export function deriveNpcCurrentAge(npc: LuanShiNpc, currentDate: string): number | undefined {
  const currentAnchor = parseAgeAnchor(currentDate);
  if (!currentAnchor) return getStaticNpcAge(npc);

  const birthAnchor = parseAgeAnchor(npc.birthDate);
  if (birthAnchor) {
    return Math.max(0, calculateAgeFromBirthAnchor(birthAnchor, currentAnchor));
  }

  const staticAge = getStaticNpcAge(npc);
  if (staticAge === undefined) return undefined;

  const knownAtAnchor = parseAgeAnchor(npc.ageKnownAtDate);
  if (!knownAtAnchor) return staticAge;

  const yearDelta = currentAnchor.year - knownAtAnchor.year;
  const anniversaryPassed = hasMonthDay(knownAtAnchor) && hasMonthDay(currentAnchor)
    ? compareMonthDay(currentAnchor, knownAtAnchor) >= 0
    : true;
  const adjustedDelta = yearDelta > 0 && !anniversaryPassed ? yearDelta - 1 : yearDelta;

  return Math.max(0, staticAge + adjustedDelta);
}

export function isAdultFemaleNpcAt(npc: LuanShiNpc, currentDate: string): boolean {
  const age = deriveNpcCurrentAge(npc, currentDate);
  return npc.sex === '女' && age !== undefined && age >= 18;
}

function getStaticNpcAge(npc: LuanShiNpc): number | undefined {
  return Number.isInteger(npc.age) && npc.age > 0 ? npc.age : undefined;
}

function parseAgeAnchor(value?: string | null): AgeAnchor | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;

  const clock = tryCreateGameClockFromDateLabel(value);
  if (clock) {
    return gameClockToAgeAnchor(clock);
  }

  const yearMatch = value.match(/(?:公元)?\s*(\d{1,4})\s*年/);
  if (!yearMatch) return undefined;

  return { year: Number(yearMatch[1]) };
}

function gameClockToAgeAnchor(clock: GameClock): AgeAnchor {
  return {
    year: clock.year,
    month: clock.month,
    day: clock.day,
  };
}

function calculateAgeFromBirthAnchor(birth: AgeAnchor, current: AgeAnchor): number {
  const yearDelta = current.year - birth.year;
  if (yearDelta <= 0) return 0;
  if (!hasMonthDay(birth) || !hasMonthDay(current)) return yearDelta;
  return compareMonthDay(current, birth) >= 0 ? yearDelta : yearDelta - 1;
}

function hasMonthDay(anchor: AgeAnchor): anchor is Required<AgeAnchor> {
  return Number.isInteger(anchor.month) && Number.isInteger(anchor.day);
}

function compareMonthDay(left: Required<AgeAnchor>, right: Required<AgeAnchor>): number {
  if (left.month !== right.month) return left.month - right.month;
  return left.day - right.day;
}

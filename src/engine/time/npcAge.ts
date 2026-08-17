import type { Actor, LuanShiNpc } from '../types';
import { tryCreateGameClockFromDateLabel, type GameClock } from './gameClock';

interface AgeAnchor {
  year: number;
  month?: number;
  day?: number;
}

interface CharacterAgeLike {
  age?: number;
  birthDate?: string;
  ageKnownAtDate?: string;
}

export interface CompleteBirthDateInput {
  age?: number;
  birthDate?: string | null;
  ageKnownAtDate?: string | null;
  currentDate: string;
  stableId: string;
  preferredMonth?: number;
  preferredDay?: number;
}

const MONTHS_PER_YEAR = 12;
const DAYS_PER_MONTH = 30;

/**
 * Normalize a full in-world birth date. Year-only values are deliberately not
 * accepted as canonical birthdays because they cannot support birthday-boundary
 * age derivation.
 */
export function normalizeCompleteBirthDate(value?: string | null): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const normalized = value.trim();
  const chineseMatch = normalized.match(/^(?:公元)?\s*(\d{1,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  const isoMatch = normalized.match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})(?:[ T]|$)/);
  const year = Number(chineseMatch?.[1] ?? isoMatch?.[1]);
  const month = Number(chineseMatch?.[2] ?? isoMatch?.[2]);
  const day = Number(chineseMatch?.[3] ?? isoMatch?.[3]);
  if (!isValidBirthDateParts(year, month, day)) return undefined;
  return formatCompleteBirthDate(year, month, day);
}

export function deriveCurrentAgeFromBirthDate(
  birthDate: string | null | undefined,
  currentDate: string,
): number | undefined {
  const normalizedBirthDate = normalizeCompleteBirthDate(birthDate);
  const currentAnchor = parseAgeAnchor(currentDate);
  if (!normalizedBirthDate || !currentAnchor) return undefined;
  const birthAnchor = parseAgeAnchor(normalizedBirthDate);
  if (!birthAnchor) return undefined;
  return Math.max(0, calculateAgeFromBirthAnchor(birthAnchor, currentAnchor));
}

/**
 * Creates a complete birthday from a legacy age snapshot. The stable id only
 * chooses month/day; no API or random source is involved, so migration is
 * deterministic and idempotent.
 */
export function ensureCompleteBirthDate(input: CompleteBirthDateInput): string | undefined {
  const existing = normalizeCompleteBirthDate(input.birthDate);
  if (existing) return existing;

  const age = normalizeLegacyAge(input.age);
  const anchor = parseAgeAnchor(input.ageKnownAtDate) ?? parseAgeAnchor(input.currentDate);
  if (age === undefined || !anchor) return undefined;

  const stableMonthDay = deriveStableMonthDay(input.stableId);
  const month = normalizeCalendarPart(input.preferredMonth, 1, MONTHS_PER_YEAR) ?? stableMonthDay.month;
  const day = normalizeCalendarPart(input.preferredDay, 1, DAYS_PER_MONTH) ?? stableMonthDay.day;
  const anchorMonth = anchor.month ?? 1;
  const anchorDay = anchor.day ?? 1;
  const birthdayPassed = anchorMonth > month || (anchorMonth === month && anchorDay >= day);
  const birthYear = anchor.year - age - (birthdayPassed ? 0 : 1);
  if (!isValidBirthDateParts(birthYear, month, day)) return undefined;
  return formatCompleteBirthDate(birthYear, month, day);
}

export function deriveActorCurrentAge(actor: Actor, currentDate: string): number | undefined {
  return deriveCharacterCurrentAge(actor, currentDate);
}

export function deriveNpcCurrentAge(npc: LuanShiNpc, currentDate: string): number | undefined {
  return deriveCharacterCurrentAge(npc, currentDate);
}

function deriveCharacterCurrentAge(character: CharacterAgeLike, currentDate: string): number | undefined {
  const currentAnchor = parseAgeAnchor(currentDate);
  if (!currentAnchor) return getStaticAge(character);

  const derivedFromBirthDate = deriveCurrentAgeFromBirthDate(character.birthDate, currentDate);
  if (derivedFromBirthDate !== undefined) return derivedFromBirthDate;

  const staticAge = getStaticAge(character);
  if (staticAge === undefined) return undefined;

  const knownAtAnchor = parseAgeAnchor(character.ageKnownAtDate);
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

function getStaticAge(character: CharacterAgeLike): number | undefined {
  return normalizeLegacyAge(character.age);
}

function normalizeLegacyAge(value: number | undefined): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
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

function deriveStableMonthDay(stableId: string): { month: number; day: number } {
  const hash = stableHash(stableId.trim() || 'character');
  return {
    month: (hash % MONTHS_PER_YEAR) + 1,
    day: (Math.floor(hash / MONTHS_PER_YEAR) % DAYS_PER_MONTH) + 1,
  };
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalizeCalendarPart(value: number | undefined, min: number, max: number): number | undefined {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max
    ? Number(value)
    : undefined;
}

function isValidBirthDateParts(year: number, month: number, day: number): boolean {
  return Number.isInteger(year)
    && year >= 1
    && Number.isInteger(month)
    && month >= 1
    && month <= MONTHS_PER_YEAR
    && Number.isInteger(day)
    && day >= 1
    && day <= DAYS_PER_MONTH;
}

function formatCompleteBirthDate(year: number, month: number, day: number): string {
  return `公元${year}年${String(month).padStart(2, '0')}月${String(day).padStart(2, '0')}日`;
}

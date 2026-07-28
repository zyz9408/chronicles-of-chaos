export interface GameClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface GameClockAdvance {
  minutesAdvanced?: number;
  hoursAdvanced?: number;
  daysAdvanced?: number;
  timeBlocksAdvanced?: number;
}

export interface CalendarEraLike {
  eraId?: string;
  eraName: string;
  startYear: number;
  startMonth?: number;
  startDay?: number;
  source?: string;
}

interface RuntimeClockState {
  currentDate: string;
  currentTime?: GameClock;
}

const DEFAULT_DAY = 1;
const DEFAULT_HOUR = 8;
const DEFAULT_MINUTE = 0;
const DAYS_PER_MONTH = 30;
const MONTHS_PER_YEAR = 12;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const MINUTES_PER_TIME_BLOCK = 2 * MINUTES_PER_HOUR;

const ancientTimeNames = [
  '子时',
  '丑时',
  '寅时',
  '卯时',
  '辰时',
  '巳时',
  '午时',
  '未时',
  '申时',
  '酉时',
  '戌时',
  '亥时',
] as const;

export function createGameClockFromDateLabel(dateLabel: string): GameClock {
  return tryCreateGameClockFromDateLabel(dateLabel)
    ?? buildGameClock({
      year: 1,
      month: 1,
      day: DEFAULT_DAY,
      hour: DEFAULT_HOUR,
      minute: DEFAULT_MINUTE,
    });
}

export function tryCreateGameClockFromDateLabel(dateLabel: string): GameClock | undefined {
  const normalized = dateLabel.trim();
  const chineseMatch = normalized.match(
    /(?:公元)?\s*(\d+)\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?(?:\s*(\d{1,2}):(\d{1,2}))?/,
  );

  if (chineseMatch) {
    return buildGameClock({
      year: Number(chineseMatch[1]),
      month: Number(chineseMatch[2]),
      day: chineseMatch[3] ? Number(chineseMatch[3]) : DEFAULT_DAY,
      hour: chineseMatch[4] ? Number(chineseMatch[4]) : DEFAULT_HOUR,
      minute: chineseMatch[5] ? Number(chineseMatch[5]) : DEFAULT_MINUTE,
    });
  }

  const isoLikeMatch = normalized.match(
    /(\d{1,4})-(\d{1,2})(?:-(\d{1,2}))?(?:[ T](\d{1,2}):(\d{1,2}))?/,
  );

  if (!isoLikeMatch) return undefined;

  return buildGameClock({
    year: Number(isoLikeMatch[1]),
    month: Number(isoLikeMatch[2]),
    day: isoLikeMatch[3] ? Number(isoLikeMatch[3]) : DEFAULT_DAY,
    hour: isoLikeMatch[4] ? Number(isoLikeMatch[4]) : DEFAULT_HOUR,
    minute: isoLikeMatch[5] ? Number(isoLikeMatch[5]) : DEFAULT_MINUTE,
  });
}

export function ensureGameClock(state: RuntimeClockState): GameClock {
  return state.currentTime ?? createGameClockFromDateLabel(state.currentDate);
}

export function advanceRuntimeClock<T extends { currentDate: string; currentTime?: GameClock }>(
  state: T,
  advance: GameClockAdvance,
): T {
  const clock = advanceGameClock(ensureGameClock(state), advance);
  state.currentTime = clock;
  state.currentDate = formatGameClock(clock);
  return state;
}

export function setRuntimeClock<T extends { currentDate: string; currentTime?: GameClock }>(
  state: T,
  clock: GameClock,
): T {
  const normalized = buildGameClock(clock);
  state.currentTime = normalized;
  state.currentDate = formatGameClock(normalized);
  return state;
}

export function advanceGameClock(clock: GameClock, advance: GameClockAdvance): GameClock {
  const minutes =
    Math.max(0, Math.floor(advance.minutesAdvanced ?? 0))
    + Math.max(0, Math.floor(advance.hoursAdvanced ?? 0)) * MINUTES_PER_HOUR
    + Math.max(0, Math.floor(advance.daysAdvanced ?? 0)) * MINUTES_PER_DAY
    + Math.max(0, Math.floor(advance.timeBlocksAdvanced ?? 0)) * MINUTES_PER_TIME_BLOCK;

  if (minutes <= 0) return buildGameClock(clock);

  const totalMinutes = clock.hour * MINUTES_PER_HOUR + clock.minute + minutes;
  let day = clock.day + Math.floor(totalMinutes / MINUTES_PER_DAY);
  const minuteOfDay = totalMinutes % MINUTES_PER_DAY;
  const hour = Math.floor(minuteOfDay / MINUTES_PER_HOUR);
  const minute = minuteOfDay % MINUTES_PER_HOUR;
  let month = clock.month;
  let year = clock.year;

  while (day > DAYS_PER_MONTH) {
    day -= DAYS_PER_MONTH;
    month += 1;
  }

  while (month > MONTHS_PER_YEAR) {
    month -= MONTHS_PER_YEAR;
    year += 1;
  }

  return buildGameClock({ year, month, day, hour, minute });
}

export function formatGameClock(clock: GameClock): string {
  return `公元${clock.year}年${pad2(clock.month)}月${pad2(clock.day)}日 ${pad2(clock.hour)}:${pad2(clock.minute)}（${getAncientTimeName(clock.hour)}）`;
}

export function formatGameDateLabelForStatusBar(
  dateLabel: string,
  clock?: GameClock,
  calendarEras?: CalendarEraLike[],
): string {
  return formatGameDateLabelForEraDisplay(dateLabel, clock, calendarEras);
}

export function formatGameDateLabelForNarrative(
  dateLabel: string,
  clock?: GameClock,
  calendarEras?: CalendarEraLike[],
): string {
  return formatGameDateLabelForEraDisplay(dateLabel, clock, calendarEras);
}

function formatGameDateLabelForEraDisplay(
  dateLabel: string,
  clock?: GameClock,
  calendarEras?: CalendarEraLike[],
): string {
  const parsed = clock ?? tryCreateGameClockFromDateLabel(dateLabel);

  if (parsed) {
    const era = findActiveCalendarEra(parsed, calendarEras);
    const datePart = `${pad2(parsed.month)}月${pad2(parsed.day)}日`;
    const timePart = ` ${pad2(parsed.hour)}:${pad2(parsed.minute)}（${getAncientTimeName(parsed.hour)}）`;
    if (era) {
      return `${era.eraName}${formatEraYear(parsed.year - era.startYear + 1)}年（${parsed.year}年）${datePart}${timePart}`;
    }
    return `${parsed.year}年${datePart}${timePart}`;
  }

  return dateLabel.replace(/公元\s*(\d+)\s*年/g, '$1年');
}

function findActiveCalendarEra(clock: GameClock, calendarEras?: CalendarEraLike[]): CalendarEraLike | undefined {
  const eras = (calendarEras ?? [])
    .filter((era) => typeof era.eraName === 'string' && era.eraName.trim() && Number.isFinite(era.startYear))
    .sort(compareCalendarEra);

  const startedEras = eras.filter((era) => compareEraStartToClock(era, clock) <= 0);
  const runtimeEras = startedEras.filter((era) => !era.source?.endsWith('.defaultEra'));
  return runtimeEras[runtimeEras.length - 1] ?? startedEras[startedEras.length - 1];
}

function compareCalendarEra(a: CalendarEraLike, b: CalendarEraLike): number {
  return (a.startYear - b.startYear)
    || ((a.startMonth ?? 1) - (b.startMonth ?? 1))
    || ((a.startDay ?? 1) - (b.startDay ?? 1));
}

function compareEraStartToClock(era: CalendarEraLike, clock: GameClock): number {
  return (era.startYear - clock.year)
    || ((era.startMonth ?? 1) - clock.month)
    || ((era.startDay ?? 1) - clock.day);
}

function formatEraYear(value: number): string {
  if (value <= 1) return '元';
  return formatChineseInteger(value);
}

function formatChineseInteger(value: number): string {
  const normalized = Math.max(1, Math.floor(value));
  if (normalized > 99) return String(normalized);

  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (normalized < 10) return digits[normalized];
  if (normalized === 10) return '十';
  if (normalized < 20) return `十${digits[normalized % 10]}`;

  const tens = Math.floor(normalized / 10);
  const ones = normalized % 10;
  return ones === 0 ? `${digits[tens]}十` : `${digits[tens]}十${digits[ones]}`;
}

export function getAncientTimeName(hour: number): string {
  const normalizedHour = ((Math.floor(hour) % 24) + 24) % 24;
  const index = normalizedHour >= 23 ? 0 : Math.floor((normalizedHour + 1) / 2);
  return ancientTimeNames[index];
}

function buildGameClock(input: GameClock): GameClock {
  return {
    year: Math.max(1, Math.floor(input.year)),
    month: clamp(Math.floor(input.month), 1, MONTHS_PER_YEAR),
    day: clamp(Math.floor(input.day), 1, DAYS_PER_MONTH),
    hour: clamp(Math.floor(input.hour), 0, 23),
    minute: clamp(Math.floor(input.minute), 0, 59),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

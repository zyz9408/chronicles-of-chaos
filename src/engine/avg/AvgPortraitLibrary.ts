export const AVG_PORTRAIT_MATCH_PROFILE_VERSION = 1 as const;

export type AvgPortraitSex = 'male' | 'female';
export type AvgPortraitAgeBand = 'child' | 'teen' | 'young_adult' | 'adult' | 'middle_aged' | 'elderly' | 'unknown';

export interface AvgPortraitMatchProfile {
  schemaVersion: typeof AVG_PORTRAIT_MATCH_PROFILE_VERSION;
  sex: AvgPortraitSex;
  ageBand: AvgPortraitAgeBand;
  roleFamily: string;
  professionTags: string[];
  socialTierTags: string[];
}

export interface AvgPortraitMatchProfileInput {
  sex?: string;
  age?: number;
  ageBand?: string;
  roleFamily?: string;
  professionTags?: Array<string | undefined>;
  socialTierTags?: Array<string | undefined>;
}

function normalizeText(value: string | undefined, limit = 64): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase()
    .slice(0, limit);
}

function normalizeSex(value: string | undefined): AvgPortraitSex | undefined {
  const normalized = normalizeText(value);
  if (normalized === '男' || normalized === 'male') return 'male';
  if (normalized === '女' || normalized === 'female') return 'female';
  return undefined;
}

function ageBandFromAge(age: number | undefined): AvgPortraitAgeBand | undefined {
  if (!Number.isFinite(age) || age === undefined || age < 0) return undefined;
  if (age < 13) return 'child';
  if (age < 18) return 'teen';
  if (age < 30) return 'young_adult';
  if (age < 50) return 'adult';
  if (age < 65) return 'middle_aged';
  return 'elderly';
}

function normalizeAgeBand(value: string | undefined, age: number | undefined): AvgPortraitAgeBand {
  const normalized = normalizeText(value).replace(/[\s-]+/gu, '_');
  if (['child', 'teen', 'young_adult', 'adult', 'middle_aged', 'elderly', 'unknown'].includes(normalized)) {
    return normalized as AvgPortraitAgeBand;
  }
  return ageBandFromAge(age) ?? 'unknown';
}

function normalizeTags(values: Array<string | undefined> | undefined): string[] {
  return [...new Set((values ?? []).map((value) => normalizeText(value)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .slice(0, 12);
}

export function createAvgPortraitMatchProfile(input: AvgPortraitMatchProfileInput): AvgPortraitMatchProfile | undefined {
  const sex = normalizeSex(input.sex);
  if (!sex) return undefined;
  return {
    schemaVersion: AVG_PORTRAIT_MATCH_PROFILE_VERSION,
    sex,
    ageBand: normalizeAgeBand(input.ageBand, input.age),
    roleFamily: normalizeText(input.roleFamily),
    professionTags: normalizeTags(input.professionTags),
    socialTierTags: normalizeTags(input.socialTierTags),
  };
}

export function isAvgPortraitMatchProfile(value: unknown): value is AvgPortraitMatchProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  return profile.schemaVersion === AVG_PORTRAIT_MATCH_PROFILE_VERSION
    && (profile.sex === 'male' || profile.sex === 'female')
    && typeof profile.ageBand === 'string'
    && ['child', 'teen', 'young_adult', 'adult', 'middle_aged', 'elderly', 'unknown'].includes(profile.ageBand)
    && typeof profile.roleFamily === 'string'
    && profile.roleFamily.length <= 64
    && Array.isArray(profile.professionTags)
    && profile.professionTags.length <= 12
    && profile.professionTags.every((tag) => typeof tag === 'string' && tag.length > 0 && tag.length <= 64)
    && Array.isArray(profile.socialTierTags)
    && profile.socialTierTags.length <= 12
    && profile.socialTierTags.every((tag) => typeof tag === 'string' && tag.length > 0 && tag.length <= 64);
}

export function avgPortraitProfileKey(profile: AvgPortraitMatchProfile): string {
  const serialized = JSON.stringify(profile);
  let hash = 2166136261;
  for (const character of serialized) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${profile.sex}-${profile.ageBand}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function stableIndex(value: string, length: number): number {
  let hash = 2166136261;
  for (const character of value.normalize('NFKC')) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

function partialRoleMatch(left: string, right: string): boolean {
  return left.length >= 2 && right.length >= 2 && (left.includes(right) || right.includes(left));
}

function roleGroup(value: string): string {
  if (/守卒|守军|守卫|卫兵|士卒|军士|士兵|步卒|差役|门卒|什长|soldier|guard/u.test(value)) return 'soldier';
  if (/掌柜|商贩|商人|店家|伙计|merchant|shopkeeper/u.test(value)) return 'merchant';
  return value;
}

function overlap(left: string[], right: string[]): number {
  const rightSet = new Set(right);
  return left.filter((tag) => rightSet.has(tag)).length;
}

export function scoreAvgPortraitSimilarity(subject: AvgPortraitMatchProfile, candidate: AvgPortraitMatchProfile): number | undefined {
  if (subject.sex !== candidate.sex) return undefined;
  // Unknown ages and child/teen/adult groups must not borrow one another's artwork.
  if (subject.ageBand === 'unknown' || candidate.ageBand === 'unknown') return undefined;
  const minor = (band: AvgPortraitAgeBand) => band === 'child' || band === 'teen';
  if ((minor(subject.ageBand) || minor(candidate.ageBand)) && subject.ageBand !== candidate.ageBand) return undefined;
  const roleMatches = Boolean(subject.roleFamily && candidate.roleFamily
    && (roleGroup(subject.roleFamily) === roleGroup(candidate.roleFamily) || partialRoleMatch(subject.roleFamily, candidate.roleFamily)));
  const professionMatches = overlap(subject.professionTags, candidate.professionTags);
  if (!roleMatches && professionMatches === 0) return undefined;
  let score = 100;
  const ages = ['child', 'teen', 'young_adult', 'adult', 'middle_aged', 'elderly'];
  if (Math.abs(ages.indexOf(subject.ageBand) - ages.indexOf(candidate.ageBand)) > 1) return undefined;
  score += subject.ageBand === candidate.ageBand ? 28 : -10;
  if (subject.roleFamily && candidate.roleFamily) {
    score += subject.roleFamily === candidate.roleFamily ? 42 : partialRoleMatch(subject.roleFamily, candidate.roleFamily) ? 18 : 0;
  }
  score += Math.min(professionMatches, 3) * 16;
  score += Math.min(overlap(subject.socialTierTags, candidate.socialTierTags), 3) * 7;
  return score;
}

export function selectSimilarAvgPortraitCandidate<T extends { key: string; portraitProfile?: AvgPortraitMatchProfile }>(
  subject: AvgPortraitMatchProfile,
  actorId: string,
  candidates: readonly T[],
  random?: () => number,
): T | undefined {
  const scored = candidates.flatMap((candidate) => {
    if (!candidate.portraitProfile || !isAvgPortraitMatchProfile(candidate.portraitProfile)) return [];
    const score = scoreAvgPortraitSimilarity(subject, candidate.portraitProfile);
    return score === undefined ? [] : [{ candidate, score }];
  });
  if (!scored.length) return undefined;
  const bestScore = Math.max(...scored.map((entry) => entry.score));
  const best = scored
    .filter((entry) => entry.score === bestScore)
    .map((entry) => entry.candidate)
    .sort((left, right) => left.key.localeCompare(right.key));
  return best[random ? Math.min(best.length - 1, Math.max(0, Math.floor(random() * best.length))) : stableIndex(actorId, best.length)];
}

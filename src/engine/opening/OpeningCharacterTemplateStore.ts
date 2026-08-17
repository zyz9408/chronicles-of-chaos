import type { CharacterTrait, OpeningCharacterOption } from '../types';

export const OPENING_CHARACTER_TEMPLATES_STORAGE_KEY = 'coc_v2_opening_character_templates';
export const OPENING_CHARACTER_TEMPLATE_LIMIT = 40;

export type OpeningCharacterTemplateMode = 'original' | 'historical';
export type OpeningCharacterTemplateSex = '男' | '女' | '其他';

export interface OpeningCharacterTemplateProfile {
  playerMode: OpeningCharacterTemplateMode;
  playerName: string;
  historicalName: string;
  courtesyName: string;
  sex: OpeningCharacterTemplateSex;
  age: number;
  /** Optional for backward compatibility with templates saved before birthday selection. */
  birthMonth?: number;
  /** Optional for backward compatibility with templates saved before birthday selection. */
  birthDay?: number;
  appearance: string;
  personality: string;
  customNotes: string;
  /** Optional for backward compatibility; blank opening requests are not persisted. */
  playerExtraRequest?: string;
  abilityPresetId: string;
  abilityBaseScores: Record<string, number>;
  abilityScores: Record<string, number>;
  birthOrigin: OpeningCharacterOption | null;
  identity: OpeningCharacterOption | null;
  traits: CharacterTrait[];
}

export interface OpeningCharacterTemplate {
  id: string;
  version: 1;
  label: string;
  worldBookId: string;
  createdAt: string;
  updatedAt: string;
  profile: OpeningCharacterTemplateProfile;
}

type TemplateStorage = Pick<Storage, 'getItem' | 'setItem'>;

function getDefaultStorage(storage?: TemplateStorage | null): TemplateStorage | null {
  if (storage !== undefined) return storage;
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function trimText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeScores(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const scores: Record<string, number> = {};
  for (const [key, rawScore] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = trimText(key, 24);
    const score = typeof rawScore === 'number' ? rawScore : Number(rawScore);
    if (!normalizedKey || !Number.isFinite(score)) continue;
    scores[normalizedKey] = Math.max(1, Math.min(99, Math.round(score)));
  }
  return scores;
}

function normalizeOption(value: unknown): OpeningCharacterOption | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = trimText(record.id, 120);
  const label = trimText(record.label, 80);
  if (!id || !label) return null;
  const description = trimText(record.description, 1200);
  return { id, label, ...(description ? { description } : {}) };
}

function normalizeTrait(value: unknown): CharacterTrait | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = trimText(record.id, 120);
  const label = trimText(record.label, 80);
  if (!id || !label) return null;
  return {
    id,
    label,
    description: trimText(record.description, 1200),
    source: trimText(record.source, 40) || 'opening',
    ...(trimText(record.rarity, 20) ? { rarity: trimText(record.rarity, 20) } : {}),
    ...(trimText(record.promptHint, 1200) ? { promptHint: trimText(record.promptHint, 1200) } : {}),
  };
}

export function normalizeOpeningCharacterTemplate(raw: unknown): OpeningCharacterTemplate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const profileRecord = record.profile;
  if (!profileRecord || typeof profileRecord !== 'object' || Array.isArray(profileRecord)) return null;
  const profile = profileRecord as Record<string, unknown>;
  const id = trimText(record.id, 120);
  const label = trimText(record.label, 80);
  const worldBookId = trimText(record.worldBookId, 120);
  if (!id || !label || !worldBookId) return null;

  const playerMode: OpeningCharacterTemplateMode = profile.playerMode === 'historical'
    ? 'historical'
    : 'original';
  const sex: OpeningCharacterTemplateSex = profile.sex === '女' || profile.sex === '其他'
    ? profile.sex
    : '男';
  const ageValue = typeof profile.age === 'number' ? profile.age : Number(profile.age);
  const birthMonthValue = typeof profile.birthMonth === 'number' ? profile.birthMonth : Number(profile.birthMonth);
  const birthDayValue = typeof profile.birthDay === 'number' ? profile.birthDay : Number(profile.birthDay);
  const traits = Array.isArray(profile.traits)
    ? profile.traits.map(normalizeTrait).filter((trait): trait is CharacterTrait => Boolean(trait)).slice(0, 3)
    : [];
  const createdAt = trimText(record.createdAt, 40);
  const updatedAt = trimText(record.updatedAt, 40);
  const playerExtraRequest = trimText(profile.playerExtraRequest, 6000);

  return {
    id,
    version: 1,
    label,
    worldBookId,
    createdAt: createdAt || new Date(0).toISOString(),
    updatedAt: updatedAt || createdAt || new Date(0).toISOString(),
    profile: {
      playerMode,
      playerName: trimText(profile.playerName, 80) || '无名氏',
      historicalName: trimText(profile.historicalName, 80),
      courtesyName: trimText(profile.courtesyName, 80),
      sex,
      age: Number.isFinite(ageValue) ? Math.max(1, Math.min(120, Math.round(ageValue))) : 18,
      ...(Number.isInteger(birthMonthValue) && birthMonthValue >= 1 && birthMonthValue <= 12
        ? { birthMonth: birthMonthValue }
        : {}),
      ...(Number.isInteger(birthDayValue) && birthDayValue >= 1 && birthDayValue <= 30
        ? { birthDay: birthDayValue }
        : {}),
      appearance: trimText(profile.appearance, 4000),
      personality: trimText(profile.personality, 4000),
      customNotes: trimText(profile.customNotes, 6000),
      ...(playerExtraRequest ? { playerExtraRequest } : {}),
      abilityPresetId: trimText(profile.abilityPresetId, 120) || 'custom',
      abilityBaseScores: normalizeScores(profile.abilityBaseScores),
      abilityScores: normalizeScores(profile.abilityScores),
      birthOrigin: normalizeOption(profile.birthOrigin),
      identity: normalizeOption(profile.identity),
      traits,
    },
  };
}

export function loadOpeningCharacterTemplates(
  storage?: TemplateStorage | null,
): OpeningCharacterTemplate[] {
  const target = getDefaultStorage(storage);
  if (!target) return [];
  const payload = target.getItem(OPENING_CHARACTER_TEMPLATES_STORAGE_KEY);
  if (!payload) return [];

  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeOpeningCharacterTemplate)
      .filter((template): template is OpeningCharacterTemplate => Boolean(template))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, OPENING_CHARACTER_TEMPLATE_LIMIT);
  } catch {
    return [];
  }
}

function writeOpeningCharacterTemplates(
  templates: OpeningCharacterTemplate[],
  storage?: TemplateStorage | null,
): OpeningCharacterTemplate[] {
  const normalized = templates
    .map(normalizeOpeningCharacterTemplate)
    .filter((template): template is OpeningCharacterTemplate => Boolean(template))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, OPENING_CHARACTER_TEMPLATE_LIMIT);
  const target = getDefaultStorage(storage);
  if (target) {
    target.setItem(OPENING_CHARACTER_TEMPLATES_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

function createTemplateId(now: Date): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `opening_character_${crypto.randomUUID()}`;
  }
  return `opening_character_${now.getTime()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function saveOpeningCharacterTemplate(
  input: {
    id?: string;
    label: string;
    worldBookId: string;
    profile: OpeningCharacterTemplateProfile;
  },
  storage?: TemplateStorage | null,
  now: Date = new Date(),
): OpeningCharacterTemplate[] {
  const existing = loadOpeningCharacterTemplates(storage);
  const current = input.id ? existing.find((template) => template.id === input.id) : undefined;
  const template = normalizeOpeningCharacterTemplate({
    id: current?.id ?? createTemplateId(now),
    version: 1,
    label: input.label,
    worldBookId: input.worldBookId,
    createdAt: current?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    profile: input.profile,
  });
  if (!template) return existing;
  return writeOpeningCharacterTemplates(
    [template, ...existing.filter((item) => item.id !== template.id)],
    storage,
  );
}

export function deleteOpeningCharacterTemplate(
  templateId: string,
  storage?: TemplateStorage | null,
): OpeningCharacterTemplate[] {
  return writeOpeningCharacterTemplates(
    loadOpeningCharacterTemplates(storage).filter((template) => template.id !== templateId),
    storage,
  );
}

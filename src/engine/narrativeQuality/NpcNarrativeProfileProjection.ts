import type { LuanShiNpc } from '../types';

export const NPC_NARRATIVE_PROFILE_LIMITS = {
  summary: 112,
  personality: 88,
  motivation: 88,
  appearance: 72,
} as const;

const PLACEHOLDER_VALUES = new Set([
  '未知',
  '不详',
  '暂无',
  '无',
  '待补充',
  '略',
  '普通',
  '正常',
]);

const APPEARANCE_OBSERVATION_TERMS = [
  '观察',
  '端详',
  '打量',
  '审视',
  '查看',
  '看向',
  '相貌',
  '外貌',
  '衣着',
  '装束',
  '神色',
  '身形',
  '伤势',
];

export interface BuildNpcNarrativeProfileProjectionOptions {
  playerInput: string;
}

export interface NpcNarrativeProfileProjection {
  parts: string[];
  includesAppearance: boolean;
}

export function buildNpcNarrativeProfileProjection(
  npc: LuanShiNpc,
  options: BuildNpcNarrativeProfileProjectionOptions,
): NpcNarrativeProfileProjection {
  const parts: string[] = [];

  pushBoundedField(parts, '人物定位', npc.summary, NPC_NARRATIVE_PROFILE_LIMITS.summary);
  pushBoundedField(parts, '核心性格', npc.personality, NPC_NARRATIVE_PROFILE_LIMITS.personality);
  pushBoundedField(parts, '当前动机', npc.motivation, NPC_NARRATIVE_PROFILE_LIMITS.motivation);

  const includesAppearance = shouldProjectStableAppearance(npc, options.playerInput);
  if (includesAppearance) {
    pushBoundedField(parts, '稳定外貌', npc.appearance, NPC_NARRATIVE_PROFILE_LIMITS.appearance);
  }

  return { parts, includesAppearance };
}

function shouldProjectStableAppearance(npc: LuanShiNpc, playerInput: string): boolean {
  if (npc.contactLevel <= 0) return true;

  const normalizedInput = normalizeText(playerInput);
  if (!normalizedInput || !APPEARANCE_OBSERVATION_TERMS.some((term) => normalizedInput.includes(term))) {
    return false;
  }

  return collectNpcReferenceTerms(npc).some((term) => normalizedInput.includes(term));
}

function collectNpcReferenceTerms(npc: LuanShiNpc): string[] {
  return [npc.name, npc.courtesyName, npc.artName, npc.commonAddress, ...(npc.aliases ?? [])]
    .map(normalizeText)
    .filter((term) => term.length >= 2);
}

function pushBoundedField(parts: string[], label: string, value: string | undefined, limit: number): void {
  const normalized = normalizeText(value);
  if (!normalized || PLACEHOLDER_VALUES.has(normalized)) return;
  parts.push(`${label}：${truncateUnicode(normalized, limit)}`);
}

function normalizeText(value: string | undefined): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function truncateUnicode(value: string, limit: number): string {
  const characters = Array.from(value);
  if (characters.length <= limit) return value;
  return `${characters.slice(0, Math.max(1, limit - 1)).join('')}…`;
}

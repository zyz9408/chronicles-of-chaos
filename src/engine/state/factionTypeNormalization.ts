const FACTION_TYPE_ALIASES: Record<string, string> = {
  empire: '朝廷',
  court: '朝廷',
  imperial_court: '朝廷',
  imperialCourt: '朝廷',
  state: '政权',
  regime: '政权',
  local_government: '地方官府',
  localGovernment: '地方官府',
  government: '地方官府',
  provincial_commission: '地方官府',
  military: '军府',
  military_government: '军府',
  military_group: '军府',
  warlord: '军阀集团',
  warlord_group: '军阀集团',
  regional_power: '军阀集团',
  regional_regime: '军阀集团',
  local_power: '地方势力',
  local_regime: '地方势力',
  clan: '豪族宗族',
  elite_clan: '豪族宗族',
  noble_clan: '豪族宗族',
  gentry: '豪族宗族',
  local_clan: '豪族宗族',
  rebel: '叛乱组织',
  rebels: '叛乱组织',
  bandit: '盗匪流寇',
  bandits: '盗匪流寇',
  religious: '宗教组织',
  organization: '组织',
  other: '其他',
};

export const FACTION_TYPE_CANONICAL_LABELS = [
  '朝廷',
  '政权',
  '地方官府',
  '军府',
  '军阀集团',
  '地方势力',
  '豪族宗族',
  '叛乱组织',
  '盗匪流寇',
  '宗教组织',
  '士人社群',
  '游侠组织',
  '宗族武装',
  '组织',
  '其他',
] as const;

const CANONICAL_TYPE_SET = new Set<string>(FACTION_TYPE_CANONICAL_LABELS);

export function normalizeFactionType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (CANONICAL_TYPE_SET.has(text)) return text;
  return FACTION_TYPE_ALIASES[text] ?? FACTION_TYPE_ALIASES[text.toLowerCase()];
}

export function formatFactionTypeForDisplay(value?: string, fallback = '势力类型待核'): string {
  const text = value?.trim();
  if (!text) return fallback;
  return normalizeFactionType(text) ?? (looksLikeEngineeringFactionType(text) ? fallback : text);
}

export function looksLikeEngineeringFactionType(value: string): boolean {
  return /[A-Za-z_]/.test(value);
}

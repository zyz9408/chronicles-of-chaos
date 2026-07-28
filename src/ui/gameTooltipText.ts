import type { CharacterCheckHook, CharacterEquipmentItem, CharacterTrait, CharacterTraitRarity, CharacterUniqueArt } from '../engine/types';

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const traitRarityValues: CharacterTraitRarity[] = ['white', 'green', 'blue', 'red', 'gold'];
const traitRaritySet = new Set<string>(traitRarityValues);
const equipmentQualityLabels: Record<string, string> = {
  normal: '普通',
  common: '普通',
  standard: '普通',
  fine: '精良',
};

export const TRAIT_RARITY_LABELS: Record<CharacterTraitRarity, string> = {
  white: '白',
  green: '绿',
  blue: '蓝',
  red: '红',
  gold: '金',
};

export const UNIQUE_ART_DOMAIN_LABELS: Record<string, string> = {
  personalCombat: '个人战',
  warfare: '军略',
  strategy: '谋略',
  social: '交涉',
  governance: '治理',
  survival: '生存',
  craft: '技艺',
  other: '其他',
};

export const COMMON_SOURCE_LABELS: Record<string, string> = {
  birthOrigin: '出身',
  opening: '开局',
  event: '剧情事件',
  turn: '当前回合',
  memory: '记忆沉淀',
  worldbook: '世界书',
  knowledgeBase: '资料库',
  storyPack: '剧情包',
  system: '系统记录',
  player: '主角经历',
  npc: '人物档案',
  origin: '出身',
  identity: '身份',
  history: '史实资料',
  observation: '现场观察',
  'runtime.story': '剧情推进',
  writeback: '剧情记录',
  unknown: '未记录',
};

const CHECK_SCOPE_LABELS: Record<string, string> = {
  personalCombat: UNIQUE_ART_DOMAIN_LABELS.personalCombat,
  warfare: UNIQUE_ART_DOMAIN_LABELS.warfare,
  strategy: UNIQUE_ART_DOMAIN_LABELS.strategy,
  social: UNIQUE_ART_DOMAIN_LABELS.social,
  governance: UNIQUE_ART_DOMAIN_LABELS.governance,
  survival: UNIQUE_ART_DOMAIN_LABELS.survival,
  craft: UNIQUE_ART_DOMAIN_LABELS.craft,
  other: UNIQUE_ART_DOMAIN_LABELS.other,
  cavalry: '骑兵',
  infantry: '步卒',
  duel: '单挑',
  battle: '战阵',
  intrigue: '权谋',
  diplomacy: '交涉',
  administration: '政务',
  logistics: '后勤',
  investigation: '侦察',
  persuasion: '说服',
};

export const TRAIT_RARITY_DESCRIPTIONS: Record<CharacterTraitRarity, string> = {
  white: '普通特质，主要提供人物气质、习惯和叙事参考。',
  green: '较明显特质，相关场景中更容易被模型采纳。',
  blue: '强特质，常会影响选择、交涉、战斗或判定倾向。',
  red: '危险或压迫性强特质，会明显改变他人反应与局势风险。',
  gold: '核心传奇级特质，属于人物定位级能力，关键场景优先作为叙事依据。',
};

export const TRAIT_RARITY_LEGEND_TITLE = [
  '特质等级说明',
  `白：${TRAIT_RARITY_DESCRIPTIONS.white}`,
  `绿：${TRAIT_RARITY_DESCRIPTIONS.green}`,
  `蓝：${TRAIT_RARITY_DESCRIPTIONS.blue}`,
  `红：${TRAIT_RARITY_DESCRIPTIONS.red}`,
  `金：${TRAIT_RARITY_DESCRIPTIONS.gold}`,
  '颜色越高代表叙事权重越高，更容易在对应场景中影响模型写法和轻量判定。',
  '它不等于固定数值加成；具体效果仍由正文、promptHint、判定钩子和剧情语境共同决定。',
].join('\n');

export function normalizeTraitRarity(value?: string | null): CharacterTraitRarity {
  if (!hasText(value)) return 'white';
  const normalized = value.trim().toLocaleLowerCase();
  return traitRaritySet.has(normalized) ? (normalized as CharacterTraitRarity) : 'white';
}

export function formatEquipmentQualityLabel(value?: string | null): string {
  if (!hasText(value)) return '';
  const quality = value.trim();
  const normalized = quality.toLocaleLowerCase();
  return traitRaritySet.has(normalized)
    ? TRAIT_RARITY_LABELS[normalized as CharacterTraitRarity]
    : equipmentQualityLabels[normalized] ?? quality;
}

export function formatUniqueArtDomainLabel(value?: string | null): string {
  if (!hasText(value)) return UNIQUE_ART_DOMAIN_LABELS.other;
  const key = value.trim();
  return UNIQUE_ART_DOMAIN_LABELS[key] ?? key;
}

export function formatKnownSourceLabel(value?: string | null): string {
  if (!hasText(value)) return '未记录';
  const key = value.trim();
  return COMMON_SOURCE_LABELS[key] ?? key;
}

function formatCheckScope(scope?: string | null): string {
  if (!hasText(scope)) return '相关判定';
  const parts = scope.trim().split(/[./:]/).filter(hasText);
  if (parts.length === 0) return scope.trim();
  return parts.map((part) => CHECK_SCOPE_LABELS[part] ?? part).join('·');
}

function formatCheckHook(hook: CharacterCheckHook): string {
  const scope = formatCheckScope(hook.scope);
  const modifier = typeof hook.modifier === 'number' && Number.isFinite(hook.modifier)
    ? ` ${hook.modifier >= 0 ? '+' : ''}${hook.modifier}`
    : '';
  const note = hasText(hook.note) ? `，${hook.note.trim()}` : '';
  return `${scope}${modifier}${note}`;
}

export function buildTraitTooltipTitle(trait: CharacterTrait): string {
  const label = hasText(trait.label) ? trait.label.trim() : '未命名特质';
  const rarity = normalizeTraitRarity(trait.rarity);
  const lines = [
    `${label}：${hasText(trait.description) ? trait.description.trim() : '暂无说明。'}`,
    `等级：${TRAIT_RARITY_LABELS[rarity]}，${TRAIT_RARITY_DESCRIPTIONS[rarity]}`,
  ];

  if (hasText(trait.promptHint)) {
    lines.push(`叙事作用：${trait.promptHint.trim()}`);
  }
  if (trait.checkHooks?.length) {
    lines.push(`判定倾向：${trait.checkHooks.map(formatCheckHook).join('；')}`);
  }
  return lines.join('\n');
}

export function buildUniqueArtTooltipTitle(art: CharacterUniqueArt): string {
  const name = hasText(art.name) ? art.name.trim() : '未命名绝艺';
  const rarity = normalizeTraitRarity(art.rarity);
  const levelText = art.maxLevel ? `Lv.${art.level} / ${art.maxLevel}` : `Lv.${art.level}`;
  const lines = [
    `${name}：${hasText(art.description) ? art.description.trim() : '暂无说明。'}`,
    `品级：${TRAIT_RARITY_LABELS[rarity]}：${TRAIT_RARITY_DESCRIPTIONS[rarity]}`,
    `领域：${formatUniqueArtDomainLabel(art.domain)}`,
    `等级：${levelText}`,
    `功效：${art.effectSummary}`,
  ];

  if (typeof art.progress === 'number' && Number.isFinite(art.progress)) {
    lines.push(`进度：${Math.max(0, Math.min(100, Math.round(art.progress)))}%`);
  }
  if (hasText(art.promptHint)) {
    lines.push(`叙事作用：${art.promptHint.trim()}`);
  }
  if (art.checkHooks?.length) {
    lines.push(`判定倾向：${art.checkHooks.map(formatCheckHook).join('；')}`);
  }
  if (art.tags?.length) {
    lines.push(`标签：${art.tags.filter(hasText).map((value) => value.trim()).join('；')}`);
  }
  return lines.filter(hasText).join('\n');
}

interface EquipmentWithBonuses extends CharacterEquipmentItem {
  statBonuses?: Record<string, number>;
}

function formatStatBonus([label, value]: [string, number]): string {
  return `${label} ${value >= 0 ? '+' : ''}${value}`;
}

export function buildEquipmentTooltipTitle(item?: CharacterEquipmentItem): string {
  if (!item) return '未装备';

  const equipment = item as EquipmentWithBonuses;
  const lines = [
    item.name,
    `品质：${formatEquipmentQualityLabel(item.quality)}`,
  ];

  if (hasText(item.description)) {
    lines.push(`说明：${item.description.trim()}`);
  }
  if (hasText(item.condition)) {
    lines.push(`状态：${item.condition.trim()}`);
  }
  if (equipment.statBonuses) {
    const statBonuses = Object.entries(equipment.statBonuses)
      .filter((entry): entry is [string, number] => hasText(entry[0]) && typeof entry[1] === 'number' && Number.isFinite(entry[1]))
      .map(formatStatBonus);
    if (statBonuses.length) {
      lines.push(`属性：${statBonuses.join('，')}`);
    }
  }
  if (item.checkHooks?.length) {
    lines.push(`作用：${item.checkHooks.map(formatCheckHook).join('；')}`);
  }
  if (hasText(item.promptHint)) {
    lines.push(`叙事提示：${item.promptHint.trim()}`);
  }
  if (item.unlocks?.length) {
    lines.push(`可解锁：${item.unlocks.filter(hasText).map((value) => value.trim()).join('；')}`);
  }
  if (item.risks?.length) {
    lines.push(`风险：${item.risks.filter(hasText).map((value) => value.trim()).join('；')}`);
  }

  return lines.filter(hasText).join('\n');
}

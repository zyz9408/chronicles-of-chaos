import type { Actor, CharacterEquipmentItem, CharacterTraitRarity } from '../engine/types';
import type { LongTermMemoryFact, MemoryArchive, MemoryImportance } from '../engine/types/memory';
import { formatCurrency } from '../engine/character/currency';
import { getFameTierLabel, getMoralityTierLabel } from '../engine/character/reputation';
import { buildEquipmentTooltipTitle, buildTraitTooltipTitle, buildUniqueArtTooltipTitle, formatKnownSourceLabel, normalizeTraitRarity } from './gameTooltipText';

export interface PlayerProfileRow {
  label: string;
  value: string;
  detail?: string;
  tooltip?: string;
}

export interface PlayerProfileCard {
  label: string;
  kind: 'trait' | 'uniqueArt' | 'buff' | 'debuff' | 'mixed';
  tooltip?: string;
  rarity?: CharacterTraitRarity;
}

export interface PlayerProfileMemorySection {
  title: string;
  description?: string;
  rows: PlayerProfileRow[];
}

export interface PlayerProfileReputationModel {
  fame: number;
  morality: number;
  fameLabel: string;
  moralityLabel: string;
  fameDisplay: string;
  moralityDisplay: string;
  tags: string[];
  summary?: string;
}

export interface PlayerProfilePanelModel {
  title: string;
  subtitle: string;
  summaryRows: PlayerProfileRow[];
  basicRows: PlayerProfileRow[];
  identityRows: PlayerProfileRow[];
  narrativeRows: PlayerProfileRow[];
  traitCards: PlayerProfileCard[];
  uniqueArtCards: PlayerProfileCard[];
  effectCards: PlayerProfileCard[];
  equipmentRows: PlayerProfileRow[];
  inventoryRows: PlayerProfileRow[];
  inventoryPreview: string[];
  reputation?: PlayerProfileReputationModel;
  memoryRows: PlayerProfileRow[];
  memorySections: PlayerProfileMemorySection[];
}

const equipmentSlotLabels: Record<CharacterEquipmentItem['slot'], string> = {
  weapon: '武器',
  armor: '防具',
  mount: '坐骑',
  treasure: '宝物',
};

const inventoryCategoryLabels: Record<string, string> = {
  equipment: '装备',
  document: '文书',
  token: '凭证',
  consumable: '消耗品',
  supply: '补给',
  material: '材料',
  misc: '杂物',
};

const longTermFactCategoryLabels: Record<LongTermMemoryFact['category'], string> = {
  identity: '身份',
  promise: '承诺',
  enmity: '仇怨',
  relationship: '关系',
  world: '世界局势',
  location: '地点',
  consequence: '后果',
  other: '其他',
};

const memoryImportanceLabels: Record<MemoryImportance, string> = {
  low: '一般',
  medium: '中等',
  high: '重要',
  critical: '关键',
};

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function pushTextRow(rows: PlayerProfileRow[], label: string, value?: string | null, detail?: string | null): void {
  if (!hasText(value)) return;
  rows.push({
    label,
    value: value.trim(),
    ...(hasText(detail) ? { detail: detail.trim() } : {}),
  });
}

function pushMemorySection(
  sections: PlayerProfileMemorySection[],
  title: string,
  rows: PlayerProfileRow[],
  description?: string,
): void {
  if (rows.length === 0) return;
  sections.push({
    title,
    rows,
    ...(hasText(description) ? { description } : {}),
  });
}

function buildSubtitle(player: Actor): string {
  const parts: string[] = [];
  if (hasText(player.courtesyName)) parts.push(`字${player.courtesyName.trim()}`);
  if (hasText(player.artName)) parts.push(`号${player.artName.trim()}`);
  if (hasText(player.commonAddress)) parts.push(player.commonAddress.trim());
  return parts.join(' · ');
}

function buildReputationModel(player: Actor): PlayerProfileReputationModel | undefined {
  const reputation = player.reputation;
  if (!reputation) return undefined;

  const fameLabel = getFameTierLabel(reputation.fame);
  const moralityLabel = getMoralityTierLabel(reputation.morality);

  return {
    fame: reputation.fame,
    morality: reputation.morality,
    fameLabel,
    moralityLabel,
    fameDisplay: fameLabel,
    moralityDisplay: moralityLabel,
    tags: reputation.tags
      .filter((tag) => hasText(tag.label))
      .map((tag) => `${tag.label.trim()}${hasText(tag.source) ? `（${formatKnownSourceLabel(tag.source)}）` : ''}`),
    ...(hasText(reputation.summary) ? { summary: reputation.summary.trim() } : {}),
  };
}

function buildPlayerInventoryRows(player: Actor): PlayerProfileRow[] {
  return (player.inventory ?? []).flatMap((item) => {
    if (!hasText(item.name) || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity)) return [];
    const quantity = Math.floor(item.quantity);
    if (quantity <= 0) return [];
    const category = hasText(item.category) ? item.category.trim() : 'misc';
    return [{
      label: inventoryCategoryLabels[category] ?? '杂物',
      value: `${item.name.trim()} x${quantity}`,
      detail: [item.quality, item.description].filter(hasText).join('；') || undefined,
    }];
  });
}

function buildSummaryRows(
  player: Actor,
  reputation: PlayerProfileReputationModel | undefined,
  equipmentRows: PlayerProfileRow[],
  inventoryRows: PlayerProfileRow[],
): PlayerProfileRow[] {
  const identityValue = player.currentIdentity ?? player.birthOrigin ?? player.socialClass ?? '身份未明';
  const identityDetail = [
    player.factionName,
    player.allegianceTarget ? `效力${player.allegianceTarget}` : undefined,
    player.officeTitle,
    player.militaryTitle,
    player.nobleTitle,
  ].filter(hasText).join('；');

  return [
    {
      label: '身份',
      value: identityValue,
      ...(identityDetail ? { detail: identityDetail } : {}),
    },
    { label: '声名', value: reputation?.fameDisplay ?? '声名未显' },
    { label: '德行', value: reputation?.moralityDisplay ?? '德行未定' },
    { label: '钱财', value: formatCurrency(player.personalMoney ?? 0) },
    { label: '行装', value: `${equipmentRows.length}件装备 / ${inventoryRows.length}类携物` },
  ];
}

export function buildPlayerProfilePanelModel(player: Actor, memoryArchive?: MemoryArchive): PlayerProfilePanelModel {
  const basicRows: PlayerProfileRow[] = [];
  if (player.sex || player.age != null) {
    basicRows.push({
      label: '基本',
      value: [player.sex, player.age != null ? `${player.age}岁` : undefined].filter(hasText).join(' / '),
    });
  }
  pushTextRow(basicRows, '别称', player.aliases?.filter(hasText).join('、 '));
  pushTextRow(basicRows, '常用称呼', player.commonAddress);

  pushTextRow(basicRows, '外貌', player.appearance);
  pushTextRow(basicRows, '性格', player.personality);

  const identityRows: PlayerProfileRow[] = [];
  pushTextRow(identityRows, '出身', player.birthOrigin, player.birthOriginDescription);
  pushTextRow(identityRows, '当前身份', player.currentIdentity, player.currentIdentityDescription);
  pushTextRow(identityRows, '所属势力', player.factionName);
  pushTextRow(identityRows, '效力对象', player.allegianceTarget);
  pushTextRow(identityRows, '官职', player.officeTitle);
  pushTextRow(identityRows, '军职', player.militaryTitle);
  pushTextRow(identityRows, '爵位封号', player.nobleTitle);

  // summary/situationSummary are legacy broad text fields and often duplicate opening choices.
  // The visible profile uses structured identity, appearance, personality, and memory instead.
  const narrativeRows: PlayerProfileRow[] = [];

  const traitCards = (player.traits ?? []).map((trait) => ({
    label: trait.label,
    kind: 'trait' as const,
    tooltip: buildTraitTooltipTitle(trait),
    rarity: normalizeTraitRarity(trait.rarity),
  }));

  const uniqueArtCards = (player.uniqueArts ?? []).map((art) => ({
    label: art.name,
    kind: 'uniqueArt' as const,
    tooltip: buildUniqueArtTooltipTitle(art),
    rarity: normalizeTraitRarity(art.rarity),
  }));

  const effectCards = (player.effects ?? []).map((effect) => ({
    label: effect.label,
    kind: effect.type,
    tooltip: [effect.description, effect.promptHint, effect.duration].filter(hasText).join('\n'),
  }));

  const equipmentRows = (player.equipment ?? []).map((item) => ({
    label: equipmentSlotLabels[item.slot] ?? item.slot,
    value: `${item.name}${item.quality ? `·${item.quality}` : ''}`,
    tooltip: buildEquipmentTooltipTitle(item),
  }));

  const inventoryRows = buildPlayerInventoryRows(player);
  const inventoryPreview = (player.inventory ?? []).map((item) => `${item.name}x${item.quantity}`);
  const reputation = buildReputationModel(player);
  const summaryRows = buildSummaryRows(player, reputation, equipmentRows, inventoryRows);

  const memorySections: PlayerProfileMemorySection[] = [];

  const overviewRows: PlayerProfileRow[] = [];
  pushTextRow(overviewRows, '履历摘要', player.playerMemory?.summary);
  pushMemorySection(memorySections, '过往概括', overviewRows, '压缩后的主角履历总览。');

  const recentRows: PlayerProfileRow[] = [];
  for (const recentTurn of [...(player.playerMemory?.recentTurns ?? [])].reverse()) {
    pushTextRow(recentRows, '近期', recentTurn);
  }
  pushMemorySection(memorySections, '近期记忆', recentRows, '最近几回合中和主角直接相关的承接信息。');

  const turnRows: PlayerProfileRow[] = [];
  for (const turnSummary of [...(memoryArchive?.recentTurnSummaries ?? [])].reverse()) {
    const detail = [turnSummary.playerActionSummary, turnSummary.visibleConsequence].filter(hasText).join('；');
    pushTextRow(
      turnRows,
      `${turnSummary.createdAt}｜回合${turnSummary.turnNumber}`,
      turnSummary.brief,
      detail,
    );
  }
  pushMemorySection(memorySections, '每回合摘要', turnRows, '自动沉淀的回合级剧情摘要。');

  const deedRows: PlayerProfileRow[] = [];
  for (const deed of [...(player.playerMemory?.keyDeeds ?? [])].reverse()) {
    pushTextRow(deedRows, deed.date, deed.summary, deed.impact);
  }
  pushMemorySection(memorySections, '关键事迹', deedRows, '有长期影响的主角行为或节点。');

  const midTermRows: PlayerProfileRow[] = [];
  for (const summary of [...(memoryArchive?.midTermSummaries ?? [])].reverse()) {
    pushTextRow(midTermRows, summary.title, summary.summary, `${summary.fromCreatedAt} - ${summary.toCreatedAt}`);
  }
  pushMemorySection(memorySections, '中期摘要', midTermRows, '阶段压缩后的剧情记忆。');

  const longTermStoryRows: PlayerProfileRow[] = [];
  for (const summary of [...(memoryArchive?.longTermStorySummaries ?? [])].reverse()) {
    pushTextRow(
      longTermStoryRows,
      summary.title,
      summary.summary,
      `${summary.fromCreatedAt} - ${summary.toCreatedAt}`,
    );
  }
  pushMemorySection(memorySections, '长期生平', longTermStoryRows, '每十条中期摘要压缩形成的长期生平承接。');

  const longTermRows: PlayerProfileRow[] = [];
  for (const fact of [...(memoryArchive?.longTermFacts ?? [])].reverse()) {
    pushTextRow(
      longTermRows,
      `${longTermFactCategoryLabels[fact.category]}｜${memoryImportanceLabels[fact.importance]}`,
      fact.summary,
      fact.updatedAt ?? fact.createdAt,
    );
  }
  pushMemorySection(memorySections, '长期事实', longTermRows, '长期重要事实、承诺、后果与关系锚点。');

  const memoryRows = memorySections.flatMap((section) => section.rows);

  return {
    title: player.name,
    subtitle: buildSubtitle(player),
    summaryRows,
    basicRows,
    identityRows,
    narrativeRows,
    traitCards,
    uniqueArtCards,
    effectCards,
    equipmentRows,
    inventoryRows,
    inventoryPreview,
    reputation,
    memoryRows,
    memorySections,
  };
}

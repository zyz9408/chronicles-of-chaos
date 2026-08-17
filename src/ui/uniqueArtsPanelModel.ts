import type {
  CharacterUniqueArt,
  CharacterUniqueArtProgressIntensity,
  CharacterUniqueArtProgressRecord,
  CharacterUniqueArtProgressSource,
  CharacterUniqueArtRarity,
  RuntimeState,
} from '../engine/types';
import {
  UNIQUE_ART_RARITY_LABELS,
  buildUniqueArtTooltipTitle,
  formatKnownSourceLabel,
  formatUniqueArtDomainLabel,
  normalizeUniqueArtRarity,
} from './gameTooltipText';

export type UniqueArtOwnerType = 'player' | 'npc';

export interface UniqueArtPanelRosterItem {
  id: string;
  characterType: UniqueArtOwnerType;
  characterId: string;
  characterName: string;
  artId: string;
  name: string;
  rarity: CharacterUniqueArtRarity;
  rarityLabel: string;
  domain: string;
  domainLabel: string;
  levelText: string;
  progressText?: string;
}

export interface UniqueArtPanelRosterGroup {
  title: string;
  items: UniqueArtPanelRosterItem[];
}

export interface UniqueArtPanelCheckHookRow {
  scope: string;
  modifier?: number;
  note?: string;
}

export interface UniqueArtPanelDetail extends UniqueArtPanelRosterItem {
  description: string;
  effectSummary: string;
  source: string;
  sourceLabel: string;
  promptHint?: string;
  acquiredAt?: string;
  upgradedAt?: string;
  currentProgress: number;
  progressPercent: number;
  bankedProgress: number;
  isMaxLevel: boolean;
  nextLevelText: string;
  acquisitionLabel?: string;
  acquisitionSummary?: string;
  acquisitionOccurredAt?: string;
  acquisitionInstructorName?: string;
  progressHistory: UniqueArtPanelProgressHistoryRow[];
  checkHookRows: UniqueArtPanelCheckHookRow[];
  tags: string[];
  tooltip: string;
}

export interface UniqueArtPanelProgressHistoryRow {
  id: string;
  occurredAt: string;
  sourceLabel: string;
  intensityLabel: string;
  summary: string;
  awardedText: string;
  transitionText: string;
  levelledUp: boolean;
}

export interface UniqueArtsPanelModel {
  totalCount: number;
  playerCount: number;
  npcCount: number;
  rosterItems: UniqueArtPanelRosterItem[];
  rosterGroups: UniqueArtPanelRosterGroup[];
  selectedArtId: string | null;
  selectedArt?: UniqueArtPanelDetail;
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildLevelText(art: CharacterUniqueArt): string {
  return art.maxLevel ? `Lv.${art.level} / ${art.maxLevel}` : `Lv.${art.level}`;
}

function buildProgressText(progress?: number): string | undefined {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return undefined;
  return `${Math.max(0, Math.min(100, Math.round(progress)))}%`;
}

const ACQUISITION_KIND_LABELS: Record<NonNullable<CharacterUniqueArt['acquisition']>['kind'], string> = {
  opening: '开局既有',
  background: '身世传承',
  training: '修习所得',
  teaching: '他人传授',
  manual: '典籍参悟',
  event: '剧情机缘',
  achievement: '重大成就',
};

const PROGRESS_SOURCE_LABELS: Record<CharacterUniqueArtProgressSource, string> = {
  actual_use: '实际运用',
  autonomous_practice: '自主修习',
  instruction_or_manual: '传授或典籍',
  major_achievement: '重大成就',
};

const PROGRESS_INTENSITY_LABELS: Record<CharacterUniqueArtProgressIntensity, string> = {
  minor: '轻微',
  normal: '正常',
  major: '重大',
};

function buildPanelId(characterType: UniqueArtOwnerType, characterId: string, artId: string): string {
  return `${characterType}:${characterId}:${artId}`;
}

function buildRosterItem(
  characterType: UniqueArtOwnerType,
  characterId: string,
  characterName: string,
  art: CharacterUniqueArt,
): UniqueArtPanelRosterItem | undefined {
  if (!hasText(art.id) || !hasText(art.name)) return undefined;

  return {
    id: buildPanelId(characterType, characterId, art.id.trim()),
    characterType,
    characterId,
    characterName,
    artId: art.id.trim(),
    name: art.name.trim(),
    rarity: normalizeUniqueArtRarity(art.rarity),
    rarityLabel: UNIQUE_ART_RARITY_LABELS[normalizeUniqueArtRarity(art.rarity)],
    domain: hasText(art.domain) ? art.domain.trim() : 'other',
    domainLabel: formatUniqueArtDomainLabel(art.domain),
    levelText: buildLevelText(art),
    ...(buildProgressText(art.progress) ? { progressText: buildProgressText(art.progress) } : {}),
  };
}

function buildProgressHistory(history: CharacterUniqueArtProgressRecord[] | undefined): UniqueArtPanelProgressHistoryRow[] {
  return [...(history ?? [])]
    .slice(-8)
    .reverse()
    .map((record) => ({
      id: record.eventId,
      occurredAt: record.occurredAt,
      sourceLabel: PROGRESS_SOURCE_LABELS[record.source],
      intensityLabel: PROGRESS_INTENSITY_LABELS[record.intensity],
      summary: record.summary,
      awardedText: `+${record.awardedProgress}`,
      transitionText: record.levelledUp
        ? `Lv.${record.levelBefore} → Lv.${record.levelAfter}`
        : `Lv.${record.levelAfter} · ${record.progressAfter}%`,
      levelledUp: record.levelledUp,
    }));
}

function buildDetail(
  state: RuntimeState,
  item: UniqueArtPanelRosterItem,
  art: CharacterUniqueArt,
): UniqueArtPanelDetail {
  const maxLevel = art.maxLevel ?? 10;
  const isMaxLevel = art.level >= maxLevel;
  const currentProgress = isMaxLevel
    ? 100
    : Math.max(0, Math.min(100, Math.round(art.progress ?? 0)));
  const bankedProgress = Math.max(0, Math.round(art.bankedProgress ?? 0));
  const acquisition = art.acquisition;
  const instructorName = acquisition?.instructorNpcId
    ? state.npcs?.find((npc) => npc.npcId === acquisition.instructorNpcId)?.name
    : undefined;
  return {
    ...item,
    description: hasText(art.description) ? art.description.trim() : '暂无说明。',
    effectSummary: hasText(art.effectSummary) ? art.effectSummary.trim() : '暂无功效记录。',
    source: hasText(art.source) ? art.source.trim() : 'unknown',
    sourceLabel: formatKnownSourceLabel(art.source),
    ...(hasText(art.promptHint) ? { promptHint: art.promptHint.trim() } : {}),
    ...(hasText(art.acquiredAt) ? { acquiredAt: art.acquiredAt.trim() } : {}),
    ...(hasText(art.upgradedAt) ? { upgradedAt: art.upgradedAt.trim() } : {}),
    currentProgress,
    progressPercent: currentProgress,
    bankedProgress,
    isMaxLevel,
    nextLevelText: isMaxLevel ? '已臻当前上限' : `距离 Lv.${art.level + 1} 还需 ${Math.max(0, 100 - currentProgress)} 点`,
    ...(acquisition ? { acquisitionLabel: ACQUISITION_KIND_LABELS[acquisition.kind] } : {}),
    ...(acquisition && hasText(acquisition.summary) ? { acquisitionSummary: acquisition.summary.trim() } : {}),
    ...(acquisition && hasText(acquisition.occurredAt) ? { acquisitionOccurredAt: acquisition.occurredAt.trim() } : {}),
    ...(instructorName ? { acquisitionInstructorName: instructorName } : {}),
    progressHistory: buildProgressHistory(art.progressHistory),
    checkHookRows: (art.checkHooks ?? []).map((hook) => ({
      scope: hook.scope,
      ...(typeof hook.modifier === 'number' ? { modifier: hook.modifier } : {}),
      ...(hasText(hook.note) ? { note: hook.note.trim() } : {}),
    })),
    tags: (art.tags ?? []).filter(hasText).map((tag) => tag.trim()),
    tooltip: buildUniqueArtTooltipTitle(art),
  };
}

function buildRosterGroups(items: UniqueArtPanelRosterItem[]): UniqueArtPanelRosterGroup[] {
  const playerItems = items.filter((item) => item.characterType === 'player');
  const npcItems = items.filter((item) => item.characterType === 'npc');
  return [
    playerItems.length > 0 ? { title: '主角绝艺', items: playerItems } : undefined,
    npcItems.length > 0 ? { title: '人物绝艺', items: npcItems } : undefined,
  ].filter((group): group is UniqueArtPanelRosterGroup => Boolean(group));
}

export function buildUniqueArtsPanelModel(
  state: RuntimeState,
  selectedArtId?: string | null,
): UniqueArtsPanelModel {
  const artByPanelId = new Map<string, CharacterUniqueArt>();
  const rosterItems: UniqueArtPanelRosterItem[] = [];

  const player = state.player;
  const playerId = hasText(player.id) ? player.id.trim() : 'player';
  for (const art of player.uniqueArts ?? []) {
    const item = buildRosterItem('player', playerId, player.name, art);
    if (!item) continue;
    rosterItems.push(item);
    artByPanelId.set(item.id, art);
  }

  for (const npc of state.npcs ?? []) {
    for (const art of npc.uniqueArts ?? []) {
      const item = buildRosterItem('npc', npc.npcId, npc.name, art);
      if (!item) continue;
      rosterItems.push(item);
      artByPanelId.set(item.id, art);
    }
  }

  const selectedItem =
    rosterItems.find((item) => item.id === selectedArtId) ??
    rosterItems[0];
  const selectedArt = selectedItem ? artByPanelId.get(selectedItem.id) : undefined;

  return {
    totalCount: rosterItems.length,
    playerCount: rosterItems.filter((item) => item.characterType === 'player').length,
    npcCount: rosterItems.filter((item) => item.characterType === 'npc').length,
    rosterItems,
    rosterGroups: buildRosterGroups(rosterItems),
    selectedArtId: selectedItem?.id ?? null,
    ...(selectedItem && selectedArt ? { selectedArt: buildDetail(state, selectedItem, selectedArt) } : {}),
  };
}

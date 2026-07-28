import type { CharacterTraitRarity, CharacterUniqueArt, RuntimeState } from '../engine/types';
import {
  TRAIT_RARITY_LABELS,
  buildUniqueArtTooltipTitle,
  formatKnownSourceLabel,
  formatUniqueArtDomainLabel,
  normalizeTraitRarity,
} from './gameTooltipText';

export type UniqueArtOwnerType = 'player' | 'npc';

export interface UniqueArtPanelRosterItem {
  id: string;
  characterType: UniqueArtOwnerType;
  characterId: string;
  characterName: string;
  artId: string;
  name: string;
  rarity: CharacterTraitRarity;
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
  checkHookRows: UniqueArtPanelCheckHookRow[];
  tags: string[];
  tooltip: string;
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
    rarity: normalizeTraitRarity(art.rarity),
    rarityLabel: TRAIT_RARITY_LABELS[normalizeTraitRarity(art.rarity)],
    domain: hasText(art.domain) ? art.domain.trim() : 'other',
    domainLabel: formatUniqueArtDomainLabel(art.domain),
    levelText: buildLevelText(art),
    ...(buildProgressText(art.progress) ? { progressText: buildProgressText(art.progress) } : {}),
  };
}

function buildDetail(item: UniqueArtPanelRosterItem, art: CharacterUniqueArt): UniqueArtPanelDetail {
  return {
    ...item,
    description: hasText(art.description) ? art.description.trim() : '暂无说明。',
    effectSummary: hasText(art.effectSummary) ? art.effectSummary.trim() : '暂无功效记录。',
    source: hasText(art.source) ? art.source.trim() : 'unknown',
    sourceLabel: formatKnownSourceLabel(art.source),
    ...(hasText(art.promptHint) ? { promptHint: art.promptHint.trim() } : {}),
    ...(hasText(art.acquiredAt) ? { acquiredAt: art.acquiredAt.trim() } : {}),
    ...(hasText(art.upgradedAt) ? { upgradedAt: art.upgradedAt.trim() } : {}),
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
    ...(selectedItem && selectedArt ? { selectedArt: buildDetail(selectedItem, selectedArt) } : {}),
  };
}

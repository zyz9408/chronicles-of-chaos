import type { CombatRecord, RuntimeState } from '../engine/types';

export type CombatPanelTabKey = 'playerRelated' | 'notable' | 'other';

export interface CombatPanelTab {
  key: CombatPanelTabKey;
  label: string;
  count: number;
}

export interface CombatPanelListItem {
  combatId: string;
  title: string;
  occurredAt: string;
  resultText: string;
  importanceText: string;
}

export interface CombatPanelModel {
  tabs: CombatPanelTab[];
  activeTab: CombatPanelTabKey;
  listItems: CombatPanelListItem[];
  selectedCombatId: string | null;
  selectedCombat: CombatRecord | null;
}

export function buildCombatPanelModel(
  runtimeState: RuntimeState,
  activeTab: CombatPanelTabKey = 'playerRelated',
  selectedCombatId?: string | null,
): CombatPanelModel {
  const combats = [...(runtimeState.combatRecords ?? [])].sort(compareCombatRecordDesc);
  const playerRelated = combats.filter(isPlayerRelatedCombat);
  const notable = combats.filter((combat) => !isPlayerRelatedCombat(combat) && isNotableCombat(combat));
  const other = combats.filter((combat) => !isPlayerRelatedCombat(combat) && !isNotableCombat(combat));
  const buckets: Record<CombatPanelTabKey, CombatRecord[]> = { playerRelated, notable, other };
  const safeActiveTab = activeTab in buckets ? activeTab : 'playerRelated';
  const activeItems = buckets[safeActiveTab];
  const selectedCombat = activeItems.find((combat) => combat.combatId === selectedCombatId) ?? activeItems[0] ?? null;

  return {
    tabs: [
      { key: 'playerRelated', label: '亲历/相关', count: playerRelated.length },
      { key: 'notable', label: '值得记录', count: notable.length },
      { key: 'other', label: '其他', count: other.length },
    ],
    activeTab: safeActiveTab,
    listItems: activeItems.map((combat) => toCombatPanelListItem(runtimeState, combat)),
    selectedCombatId: selectedCombat?.combatId ?? null,
    selectedCombat,
  };
}

function isPlayerRelatedCombat(combat: CombatRecord): boolean {
  return combat.playerInvolved
    || combat.participants.some((participant) => (
      participant.side === 'player'
      || participant.participantId === 'player'
    ));
}

function isNotableCombat(combat: CombatRecord): boolean {
  return combat.chronicleWorthy === true
    || combat.significance === 'notable'
    || combat.significance === 'major'
    || combat.significance === 'legendary';
}

const COMBAT_KIND_LABELS: Record<string, string> = {
  duel: '单挑',
  melee: '混战',
  assassination: '刺杀',
  escape: '突围',
  capture: '擒拿',
  battlefieldDuel: '阵前交锋',
  other: '其他',
};

const COMBAT_RESULT_LABELS: Record<string, string> = {
  decisiveWin: '大胜',
  win: '胜',
  stalemate: '相持',
  loss: '败',
  decisiveLoss: '大败',
};

const COMBAT_SIGNIFICANCE_LABELS: Record<string, string> = {
  minor: '普通',
  notable: '值得记录',
  major: '重大',
  legendary: '传奇',
};

function toCombatPanelListItem(runtimeState: RuntimeState, combat: CombatRecord): CombatPanelListItem {
  void runtimeState;

  return {
    combatId: combat.combatId,
    title: combat.title,
    occurredAt: combat.occurredAt,
    resultText: formatCombatResult(combat.resultLevel),
    importanceText: formatCombatSignificance(combat.significance),
  };
}

export function formatCombatKind(value?: string): string {
  if (!value?.trim()) return '其他';
  const key = value.trim();
  return COMBAT_KIND_LABELS[key] ?? (looksLikeEngineeringText(key) ? '其他' : key);
}

export function formatCombatResult(value?: string): string {
  if (!value?.trim()) return '结果未明';
  const key = value.trim();
  return COMBAT_RESULT_LABELS[key] ?? (looksLikeEngineeringText(key) ? '结果未明' : key);
}

export function formatCombatSignificance(value?: string): string {
  if (!value?.trim()) return '重要度未明';
  const key = value.trim();
  return COMBAT_SIGNIFICANCE_LABELS[key] ?? (looksLikeEngineeringText(key) ? '重要度未明' : key);
}

function compareCombatRecordDesc(a: CombatRecord, b: CombatRecord): number {
  const aTime = a.updatedAt ?? a.occurredAt;
  const bTime = b.updatedAt ?? b.occurredAt;
  return bTime.localeCompare(aTime, 'zh-Hans-CN');
}

function looksLikeEngineeringText(value: string): boolean {
  return /[A-Za-z_]/.test(value);
}

import type { ConflictRecord, RuntimeState } from '../engine/types';

export type BattlePanelTabKey = 'selfRelated' | 'other';

export interface BattlePanelTab {
  key: BattlePanelTabKey;
  label: string;
  count: number;
}

export interface BattlePanelListItem {
  conflictId: string;
  title: string;
  occurredAt: string;
  resultText: string;
  importanceText: string;
}

export interface BattlePanelModel {
  tabs: BattlePanelTab[];
  activeTab: BattlePanelTabKey;
  listItems: BattlePanelListItem[];
  selectedConflictId: string | null;
  selectedConflict: ConflictRecord | null;
}

export function buildBattlePanelModel(
  runtimeState: RuntimeState,
  activeTab: BattlePanelTabKey = 'selfRelated',
  selectedConflictId?: string | null,
): BattlePanelModel {
  const conflicts = [...(runtimeState.conflicts ?? [])].sort(compareConflictRecordDesc);
  const selfRelated = conflicts.filter(isSelfRelatedConflict);
  const other = conflicts.filter((conflict) => !isSelfRelatedConflict(conflict));
  const buckets: Record<BattlePanelTabKey, ConflictRecord[]> = { selfRelated, other };
  const safeActiveTab = activeTab === 'other' ? 'other' : 'selfRelated';
  const activeItems = buckets[safeActiveTab];
  const selectedConflict = activeItems.find((conflict) => conflict.conflictId === selectedConflictId) ?? activeItems[0] ?? null;

  return {
    tabs: [
      { key: 'selfRelated', label: '自势力相关', count: selfRelated.length },
      { key: 'other', label: '其他', count: other.length },
    ],
    activeTab: safeActiveTab,
    listItems: activeItems.map((conflict) => toBattlePanelListItem(runtimeState, conflict)),
    selectedConflictId: selectedConflict?.conflictId ?? null,
    selectedConflict,
  };
}

function isSelfRelatedConflict(conflict: ConflictRecord): boolean {
  return conflict.scope === 'selfRelated' || conflict.recordLevel === 'full';
}

function toBattlePanelListItem(runtimeState: RuntimeState, conflict: ConflictRecord): BattlePanelListItem {
  void runtimeState;
  const recordLevel = conflict.recordLevel ?? (isSelfRelatedConflict(conflict) ? 'full' : 'brief');
  return {
    conflictId: conflict.conflictId,
    title: conflict.title,
    occurredAt: conflict.occurredAt,
    resultText: formatConflictResult(conflict),
    importanceText: recordLevel === 'full' ? '重要战报' : '简略记录',
  };
}

function formatConflictResult(conflict: ConflictRecord): string {
  return formatResultLevel(conflict.resultLevel) ?? conflict.result ?? conflict.outcome;
}

const RESULT_LEVEL_LABELS: Record<string, string> = {
  decisiveWin: '大胜',
  win: '胜',
  minorWin: '小胜',
  stalemate: '相持',
  minorLoss: '小败',
  loss: '败',
  decisiveLoss: '大败',
};

const CONFLICT_TYPE_LABELS: Record<string, string> = {
  personalCombat: '个人战斗',
  personal_combat: '个人战斗',
  war: '战争',
  militaryConflict: '军事冲突',
  military_conflict: '军事冲突',
  standoff: '对峙',
  fieldBattle: '野战',
  field_battle: '野战',
  ambush: '伏击',
  pursuit: '追击',
  siege: '围城',
  defense: '守城',
  nightRaid: '夜袭',
  night_raid: '夜袭',
  supplyRaid: '抢粮',
  supply_raid: '抢粮',
  campBattle: '营寨战',
  camp_battle: '营寨战',
  streetBattle: '巷战',
  street_battle: '巷战',
  navalBattle: '水战',
  naval_battle: '水战',
  other: '其他',
};

export function formatConflictType(value?: string): string {
  if (!value?.trim()) return '战事';
  const key = value.trim();
  return CONFLICT_TYPE_LABELS[key] ?? (looksLikeEngineeringText(key) ? '战事' : key);
}

export function formatConflictResultLevel(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  const key = value.trim();
  return RESULT_LEVEL_LABELS[key] ?? (looksLikeEngineeringText(key) ? '结果未明' : key);
}

function formatResultLevel(value?: string): string | undefined {
  return formatConflictResultLevel(value);
}

function compareConflictRecordDesc(a: ConflictRecord, b: ConflictRecord): number {
  const aTime = a.updatedAt ?? a.occurredAt;
  const bTime = b.updatedAt ?? b.occurredAt;
  return bTime.localeCompare(aTime, 'zh-Hans-CN');
}

function looksLikeEngineeringText(value: string): boolean {
  return /[A-Za-z_]/.test(value);
}

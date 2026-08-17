import type { ConflictRecord, RuntimeState, TroopLedgerEntry } from '../engine/types';
import { calculateHoldingMonthlyUpkeepPreview } from '../engine/holdings/HoldingAnnualSettlementRuntime';
import { formatFactionTypeForDisplay } from '../engine/state/factionTypeNormalization';
import { isCurrentTroopLedgerEntry } from '../engine/state/troopLifecycle';
import {
  resolveTroopFatiguePercent,
} from '../engine/troops/TroopFatigue';

export interface TroopPanelRosterItem {
  troopId: string;
  name: string;
  subtitle: string;
  sizeText: string;
  statusText: string;
  relationToPlayer: string;
}

export interface TroopPanelGroupItem {
  groupId: string;
  factionId?: string;
  name: string;
  subtitle: string;
  troopCount: number;
  totalSizeText: string;
  relationSummary: string;
  statusSummary: string;
  firstTroopId: string;
}

export interface TroopPanelDetailRow {
  label: string;
  value: string;
  detail?: string;
}

export interface TroopPanelDetailSection {
  key: 'command' | 'condition' | 'movement' | 'intelligence';
  title: string;
  rows: TroopPanelDetailRow[];
}

export interface TroopPanelVisualProfile {
  troopTypeText: string;
  sizeText: string;
  qualityText: string;
  caption: string;
}

export interface TroopPanelModel {
  rosterItems: TroopPanelRosterItem[];
  groupItems: TroopPanelGroupItem[];
  selectedGroupId: string | null;
  selectedGroup: TroopPanelGroupItem | null;
  groupTroops: TroopPanelRosterItem[];
  selectedTroopId: string | null;
  selectedTroop: TroopLedgerEntry | null;
  officerRows: TroopPanelDetailRow[];
  overviewRows: TroopPanelDetailRow[];
  conditionRows: TroopPanelDetailRow[];
  movementRows: TroopPanelDetailRow[];
  intelligenceRows: TroopPanelDetailRow[];
  detailRows: TroopPanelDetailRow[];
  detailSections: TroopPanelDetailSection[];
  visualProfile: TroopPanelVisualProfile | null;
  monthlyUpkeepNote: string | null;
  statusTags: string[];
  recentBattles: ConflictRecord[];
  intelNotice: string;
}

interface TroopPanelGroup {
  item: TroopPanelGroupItem;
  troops: TroopLedgerEntry[];
}

const LIFECYCLE_STATUS_LABELS: Record<NonNullable<TroopLedgerEntry['lifecycleStatus']>, string> = {
  active: '活跃',
  routed: '溃散',
  merged: '已合并',
  split: '已拆分',
  destroyed: '覆灭',
  surrendered: '已招降',
  disbanded: '解散',
  unknown: '不明',
  archived: '归档',
};

const STRENGTH_TREND_LABELS: Record<NonNullable<TroopLedgerEntry['strengthTrend']>, string> = {
  increased: '增员',
  decreased: '减员',
  stable: '稳定',
  unknown: '不明',
};

const CERTAINTY_LABELS: Record<NonNullable<TroopLedgerEntry['certainty']>, string> = {
  confirmed: '已确认',
  reported: '据报',
  rumor: '传闻',
  uncertain: '不明',
};

const ORDER_STATUS_LABELS: Record<NonNullable<TroopLedgerEntry['orderStatus']>, string> = {
  none: '无',
  issued: '已下令',
  inTransit: '传令中',
  delivered: '已送达',
  delayed: '延误',
  lost: '失联',
  cancelled: '已取消',
};

const MOVEMENT_STATUS_LABELS: Record<NonNullable<TroopLedgerEntry['movementStatus']>, string> = {
  none: '无',
  waitingOrder: '待接令',
  preparing: '整备中',
  marching: '行军中',
  arrived: '已抵达',
  blocked: '受阻',
  interrupted: '中断',
  cancelled: '已取消',
};

const TROOP_TYPE_LABELS: Record<string, string> = {
  regular: '正规军',
  militia: '民兵',
  archer: '弓弩',
  cavalry: '骑兵',
  light_cavalry: '轻骑兵',
  'light cavalry': '轻骑兵',
  heavy_cavalry: '重骑兵',
  'heavy cavalry': '重骑兵',
  infantry: '步卒',
  logistics: '辎重',
  naval: '水军',
  siege: '攻城',
  mixedInfantry: '骑步混编',
  mixed_infantry: '骑步混编',
  'mixed infantry': '骑步混编',
  guards: '卫队',
  garrison: '守军',
  mixed: '混编',
  mixed_force: '混编',
  mixedInfantryCavalry: '骑步混编',
  mixed_infantry_cavalry: '骑步混编',
  rebels: '叛军',
  bandits: '乱兵',
  transport: '辎重队',
  scouts: '斥候',
  levy: '征发兵',
};

const GENERIC_TROOP_TYPE_WORDS = new Set([
  '部队',
  '军队',
  '队伍',
  '人马',
  '兵马',
  '军马',
  '军伍',
  '士卒',
  '兵卒',
  '兵员',
  'other',
]);

const TROOP_RELATION_LABELS: Record<string, string> = {
  self: '己方',
  own: '己方',
  owned: '直属部队',
  controlled: '受控',
  subordinate: '受你统领',
  direct_command: '你直接统领',
  player_direct: '你直接统领',
  directCommand: '你直接统领',
  selfRelated: '自势力相关',
  self_related: '自势力相关',
  'self-related': '自势力相关',
  friendly: '友好',
  allied: '盟友',
  neutral: '中立',
  hostile: '敌对',
  enemy: '敌对',
  unknown: '不明',
  observed: '已侦知',
};

export function buildTroopPanelModel(runtimeState: RuntimeState, selectedTroopId?: string | null): TroopPanelModel {
  const troops = (runtimeState.troops ?? [])
    .filter(isCurrentTroopLedgerEntry)
    .sort(compareTroopEntries);
  const groups = buildTroopGroups(runtimeState, troops);
  const selectedTroop = troops.find((troop) => troop.troopId === selectedTroopId) ?? troops[0] ?? null;
  const selectedGroup =
    (selectedTroop ? groups.find((group) => group.item.groupId === getTroopGroupId(selectedTroop)) : undefined) ??
    groups[0] ??
    null;
  const recentBattles = selectedTroop ? findRecentBattles(runtimeState.conflicts ?? [], selectedTroop) : [];
  const detailRows = selectedTroop ? buildDetailRows(runtimeState, selectedTroop) : [];
  const monthlyUpkeepNote = selectedTroop
    ? buildTroopMonthlyUpkeepNote(runtimeState, selectedTroop)
    : null;
  const officerRows = pickRowsByLabel(detailRows, ['主将', '副将', '军师']);
  const overviewRows = pickRowsByLabel(detailRows, ['所属势力', '主将', '副将', '军师', '番号', '当前任务', '当前位置', '最后已知位置', '对玩家关系']);
  const conditionRows = pickRowsByLabel(detailRows, ['兵种', '规模', '精锐度', '士气', '训练', '补给', '整备', '疲劳', '状态']);
  const movementRows = pickRowsByLabel(detailRows, ['当前位置', '最后已知位置', '军令状态', '军令发出', '军令送达', '军令内容', '目标地点', '行军路线', '行军状态', '启程时间', '预计抵达', '抵达时间', '行军说明']);
  const intelligenceRows = pickRowsByLabel(detailRows, ['账本层级', '消息时间', '可信度', '情报来源', '前归属势力', '归属变更时间', '归属变更原因', '上级作战集群', '父级部队', '拆分子部', '合并去向', '覆灭战事', '最近战事', '兵力变化', '变化原因', '最近沿革']);

  return {
    rosterItems: troops.map((troop) => toRosterItem(runtimeState, troop)),
    groupItems: groups.map((group) => group.item),
    selectedGroupId: selectedGroup?.item.groupId ?? null,
    selectedGroup: selectedGroup?.item ?? null,
    groupTroops: selectedGroup?.troops.map((troop) => toRosterItem(runtimeState, troop)) ?? [],
    selectedTroopId: selectedTroop?.troopId ?? null,
    selectedTroop,
    officerRows,
    overviewRows,
    conditionRows,
    movementRows,
    intelligenceRows,
    detailRows,
    detailSections: buildDetailSections(detailRows),
    visualProfile: selectedTroop ? buildVisualProfile(selectedTroop) : null,
    monthlyUpkeepNote,
    statusTags: selectedTroop?.statusTags ?? [],
    recentBattles,
    intelNotice: '这里只显示玩家已知情报中的部队信息；消息时间不是实时上帝视角，后续需通过剧情、探查或回报更新。',
  };
}

function buildTroopMonthlyUpkeepNote(
  runtimeState: RuntimeState,
  troop: TroopLedgerEntry,
): string | null {
  const preview = calculateHoldingMonthlyUpkeepPreview(runtimeState);
  const breakdown = preview?.troopBreakdown.find((entry) => entry.troopId === troop.troopId);
  if (!breakdown) return null;

  const expenses = breakdown.requiredExpenses;
  const resourceParts = [
    expenses.money > 0 ? `钱财${expenses.money}贯` : '',
    expenses.grain > 0 ? `粮草${expenses.grain}石` : '',
    expenses.horses > 0 ? `战马${expenses.horses}匹` : '',
    expenses.arms > 0 ? `军械${expenses.arms}件` : '',
  ].filter(Boolean);
  if (resourceParts.length === 0) return null;

  const sourceLabel = {
    player_resources: '玩家府库',
    superior_provision: '上级供给',
    mixed: '上级供给与玩家府库共同承担',
  }[breakdown.source];
  const troopType = formatTroopTypeForDisplay(troop.troopType ?? troop.specialDesignation, {
    logisticsClass: troop.logisticsClass,
  }) ?? '兵种未明';
  const quality = troop.quality?.trim() || '未标定';

  return `月度军需：${breakdown.size}人 × ${troopType} × 精锐度${quality} → ${resourceParts.join('、')}；来源：${sourceLabel}`;
}

function buildTroopGroups(runtimeState: RuntimeState, troops: TroopLedgerEntry[]): TroopPanelGroup[] {
  const groupedTroops = new Map<string, TroopLedgerEntry[]>();
  for (const troop of troops) {
    const groupId = getTroopGroupId(troop);
    groupedTroops.set(groupId, [...(groupedTroops.get(groupId) ?? []), troop]);
  }

  return Array.from(groupedTroops.entries()).map(([groupId, groupTroops]) => {
    const firstTroop = groupTroops[0];
    const faction = firstTroop.factionId
      ? runtimeState.factions?.find((item) => item.factionId === firstTroop.factionId)
      : undefined;
    const totalSize = groupTroops.reduce((sum, troop) => sum + troopStrengthMidpoint(troop), 0);
    const hasIntelligenceOnly = groupTroops.some((troop) => troop.detailLevel === 'intelligence');
    const groupDisplay = resolveTroopGroupDisplay(runtimeState, firstTroop, faction);

    return {
      item: {
        groupId,
        ...(firstTroop.factionId ? { factionId: firstTroop.factionId } : {}),
        name: groupDisplay.name,
        subtitle: groupDisplay.subtitle,
        troopCount: groupTroops.length,
        totalSizeText: totalSize > 0 ? `${hasIntelligenceOnly ? '约' : ''}${totalSize}人` : '兵力未明',
        relationSummary: summarizeValues(groupTroops.map((troop) => formatTroopRelation(troop.relationToPlayer))),
        statusSummary: summarizeValues(groupTroops.map((troop) => (
          formatLifecycleStatus(troop.lifecycleStatus) ?? formatStrengthTrend(troop.strengthTrend) ?? '已知'
        ))),
        firstTroopId: firstTroop.troopId,
      },
      troops: groupTroops,
    };
  });
}

function getTroopGroupId(troop: TroopLedgerEntry): string {
  return troop.factionId ? `faction:${troop.factionId}` : `unassigned:${troop.relationToPlayer || 'unknown'}`;
}

function summarizeValues(values: Array<string | undefined>): string {
  const uniqueValues = Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
  if (uniqueValues.length === 0) return '未明';
  if (uniqueValues.length <= 2) return uniqueValues.join(' / ');
  return `${uniqueValues.slice(0, 2).join(' / ')} 等`;
}

function toRosterItem(runtimeState: RuntimeState, troop: TroopLedgerEntry): TroopPanelRosterItem {
  const typeText = formatTroopTypeForDisplay(troop.troopType ?? troop.specialDesignation, {
    logisticsClass: troop.logisticsClass,
  });
  const factionText = resolveTroopAffiliationLabel(runtimeState, troop);
  return {
    troopId: troop.troopId,
    name: troop.name,
    subtitle: [typeText, factionText].filter(Boolean).join(' / '),
    sizeText: formatTroopStrength(troop),
    statusText: troop.detailLevel === 'intelligence'
      ? '军情档案'
      : formatLifecycleStatus(troop.lifecycleStatus) ?? formatStrengthTrend(troop.strengthTrend) ?? '已知',
    relationToPlayer: formatTroopRelation(troop.relationToPlayer),
  };
}

function buildDetailRows(runtimeState: RuntimeState, troop: TroopLedgerEntry): TroopPanelDetailRow[] {
  const intelligenceOnly = troop.detailLevel === 'intelligence';
  const fatiguePercent = intelligenceOnly ? undefined : resolveTroopFatiguePercent(troop);
  const exactPositionVisible = isPlayerCommandedTroop(runtimeState, troop) || isSelfRelatedTroop(troop);
  const missingOfficerLabel = exactPositionVisible ? '未任命' : '未明';
  const positionLabel = exactPositionVisible ? '当前位置' : '最后已知位置';
  const positionId = exactPositionVisible
    ? troop.locationId ?? troop.lastKnownLocationId
    : troop.lastKnownLocationId ?? troop.locationId;
  return [
    makeRow('所属势力', resolveTroopAffiliationLabel(runtimeState, troop)),
    makeRow('前归属势力', resolveFactionLabel(runtimeState, troop.previousFactionId)),
    makeRow('归属变更时间', troop.allegianceChangedAt),
    makeRow('归属变更原因', troop.allegianceChangeReason),
    makeRow('账本层级', intelligenceOnly ? '军情档案（不可直接参战）' : '完整作战建制'),
    makeRow('指挥关系', formatCommandRelationship(runtimeState, troop)),
    makeRow('主将', resolveTroopLeaderLabel(runtimeState, troop) ?? missingOfficerLabel),
    makeRow('副将', resolveTroopDeputyLabel(runtimeState, troop) ?? missingOfficerLabel),
    makeRow('军师', resolveNpcLabel(runtimeState, troop.strategistNpcId) ?? missingOfficerLabel),
    makeRow('兵种', formatTroopTypeForDisplay(troop.troopType, {
      logisticsClass: troop.logisticsClass,
    })),
    makeRow('番号', troop.specialDesignation),
    makeRow('规模', formatTroopStrength(troop), troop.previousSize !== undefined ? `上次记录 ${troop.previousSize}人` : troop.strengthEstimate?.basis),
    makeRow('精锐度', intelligenceOnly ? undefined : troop.quality),
    makeRow('士气', intelligenceOnly ? undefined : String(troop.morale)),
    makeRow('训练', intelligenceOnly ? undefined : String(troop.training)),
    makeRow('补给', intelligenceOnly ? undefined : troop.supplies),
    makeRow('整备', intelligenceOnly ? undefined : troop.readiness),
    makeRow(
      '疲劳',
      fatiguePercent === undefined ? undefined : `${fatiguePercent}/100`,
    ),
    makeRow('状态', formatLifecycleStatus(troop.lifecycleStatus)),
    makeRow(positionLabel, resolveLocationLabel(runtimeState, positionId) ?? '位置未确认'),
    makeRow('军令状态', formatOrderStatus(troop.orderStatus)),
    makeRow('军令发出', troop.orderIssuedAt),
    makeRow('军令送达', troop.orderDeliveredAt),
    makeRow('军令内容', troop.orderSummary),
    makeRow('目标地点', resolveLocationLabel(runtimeState, troop.destinationLocationId)),
    makeRow('行军路线', resolveRouteLabel(runtimeState, troop.routeId)),
    makeRow('行军状态', formatMovementStatus(troop.movementStatus)),
    makeRow('启程时间', troop.departedAt),
    makeRow('预计抵达', troop.estimatedArrivalAt),
    makeRow('抵达时间', troop.arrivedAt),
    makeRow('行军说明', troop.movementNotes),
    makeRow('消息时间', troop.lastKnownAt ?? troop.updatedAt),
    makeRow('可信度', formatCertainty(troop.certainty)),
    makeRow('情报来源', troop.sourceNote),
    makeRow('当前任务', troop.task),
    makeRow('对玩家关系', formatTroopRelation(troop.relationToPlayer)),
    makeRow('上级作战集群', resolveTroopLabel(runtimeState, troop.operationalParentForceId)),
    makeRow('父级部队', resolveTroopLabel(runtimeState, troop.parentTroopId)),
    makeRow('拆分子部', troop.childTroopIds?.map((troopId) => resolveTroopLabel(runtimeState, troopId)).filter(Boolean).join(' / ')),
    makeRow('合并去向', resolveTroopLabel(runtimeState, troop.mergedIntoTroopId)),
    makeRow('覆灭战事', resolveConflictLabel(runtimeState, troop.destroyedInBattleId)),
    makeRow('最近战事', resolveConflictLabel(runtimeState, troop.lastBattleId)),
    makeRow('兵力变化', formatStrengthTrend(troop.strengthTrend)),
    makeRow('变化原因', troop.lastChangeReason),
    makeRow('最近沿革', troop.changeHistory?.[troop.changeHistory.length - 1]?.summary),
  ].filter((row): row is TroopPanelDetailRow => row !== null);
}

function findRecentBattles(conflicts: ConflictRecord[], troop: TroopLedgerEntry): ConflictRecord[] {
  return [...conflicts]
    .filter((conflict) => (
      conflict.conflictId === troop.lastBattleId
      || conflict.conflictId === troop.destroyedInBattleId
      || conflict.involvedTroopIds?.includes(troop.troopId)
    ))
    .sort((a, b) => (b.updatedAt ?? b.occurredAt).localeCompare(a.updatedAt ?? a.occurredAt, 'zh-Hans-CN'))
    .slice(0, 5);
}

function makeRow(label: string, value?: string | number | null, detail?: string): TroopPanelDetailRow | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const displayValue = String(value).trim();
  if (displayValue.length === 0) return null;
  return {
    label,
    value: displayValue,
    ...(detail && detail.trim().length > 0 ? { detail: detail.trim() } : {}),
  };
}

function buildDetailSections(rows: TroopPanelDetailRow[]): TroopPanelDetailSection[] {
  const configs: Array<{ key: TroopPanelDetailSection['key']; title: string; labels: string[] }> = [
    {
      key: 'command',
      title: '统属与任务',
      labels: ['所属势力', '指挥关系', '上级作战集群', '主将', '副将', '军师', '当前位置', '最后已知位置', '当前任务', '对玩家关系'],
    },
    {
      key: 'condition',
      title: '战力与状态',
      labels: ['兵种', '番号', '规模', '精锐度', '士气', '训练', '补给', '整备', '疲劳', '状态', '兵力变化'],
    },
    {
      key: 'movement',
      title: '军令与行军',
      labels: ['当前位置', '最后已知位置', '军令状态', '军令发出', '军令送达', '军令内容', '目标地点', '行军路线', '行军状态', '启程时间', '预计抵达', '抵达时间', '行军说明'],
    },
    {
      key: 'intelligence',
      title: '情报与沿革',
      labels: ['账本层级', '消息时间', '可信度', '情报来源', '前归属势力', '归属变更时间', '归属变更原因', '父级部队', '拆分子部', '合并去向', '覆灭战事', '最近战事', '变化原因', '最近沿革'],
    },
  ];

  return configs
    .map((config) => ({
      key: config.key,
      title: config.title,
      rows: pickRowsByLabel(rows, config.labels),
    }))
    .filter((section) => section.rows.length > 0);
}

function pickRowsByLabel(rows: TroopPanelDetailRow[], labels: string[]): TroopPanelDetailRow[] {
  return labels
    .map((label) => rows.find((row) => row.label === label))
    .filter((row): row is TroopPanelDetailRow => Boolean(row));
}

function resolveFactionLabel(
  runtimeState: RuntimeState,
  factionId?: string,
  options: { fallback?: boolean } = {},
): string | undefined {
  if (!factionId) return undefined;
  const faction = runtimeState.factions?.find((item) => item.factionId === factionId);
  if (faction) return faction.name;
  return options.fallback === false ? undefined : '未登记势力';
}

function resolveTroopGroupDisplay(
  runtimeState: RuntimeState,
  troop: TroopLedgerEntry,
  faction?: NonNullable<RuntimeState['factions']>[number],
): { name: string; subtitle: string } {
  if (faction) {
    return {
      name: faction.name,
      subtitle: formatFactionType(faction.type),
    };
  }

  if (isPlayerCommandedTroop(runtimeState, troop)) {
    return {
      name: resolvePlayerFactionLabel(runtimeState, { fallback: false }) ?? resolvePlayerDirectLabel(runtimeState),
      subtitle: '主角直属部队',
    };
  }

  if (troop.factionId) {
    return {
      name: '未登记势力',
      subtitle: '势力档案待补',
    };
  }

  return {
    name: '未明归属',
    subtitle: '未绑定势力',
  };
}

function resolveTroopAffiliationLabel(runtimeState: RuntimeState, troop: TroopLedgerEntry): string | undefined {
  const factionLabel = resolveFactionLabel(runtimeState, troop.factionId, { fallback: false });
  if (factionLabel) return factionLabel;
  if (isPlayerCommandedTroop(runtimeState, troop)) {
    return resolvePlayerFactionLabel(runtimeState, { fallback: false }) ?? resolvePlayerDirectLabel(runtimeState);
  }
  return resolveFactionLabel(runtimeState, troop.factionId);
}

function resolvePlayerFactionLabel(
  runtimeState: RuntimeState,
  options: { fallback?: boolean } = {},
): string | undefined {
  const factionName = runtimeState.player?.factionName?.trim();
  if (factionName) return factionName;
  const factionId = runtimeState.player?.factionId?.trim();
  if (!factionId) return undefined;
  return resolveFactionLabel(runtimeState, factionId, options);
}

function resolvePlayerDirectLabel(runtimeState: RuntimeState): string {
  const playerName = runtimeState.player?.name?.trim();
  return playerName ? `${playerName}直属` : '主角直属';
}

function resolveNpcLabel(runtimeState: RuntimeState, npcId?: string): string | undefined {
  if (!npcId) return undefined;
  return runtimeState.npcs?.find((npc) => npc.npcId === npcId)?.name ?? '未登记人物';
}

function resolveTroopLeaderLabel(runtimeState: RuntimeState, troop: TroopLedgerEntry): string | undefined {
  if (!troop.leaderNpcId) {
    return isPlayerCommandedTroop(runtimeState, troop) ? resolvePlayerLeaderLabel(runtimeState) : undefined;
  }
  if (isPlayerLeaderId(runtimeState, troop.leaderNpcId)) {
    return resolvePlayerLeaderLabel(runtimeState);
  }
  return resolveNpcLabel(runtimeState, troop.leaderNpcId);
}

function resolvePlayerLeaderLabel(runtimeState: RuntimeState): string {
  const playerName = runtimeState.player?.name?.trim();
  return playerName ? `${playerName}（你）` : '你亲自统领';
}

function resolveTroopDeputyLabel(runtimeState: RuntimeState, troop: TroopLedgerEntry): string | undefined {
  const labels = (troop.deputyNpcIds ?? [])
    .map((npcId) => resolveNpcLabel(runtimeState, npcId))
    .filter((label): label is string => Boolean(label));
  return labels.length > 0 ? labels.join('、') : undefined;
}

function buildVisualProfile(troop: TroopLedgerEntry): TroopPanelVisualProfile {
  const troopTypeText = formatTroopTypeForDisplay(troop.troopType ?? troop.specialDesignation, {
    logisticsClass: troop.logisticsClass,
  }) ?? '兵种未明';
  const sizeText = formatTroopStrength(troop);
  const qualityText = troop.detailLevel === 'intelligence' ? '军情未明' : troop.quality ?? '未明';
  return {
    troopTypeText,
    sizeText,
    qualityText,
    caption: `${troopTypeText} · ${sizeText} · 精锐度 ${qualityText}`,
  };
}

function troopStrengthMidpoint(troop: TroopLedgerEntry): number {
  if (troop.detailLevel !== 'intelligence') return Math.max(0, troop.size);
  if (troop.strengthEstimate) {
    return Math.round((troop.strengthEstimate.min + troop.strengthEstimate.max) / 2);
  }
  return Math.max(0, troop.size);
}

function formatTroopStrength(troop: TroopLedgerEntry): string {
  if (troop.detailLevel !== 'intelligence') return `${troop.size}人`;
  const estimate = troop.strengthEstimate;
  if (estimate) {
    return estimate.min === estimate.max
      ? `约${estimate.min}人`
      : `约${estimate.min}—${estimate.max}人`;
  }
  return troop.size > 0 ? `约${troop.size}人` : '兵力未明';
}

function resolveLocationLabel(runtimeState: RuntimeState, locationId?: string): string | undefined {
  if (!locationId) return undefined;
  return runtimeState.locations?.find((location) => location.locationId === locationId)?.name
    ?? runtimeState.mapNodes?.find((node) => node.id === locationId)?.name
    ?? '未登记地点';
}

function resolveTroopLabel(runtimeState: RuntimeState, troopId?: string): string | undefined {
  if (!troopId) return undefined;
  return runtimeState.troops?.find((troop) => troop.troopId === troopId)?.name ?? '未登记部队';
}

function resolveConflictLabel(runtimeState: RuntimeState, conflictId?: string): string | undefined {
  if (!conflictId) return undefined;
  return runtimeState.conflicts?.find((conflict) => conflict.conflictId === conflictId)?.title ?? '未登记战事';
}

function resolveRouteLabel(runtimeState: RuntimeState, routeId?: string): string | undefined {
  if (!routeId) return undefined;
  return runtimeState.routes?.find((route) => route.routeId === routeId)?.name
    ?? runtimeState.routeEdges?.find((route) => route.routeId === routeId)?.name
    ?? '未登记路线';
}

export function formatTroopTypeForDisplay(
  value?: string,
  projection?: {
    logisticsClass?: TroopLedgerEntry['logisticsClass'];
    primaryClass?: string;
    tags?: readonly string[];
  },
): string | undefined {
  if (projection?.logisticsClass === 'heavy_cavalry'
    || (projection?.primaryClass === 'cavalry' && projection.tags?.includes('heavy'))) {
    return '重骑兵';
  }
  if (!value?.trim()) return undefined;
  const key = value.trim();
  const localized = TROOP_TYPE_LABELS[key] ?? TROOP_TYPE_LABELS[key.toLowerCase()];
  if (localized) return localized;
  if (GENERIC_TROOP_TYPE_WORDS.has(key) || looksLikeEngineeringText(key)) return undefined;
  return key;
}

function formatTroopRelation(value?: string): string {
  if (!value?.trim()) return '不明';
  const key = value.trim();
  return TROOP_RELATION_LABELS[key] ?? (looksLikeEngineeringText(key) ? '关系未明' : key);
}

function formatFactionType(value?: string): string {
  return formatFactionTypeForDisplay(value);
}

function formatCommandRelationship(runtimeState: RuntimeState, troop: TroopLedgerEntry): string | undefined {
  if (isPlayerCommandedTroop(runtimeState, troop)) {
    return '你直接统领';
  }
  return undefined;
}

function isPlayerCommandedTroop(runtimeState: RuntimeState, troop: TroopLedgerEntry): boolean {
  if (troop.leaderNpcId && isPlayerLeaderId(runtimeState, troop.leaderNpcId)) return true;
  const relation = troop.relationToPlayer?.trim();
  if (!relation) return false;
  return /self|own|owned|subordinate|direct_command|directCommand|player_direct|controlled|己方|直属|统领|麾下|受你/.test(relation);
}

function isSelfRelatedTroop(troop: TroopLedgerEntry): boolean {
  const relation = troop.relationToPlayer?.trim();
  return Boolean(relation && /selfRelated|self_related|self-related|自势力相关/.test(relation));
}

function isPlayerLeaderId(runtimeState: RuntimeState, leaderNpcId: string): boolean {
  const playerId = runtimeState.player?.id;
  return leaderNpcId === 'player' || (typeof playerId === 'string' && leaderNpcId === playerId);
}

function looksLikeEngineeringText(value: string): boolean {
  return /[A-Za-z_]/.test(value);
}

function formatLifecycleStatus(status?: TroopLedgerEntry['lifecycleStatus']): string | undefined {
  if (!status) return undefined;
  return LIFECYCLE_STATUS_LABELS[status] ?? (looksLikeEngineeringText(status) ? '状态未明' : status);
}

function formatStrengthTrend(trend?: TroopLedgerEntry['strengthTrend']): string | undefined {
  if (!trend) return undefined;
  return STRENGTH_TREND_LABELS[trend] ?? (looksLikeEngineeringText(trend) ? '变化未明' : trend);
}

function formatCertainty(certainty?: TroopLedgerEntry['certainty']): string | undefined {
  if (!certainty) return undefined;
  return CERTAINTY_LABELS[certainty] ?? (looksLikeEngineeringText(certainty) ? '可信度未明' : certainty);
}

function formatOrderStatus(status?: TroopLedgerEntry['orderStatus']): string | undefined {
  if (!status) return undefined;
  return ORDER_STATUS_LABELS[status] ?? (looksLikeEngineeringText(status) ? '军令未明' : status);
}

function formatMovementStatus(status?: TroopLedgerEntry['movementStatus']): string | undefined {
  if (!status) return undefined;
  return MOVEMENT_STATUS_LABELS[status] ?? (looksLikeEngineeringText(status) ? '行军未明' : status);
}

function compareTroopEntries(a: TroopLedgerEntry, b: TroopLedgerEntry): number {
  const aTime = a.updatedAt ?? a.lastKnownAt ?? '';
  const bTime = b.updatedAt ?? b.lastKnownAt ?? '';
  const byTime = bTime.localeCompare(aTime, 'zh-Hans-CN');
  if (byTime !== 0) return byTime;
  return a.name.localeCompare(b.name, 'zh-Hans-CN');
}

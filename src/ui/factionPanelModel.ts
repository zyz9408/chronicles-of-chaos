import type { FactionLedgerEntry, RuntimeState } from '../engine/types';
import { isOpenCurrentMatter } from '../engine/state/currentMatterLifecycle';
import { formatFactionTypeForDisplay } from '../engine/state/factionTypeNormalization';
import { normalizeCurrentTroopReferenceIds } from '../engine/state/troopLifecycle';
import { isWorldChronicleEligible } from '../engine/state/worldChroniclePolicy';
import { normalizeFactionRecentActionHistory } from '../engine/state/factionRecentActionHistory';

export interface FactionPanelRosterItem {
  factionId: string;
  name: string;
  type: string;
  stanceToPlayer: string;
  knownLevel: FactionLedgerEntry['knownLevel'];
}

export interface FactionPanelDetailRow {
  label: string;
  value: string;
}

export interface FactionPanelBriefingRow extends FactionPanelDetailRow {
  key: 'stance' | 'controller' | 'sphere' | 'recentAction' | 'intelTime' | 'risk';
  tone?: 'normal' | 'warning' | 'danger';
}

export interface FactionPanelDetailSection {
  key: 'identity' | 'timing';
  title: string;
  rows: FactionPanelDetailRow[];
}

export interface FactionPanelRecentAction {
  key: string;
  summary: string;
  knownLevel: FactionLedgerEntry['knownLevel'];
  observedAt?: string;
  sourceNote?: string;
}

export interface FactionPanelModel {
  rosterItems: FactionPanelRosterItem[];
  selectedFactionId: string | null;
  selectedFaction: FactionLedgerEntry | null;
  briefingRows: FactionPanelBriefingRow[];
  summaryRows: FactionPanelDetailRow[];
  detailRows: FactionPanelDetailRow[];
  detailSections: FactionPanelDetailSection[];
  corePeople: string[];
  knownMembers: string[];
  relatedTroops: string[];
  relatedHoldings: string[];
  relatedMatters: string[];
  relatedSignals: string[];
  relatedChronicles: string[];
  recentActions: FactionPanelRecentAction[];
}

const STANCE_LABELS: Record<string, string> = {
  self: '己方',
  friendly: '友好',
  allied: '盟友',
  neutral: '中立',
  hostile: '敌对',
  enemy: '敌对',
  controlled: '受控',
  dependent: '依附',
  wary: '戒备',
  unknown: '不明',
};

export function buildFactionPanelModel(runtimeState: RuntimeState, selectedFactionId?: string | null): FactionPanelModel {
  const troops = runtimeState.troops ?? [];
  const factions = (runtimeState.factions ?? []).map((faction) => {
    const authoritativeFactionTroopIds = troops
      .filter((troop) => troop.factionId === faction.factionId)
      .map((troop) => troop.troopId);
    const relatedTroopIds = normalizeCurrentTroopReferenceIds(
      [...(faction.relatedTroopIds ?? []), ...authoritativeFactionTroopIds],
      troops,
    );
    return relatedTroopIds === faction.relatedTroopIds
      ? faction
      : { ...faction, relatedTroopIds };
  });
  const selectedFaction =
    factions.find((faction) => faction.factionId === selectedFactionId) ??
    factions[0] ??
    null;
  const detailRows = selectedFaction ? buildDetailRows(runtimeState, selectedFaction) : [];

  return {
    rosterItems: factions.map((faction) => ({
      factionId: faction.factionId,
      name: faction.name,
      type: formatFactionType(faction.type),
      stanceToPlayer: formatStance(faction.stanceToPlayer),
      knownLevel: faction.knownLevel,
    })),
    selectedFactionId: selectedFaction?.factionId ?? null,
    selectedFaction,
    briefingRows: selectedFaction ? buildBriefingRows(runtimeState, selectedFaction) : [],
    summaryRows: selectedFaction ? buildSummaryRows(selectedFaction) : [],
    detailRows,
    detailSections: buildDetailSections(detailRows),
    corePeople: selectedFaction?.corePersonNpcIds?.map((npcId) => resolveNpcLabel(runtimeState, npcId)) ?? [],
    knownMembers: selectedFaction?.knownMemberNpcIds?.map((npcId) => resolveNpcLabel(runtimeState, npcId)) ?? [],
    relatedTroops: selectedFaction?.relatedTroopIds?.map((troopId) => resolveTroopLabel(runtimeState, troopId)) ?? [],
    relatedHoldings: selectedFaction ? buildRelatedHoldingLabels(runtimeState, selectedFaction) : [],
    relatedMatters: selectedFaction ? buildRelatedMatterLabels(runtimeState, selectedFaction.factionId) : [],
    relatedSignals: selectedFaction ? buildRelatedSignalLabels(runtimeState, selectedFaction.factionId) : [],
    relatedChronicles: selectedFaction ? buildRelatedChronicleLabels(runtimeState, selectedFaction.factionId) : [],
    recentActions: selectedFaction ? buildRecentActionRows(selectedFaction) : [],
  };
}

function buildRecentActionRows(faction: FactionLedgerEntry): FactionPanelRecentAction[] {
  const normalized = normalizeFactionRecentActionHistory(faction);
  return (normalized.recentActionRecords ?? []).map((record, index) => ({
    key: `${index}:${record.knownLevel}:${record.observedAt ?? ''}:${record.summary}`,
    summary: record.summary,
    knownLevel: record.knownLevel,
    observedAt: record.observedAt,
    sourceNote: record.sourceNote,
  }));
}

function buildSummaryRows(faction: FactionLedgerEntry): FactionPanelDetailRow[] {
  const rows: Array<[string, string | undefined]> = [
    ['类型', formatFactionType(faction.type)],
    ['对玩家态度', formatStance(faction.stanceToPlayer)],
    ['已知势力范围', faction.knownSphere],
    ['情报来源', faction.sourceNote],
  ];
  return rows.flatMap(([label, value]) => makeDetailRow(label, value));
}

function buildDetailRows(runtimeState: RuntimeState, faction: FactionLedgerEntry): FactionPanelDetailRow[] {
  const rows: Array<[string, string | undefined]> = [
    ['类型', formatFactionType(faction.type)],
    ['别名', joinList(faction.aliases)],
    ['对玩家态度', formatStance(faction.stanceToPlayer)],
    ['名义归属', resolveEntityText(runtimeState, faction.nominalAllegiance)],
    ['合法身份', faction.legalIdentity],
    ['实际主事', resolveEntityText(runtimeState, faction.actualController)],
    ['已知势力范围', faction.knownSphere],
    ['情报来源', faction.sourceNote],
    ['消息时间', faction.lastKnownAt],
    ['更新于', faction.updatedAt],
  ];
  return rows.flatMap(([label, value]) => makeDetailRow(label, value));
}

function buildDetailSections(rows: FactionPanelDetailRow[]): FactionPanelDetailSection[] {
  const configs: Array<{ key: FactionPanelDetailSection['key']; title: string; labels: string[] }> = [
    {
      key: 'identity',
      title: '身份与主事',
      labels: ['别名', '名义归属', '合法身份', '实际主事'],
    },
    {
      key: 'timing',
      title: '情报时间',
      labels: ['消息时间', '更新于'],
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

function pickRowsByLabel(rows: FactionPanelDetailRow[], labels: string[]): FactionPanelDetailRow[] {
  const labelSet = new Set(labels);
  return rows.filter((row) => labelSet.has(row.label));
}

function makeDetailRow(label: string, value?: string): FactionPanelDetailRow[] {
  const normalized = value?.trim();
  return normalized ? [{ label, value: normalized }] : [];
}

function joinList(values?: string[]): string | undefined {
  const normalized = values?.map((value) => value.trim()).filter(Boolean) ?? [];
  return normalized.length > 0 ? normalized.join('、') : undefined;
}

function resolveNpcLabel(runtimeState: RuntimeState, npcId: string): string {
  const npc = runtimeState.npcs?.find((item) => item.npcId === npcId);
  return npc ? npc.name : '未登记人物';
}

function resolveTroopLabel(runtimeState: RuntimeState, troopId: string): string {
  const troop = runtimeState.troops?.find((item) => item.troopId === troopId);
  return troop ? troop.name : '未登记部队';
}

function resolveEntityText(runtimeState: RuntimeState, value?: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const faction = runtimeState.factions?.find((item) => item.factionId === normalized);
  if (faction) return faction.name;
  const npc = runtimeState.npcs?.find((item) => item.npcId === normalized);
  if (npc) return npc.name;
  const troop = runtimeState.troops?.find((item) => item.troopId === normalized);
  if (troop) return troop.name;
  if (/^faction[_:-]/i.test(normalized)) return '未登记势力';
  if (/^npc[_:-]/i.test(normalized)) return '未登记人物';
  if (/^troop[_:-]/i.test(normalized)) return '未登记部队';
  return normalized;
}

function buildRelatedHoldingLabels(runtimeState: RuntimeState, faction: FactionLedgerEntry): string[] {
  return (runtimeState.holdings ?? [])
    .filter((holding) => {
      if (holding.factionId === faction.factionId) return true;
      if (holding.nominalAllegiance === faction.name) return true;
      if (holding.nominalAllegiance === faction.factionId) return true;
      if (holding.actualController === faction.name) return true;
      if (holding.actualController === faction.factionId) return true;
      return false;
    })
    .map((holding) => `${holding.name}（${formatHoldingStatus(holding.status)}）`);
}

function formatHoldingStatus(status: string): string {
  const labels: Record<string, string> = {
    controlled: '掌控',
    contested: '争夺中',
    temporary: '临时控制',
    lost: '失去',
    archived: '归档',
  };
  return labels[status] ?? (looksLikeEngineeringText(status) ? '状态未明' : status);
}

function formatFactionType(value?: string): string {
  return formatFactionTypeForDisplay(value);
}

function buildBriefingRows(runtimeState: RuntimeState, faction: FactionLedgerEntry): FactionPanelBriefingRow[] {
  const risk = summarizeFactionRisk(faction.stanceToPlayer);
  const recentActions = buildRecentActionRows(faction);
  return [
    { key: 'stance', label: '对玩家立场', value: formatStance(faction.stanceToPlayer) },
    { key: 'controller', label: '实际主事', value: resolveEntityText(runtimeState, faction.actualController) ?? '主事未明' },
    { key: 'sphere', label: '已知范围', value: faction.knownSphere?.trim() || '范围未详' },
    { key: 'recentAction', label: '近期动作', value: recentActions[recentActions.length - 1]?.summary || '暂无新近动作' },
    { key: 'intelTime', label: '情报时间', value: faction.lastKnownAt?.trim() || faction.updatedAt?.trim() || '时间未详' },
    { key: 'risk', label: '风险提示', value: risk.value, tone: risk.tone },
  ];
}

function summarizeFactionRisk(stance?: string): Pick<FactionPanelBriefingRow, 'value' | 'tone'> {
  const normalized = stance?.trim().toLowerCase() ?? '';
  if (['hostile', 'enemy'].includes(normalized) || /敌|仇|攻/.test(normalized)) {
    return { value: '高风险，行动前需复核敌情', tone: 'danger' };
  }
  if (['wary', 'unknown'].includes(normalized) || /戒备|观望|不明|警惕/.test(normalized)) {
    return { value: normalized === 'unknown' || /不明/.test(normalized) ? '情报不足，谨慎接触' : '存在变数，持续观察', tone: 'warning' };
  }
  return { value: '暂无直接威胁', tone: 'normal' };
}

function formatStance(value?: string): string {
  if (!value?.trim()) return '不明';
  const key = value.trim();
  return STANCE_LABELS[key] ?? (looksLikeEngineeringText(key) ? '态度未明' : key);
}

function looksLikeEngineeringText(value: string): boolean {
  return /[A-Za-z_]/.test(value);
}

function buildRelatedMatterLabels(runtimeState: RuntimeState, factionId: string): string[] {
  return (runtimeState.activeQuests ?? [])
    .filter(isOpenCurrentMatter)
    .filter((quest) => includesFactionId(quest, factionId))
    .map((quest) => quest.title);
}

function buildRelatedSignalLabels(runtimeState: RuntimeState, factionId: string): string[] {
  return (runtimeState.knownRumors ?? [])
    .filter((signal) => includesFactionId(signal, factionId))
    .map((signal) => signal.title ?? signal.content);
}

function buildRelatedChronicleLabels(runtimeState: RuntimeState, factionId: string): string[] {
  return (runtimeState.worldTrends ?? [])
    .filter((trend) => trend.knownToPlayer && isWorldChronicleEligible(trend) && includesFactionId(trend, factionId))
    .map((trend) => `${trend.title}：${trend.summary}`);
}

function includesFactionId(value: {
  factionId?: string;
  relatedFactionId?: string;
  relatedFactionIds?: string[];
  affectedFactionIds?: string[];
}, factionId: string): boolean {
  return value.factionId === factionId ||
    value.relatedFactionId === factionId ||
    (value.relatedFactionIds ?? []).includes(factionId) ||
    (value.affectedFactionIds ?? []).includes(factionId);
}

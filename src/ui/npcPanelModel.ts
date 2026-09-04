import type { CharacterTraitRarity, CharacterUniqueArt, CharacterUniqueArtRarity, LuanShiNpc, RuntimeState } from '../engine/types';
import { normalizeCharacterTraitRarity } from '../engine/character/TraitRarity';
import {
  deriveNpcCurrentAge,
  isAdultFemaleNpcAt,
  normalizeCompleteBirthDate,
} from '../engine/time/npcAge';
import { getPregnancyMonth, getPregnancyStatusLabel } from '../engine/pregnancy/PregnancyLifecycle';
import { filterProtagonistNpcClones } from '../engine/state/playerNpcBoundary';
import { isNpcPhysicallyPresent } from '../engine/state/npcPresence';
import { projectEquippedItems } from '../engine/character/loadoutIdentity';
import { buildTraitTooltipTitle, buildUniqueArtTooltipTitle, formatKnownSourceLabel, formatUniqueArtDomainLabel, normalizeUniqueArtRarity } from './gameTooltipText';
import { normalizeCharacterTraits } from '../engine/character/CharacterTraitNormalization';
import { mergeStableCharacterUniqueArts } from '../engine/character/NpcUniqueArtPolicy';
import { selectNpcRecentActivity, type NpcRecentActivitySource } from '../engine/npc/NpcRecentActivity';

export interface NpcPanelRow {
  id?: string;
  label: string;
  value: string;
  detail?: string;
}

export interface NpcAbilityRow {
  label: string;
  value: number;
}

export type NpcPanelSectionKind =
  | 'basic'
  | 'appearanceAnchor'
  | 'relationship'
  | 'bodyParts'
  | 'preferences'
  | 'privateAnchor'
  | 'womb'
  | 'milestone'
  | 'metadata';

export interface NpcPanelSection {
  title: string;
  rows: NpcPanelRow[];
  kind: NpcPanelSectionKind;
}

export interface NpcTraitChip {
  id: string;
  label: string;
  description: string;
  promptHint?: string;
  source?: string;
  sourceLabel?: string;
  rarity: CharacterTraitRarity;
  title: string;
}

export interface NpcUniqueArtChip {
  id: string;
  label: string;
  description: string;
  effectSummary: string;
  promptHint?: string;
  source?: string;
  sourceLabel?: string;
  rarity: CharacterUniqueArtRarity;
  domain: string;
  domainLabel: string;
  levelText: string;
  progressText?: string;
  title: string;
}

export interface NpcFemaleProfilePanel {
  rows: NpcPanelRow[];
  adultPrivateRows: NpcPanelRow[];
  sections: NpcPanelSection[];
  adultPrivateSections: NpcPanelSection[];
  adultPrivateBodyRows: NpcPanelRow[];
  adultPrivatePreferenceRows: NpcPanelRow[];
  adultPrivateAnchorRows: NpcPanelRow[];
  wombRecords: NpcPrivateWombRecord[];
}

export interface NpcPrivateWombRecord {
  id: string;
  date: string;
  description: string;
  pregnancyCheckDate?: string;
}

export type NpcPrivateRecordDisplayLimit = 10 | 20 | 'all';

export function selectNpcPrivateRecords(
  records: readonly NpcPrivateWombRecord[],
  limit: NpcPrivateRecordDisplayLimit,
): NpcPrivateWombRecord[] {
  return limit === 'all' ? [...records] : records.slice(0, limit);
}

export interface NpcPresenceUpdatePreview {
  id: string;
  summary: string;
  meta: string;
  readByPlayer: boolean;
  sourceKind?: NpcRecentActivitySource;
}

export type NpcMemoryLayerKey = 'recent' | 'mid' | 'long';

export interface NpcMemoryLayerEntry {
  id: string;
  meta: string;
  content: string;
  detail?: string;
}

export interface NpcMemoryLayer {
  key: NpcMemoryLayerKey;
  label: string;
  description: string;
  entries: NpcMemoryLayerEntry[];
}

export interface NpcPanelCard {
  id: string;
  name: string;
  subtitle: string;
  statusBadges: string[];
  relation: string;
  contactLevel: number;
  recentAttitude: string;
  overviewRows: NpcPanelRow[];
  identityRows: NpcPanelRow[];
  descriptionRows: NpcPanelRow[];
  abilityRows: NpcAbilityRow[];
  equipmentRows: NpcPanelRow[];
  inventoryRows: NpcPanelRow[];
  traitChips: NpcTraitChip[];
  traitLabels: string[];
  uniqueArtChips: NpcUniqueArtChip[];
  uniqueArtLabels: string[];
  effectLabels: string[];
  memoryPreview: string[];
  memoryLayers: NpcMemoryLayer[];
  presenceUpdates: NpcPresenceUpdatePreview[];
  femaleProfile?: NpcFemaleProfilePanel;
  isPresent: boolean;
  isFocused: boolean;
}

export interface NpcRosterItem {
  id: string;
  name: string;
  avatarText: string;
  subtitle: string;
  roleText: string;
  relationPreview: string;
  contactLevel: number;
  presenceText: string;
  locationText: string;
  isPresent: boolean;
  isFocused: boolean;
  hasUnreadPresence: boolean;
}

export interface NpcRosterGroup {
  title: string;
  items: NpcRosterItem[];
}

export interface NpcPanelBuildOptions {
  selectedNpcId?: string | null;
  searchText?: string;
  onlyFocused?: boolean;
  groupByLocation?: boolean;
  presenceHintsEnabled?: boolean;
  currentLocationLabel?: string;
}

export interface NpcPanelModel {
  totalCount: number;
  presentCount: number;
  focusedCount: number;
  visibleCount: number;
  cards: NpcPanelCard[];
  rosterGroups: NpcRosterGroup[];
  selectedCard?: NpcPanelCard;
  selectedRosterItem?: NpcRosterItem;
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
const missingTraitDescription = '\u6682\u65e0\u8bf4\u660e\u3002';

const certaintyLabels: Record<string, string> = {
  confirmed: '已确认',
  reported: '据报',
  rumor: '传闻',
  uncertain: '不明',
};

const equipmentSlotLabelMap: Record<string, string> = {
  weapon: '武器',
  armor: '防具',
  mount: '坐骑',
  treasure: '宝物',
};

const inventoryCategoryLabelMap: Record<string, string> = {
  equipment: '备用装备',
  document: '文书',
  token: '令牌',
  consumable: '消耗品',
  supply: '补给',
  material: '材料',
  misc: '杂物',
};

function getCurrentNpcAge(npc: LuanShiNpc, currentDate: string): number | undefined {
  return deriveNpcCurrentAge(npc, currentDate);
}

function isFemaleNpc(npc: LuanShiNpc): boolean {
  return npc.sex === '女';
}

function isUnderageFemaleNpc(npc: LuanShiNpc, currentDate: string): boolean {
  const age = getCurrentNpcAge(npc, currentDate);
  return isFemaleNpc(npc) && age !== undefined && age < 18;
}

function normalizeTraitRarity(value?: string | null): CharacterTraitRarity {
  return normalizeCharacterTraitRarity(value) ?? 'white';
}



function buildTraitChips(npc: LuanShiNpc): NpcTraitChip[] {
  return normalizeCharacterTraits(npc.traits)
    .filter((trait) => hasText(trait.label))
    .map((trait) => ({
      id: trait.id,
      label: trait.label.trim(),
      description: hasText(trait.description) ? trait.description.trim() : missingTraitDescription,
      promptHint: hasText(trait.promptHint) ? trait.promptHint.trim() : undefined,
      source: hasText(trait.source) ? trait.source.trim() : undefined,
      sourceLabel: hasText(trait.source) ? formatKnownSourceLabel(trait.source) : undefined,
      rarity: normalizeTraitRarity(trait.rarity),
      title: buildTraitTooltipTitle(trait),
    }));
}

function buildUniqueArtLevelText(art: CharacterUniqueArt): string {
  return art.maxLevel ? `Lv.${art.level} / ${art.maxLevel}` : `Lv.${art.level}`;
}

function buildUniqueArtProgressText(progress?: number): string | undefined {
  if (typeof progress !== 'number' || !Number.isFinite(progress)) return undefined;
  return `${Math.max(0, Math.min(100, Math.round(progress)))}%`;
}

function buildUniqueArtChips(npc: LuanShiNpc): NpcUniqueArtChip[] {
  return mergeStableCharacterUniqueArts(npc.uniqueArts, [])
    .filter((art) => hasText(art.name))
    .map((art) => ({
      id: art.id,
      label: art.name.trim(),
      description: hasText(art.description) ? art.description.trim() : missingTraitDescription,
      effectSummary: hasText(art.effectSummary) ? art.effectSummary.trim() : missingTraitDescription,
      promptHint: hasText(art.promptHint) ? art.promptHint.trim() : undefined,
      source: hasText(art.source) ? art.source.trim() : undefined,
      sourceLabel: hasText(art.source) ? formatKnownSourceLabel(art.source) : undefined,
      rarity: normalizeUniqueArtRarity(art.rarity),
      domain: hasText(art.domain) ? art.domain.trim() : 'other',
      domainLabel: formatUniqueArtDomainLabel(art.domain),
      levelText: buildUniqueArtLevelText(art),
      progressText: buildUniqueArtProgressText(art.progress),
      title: buildUniqueArtTooltipTitle(art),
    }));
}
function pushRow(rows: NpcPanelRow[], label: string, value?: string | null, detail?: string | null): void {
  if (!hasText(value)) return;
  rows.push({
    label,
    value: value.trim(),
    ...(hasText(detail) ? { detail: detail.trim() } : {}),
  });
}

function pushBooleanRow(rows: NpcPanelRow[], label: string, value?: boolean): void {
  if (typeof value !== 'boolean') return;
  rows.push({ label, value: value ? '是' : '否' });
}

function buildSection(title: string, rows: NpcPanelRow[], kind: NpcPanelSectionKind): NpcPanelSection | undefined {
  return rows.length > 0 ? { title, rows, kind } : undefined;
}

function formatRelationshipNetwork(profile: LuanShiNpc['femaleProfile']): string {
  return (profile?.relationshipNetwork ?? [])
    .filter((entry) => hasText(entry.targetName) && hasText(entry.relationship))
    .map((entry) => {
      const base = `${entry.targetName.trim()}：${entry.relationship.trim()}`;
      return hasText(entry.notes) ? `${base}（${entry.notes.trim()}）` : base;
    })
    .join('；');
}

function buildWombRecords(profile: LuanShiNpc['femaleProfile']): NpcPrivateWombRecord[] {
  return (profile?.adultPrivateProfile?.wombProfile?.inseminationRecords ?? [])
    .filter((record) => hasText(record.date) && hasText(record.description))
    .map((record, index) => ({
      id: `womb-record-${index}-${record.date.trim()}`,
      date: record.date.trim(),
      description: record.description.trim(),
      ...(hasText(record.pregnancyCheckDate)
        ? { pregnancyCheckDate: record.pregnancyCheckDate.trim() }
        : {}),
    }))
    .reverse();
}

function buildSubtitle(npc: LuanShiNpc): string {
  const parts = [
    hasText(npc.courtesyName) ? `字${npc.courtesyName.trim()}` : '',
    hasText(npc.artName) ? `号${npc.artName.trim()}` : '',
    ...(npc.aliases ?? []).filter(hasText).map((item) => item.trim()),
    hasText(npc.commonAddress) ? npc.commonAddress.trim() : '',
  ].filter(hasText);

  return parts.join(' · ');
}

function buildStatusBadges(npc: LuanShiNpc, currentDate: string, isPresent: boolean): string[] {
  const age = getCurrentNpcAge(npc, currentDate);
  const birthDate = normalizeCompleteBirthDate(npc.birthDate);
  const sexAndAge = npc.sex && age !== undefined ? `${npc.sex} ${age}岁` : npc.sex;
  return [
    isPresent ? '在场' : '',
    npc.isFocused ? '关注' : '',
    npc.factionName,
    isUnderageFemaleNpc(npc, currentDate) ? '未成年' : '',
    birthDate && sexAndAge ? `${sexAndAge} · ${birthDate}生` : sexAndAge,
  ].filter(hasText);
}

function buildIdentityRows(npc: LuanShiNpc): NpcPanelRow[] {
  const rows: NpcPanelRow[] = [];
  pushRow(rows, '当前身份', npc.currentIdentity, npc.currentIdentityDescription);
  pushRow(rows, '角色定位', npc.role);
  pushRow(rows, '出身', npc.birthOrigin, npc.birthOriginDescription);
  pushRow(rows, '所属势力', npc.factionName);
  pushRow(rows, '效力对象', npc.allegianceTarget);
  pushRow(rows, '官职', npc.officeTitle);
  pushRow(rows, '军职', npc.militaryTitle);
  pushRow(rows, '爵位封号', npc.nobleTitle);
  pushRow(rows, '身份摘要', npc.identitySummary);
  return rows;
}

function buildDescriptionRows(npc: LuanShiNpc): NpcPanelRow[] {
  const rows: NpcPanelRow[] = [];
  pushRow(rows, '人物简介', npc.summary);
  pushRow(rows, '外貌', npc.appearance);
  pushRow(rows, '性格', npc.personality);
  pushRow(rows, '动机', npc.motivation);
  return rows;
}

function buildNpcRowDetail(parts: Array<string | undefined>): string | undefined {
  const detail = parts.filter(hasText).map((part) => part.trim()).join('；');
  return hasText(detail) ? detail : undefined;
}

function buildNpcEquipmentRows(npc: LuanShiNpc): NpcPanelRow[] {
  return projectEquippedItems(npc.equipment ?? [])
    .filter((item) => hasText(item.name))
    .map((item) => {
      const slot = hasText(item.slot) ? item.slot.trim() : '';
      return {
        id: hasText(item.id) ? item.id.trim() : undefined,
        label: equipmentSlotLabelMap[slot] ?? slot,
        value: item.name.trim(),
        detail: buildNpcRowDetail([
          item.quality,
          item.condition,
          item.description,
          hasText(item.promptHint) ? `承接：${item.promptHint.trim()}` : undefined,
        ]),
      };
    });
}

function buildNpcInventoryRows(npc: LuanShiNpc): NpcPanelRow[] {
  return (npc.inventory ?? [])
    .flatMap((item) => {
      if (!hasText(item.name) || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity)) return [];
      const quantity = Math.floor(item.quantity);
      if (quantity <= 0) return [];
      const category = hasText(item.category) ? item.category.trim() : 'misc';
      return [{
        id: hasText(item.id) ? item.id.trim() : undefined,
        label: inventoryCategoryLabelMap[category] ?? '杂物',
        value: `${item.name.trim()} x${quantity}`,
        detail: buildNpcRowDetail([
          item.keyItem ? '关键' : undefined,
          item.quality,
          item.condition,
          item.description,
          hasText(item.promptHint) ? `承接：${item.promptHint.trim()}` : undefined,
        ]),
      }];
    });
}

function buildLoadoutSummary(equipmentRows: NpcPanelRow[], inventoryRows: NpcPanelRow[]): string {
  if (equipmentRows.length === 0 && inventoryRows.length === 0) return '未记录';
  return [
    equipmentRows.length > 0 ? `${equipmentRows.length}件装备` : undefined,
    inventoryRows.length > 0 ? `${inventoryRows.length}类携物` : undefined,
  ].filter(hasText).join(' / ');
}

const npcRelationshipLabelMap: Record<string, string> = {
  neutral: '中立',
  hostile: '敌对',
  submissive: '顺从',
};

function formatNpcRelationshipLabel(value: string): string {
  const text = value.trim();
  return npcRelationshipLabelMap[text.toLocaleLowerCase()] ?? text;
}

function buildOverviewRows(
  npc: LuanShiNpc,
  equipmentRows: NpcPanelRow[],
  inventoryRows: NpcPanelRow[],
): NpcPanelRow[] {
  const relation = formatNpcRelationshipLabel(npc.relationToPlayer);
  const recentAttitude = formatNpcRelationshipLabel(npc.recentAttitude);
  return [
    {
      label: '身份',
      value: npc.currentIdentity || npc.role || npc.factionName || '身份未明',
      detail: buildNpcRowDetail([npc.factionName, npc.officeTitle, npc.militaryTitle, npc.nobleTitle]),
    },
    {
      label: '关系',
      value: recentAttitude || relation || '关系未明',
      detail: relation,
    },
    { label: '行装', value: buildLoadoutSummary(equipmentRows, inventoryRows) },
    { label: '记忆', value: `${npc.memories.length}条` },
  ];
}

const publicAbilityOrder = ['武力', '统率', '智力', '政治', '魅力'];
const hiddenAbilityLabels = new Set(['机运']);

function buildAbilityRows(npc: LuanShiNpc): NpcAbilityRow[] {
  const scores = npc.abilityScores;
  if (!scores) return [];

  const rows: NpcAbilityRow[] = [];
  for (const label of publicAbilityOrder) {
    const value = scores[label];
    if (typeof value === 'number' && Number.isFinite(value)) {
      rows.push({ label, value });
    }
  }

  const extraRows: NpcAbilityRow[] = Object.entries(scores).flatMap(([label, value]) => {
    if (publicAbilityOrder.includes(label) || hiddenAbilityLabels.has(label)) return [];
    if (typeof value !== 'number' || !Number.isFinite(value)) return [];
    return [{ label, value }];
  });

  return [...rows, ...extraRows];
}

function buildMemoryPreview(npc: LuanShiNpc): string[] {
  return [...npc.memories]
    .reverse()
    .map((memory) => (
      hasText(memory.createdAt)
        ? `${formatKnownSourceLabel(memory.source)}｜${memory.createdAt.trim()}：${memory.content}`
        : `${formatKnownSourceLabel(memory.source)}：${memory.content}`
    ));
}

function formatMemoryRange(fromCreatedAt?: string, toCreatedAt?: string): string {
  const from = hasText(fromCreatedAt) ? fromCreatedAt.trim() : '';
  const to = hasText(toCreatedAt) ? toCreatedAt.trim() : '';
  if (from && to && from !== to) return `${from}—${to}`;
  return to || from || '时间未明';
}

function buildMemoryLayers(state: RuntimeState, npc: LuanShiNpc): NpcMemoryLayer[] {
  const recentEntries: NpcMemoryLayerEntry[] = [...npc.memories]
    .reverse()
    .map((memory) => ({
      id: memory.memoryId,
      meta: hasText(memory.createdAt)
        ? `${formatKnownSourceLabel(memory.source)} · ${memory.createdAt.trim()}`
        : formatKnownSourceLabel(memory.source),
      content: memory.content,
    }));

  const midEntries: NpcMemoryLayerEntry[] = [...(state.memoryArchive?.npcMidTermSummaries ?? [])]
    .filter((summary) => summary.npcId === npc.npcId)
    .reverse()
    .map((summary) => ({
      id: summary.summaryId,
      meta: `中期 · ${formatMemoryRange(summary.fromCreatedAt, summary.toCreatedAt)}`,
      content: summary.summary,
      ...(summary.foldedIntoLongTermSummaryId ? { detail: '已归入长期摘要' } : {}),
    }));

  const longTermEntries: NpcMemoryLayerEntry[] = [...(state.memoryArchive?.npcLongTermSummaries ?? [])]
    .filter((summary) => summary.npcId === npc.npcId)
    .reverse()
    .map((summary) => ({
      id: summary.summaryId,
      meta: `长期 · ${formatMemoryRange(summary.fromCreatedAt, summary.toCreatedAt)}`,
      content: summary.summary,
    }));
  const interactionEntries: NpcMemoryLayerEntry[] = [...(state.memoryArchive?.npcInteractionSummaries ?? [])]
    .filter((summary) => summary.npcId === npc.npcId)
    .reverse()
    .map((summary, index) => ({
      id: `interaction-${npc.npcId}-${summary.updatedAt}-${index}`,
      meta: `互动总览 · ${formatMemoryRange(summary.fromCreatedAt, summary.toCreatedAt)}`,
      content: summary.summary,
    }));

  return [
    {
      key: 'recent',
      label: '近期',
      description: '保留的原始经历与认知来源',
      entries: recentEntries,
    },
    {
      key: 'mid',
      label: '中期',
      description: '由连续原始记忆压缩形成的阶段摘要',
      entries: midEntries,
    },
    {
      key: 'long',
      label: '长期',
      description: '长期经历与互动关系总览',
      entries: [...longTermEntries, ...interactionEntries],
    },
  ];
}

function hasUnreadPresenceUpdate(npc: LuanShiNpc): boolean {
  return (npc.presenceUpdates ?? []).some((update) => update.readByPlayer === false);
}

function buildPresenceUpdates(state: RuntimeState, npc: LuanShiNpc): NpcPresenceUpdatePreview[] {
  return selectNpcRecentActivity(state, npc).map((activity) => {
      const update = activity.source === 'presenceUpdate'
        ? npc.presenceUpdates?.find((item) => `presence-update:${item.id}` === activity.id)
        : undefined;
      const meta = [
        activity.occurredAt,
        activity.sourceLabel,
        hasText(update?.kind) ? update.kind : '',
        hasText(update?.source) ? formatKnownSourceLabel(update.source) : '',
        hasText(update?.certainty) ? certaintyLabels[update.certainty] ?? update.certainty : '',
      ].filter(hasText).join(' / ');

      return {
        id: activity.id,
        summary: activity.summary,
        meta,
        readByPlayer: activity.readByPlayer,
        sourceKind: activity.source,
      };
    });
}

function buildFemaleProfile(npc: LuanShiNpc, currentDate: string): NpcFemaleProfilePanel | undefined {
  const profile = npc.femaleProfile;
  if (!profile) return undefined;

  const basicRows: NpcPanelRow[] = [];
  pushRow(basicRows, '生日', profile.birthday);
  pushRow(basicRows, '对主角称呼', profile.addressToPlayer);
  pushRow(basicRows, '关系记录', profile.relationshipNotes);
  pushRow(basicRows, '公开亲昵边界', profile.publicIntimacyNotes);
  pushRow(basicRows, '情绪边界', profile.emotionalBoundary);
  pushRow(basicRows, '更新于', profile.updatedAt);
  pushRow(basicRows, '来源', hasText(profile.source) ? formatKnownSourceLabel(profile.source) : undefined);

  const appearanceRows: NpcPanelRow[] = [];
  pushRow(appearanceRows, '外貌描写', profile.appearanceDescription);
  pushRow(appearanceRows, '身材描写', profile.bodyDescription);
  pushRow(appearanceRows, '衣着风格', profile.clothingStyle);
  pushRow(appearanceRows, '外貌补充', profile.appearanceExtension);

  const relationshipRows: NpcPanelRow[] = [];
  pushRow(relationshipRows, '核心性格特征', profile.personalityCore);
  pushRow(relationshipRows, '好感度突破条件', profile.affectionProgressionCondition);
  pushRow(relationshipRows, '关系突破条件', profile.relationshipProgressionCondition);
  pushRow(relationshipRows, '关系网变量', formatRelationshipNetwork(profile));

  const sections = [
    buildSection('基础档案', basicRows, 'basic'),
    buildSection('外貌与衣着', appearanceRows, 'appearanceAnchor'),
    buildSection('关系承接', relationshipRows, 'relationship'),
  ].filter((section): section is NpcPanelSection => Boolean(section));

  const adultPrivateSections: NpcPanelSection[] = [];
  const adultPrivateAnchorRows: NpcPanelRow[] = [];
  const adultPrivateBodyRows = adultPrivateAnchorRows;
  const adultPrivatePreferenceRows: NpcPanelRow[] = [];
  let wombRecords: NpcPrivateWombRecord[] = [];
  const adultPrivateProfile = profile.adultPrivateProfile;
  if (adultPrivateProfile && isAdultFemaleNpcAt(npc, currentDate) && adultPrivateProfile.enabled !== false && adultPrivateProfile.ageConfirmedAdult !== false) {
    pushRow(adultPrivateAnchorRows, '胸部描述', adultPrivateProfile.breastDescription);
    pushRow(adultPrivateAnchorRows, '小穴描述', adultPrivateProfile.vaginaDescription);
    pushRow(adultPrivateAnchorRows, '屁穴描述', adultPrivateProfile.anusDescription);
    const anchorSection = buildSection('私密部位锚点', adultPrivateAnchorRows, 'privateAnchor');
    if (anchorSection) adultPrivateSections.push(anchorSection);

    pushRow(adultPrivatePreferenceRows, '性癖', adultPrivateProfile.sexualPreferenceNotes);
    pushRow(adultPrivatePreferenceRows, '敏感点', adultPrivateProfile.sensitiveSpotNotes);
    pushRow(adultPrivatePreferenceRows, '偏好记录', adultPrivateProfile.preferenceNotes);
    pushRow(adultPrivatePreferenceRows, '边界记录', adultPrivateProfile.boundaryNotes);
    pushRow(adultPrivatePreferenceRows, '敏感记录', adultPrivateProfile.sensitiveNotes);
    pushRow(adultPrivatePreferenceRows, '关系风险', adultPrivateProfile.relationshipRiskNotes);
    const preferenceSection = buildSection('私密信息', adultPrivatePreferenceRows, 'preferences');
    if (preferenceSection) adultPrivateSections.push(preferenceSection);

    const wombRows: NpcPanelRow[] = [];
    wombRecords = buildWombRecords(profile);
    pushRow(wombRows, '状态', adultPrivateProfile.wombProfile?.status);
    pushRow(wombRows, '宫口状态', adultPrivateProfile.wombProfile?.cervixStatus);
    const pregnancy = adultPrivateProfile.wombProfile?.pregnancy;
    if (pregnancy) {
      pushRow(wombRows, '怀孕进程', getPregnancyStatusLabel(pregnancy.status));
      const pregnancyMonth = getPregnancyMonth(currentDate, pregnancy);
      if (pregnancyMonth !== undefined && pregnancy.status !== 'postpartum') {
        pushRow(wombRows, '孕期', `第${pregnancyMonth}月`);
      }
      if (pregnancy.status === 'pendingCheck') pushRow(wombRows, '计划判定日', pregnancy.checkAt);
      pushRow(wombRows, '预计分娩', pregnancy.status === 'postpartum' ? undefined : pregnancy.estimatedDueAt);
      pushRow(
        wombRows,
        '父系记录',
        pregnancy.paternityStatus === 'uncertain'
          ? '未定'
          : pregnancy.fatherCharacterIds.includes('player')
            ? '主角'
            : pregnancy.fatherCharacterIds.join('、'),
      );
      pushRow(wombRows, '知情范围', pregnancy.disclosure === 'public' ? '已公开' : '私密');
      pushRow(wombRows, '产后恢复至', pregnancy.postpartumUntil);
    }
    pushBooleanRow(wombRows, '是否处女', adultPrivateProfile.virgin);
    pushRow(wombRows, '初夜夺取者', adultPrivateProfile.firstNightPartner);
    pushRow(wombRows, '初夜时间', adultPrivateProfile.firstNightTime);
    pushRow(wombRows, '初夜描述', adultPrivateProfile.firstNightDescription);
    const wombSection = wombRows.length > 0 || wombRecords.length > 0
      ? { title: '子宫档案', rows: wombRows, kind: 'womb' as const }
      : undefined;
    if (wombSection) adultPrivateSections.push(wombSection);
  }

  const rows = sections.flatMap((section) => section.rows);
  const adultPrivateRows = adultPrivateSections.flatMap((section) => section.rows);

  if (rows.length === 0 && adultPrivateRows.length === 0 && wombRecords.length === 0) return undefined;
  return {
    rows,
    adultPrivateRows,
    sections,
    adultPrivateSections,
    adultPrivateBodyRows,
    adultPrivatePreferenceRows,
    adultPrivateAnchorRows,
    wombRecords,
  };
}

function buildCard(state: RuntimeState, npc: LuanShiNpc, currentDate: string, isPresent: boolean): NpcPanelCard {
  const traitChips = buildTraitChips(npc);
  const uniqueArtChips = buildUniqueArtChips(npc);
  const femaleProfile = buildFemaleProfile(npc, currentDate);
  const equipmentRows = buildNpcEquipmentRows(npc);
  const inventoryRows = buildNpcInventoryRows(npc);
  const overviewRows = buildOverviewRows(npc, equipmentRows, inventoryRows);

  return {
    id: npc.npcId,
    name: npc.name,
    subtitle: buildSubtitle(npc),
    statusBadges: buildStatusBadges(npc, currentDate, isPresent),
    relation: formatNpcRelationshipLabel(npc.relationToPlayer),
    contactLevel: npc.contactLevel,
    recentAttitude: formatNpcRelationshipLabel(npc.recentAttitude),
    overviewRows,
    identityRows: buildIdentityRows(npc),
    descriptionRows: buildDescriptionRows(npc),
    abilityRows: buildAbilityRows(npc),
    equipmentRows,
    inventoryRows,
    traitChips,
    traitLabels: traitChips.map((trait) => trait.label),
    uniqueArtChips,
    uniqueArtLabels: uniqueArtChips.map((art) => art.label),
    effectLabels: (npc.effects ?? []).map((effect) => effect.label).filter(hasText),
    memoryPreview: buildMemoryPreview(npc),
    memoryLayers: buildMemoryLayers(state, npc),
    presenceUpdates: buildPresenceUpdates(state, npc),
    ...(femaleProfile ? { femaleProfile } : {}),
    isPresent,
    isFocused: npc.isFocused,
  };
}
function resolveKnownLocationName(state: RuntimeState, locationId?: string): string {
  if (!hasText(locationId)) return '';

  const ledgerLocation = state.locations?.find((location) => location.locationId === locationId);
  if (ledgerLocation) return ledgerLocation.name;

  const mapNode = state.mapNodes?.find((node) => node.id === locationId);
  if (mapNode) return mapNode.name;

  return '';
}

function resolveLocationName(
  state: RuntimeState,
  npc: LuanShiNpc,
  isPresent: boolean,
  currentLocationLabel?: string,
): string {
  const currentLocationName = hasText(currentLocationLabel)
    ? currentLocationLabel.trim()
    : resolveKnownLocationName(state, state.currentPlaceId ?? state.currentLocationId);

  if (isPresent) return currentLocationName || '当前地点';

  const locationId = npc.locationId;
  if (!hasText(locationId)) return '';

  if (locationId === state.currentPlaceId || locationId === state.currentLocationId) {
    return currentLocationName || '当前地点';
  }

  const knownLocationName = resolveKnownLocationName(state, locationId);
  if (knownLocationName) return knownLocationName;

  if (/^(loc|location|place|scene)[_:-]/i.test(locationId)) return '未登记地点';
  return locationId;
}

function buildRosterItem(
  card: NpcPanelCard,
  npc: LuanShiNpc,
  state: RuntimeState,
  presenceHintsEnabled: boolean,
  currentLocationLabel?: string,
): NpcRosterItem {
  const locationText = resolveLocationName(state, npc, card.isPresent, currentLocationLabel);
  return {
    id: card.id,
    name: card.name,
    avatarText: Array.from(card.name.trim())[0] ?? '人',
    subtitle: card.subtitle,
    roleText: npc.currentIdentity || npc.role || npc.factionName || '未明身份',
    relationPreview: card.recentAttitude || card.relation || '关系未明',
    contactLevel: card.contactLevel,
    presenceText: card.isPresent ? '在场' : '未在场',
    locationText,
    isPresent: card.isPresent,
    isFocused: card.isFocused,
    hasUnreadPresence: presenceHintsEnabled && card.presenceUpdates.some((update) => update.readByPlayer === false),
  };
}

function cardMatchesSearch(card: NpcPanelCard, item: NpcRosterItem, searchText: string): boolean {
  const query = searchText.trim().toLocaleLowerCase();
  if (!query) return true;

  const haystack = [
    card.name,
    card.subtitle,
    card.relation,
    card.recentAttitude,
    ...card.statusBadges,
    ...card.identityRows.flatMap((row) => [row.label, row.value, row.detail ?? '']),
    ...card.descriptionRows.flatMap((row) => [row.label, row.value]),
    ...card.equipmentRows.flatMap((row) => [row.label, row.value, row.detail ?? '']),
    ...card.inventoryRows.flatMap((row) => [row.label, row.value, row.detail ?? '']),
    ...card.memoryLayers.flatMap((layer) => layer.entries.flatMap((entry) => [
      entry.meta,
      entry.content,
      entry.detail ?? '',
    ])),
    ...(card.femaleProfile?.rows.flatMap((row) => [row.label, row.value, row.detail ?? '']) ?? []),
    ...(card.femaleProfile?.adultPrivateRows.flatMap((row) => [row.label, row.value, row.detail ?? '']) ?? []),
    ...(card.femaleProfile?.wombRecords.flatMap((record) => [
      record.date,
      record.description,
      record.pregnancyCheckDate ?? '',
    ]) ?? []),
    ...card.presenceUpdates.flatMap((update) => [update.summary, update.meta]),
    ...card.traitLabels,
    ...card.uniqueArtLabels,
    ...card.uniqueArtChips.flatMap((art) => [
      art.description,
      art.effectSummary,
      art.promptHint ?? '',
      art.domainLabel,
    ]),
    ...card.effectLabels,
    item.roleText,
    item.locationText,
    item.presenceText,
  ]
    .filter(hasText)
    .join(' ')
    .toLocaleLowerCase();

  return haystack.includes(query);
}

function groupRosterItems(items: NpcRosterItem[], groupByLocation?: boolean): NpcRosterGroup[] {
  if (!groupByLocation) {
    return items.length > 0 ? [{ title: '全部人物', items }] : [];
  }

  const groups: NpcRosterGroup[] = [];
  for (const item of items) {
    const title = item.locationText || (item.isPresent ? '当前地点' : '未明地点');
    const existing = groups.find((group) => group.title === title);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.push({ title, items: [item] });
    }
  }
  return groups;
}

export function buildNpcPanelModel(state: RuntimeState, options: NpcPanelBuildOptions = {}): NpcPanelModel {
  const presenceHintsEnabled = options.presenceHintsEnabled ?? true;
  const npcs = filterProtagonistNpcClones(state, state.npcs ?? []).sort((a, b) => {
    if (presenceHintsEnabled) {
      const unreadDelta = Number(hasUnreadPresenceUpdate(b)) - Number(hasUnreadPresenceUpdate(a));
      if (unreadDelta !== 0) return unreadDelta;
    }

    const presentDelta = Number(isNpcPhysicallyPresent(state, b)) - Number(isNpcPhysicallyPresent(state, a));
    if (presentDelta !== 0) return presentDelta;

    const focusedDelta = Number(b.isFocused) - Number(a.isFocused);
    if (focusedDelta !== 0) return focusedDelta;

    const contactDelta = b.contactLevel - a.contactLevel;
    if (contactDelta !== 0) return contactDelta;

    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });

  const cards = npcs.map((npc) => buildCard(state, npc, state.currentDate, isNpcPhysicallyPresent(state, npc)));
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const rosterItems = npcs.map((npc) => buildRosterItem(
    cardById.get(npc.npcId)!,
    npc,
    state,
    presenceHintsEnabled,
    options.currentLocationLabel,
  ));
  const itemById = new Map(rosterItems.map((item) => [item.id, item]));

  const visibleItems = rosterItems.filter((item) => {
    if (options.onlyFocused && !item.isFocused) return false;
    const card = cardById.get(item.id);
    return card ? cardMatchesSearch(card, item, options.searchText ?? '') : false;
  });

  const selectedRosterItem =
    visibleItems.find((item) => item.id === options.selectedNpcId) ??
    visibleItems[0];
  const selectedCard = selectedRosterItem ? cardById.get(selectedRosterItem.id) : undefined;

  return {
    totalCount: npcs.length,
    presentCount: npcs.filter((npc) => isNpcPhysicallyPresent(state, npc)).length,
    focusedCount: npcs.filter((npc) => npc.isFocused).length,
    visibleCount: visibleItems.length,
    cards,
    rosterGroups: groupRosterItems(visibleItems, options.groupByLocation),
    selectedCard,
    selectedRosterItem: selectedRosterItem ? itemById.get(selectedRosterItem.id) : undefined,
  };
}

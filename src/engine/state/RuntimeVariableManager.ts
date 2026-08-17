import type {
  Actor,
  CharacterUniqueArt,
  HoldingLedgerEntry,
  LuanShiNpc,
  PrivateAssetEntry,
  Relationship,
  RuntimeState,
  TroopLedgerEntry,
} from '../types';
import { CORE_PLAYER_ATTRIBUTE_KEYS } from '../character/progression';
import {
  getHoldingCapacityLimits,
  validateHoldingCapacityUpdate,
} from '../holdings/HoldingCapacityPolicy';
import { getPrivateAssetAbsoluteScaleLimits } from '../holdings/PrivateAssetPolicy';
import { normalizeEquipmentQualityTier } from '../equipment/EquipmentQuality';
import {
  deriveActorCurrentAge,
  deriveNpcCurrentAge,
  normalizeCompleteBirthDate,
} from '../time/npcAge';
import { migrateRuntimeStateForPersistence } from './RuntimeStateMigration';

export type RuntimeVariableSection =
  | 'player'
  | 'npc'
  | 'inventory'
  | 'uniqueArt'
  | 'relationship'
  | 'resources'
  | 'troop'
  | 'holding'
  | 'privateAsset';

export type RuntimeVariableValue = string | number | boolean;
export type RuntimeVariableDraft = Record<string, RuntimeVariableValue>;

export interface RuntimeVariableSectionDefinition {
  id: RuntimeVariableSection;
  label: string;
  description: string;
  requiresEntity: boolean;
}

export interface RuntimeVariableEntityOption {
  id: string;
  label: string;
  detail?: string;
}

export interface RuntimeVariableFieldOption {
  value: string;
  label: string;
}

export interface RuntimeVariableFieldDefinition {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'checkbox' | 'select' | 'readonly';
  value: RuntimeVariableValue;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: RuntimeVariableFieldOption[];
  wide?: boolean;
}

export interface RuntimeVariableEditorDefinition {
  title: string;
  subtitle: string;
  fields: RuntimeVariableFieldDefinition[];
}

export interface RuntimeVariableChange {
  key: string;
  label: string;
  before: string;
  after: string;
}

export type RuntimeVariablePreviewResult =
  | { ok: true; state: RuntimeState; changes: RuntimeVariableChange[]; warnings: string[] }
  | { ok: false; errors: string[] };

export const RUNTIME_VARIABLE_SECTIONS: readonly RuntimeVariableSectionDefinition[] = [
  { id: 'player', label: '玩家', description: '身份、属性、成长、生命体力与个人钱财。', requiresEntity: false },
  { id: 'npc', label: 'NPC', description: '人物身份、位置、在场状态、关系与基础能力。', requiresEntity: true },
  { id: 'inventory', label: '背包', description: '修正已有背包物品的数量与可见档案。', requiresEntity: true },
  { id: 'uniqueArt', label: '绝艺', description: '修正已有绝艺的等级、进度、品级和说明。', requiresEntity: true },
  { id: 'relationship', label: '关系', description: '修正已有角色关系的类型、数值和说明。', requiresEntity: true },
  { id: 'resources', label: '府库', description: '修正公共钱粮、战马、军械和可征召人手。', requiresEntity: false },
  { id: 'troop', label: '部队', description: '修正已有部队的兵力、将领、位置与战备状态。', requiresEntity: true },
  { id: 'holding', label: '领地', description: '在类型、民政范围和容量规则内修正领地账本。', requiresEntity: true },
  { id: 'privateAsset', label: '私产', description: '在私产类型与规模上限内修正经营账本。', requiresEntity: true },
] as const;

const UNIQUE_ART_RARITIES = ['white', 'green', 'blue', 'purple', 'orange', 'red'];
const QUALITY_OPTIONS = ['低', '中', '高', '精锐'];
const FATIGUE_OPTIONS = ['低', '中', '高', '极高'];
const READINESS_OPTIONS = ['低', '中', '高'];
const TROOP_LIFECYCLE_OPTIONS = ['active', 'routed', 'merged', 'split', 'destroyed', 'surrendered', 'disbanded', 'unknown', 'archived'];
const HOLDING_STATUS_OPTIONS = ['controlled', 'contested', 'temporary', 'lost', 'archived'];
const PRIVATE_ASSET_STATUS_OPTIONS = ['active', 'damaged', 'occupied', 'disputed', 'archived'];

export function listRuntimeVariableEntities(
  state: RuntimeState,
  section: RuntimeVariableSection,
): RuntimeVariableEntityOption[] {
  switch (section) {
    case 'npc':
      return (state.npcs ?? []).map((npc) => ({
        id: npc.npcId,
        label: npc.name,
        detail: [npc.currentIdentity || npc.role, npc.locationId].filter(Boolean).join(' · '),
      }));
    case 'inventory':
      return (state.player.inventory ?? []).map((item) => ({
        id: item.id,
        label: item.name,
        detail: `${item.category ?? '未分类'} · 数量 ${item.quantity}`,
      }));
    case 'uniqueArt':
      return listUniqueArtEntities(state);
    case 'relationship':
      return state.relationships.map((relationship) => ({
        id: relationship.id,
        label: relationshipLabel(state, relationship),
        detail: `${relationship.type} · ${relationship.value}`,
      }));
    case 'troop':
      return (state.troops ?? []).map((troop) => ({
        id: troop.troopId,
        label: troop.name,
        detail: `${troop.troopType ?? '未分类'} · ${troop.size}人`,
      }));
    case 'holding':
      return (state.holdings ?? []).map((holding) => ({
        id: holding.holdingId,
        label: holding.name,
        detail: `${holding.type} · ${holding.status}`,
      }));
    case 'privateAsset':
      return (state.privateAssets ?? []).map((asset) => ({
        id: asset.privateAssetId,
        label: asset.name,
        detail: `${asset.type} · ${asset.status}`,
      }));
    default:
      return [];
  }
}

export function getRuntimeVariableEditor(
  state: RuntimeState,
  section: RuntimeVariableSection,
  entityId?: string,
): RuntimeVariableEditorDefinition | null {
  switch (section) {
    case 'player':
      return playerEditor(state);
    case 'npc': {
      const npc = state.npcs?.find((entry) => entry.npcId === entityId);
      return npc ? npcEditor(state, npc) : null;
    }
    case 'inventory': {
      const item = state.player.inventory?.find((entry) => entry.id === entityId);
      return item ? inventoryEditor(item) : null;
    }
    case 'uniqueArt': {
      const target = resolveUniqueArtTarget(state, entityId);
      return target ? uniqueArtEditor(target.ownerName, target.art) : null;
    }
    case 'relationship': {
      const relationship = state.relationships.find((entry) => entry.id === entityId);
      return relationship ? relationshipEditor(state, relationship) : null;
    }
    case 'resources':
      return resourcesEditor(state);
    case 'troop': {
      const troop = state.troops?.find((entry) => entry.troopId === entityId);
      return troop ? troopEditor(state, troop) : null;
    }
    case 'holding': {
      const holding = state.holdings?.find((entry) => entry.holdingId === entityId);
      return holding ? holdingEditor(holding) : null;
    }
    case 'privateAsset': {
      const asset = state.privateAssets?.find((entry) => entry.privateAssetId === entityId);
      return asset ? privateAssetEditor(state, asset) : null;
    }
  }
}

export function createRuntimeVariableDraft(editor: RuntimeVariableEditorDefinition): RuntimeVariableDraft {
  return Object.fromEntries(editor.fields
    .filter((field) => field.type !== 'readonly')
    .map((field) => [field.key, field.value]));
}

export function previewRuntimeVariableEdit(
  state: RuntimeState,
  section: RuntimeVariableSection,
  entityId: string | undefined,
  draft: RuntimeVariableDraft,
): RuntimeVariablePreviewResult {
  const currentEditor = getRuntimeVariableEditor(state, section, entityId);
  if (!currentEditor) return { ok: false, errors: ['没有找到要修改的目标。'] };
  try {
    const edited = applySectionDraft(state, section, entityId, draft);
    if (!edited.ok) return edited;
    const migrated = migrateRuntimeStateForPersistence(edited.state).state;
    const nextEditor = getRuntimeVariableEditor(migrated, section, entityId);
    if (!nextEditor) return { ok: false, errors: ['修改后目标无法通过持久化规范化。'] };
    const changes = collectChanges(currentEditor, nextEditor);
    if (changes.length === 0) return { ok: false, errors: ['没有检测到实际变化。'] };
    return { ok: true, state: migrated, changes, warnings: edited.warnings };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

function applySectionDraft(
  state: RuntimeState,
  section: RuntimeVariableSection,
  entityId: string | undefined,
  draft: RuntimeVariableDraft,
): { ok: true; state: RuntimeState; warnings: string[] } | { ok: false; errors: string[] } {
  switch (section) {
    case 'player':
      return applyPlayerDraft(state, draft);
    case 'npc':
      return applyNpcDraft(state, entityId, draft);
    case 'inventory':
      return applyInventoryDraft(state, entityId, draft);
    case 'uniqueArt':
      return applyUniqueArtDraft(state, entityId, draft);
    case 'relationship':
      return applyRelationshipDraft(state, entityId, draft);
    case 'resources':
      return applyResourcesDraft(state, draft);
    case 'troop':
      return applyTroopDraft(state, entityId, draft);
    case 'holding':
      return applyHoldingDraft(state, entityId, draft);
    case 'privateAsset':
      return applyPrivateAssetDraft(state, entityId, draft);
  }
}

function applyPlayerDraft(
  state: RuntimeState,
  draft: RuntimeVariableDraft,
): { ok: true; state: RuntimeState; warnings: string[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const birthDate = validateBirthDate(draft.birthDate, state.currentDate, '玩家出生日期', errors);
  const maxHp = integerField(draft.maxHp, '生命上限', 1, 100_000, errors);
  const hp = integerField(draft.hp, '当前生命', 0, maxHp ?? 100_000, errors);
  const maxStamina = integerField(draft.maxStamina, '体力上限', 1, 100_000, errors);
  const stamina = integerField(draft.stamina, '当前体力', 0, maxStamina ?? 100_000, errors);
  const abilityScores = readAbilityScores(draft, errors);
  if (errors.length) return { ok: false, errors };

  const player: Actor = {
    ...state.player,
    name: requiredText(draft.name, '姓名', errors),
    birthDate,
    age: birthDate ? deriveActorCurrentAge({ ...state.player, birthDate }, state.currentDate) : state.player.age,
    currentIdentity: optionalText(draft.currentIdentity),
    currentIdentityDescription: optionalText(draft.currentIdentityDescription),
    officeTitle: optionalText(draft.officeTitle),
    militaryTitle: optionalText(draft.militaryTitle),
    nobleTitle: optionalText(draft.nobleTitle),
    personalMoney: integerField(draft.personalMoney, '个人钱财', 0, 1_000_000_000_000, errors) ?? 0,
    level: integerField(draft.level, '等级', 1, 10_000, errors) ?? 1,
    xp: integerField(draft.xp, '经验', 0, 1_000_000_000, errors) ?? 0,
    growthPoints: integerField(draft.growthPoints, '成长点', 0, 1_000_000, errors) ?? 0,
    vitals: { hp: hp ?? 0, maxHp: maxHp ?? 1, stamina: stamina ?? 0, maxStamina: maxStamina ?? 1 },
    abilityScores,
  };
  if (errors.length) return { ok: false, errors };
  return { ok: true, state: { ...state, player }, warnings: [] };
}

function applyNpcDraft(
  state: RuntimeState,
  entityId: string | undefined,
  draft: RuntimeVariableDraft,
): { ok: true; state: RuntimeState; warnings: string[] } | { ok: false; errors: string[] } {
  const npc = state.npcs?.find((entry) => entry.npcId === entityId);
  if (!npc) return { ok: false, errors: ['NPC 不存在。'] };
  const errors: string[] = [];
  const birthDate = validateBirthDate(draft.birthDate, state.currentDate, 'NPC 出生日期', errors);
  const locationId = optionalText(draft.locationId);
  if (locationId && !locationIds(state).has(locationId)) errors.push('所在地点必须从本局已固化地点中选择。');
  const maxHp = integerField(draft.maxHp, '生命上限', 1, 100_000, errors);
  const hp = integerField(draft.hp, '当前生命', 0, maxHp ?? 100_000, errors);
  const maxStamina = integerField(draft.maxStamina, '体力上限', 1, 100_000, errors);
  const stamina = integerField(draft.stamina, '当前体力', 0, maxStamina ?? 100_000, errors);
  const abilityScores = readAbilityScores(draft, errors);
  const updated: LuanShiNpc = {
    ...npc,
    name: requiredText(draft.name, '姓名', errors),
    birthDate,
    age: birthDate ? deriveNpcCurrentAge({ ...npc, birthDate }, state.currentDate) ?? npc.age : npc.age,
    role: requiredText(draft.role, '角色定位', errors),
    currentIdentity: optionalText(draft.currentIdentity),
    currentIdentityDescription: optionalText(draft.currentIdentityDescription),
    officeTitle: optionalText(draft.officeTitle),
    militaryTitle: optionalText(draft.militaryTitle),
    nobleTitle: optionalText(draft.nobleTitle),
    locationId,
    isPresent: Boolean(draft.isPresent),
    isFocused: Boolean(draft.isFocused),
    contactLevel: integerField(draft.contactLevel, '往来度', 0, 100, errors) ?? 0,
    relationToPlayer: requiredText(draft.relationToPlayer, '与玩家关系', errors),
    recentAttitude: requiredText(draft.recentAttitude, '近期态度', errors),
    vitals: { hp: hp ?? 0, maxHp: maxHp ?? 1, stamina: stamina ?? 0, maxStamina: maxStamina ?? 1 },
    abilityScores,
  };
  if (errors.length) return { ok: false, errors };
  const npcs = (state.npcs ?? []).map((entry) => entry.npcId === npc.npcId ? updated : entry);
  const knownActors = state.knownActors.map((actor) => actor.id === npc.npcId
    ? syncKnownActorFromNpc(actor, updated)
    : actor);
  return { ok: true, state: { ...state, npcs, knownActors }, warnings: [] };
}

function applyInventoryDraft(
  state: RuntimeState,
  entityId: string | undefined,
  draft: RuntimeVariableDraft,
): { ok: true; state: RuntimeState; warnings: string[] } | { ok: false; errors: string[] } {
  const item = state.player.inventory?.find((entry) => entry.id === entityId);
  if (!item) return { ok: false, errors: ['背包物品不存在。'] };
  const errors: string[] = [];
  const rawQuality = optionalText(draft.quality);
  const quality = rawQuality ? normalizeEquipmentQualityTier(rawQuality) : undefined;
  if (rawQuality && !quality) errors.push('物品品质必须使用普通、良好、精良、珍贵、传说或绝世品级。');
  const updated = {
    ...item,
    name: requiredText(draft.name, '物品名称', errors),
    quantity: integerField(draft.quantity, '数量', 0, 1_000_000_000, errors) ?? 0,
    quality,
    description: optionalText(draft.description),
    keyItem: Boolean(draft.keyItem),
    updatedAt: state.currentDate,
  };
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    state: {
      ...state,
      player: {
        ...state.player,
        inventory: (state.player.inventory ?? []).map((entry) => entry.id === item.id ? updated : entry),
      },
    },
    warnings: updated.quantity === 0 ? ['数量为 0 时保留物品档案；如需删除，请使用背包中的移除功能。'] : [],
  };
}

function applyUniqueArtDraft(
  state: RuntimeState,
  entityId: string | undefined,
  draft: RuntimeVariableDraft,
): { ok: true; state: RuntimeState; warnings: string[] } | { ok: false; errors: string[] } {
  const target = resolveUniqueArtTarget(state, entityId);
  if (!target) return { ok: false, errors: ['绝艺不存在。'] };
  const errors: string[] = [];
  const rarity = requiredText(draft.rarity, '绝艺品级', errors);
  if (!UNIQUE_ART_RARITIES.includes(rarity)) errors.push('绝艺品级必须使用系统内置品级。');
  const maxLevel = integerField(draft.maxLevel, '最高等级', 1, 100, errors) ?? 1;
  const level = integerField(draft.level, '当前等级', 1, maxLevel, errors) ?? 1;
  const updated: CharacterUniqueArt = {
    ...target.art,
    name: requiredText(draft.name, '绝艺名称', errors),
    rarity,
    level,
    maxLevel,
    progress: integerField(draft.progress, '当前进度', 0, 1_000_000, errors) ?? 0,
    bankedProgress: integerField(draft.bankedProgress, '溢出进度', 0, 1_000_000, errors) ?? 0,
    description: requiredText(draft.description, '绝艺描述', errors),
    effectSummary: requiredText(draft.effectSummary, '效果说明', errors),
    upgradedAt: state.currentDate,
  };
  if (errors.length) return { ok: false, errors };
  if (target.ownerKind === 'player') {
    return {
      ok: true,
      state: {
        ...state,
        player: {
          ...state.player,
          uniqueArts: (state.player.uniqueArts ?? []).map((art) => art.id === updated.id ? updated : art),
        },
      },
      warnings: ['变量管理只修正已有绝艺；不会凭空生成新的战斗或战争投影。'],
    };
  }
  return {
    ok: true,
    state: {
      ...state,
      npcs: (state.npcs ?? []).map((npc) => npc.npcId === target.ownerId
        ? { ...npc, uniqueArts: (npc.uniqueArts ?? []).map((art) => art.id === updated.id ? updated : art) }
        : npc),
      knownActors: state.knownActors.map((actor) => actor.id === target.ownerId
        ? { ...actor, uniqueArts: (actor.uniqueArts ?? []).map((art) => art.id === updated.id ? updated : art) }
        : actor),
    },
    warnings: ['变量管理只修正已有绝艺；不会凭空生成新的战斗或战争投影。'],
  };
}

function applyRelationshipDraft(
  state: RuntimeState,
  entityId: string | undefined,
  draft: RuntimeVariableDraft,
): { ok: true; state: RuntimeState; warnings: string[] } | { ok: false; errors: string[] } {
  const relationship = state.relationships.find((entry) => entry.id === entityId);
  if (!relationship) return { ok: false, errors: ['关系记录不存在。'] };
  const errors: string[] = [];
  const updated: Relationship = {
    ...relationship,
    type: requiredText(draft.type, '关系类型', errors),
    value: integerField(draft.value, '关系值', -100, 100, errors) ?? 0,
    description: requiredText(draft.description, '关系说明', errors),
  };
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    state: { ...state, relationships: state.relationships.map((entry) => entry.id === relationship.id ? updated : entry) },
    warnings: [],
  };
}

function applyResourcesDraft(
  state: RuntimeState,
  draft: RuntimeVariableDraft,
): { ok: true; state: RuntimeState; warnings: string[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const resources = {
    money: integerField(draft.money, '公共钱财', 0, 1_000_000_000_000, errors) ?? 0,
    grain: integerField(draft.grain, '粮草', 0, 1_000_000_000_000, errors) ?? 0,
    horses: integerField(draft.horses, '马匹', 0, 100_000_000, errors) ?? 0,
    arms: integerField(draft.arms, '军械', 0, 100_000_000, errors) ?? 0,
    recruits: integerField(draft.recruits, '可征召人手', 0, 1_000_000_000, errors) ?? 0,
    weapons: state.resources?.weapons ?? [],
    documents: state.resources?.documents ?? [],
    tokens: state.resources?.tokens ?? [],
    importantSupplies: state.resources?.importantSupplies ?? [],
  };
  if (errors.length) return { ok: false, errors };
  return { ok: true, state: { ...state, resources }, warnings: ['公共钱财底层单位为“贯”；玩家个人钱财底层单位为“钱”。'] };
}

function applyTroopDraft(
  state: RuntimeState,
  entityId: string | undefined,
  draft: RuntimeVariableDraft,
): { ok: true; state: RuntimeState; warnings: string[] } | { ok: false; errors: string[] } {
  const troop = state.troops?.find((entry) => entry.troopId === entityId);
  if (!troop) return { ok: false, errors: ['部队不存在。'] };
  const errors: string[] = [];
  const size = integerField(draft.size, '兵力', 0, 10_000_000, errors) ?? 0;
  const deployableSize = integerField(draft.deployableSize, '可出战人数', 0, size, errors) ?? 0;
  const knownCharacterIds = new Set([state.player.id, ...(state.npcs ?? []).map((npc) => npc.npcId)]);
  const leaderNpcId = optionalText(draft.leaderNpcId);
  const strategistNpcId = optionalText(draft.strategistNpcId);
  const deputyNpcIds = splitIds(draft.deputyNpcIds);
  if (leaderNpcId && !knownCharacterIds.has(leaderNpcId)) errors.push('主将必须从玩家或已有 NPC 中选择。');
  if (strategistNpcId && !knownCharacterIds.has(strategistNpcId)) errors.push('军师必须从玩家或已有 NPC 中选择。');
  if (deputyNpcIds.length > 2) errors.push('副将最多两名。');
  if (deputyNpcIds.some((id) => !knownCharacterIds.has(id))) errors.push('副将必须从玩家或已有 NPC 中选择。');
  const officerIds = [leaderNpcId, ...deputyNpcIds, strategistNpcId].filter(Boolean);
  if (new Set(officerIds).size !== officerIds.length) errors.push('主将、副将和军师不得由同一人重复任职。');
  const locationId = requiredText(draft.locationId, '部队位置', errors);
  if (!locationIds(state).has(locationId)) errors.push('部队位置必须从本局已固化地点中选择。');
  const updated: TroopLedgerEntry = {
    ...troop,
    name: requiredText(draft.name, '部队名称', errors),
    size,
    deployableSize,
    troopType: requiredText(draft.troopType, '兵种', errors),
    quality: requiredEnum(draft.quality, QUALITY_OPTIONS, '精锐度', errors) as TroopLedgerEntry['quality'],
    fatigue: requiredEnum(draft.fatigue, FATIGUE_OPTIONS, '疲劳档位', errors) as TroopLedgerEntry['fatigue'],
    warFatiguePercent: integerField(draft.warFatiguePercent, '疲劳度', 0, 100, errors) ?? 0,
    readiness: requiredEnum(draft.readiness, READINESS_OPTIONS, '整备', errors) as TroopLedgerEntry['readiness'],
    lifecycleStatus: requiredEnum(draft.lifecycleStatus, TROOP_LIFECYCLE_OPTIONS, '生命周期', errors) as TroopLedgerEntry['lifecycleStatus'],
    leaderNpcId,
    deputyNpcIds,
    strategistNpcId,
    locationId,
    morale: integerField(draft.morale, '士气', 0, 100, errors) ?? 0,
    training: integerField(draft.training, '训练', 0, 100, errors) ?? 0,
    supplies: integerField(draft.supplies, '补给', 0, 1_000_000_000, errors) ?? 0,
    task: requiredText(draft.task, '当前任务', errors),
    relationToPlayer: requiredText(draft.relationToPlayer, '与玩家关系', errors),
    upkeepSource: requiredEnum(draft.upkeepSource, ['player_resources', 'superior_provision', 'mixed', 'unknown'], '军需来源', errors) as TroopLedgerEntry['upkeepSource'],
    updatedAt: state.currentDate,
  };
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    state: { ...state, troops: (state.troops ?? []).map((entry) => entry.troopId === troop.troopId ? updated : entry) },
    warnings: [],
  };
}

function applyHoldingDraft(
  state: RuntimeState,
  entityId: string | undefined,
  draft: RuntimeVariableDraft,
): { ok: true; state: RuntimeState; warnings: string[] } | { ok: false; errors: string[] } {
  const holding = state.holdings?.find((entry) => entry.holdingId === entityId);
  if (!holding) return { ok: false, errors: ['领地不存在。'] };
  const errors: string[] = [];
  const score = (key: string, label: string) => integerField(draft[key], label, 0, 100, errors) ?? 0;
  const updated: HoldingLedgerEntry = {
    ...holding,
    name: requiredText(draft.name, '领地名称', errors),
    status: requiredEnum(draft.status, HOLDING_STATUS_OPTIONS, '控制状态', errors) as HoldingLedgerEntry['status'],
    summary: requiredText(draft.summary, '领地说明', errors),
    actualController: optionalText(draft.actualController),
    scaleLevel: integerField(draft.scaleLevel, '设施规模', 1, 5, errors) as HoldingLedgerEntry['scaleLevel'],
    civilScaleLevel: integerField(draft.civilScaleLevel, '民政规模', 1, 5, errors) as HoldingLedgerEntry['civilScaleLevel'],
    agriculture: score('agriculture', '农业'),
    commerce: score('commerce', '商业'),
    population: integerField(draft.population, '人口', 0, 100_000_000, errors) ?? 0,
    publicOrder: score('publicOrder', '治安'),
    popularSupport: score('popularSupport', '民心'),
    defense: score('defense', '防御'),
    recruitPotential: score('recruitPotential', '征募潜力'),
    armory: score('armory', '军械'),
    horseSupply: score('horseSupply', '马源'),
    ...(holding.corruption === undefined ? {} : { corruption: score('corruption', '腐败') }),
    ...(holding.farmlandMu === undefined ? {} : { farmlandMu: integerField(draft.farmlandMu, '田亩', 0, 100_000_000, errors) }),
    ...(holding.registeredHouseholds === undefined ? {} : { registeredHouseholds: integerField(draft.registeredHouseholds, '编户', 0, 100_000_000, errors) }),
    localTreasury: integerField(draft.localTreasury, '本地钱库', 0, 1_000_000_000_000, errors) ?? 0,
    localGranary: integerField(draft.localGranary, '本地粮仓', 0, 1_000_000_000_000, errors) ?? 0,
    updatedAt: state.currentDate,
  };
  errors.push(...validateHoldingCapacityUpdate(updated, holding, holding.civilAdministrationScope));
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    state: { ...state, holdings: (state.holdings ?? []).map((entry) => entry.holdingId === holding.holdingId ? updated : entry) },
    warnings: [],
  };
}

function applyPrivateAssetDraft(
  state: RuntimeState,
  entityId: string | undefined,
  draft: RuntimeVariableDraft,
): { ok: true; state: RuntimeState; warnings: string[] } | { ok: false; errors: string[] } {
  const asset = state.privateAssets?.find((entry) => entry.privateAssetId === entityId);
  if (!asset) return { ok: false, errors: ['私人产业不存在。'] };
  const errors: string[] = [];
  const limits = getPrivateAssetAbsoluteScaleLimits(asset.type, asset.ownerScope);
  const locationId = optionalText(draft.locationId);
  if (locationId && !locationIds(state).has(locationId)) errors.push('私产位置必须从本局已固化地点中选择。');
  const managerNpcId = optionalText(draft.managerNpcId);
  if (managerNpcId && !(state.npcs ?? []).some((npc) => npc.npcId === managerNpcId)) errors.push('管理者必须从已建档 NPC 中选择。');
  const updated: PrivateAssetEntry = {
    ...asset,
    name: requiredText(draft.name, '私产名称', errors),
    status: requiredEnum(draft.status, PRIVATE_ASSET_STATUS_OPTIONS, '私产状态', errors) as PrivateAssetEntry['status'],
    summary: requiredText(draft.summary, '私产说明', errors),
    locationId,
    locationDescription: optionalText(draft.locationDescription),
    managerNpcId,
    mu: optionalIntegerField(draft.mu, '田亩', 0, limits.mu, errors),
    households: optionalIntegerField(draft.households, '佃户', 0, limits.households, errors),
    workers: optionalIntegerField(draft.workers, '雇工', 0, limits.workers, errors),
    workshopScale: optionalIntegerField(draft.workshopScale, '工坊规模', 1, limits.workshopScale, errors) as PrivateAssetEntry['workshopScale'],
    ranchCapacity: optionalIntegerField(draft.ranchCapacity, '牧场容量', 0, limits.ranchCapacity, errors),
    updatedAt: state.currentDate,
  };
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    state: { ...state, privateAssets: (state.privateAssets ?? []).map((entry) => entry.privateAssetId === asset.privateAssetId ? updated : entry) },
    warnings: [],
  };
}

function playerEditor(state: RuntimeState): RuntimeVariableEditorDefinition {
  const player = state.player;
  const vitals = player.vitals ?? { hp: 100, maxHp: 100, stamina: 100, maxStamina: 100 };
  return {
    title: player.name,
    subtitle: `稳定 ID：${player.id} · 当前年龄 ${deriveActorCurrentAge(player, state.currentDate) ?? '未知'}岁（年龄由出生日期派生）`,
    fields: [
      text('name', '姓名', player.name),
      text('birthDate', '出生日期', player.birthDate ?? '', '格式：公元184年03月01日；年龄会自动派生。'),
      text('currentIdentity', '当前身份', player.currentIdentity ?? ''),
      text('officeTitle', '官职', player.officeTitle ?? ''),
      text('militaryTitle', '军职', player.militaryTitle ?? ''),
      text('nobleTitle', '爵位', player.nobleTitle ?? ''),
      textarea('currentIdentityDescription', '身份说明', player.currentIdentityDescription ?? ''),
      number('personalMoney', '个人钱财（钱）', player.personalMoney ?? 0, 0, 1_000_000_000_000),
      number('level', '等级', player.level ?? 1, 1, 10_000),
      number('xp', '经验', player.xp ?? 0, 0, 1_000_000_000),
      number('growthPoints', '成长点', player.growthPoints ?? 0, 0, 1_000_000),
      number('hp', '当前生命', vitals.hp, 0, vitals.maxHp),
      number('maxHp', '生命上限', vitals.maxHp, 1, 100_000),
      number('stamina', '当前体力', vitals.stamina, 0, vitals.maxStamina),
      number('maxStamina', '体力上限', vitals.maxStamina, 1, 100_000),
      ...abilityFields(player.abilityScores),
    ],
  };
}

function npcEditor(state: RuntimeState, npc: LuanShiNpc): RuntimeVariableEditorDefinition {
  const vitals = npc.vitals ?? { hp: 100, maxHp: 100, stamina: 100, maxStamina: 100 };
  return {
    title: npc.name,
    subtitle: `稳定 ID：${npc.npcId} · 当前年龄 ${deriveNpcCurrentAge(npc, state.currentDate) ?? '未知'}岁（年龄由出生日期派生）`,
    fields: [
      text('name', '姓名', npc.name),
      text('birthDate', '出生日期', npc.birthDate ?? ''),
      text('role', '角色定位', npc.role),
      text('currentIdentity', '当前身份', npc.currentIdentity ?? ''),
      text('officeTitle', '官职', npc.officeTitle ?? ''),
      text('militaryTitle', '军职', npc.militaryTitle ?? ''),
      text('nobleTitle', '爵位', npc.nobleTitle ?? ''),
      textarea('currentIdentityDescription', '身份说明', npc.currentIdentityDescription ?? ''),
      select('locationId', '所在地点', npc.locationId ?? '', locationOptions(state, true)),
      checkbox('isPresent', '当前在场', npc.isPresent, '只修正本回合后的稳定在场状态，不编造新的同行事实。'),
      checkbox('isFocused', '重点人物', npc.isFocused),
      number('contactLevel', '往来度', npc.contactLevel, 0, 100),
      text('relationToPlayer', '与玩家关系', npc.relationToPlayer),
      text('recentAttitude', '近期态度', npc.recentAttitude),
      number('hp', '当前生命', vitals.hp, 0, vitals.maxHp),
      number('maxHp', '生命上限', vitals.maxHp, 1, 100_000),
      number('stamina', '当前体力', vitals.stamina, 0, vitals.maxStamina),
      number('maxStamina', '体力上限', vitals.maxStamina, 1, 100_000),
      ...abilityFields(npc.abilityScores),
    ],
  };
}

function inventoryEditor(item: NonNullable<Actor['inventory']>[number]): RuntimeVariableEditorDefinition {
  return {
    title: item.name,
    subtitle: `稳定 ID：${item.id} · ${item.category ?? '未分类'}${item.equipSlot ? ` · 可装备至 ${item.equipSlot}` : ''}`,
    fields: [
      text('name', '物品名称', item.name),
      number('quantity', '数量', item.quantity, 0, 1_000_000_000),
      select('quality', '品质', item.quality ?? '', rarityOptions(true)),
      checkbox('keyItem', '关键物品', Boolean(item.keyItem), '关键物品仍不会因数量改为 0 而自动删除。'),
      textarea('description', '物品说明', item.description ?? ''),
    ],
  };
}

function uniqueArtEditor(ownerName: string, art: CharacterUniqueArt): RuntimeVariableEditorDefinition {
  return {
    title: art.name,
    subtitle: `${ownerName} · 稳定 ID：${art.id} · 领域 ${art.domain}`,
    fields: [
      text('name', '绝艺名称', art.name),
      select('rarity', '品级', art.rarity, rarityOptions()),
      number('level', '当前等级', art.level, 1, art.maxLevel ?? 100),
      number('maxLevel', '最高等级', art.maxLevel ?? 10, 1, 100),
      number('progress', '当前进度', art.progress ?? 0, 0, 1_000_000),
      number('bankedProgress', '溢出进度', art.bankedProgress ?? 0, 0, 1_000_000),
      textarea('description', '绝艺描述', art.description),
      textarea('effectSummary', '效果说明', art.effectSummary),
    ],
  };
}

function relationshipEditor(state: RuntimeState, relationship: Relationship): RuntimeVariableEditorDefinition {
  return {
    title: relationshipLabel(state, relationship),
    subtitle: `稳定 ID：${relationship.id} · 双方实体与目标类型保持锁定`,
    fields: [
      text('type', '关系类型', relationship.type),
      number('value', '关系值', relationship.value, -100, 100),
      textarea('description', '关系说明', relationship.description),
    ],
  };
}

function resourcesEditor(state: RuntimeState): RuntimeVariableEditorDefinition {
  const resources = state.resources ?? {
    money: 0, grain: 0, horses: 0, arms: 0, recruits: 0,
    weapons: [], documents: [], tokens: [], importantSupplies: [],
  };
  return {
    title: '公共府库',
    subtitle: '钱财单位为贯；这里不会改动玩家个人钱财和文字类关键物品。',
    fields: [
      number('money', '钱财（贯）', resources.money, 0, 1_000_000_000_000),
      number('grain', '粮草（石）', resources.grain, 0, 1_000_000_000_000),
      number('horses', '马匹', resources.horses, 0, 100_000_000),
      number('arms', '军械', resources.arms, 0, 100_000_000),
      number('recruits', '可征召人手', resources.recruits, 0, 1_000_000_000),
    ],
  };
}

function troopEditor(state: RuntimeState, troop: TroopLedgerEntry): RuntimeVariableEditorDefinition {
  return {
    title: troop.name,
    subtitle: `稳定 ID：${troop.troopId} · ${troop.detailLevel ?? 'operational'} · 重骑兵仍受组建证据合同约束`,
    fields: [
      text('name', '部队名称', troop.name),
      text('troopType', '兵种', troop.troopType ?? ''),
      number('size', '兵力', troop.size, 0, 10_000_000),
      number('deployableSize', '可出战人数', troop.deployableSize ?? troop.size, 0, 10_000_000, '不得高于同次修改后的总兵力。'),
      select('quality', '精锐度', troop.quality ?? '中', stringOptions(QUALITY_OPTIONS)),
      select('fatigue', '疲劳档位', troop.fatigue ?? '低', stringOptions(FATIGUE_OPTIONS)),
      number('warFatiguePercent', '疲劳度', troop.warFatiguePercent ?? 0, 0, 100),
      select('readiness', '整备', troop.readiness ?? '中', stringOptions(READINESS_OPTIONS)),
      number('morale', '士气', troop.morale, 0, 100),
      number('training', '训练', troop.training, 0, 100),
      number('supplies', '补给', typeof troop.supplies === 'number' ? troop.supplies : 0, 0, 1_000_000_000),
      select('lifecycleStatus', '生命周期', troop.lifecycleStatus ?? 'active', stringOptions(TROOP_LIFECYCLE_OPTIONS)),
      select('leaderNpcId', '主将', troop.leaderNpcId ?? '', characterOptions(state, true)),
      text('deputyNpcIds', '副将 ID', (troop.deputyNpcIds ?? []).join(', '), '最多两个稳定 ID，以逗号分隔。'),
      select('strategistNpcId', '军师', troop.strategistNpcId ?? '', characterOptions(state, true)),
      select('locationId', '当前位置', troop.locationId ?? state.currentLocationId, locationOptions(state)),
      select('upkeepSource', '军需来源', troop.upkeepSource ?? 'unknown', [
        { value: 'player_resources', label: '玩家府库' },
        { value: 'superior_provision', label: '上级供给' },
        { value: 'mixed', label: '混合供给' },
        { value: 'unknown', label: '尚未确认' },
      ]),
      text('task', '当前任务', troop.task),
      text('relationToPlayer', '与玩家关系', troop.relationToPlayer),
    ],
  };
}

function holdingEditor(holding: HoldingLedgerEntry): RuntimeVariableEditorDefinition {
  const limits = getHoldingCapacityLimits(holding, holding.civilAdministrationScope);
  return {
    title: holding.name,
    subtitle: `稳定 ID：${holding.holdingId} · 类型 ${holding.type} · 民政范围 ${holding.civilAdministrationScope ?? 'none'} · 当前容量：田亩 ${limits.maxFarmlandMu} / 编户 ${limits.maxRegisteredHouseholds}`,
    fields: [
      text('name', '领地名称', holding.name),
      readonly('type', '领地类型（锁定）', holding.type),
      readonly('civilAdministrationScope', '民政范围（锁定）', holding.civilAdministrationScope ?? 'none'),
      select('status', '控制状态', holding.status, stringOptions(HOLDING_STATUS_OPTIONS)),
      text('actualController', '实际控制者', holding.actualController ?? ''),
      number('scaleLevel', '设施规模', holding.scaleLevel, 1, 5),
      number('civilScaleLevel', '民政规模', holding.civilScaleLevel ?? limits.civilScaleLevel, 1, limits.maxCivilScaleLevel),
      number('agriculture', '农业', holding.agriculture, 0, 100),
      number('commerce', '商业', holding.commerce, 0, 100),
      number('population', '人口', holding.population, 0, 100_000_000),
      number('publicOrder', '治安', holding.publicOrder, 0, 100),
      number('popularSupport', '民心', holding.popularSupport, 0, 100),
      number('defense', '防御', holding.defense, 0, 100),
      number('recruitPotential', '征募潜力', holding.recruitPotential, 0, 100),
      number('armory', '军械', holding.armory, 0, 100),
      number('horseSupply', '马源', holding.horseSupply, 0, 100),
      ...(holding.corruption === undefined ? [] : [number('corruption', '腐败', holding.corruption, 0, 100)]),
      ...(holding.farmlandMu === undefined ? [] : [number('farmlandMu', '账面田亩', holding.farmlandMu, 0, limits.maxFarmlandMu)]),
      ...(holding.registeredHouseholds === undefined ? [] : [number('registeredHouseholds', '编户', holding.registeredHouseholds, 0, limits.maxRegisteredHouseholds)]),
      number('localTreasury', '本地钱库（贯）', holding.localTreasury ?? 0, 0, 1_000_000_000_000),
      number('localGranary', '本地粮仓（石）', holding.localGranary ?? 0, 0, 1_000_000_000_000),
      textarea('summary', '领地说明', holding.summary),
    ],
  };
}

function privateAssetEditor(state: RuntimeState, asset: PrivateAssetEntry): RuntimeVariableEditorDefinition {
  const limits = getPrivateAssetAbsoluteScaleLimits(asset.type, asset.ownerScope);
  return {
    title: asset.name,
    subtitle: `稳定 ID：${asset.privateAssetId} · 类型 ${asset.type} · 权属 ${asset.ownerScope} · 所有规模字段受现有绝对上限约束`,
    fields: [
      text('name', '私产名称', asset.name),
      readonly('type', '私产类型（锁定）', asset.type),
      readonly('ownerScope', '权属范围（锁定）', asset.ownerScope),
      select('status', '状态', asset.status, stringOptions(PRIVATE_ASSET_STATUS_OPTIONS)),
      select('locationId', '地点', asset.locationId ?? '', locationOptions(state, true)),
      text('locationDescription', '地点说明', asset.locationDescription ?? ''),
      select('managerNpcId', '管理者', asset.managerNpcId ?? '', npcOptions(state, true)),
      optionalNumber('mu', `田亩（上限 ${limits.mu}）`, asset.mu, 0, limits.mu),
      optionalNumber('households', `佃户（上限 ${limits.households}）`, asset.households, 0, limits.households),
      optionalNumber('workers', `雇工（上限 ${limits.workers}）`, asset.workers, 0, limits.workers),
      optionalNumber('workshopScale', `工坊规模（上限 ${limits.workshopScale}）`, asset.workshopScale, 1, limits.workshopScale),
      optionalNumber('ranchCapacity', `牧场容量（上限 ${limits.ranchCapacity}）`, asset.ranchCapacity, 0, limits.ranchCapacity),
      textarea('summary', '私产说明', asset.summary),
    ],
  };
}

function listUniqueArtEntities(state: RuntimeState): RuntimeVariableEntityOption[] {
  const playerArts = (state.player.uniqueArts ?? []).map((art) => ({
    id: uniqueArtEntityId('player', state.player.id, art.id),
    label: `${state.player.name} · ${art.name}`,
    detail: `玩家 · ${art.rarity} · Lv.${art.level}`,
  }));
  const npcArts = (state.npcs ?? []).flatMap((npc) => (npc.uniqueArts ?? []).map((art) => ({
    id: uniqueArtEntityId('npc', npc.npcId, art.id),
    label: `${npc.name} · ${art.name}`,
    detail: `NPC · ${art.rarity} · Lv.${art.level}`,
  })));
  return [...playerArts, ...npcArts];
}

function resolveUniqueArtTarget(state: RuntimeState, entityId?: string): {
  ownerKind: 'player' | 'npc'; ownerId: string; ownerName: string; art: CharacterUniqueArt;
} | undefined {
  const [ownerKind, ownerId, artId] = (entityId ?? '').split('::');
  if (ownerKind === 'player' && ownerId === state.player.id) {
    const art = state.player.uniqueArts?.find((entry) => entry.id === artId);
    return art ? { ownerKind, ownerId, ownerName: state.player.name, art } : undefined;
  }
  if (ownerKind === 'npc') {
    const npc = state.npcs?.find((entry) => entry.npcId === ownerId);
    const art = npc?.uniqueArts?.find((entry) => entry.id === artId);
    return npc && art ? { ownerKind, ownerId, ownerName: npc.name, art } : undefined;
  }
  return undefined;
}

function uniqueArtEntityId(kind: 'player' | 'npc', ownerId: string, artId: string): string {
  return `${kind}::${ownerId}::${artId}`;
}

function collectChanges(
  before: RuntimeVariableEditorDefinition,
  after: RuntimeVariableEditorDefinition,
): RuntimeVariableChange[] {
  const afterByKey = new Map(after.fields.map((field) => [field.key, field]));
  return before.fields.flatMap((field) => {
    if (field.type === 'readonly') return [];
    const next = afterByKey.get(field.key);
    if (!next || equalFieldValue(field.value, next.value)) return [];
    return [{
      key: field.key,
      label: field.label,
      before: formatFieldValue(field.value),
      after: formatFieldValue(next.value),
    }];
  });
}

function syncKnownActorFromNpc(actor: Actor, npc: LuanShiNpc): Actor {
  return {
    ...actor,
    name: npc.name,
    birthDate: npc.birthDate,
    age: npc.age,
    roleType: npc.role,
    locationId: npc.locationId,
    currentIdentity: npc.currentIdentity,
    currentIdentityDescription: npc.currentIdentityDescription,
    officeTitle: npc.officeTitle,
    militaryTitle: npc.militaryTitle,
    nobleTitle: npc.nobleTitle,
    identitySummary: npc.identitySummary,
    abilityScores: npc.abilityScores,
    vitals: npc.vitals,
    summary: npc.summary,
    relationshipWithPlayer: npc.relationToPlayer,
    situationSummary: npc.recentAttitude,
  };
}

function relationshipLabel(state: RuntimeState, relationship: Relationship): string {
  return `${characterName(state, relationship.actorId)} ↔ ${characterName(state, relationship.targetId)}`;
}

function characterName(state: RuntimeState, id: string): string {
  if (id === state.player.id) return state.player.name;
  return state.npcs?.find((npc) => npc.npcId === id)?.name
    ?? state.knownActors.find((actor) => actor.id === id)?.name
    ?? state.factions?.find((faction) => faction.factionId === id)?.name
    ?? id;
}

function locationIds(state: RuntimeState): Set<string> {
  return new Set([
    state.currentLocationId,
    state.currentPlaceId,
    ...(state.locations ?? []).map((entry) => entry.locationId),
    ...(state.mapNodes ?? []).map((entry) => entry.id),
  ].filter((value): value is string => Boolean(value)));
}

function locationOptions(state: RuntimeState, allowEmpty = false): RuntimeVariableFieldOption[] {
  const byId = new Map<string, string>();
  if (allowEmpty) byId.set('', '未指定');
  for (const location of state.locations ?? []) byId.set(location.locationId, location.name);
  for (const node of state.mapNodes ?? []) byId.set(node.id, node.name);
  if (!byId.has(state.currentLocationId)) byId.set(state.currentLocationId, state.currentLocationId);
  return [...byId].map(([value, label]) => ({ value, label: `${label}${value ? `（${value}）` : ''}` }));
}

function npcOptions(state: RuntimeState, allowEmpty = false): RuntimeVariableFieldOption[] {
  return [
    ...(allowEmpty ? [{ value: '', label: '不指定' }] : []),
    ...(state.npcs ?? []).map((npc) => ({ value: npc.npcId, label: `${npc.name}（${npc.npcId}）` })),
  ];
}

function characterOptions(state: RuntimeState, allowEmpty = false): RuntimeVariableFieldOption[] {
  return [
    ...(allowEmpty ? [{ value: '', label: '不指定' }] : []),
    { value: state.player.id, label: `${state.player.name}（玩家）` },
    ...(state.npcs ?? []).map((npc) => ({ value: npc.npcId, label: `${npc.name}（NPC）` })),
  ];
}

function abilityFields(scores?: Record<string, number>): RuntimeVariableFieldDefinition[] {
  return CORE_PLAYER_ATTRIBUTE_KEYS.map((key) => number(`ability_${key}`, key, scores?.[key] ?? 0, 0, 100));
}

function readAbilityScores(draft: RuntimeVariableDraft, errors: string[]): Record<string, number> {
  return Object.fromEntries(CORE_PLAYER_ATTRIBUTE_KEYS.map((key) => [
    key,
    integerField(draft[`ability_${key}`], key, 0, 100, errors) ?? 0,
  ]));
}

function validateBirthDate(
  value: RuntimeVariableValue | undefined,
  currentDate: string,
  label: string,
  errors: string[],
): string | undefined {
  const raw = optionalText(value);
  const normalized = normalizeCompleteBirthDate(raw);
  if (!normalized) {
    errors.push(`${label}必须是完整、合法的游戏内年月日。`);
    return undefined;
  }
  const currentYear = Number(currentDate.match(/(\d{1,4})\s*年/)?.[1] ?? 0);
  const birthYear = Number(normalized.match(/(\d{1,4})\s*年/)?.[1] ?? 0);
  if (currentYear > 0 && birthYear > currentYear) errors.push(`${label}不能晚于当前游戏年份。`);
  return normalized;
}

function integerField(
  value: RuntimeVariableValue | undefined,
  label: string,
  min: number,
  max: number,
  errors: string[],
): number | undefined {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue)) {
    errors.push(`${label}必须是整数。`);
    return undefined;
  }
  if (numberValue < min || numberValue > max) {
    errors.push(`${label}必须在 ${min}—${max} 之间。`);
    return undefined;
  }
  return numberValue;
}

function optionalIntegerField(
  value: RuntimeVariableValue | undefined,
  label: string,
  min: number,
  max: number,
  errors: string[],
): number | undefined {
  if (value === undefined || value === '') return undefined;
  return integerField(value, label, min, max, errors);
}

function requiredText(value: RuntimeVariableValue | undefined, label: string, errors: string[]): string {
  const result = optionalText(value);
  if (!result) errors.push(`${label}不能为空。`);
  return result;
}

function optionalText(value: RuntimeVariableValue | undefined): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function requiredEnum(
  value: RuntimeVariableValue | undefined,
  allowed: readonly string[],
  label: string,
  errors: string[],
): string {
  const result = optionalText(value);
  if (!allowed.includes(result)) errors.push(`${label}不是系统允许的值。`);
  return result;
}

function splitIds(value: RuntimeVariableValue | undefined): string[] {
  return [...new Set(optionalText(value).split(/[,，\s]+/).map((entry) => entry.trim()).filter(Boolean))];
}

function equalFieldValue(left: RuntimeVariableValue, right: RuntimeVariableValue): boolean {
  return typeof left === 'number' && typeof right === 'number'
    ? left === right
    : String(left) === String(right);
}

function formatFieldValue(value: RuntimeVariableValue): string {
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value === '') return '未设置';
  return String(value);
}

function text(key: string, label: string, value: string, description?: string): RuntimeVariableFieldDefinition {
  return { key, label, type: 'text', value, description };
}

function textarea(key: string, label: string, value: string): RuntimeVariableFieldDefinition {
  return { key, label, type: 'textarea', value, wide: true };
}

function number(
  key: string,
  label: string,
  value: number,
  min: number,
  max: number,
  description?: string,
): RuntimeVariableFieldDefinition {
  return { key, label, type: 'number', value, min, max, step: 1, description };
}

function optionalNumber(
  key: string,
  label: string,
  value: number | undefined,
  min: number,
  max: number,
): RuntimeVariableFieldDefinition {
  return { key, label, type: 'number', value: value ?? '', min, max, step: 1 };
}

function checkbox(
  key: string,
  label: string,
  value: boolean,
  description?: string,
): RuntimeVariableFieldDefinition {
  return { key, label, type: 'checkbox', value, description };
}

function select(
  key: string,
  label: string,
  value: string,
  options: RuntimeVariableFieldOption[],
): RuntimeVariableFieldDefinition {
  if (!options.some((option) => option.value === value)) options = [{ value, label: value || '未指定' }, ...options];
  return { key, label, type: 'select', value, options };
}

function readonly(key: string, label: string, value: string): RuntimeVariableFieldDefinition {
  return { key, label, type: 'readonly', value };
}

function stringOptions(values: readonly string[]): RuntimeVariableFieldOption[] {
  return values.map((value) => ({ value, label: value }));
}

function rarityOptions(allowEmpty = false): RuntimeVariableFieldOption[] {
  const labels: Record<string, string> = {
    white: '普通（白）', green: '良好（绿）', blue: '精良（蓝）', purple: '珍贵（紫）', orange: '传说（橙）', red: '绝世（红）',
  };
  return [
    ...(allowEmpty ? [{ value: '', label: '未指定' }] : []),
    ...UNIQUE_ART_RARITIES.map((value) => ({ value, label: labels[value] })),
  ];
}

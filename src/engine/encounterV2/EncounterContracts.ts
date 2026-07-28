export const ENCOUNTER_CONTRACT_VERSION = 1 as const;
export const SEMANTIC_PROJECTION_VERSION = 1 as const;

export const COMBAT_RULESET_VERSION = 'combat-v2.0.0' as const;
export const WAR_RULESET_VERSION = 'war-v2.0.0' as const;

export const ENCOUNTER_SAVE_POLICY = Object.freeze({
  allowMidEncounterSave: false,
  allowPreEncounterCheckpoint: true,
  allowPostResultCheckpoint: true,
} as const);

export const ENCOUNTER_SIDE_LAYOUT = Object.freeze({
  enemy: 'left',
  player: 'right',
} as const);

export const ENCOUNTER_ENVIRONMENT_TAGS = [
  'open',
  'difficult',
  'fortified',
  'water',
] as const;

export const SEMANTIC_EFFECT_TRIGGERS = [
  'battle_start',
  'round_start',
  'before_action',
  'before_attack',
  'after_attack',
  'on_hit',
  'on_critical',
  'on_block',
  'on_evade',
  'on_damage_taken',
  'on_downed',
  'on_retreat_check',
  'battle_end',
  'war_round_start',
  'before_war_resolution',
  'after_war_resolution',
] as const;

export const SEMANTIC_EFFECT_CONDITIONS = [
  'always',
  'self_hp_below_30',
  'self_stamina_below_30',
  'target_hp_below_30',
  'outnumbered',
  'surrounded',
  'defending',
  'attacking',
  'water_environment',
  'fortified_environment',
  'low_morale',
  'low_supply',
] as const;

export const SEMANTIC_EFFECT_OPERATIONS = [
  'modify_accuracy',
  'modify_evasion',
  'modify_block',
  'modify_critical',
  'modify_damage_flat',
  'modify_damage_multiplier',
  'modify_armor',
  'modify_armor_penetration',
  'modify_speed',
  'modify_stamina_cost',
  'restore_hp',
  'restore_stamina',
  'apply_status',
  'remove_status',
  'extra_attack',
  'prevent_down',
  'modify_retreat',
  'modify_surrender',
  'modify_capture',
  'modify_morale',
  'modify_supply',
  'modify_fatigue',
  'modify_casualty_rate',
  'modify_effective_strength',
] as const;

export const SEMANTIC_EFFECT_TARGETS = [
  'self',
  'single_ally',
  'all_allies',
  'single_enemy',
  'all_enemies',
  'current_attacker',
  'current_defender',
  'own_force',
  'enemy_force',
] as const;

export const TROOP_PRIMARY_CLASSES = [
  'infantry',
  'cavalry',
  'ranged',
  'naval',
  'siege',
  'mixed',
] as const;

export const TROOP_SEMANTIC_TAGS = [
  'anti_cavalry',
  'heavy',
  'mobile',
  'defensive',
  'assault',
] as const;

export const ITEM_QUALITY_TIERS = [
  'white',
  'green',
  'blue',
  'purple',
  'orange',
  'red',
] as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type EncounterKind = 'personal_combat' | 'war';
export type EncounterRulesetScope = EncounterKind;
export type EncounterRulesetVersion = typeof COMBAT_RULESET_VERSION | typeof WAR_RULESET_VERSION;
export type EncounterSide = 'player' | 'enemy';
export type EncounterOutcome = 'player_victory' | 'enemy_victory' | 'draw' | 'player_retreat' | 'enemy_retreat' | 'surrender';
export type EncounterEnvironmentTag = typeof ENCOUNTER_ENVIRONMENT_TAGS[number];

export interface EncounterPolicy {
  lethality: 'nonlethal' | 'standard' | 'fatal';
  allowRetreat: boolean;
  allowSurrender: boolean;
  allowCapture: boolean;
  lootPolicy: 'actual_items_only' | 'none';
}

interface EncounterStartIntentBase {
  contractVersion: typeof ENCOUNTER_CONTRACT_VERSION;
  encounterId: string;
  kind: EncounterKind;
  rulesetVersion: EncounterRulesetVersion;
  sourceTurnNumber: number;
  locationId: string;
  reason: string;
  seed: string;
  createdAt: string;
  policy: EncounterPolicy;
}

export interface PersonalCombatStartIntent extends EncounterStartIntentBase {
  kind: 'personal_combat';
  rulesetVersion: typeof COMBAT_RULESET_VERSION;
  playerParty: { actorIds: string[] };
  enemyParty: { actorIds: string[] };
  partySelection: 'player_choice' | 'locked';
}

export interface WarStartIntent extends EncounterStartIntentBase {
  kind: 'war';
  rulesetVersion: typeof WAR_RULESET_VERSION;
  playerForce: { troopIds: string[]; commanderActorId?: string };
  enemyForce: { troopIds: string[]; commanderActorId?: string };
  objective: 'defeat_enemy' | 'capture_holding' | 'break_siege' | 'relieve_siege';
  /** Required for objectives that deterministically mutate a holding or its siege state. */
  targetHoldingId?: string;
  environmentTags: EncounterEnvironmentTag[];
}

export type EncounterStartIntent = PersonalCombatStartIntent | WarStartIntent;

export type SemanticProjectionStatus = 'executable' | 'narrative_only';
export type SemanticEffectTrigger = typeof SEMANTIC_EFFECT_TRIGGERS[number];
export type SemanticEffectCondition = typeof SEMANTIC_EFFECT_CONDITIONS[number];
export type SemanticEffectOperation = typeof SEMANTIC_EFFECT_OPERATIONS[number];
export type SemanticEffectTarget = typeof SEMANTIC_EFFECT_TARGETS[number];
export type ItemQualityTier = typeof ITEM_QUALITY_TIERS[number];

export interface SemanticEffect {
  trigger: SemanticEffectTrigger;
  condition: SemanticEffectCondition;
  operation: SemanticEffectOperation;
  target: SemanticEffectTarget;
  value: number;
  priority: number;
  perRoundLimit?: number;
  perEncounterLimit?: number;
  stackingGroup?: string;
  statusId?: string;
}

interface SemanticProjectionBase {
  projectionVersion: typeof SEMANTIC_PROJECTION_VERSION;
  sourceId: string;
  status: SemanticProjectionStatus;
  rulesetScopes: EncounterRulesetScope[];
  effects: SemanticEffect[];
}

export interface TraitSemanticProfile extends SemanticProjectionBase {
  profileKind: 'ability';
  sourceType: 'trait';
  activation: 'passive';
}

export type UniqueArtPowerClass = 'light' | 'standard' | 'heavy' | 'ultimate';
export type UniqueArtTargetMode = 'self' | 'single_ally' | 'all_allies' | 'single_enemy' | 'all_enemies';
export type UniqueArtPurpose = 'damage' | 'healing' | 'protection' | 'control' | 'mixed';

export interface UniqueArtSemanticProfile extends SemanticProjectionBase {
  profileKind: 'ability';
  sourceType: 'unique_art';
  activation: 'active';
  targetMode: UniqueArtTargetMode;
  purpose: UniqueArtPurpose;
  powerClass: UniqueArtPowerClass;
  powerMultiplier: number;
  staminaCost: number;
  accuracyModifier: number;
  maxHits: number;
  perEncounterLimit: number;
  blockable: boolean;
  armorPiercing: boolean;
  canCrit: boolean;
  allowAutoUse: boolean;
}

export type AbilitySemanticProfile = TraitSemanticProfile | UniqueArtSemanticProfile;

export interface EquipmentSemanticProfile extends SemanticProjectionBase {
  profileKind: 'equipment';
  equipmentSlot: 'weapon' | 'armor' | 'mount' | 'treasure';
  qualityTier: ItemQualityTier;
  weaponWeight?: 'unarmed' | 'light' | 'standard' | 'polearm' | 'heavy' | 'ranged';
  armorWeight?: 'none' | 'light' | 'medium' | 'heavy';
  weaponBaseDamage?: number;
  accuracyBonus?: number;
  armorPenetration?: number;
  blockBonus?: number;
  armorTier?: 0 | 1 | 2 | 3 | 4 | 5;
  speedModifier?: number;
}

export interface ItemCombatProfile extends SemanticProjectionBase {
  profileKind: 'item';
  combatUse: boolean;
  qualityTier: ItemQualityTier;
  consumable: boolean;
  quantityPerUse: number;
  perEncounterLimit: number;
  allowAutoUse?: boolean;
}

export interface TroopSemanticProfile extends SemanticProjectionBase {
  profileKind: 'troop';
  primaryClass: typeof TROOP_PRIMARY_CLASSES[number];
  tags: Array<typeof TROOP_SEMANTIC_TAGS[number]>;
}

export type SemanticProjection =
  | AbilitySemanticProfile
  | EquipmentSemanticProfile
  | ItemCombatProfile
  | TroopSemanticProfile;

export interface EncounterActionLogEntry {
  sequence: number;
  actionId: string;
  actorId: string;
  targetIds: string[];
  actionType: string;
  randomDrawStart: number;
  randomDrawEnd: number;
  summaryKey: string;
  values: Record<string, JsonPrimitive>;
}

export interface EncounterStateDelta {
  idempotencyKey: string;
  targetKind: 'actor' | 'troop' | 'item' | 'equipment' | 'world';
  targetId: string;
  field: string;
  operation: 'set' | 'increment' | 'decrement' | 'add' | 'remove';
  beforeValue: JsonValue;
  afterValue: JsonValue;
}

export interface CombatantResultState {
  actorId: string;
  side: EncounterSide;
  hp: number;
  stamina: number;
  downCount: number;
  statuses: string[];
}

export interface WarForceResultState {
  troopId: string;
  side: EncounterSide;
  initialStrength: number;
  remainingStrength: number;
  casualties: number;
  capturedCount: number;
  morale: number;
  supply: number;
  fatigue: number;
  lifecycleStatus: 'active' | 'routed' | 'surrendered' | 'destroyed';
  routed: boolean;
  surrendered: boolean;
  captured: boolean;
  statuses: string[];
}

export interface WarPursuitResult {
  status: 'not_available' | 'declined' | 'resolved';
  pursuingSide?: EncounterSide;
  fleeingSide?: EncounterSide;
  extraCasualties: number;
  extraCaptured: number;
}

export interface WarCommanderResultState {
  actorId: string;
  side: EncounterSide;
  outcome: 'active' | 'wounded' | 'missing' | 'captured' | 'dead';
}

interface EncounterResultBase {
  contractVersion: typeof ENCOUNTER_CONTRACT_VERSION;
  sessionId: string;
  encounterId: string;
  kind: EncounterKind;
  rulesetVersion: EncounterRulesetVersion;
  sourceTurnNumber: number;
  seed: string;
  resolvedAt: string;
  outcome: EncounterOutcome;
  elapsedMinutes: number;
  actionLog: EncounterActionLogEntry[];
  deltas: EncounterStateDelta[];
}

export interface UnsealedCombatResult extends EncounterResultBase {
  kind: 'personal_combat';
  rulesetVersion: typeof COMBAT_RULESET_VERSION;
  combatants: CombatantResultState[];
  experienceAward: number;
  lootItemIds: string[];
  capturedEquipmentItemIds: string[];
}

export interface UnsealedWarResult extends EncounterResultBase {
  kind: 'war';
  rulesetVersion: typeof WAR_RULESET_VERSION;
  objective: WarStartIntent['objective'];
  objectiveAchieved: boolean;
  exitReason: 'objective_achieved' | 'force_routed' | 'force_destroyed' | 'retreat' | 'surrender' | 'round_limit';
  forces: WarForceResultState[];
  roundsCompleted: number;
  pursuit: WarPursuitResult;
  commanders: WarCommanderResultState[];
  capturedItemIds: string[];
}

export type UnsealedEncounterResult = UnsealedCombatResult | UnsealedWarResult;

export type DeepReadonly<T> = T extends JsonPrimitive
  ? T
  : T extends Array<infer U>
    ? ReadonlyArray<DeepReadonly<U>>
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export type SealedEncounterResult<T extends UnsealedEncounterResult = UnsealedEncounterResult> =
  DeepReadonly<T & { resultHash: string }>;

export type EncounterSessionStatus =
  | 'pending'
  | 'fighting'
  | 'resolved'
  | 'narrative_pending'
  | 'narrated'
  | 'aborted_before_result';

export interface EncounterSession {
  sessionId: string;
  status: EncounterSessionStatus;
  intent: EncounterStartIntent;
  snapshotHash: string;
  createdAt: string;
  startedAt?: string;
  resolvedAt?: string;
  narrativePendingAt?: string;
  narratedAt?: string;
  abortedAt?: string;
  result?: SealedEncounterResult;
}

interface EncounterCheckpointBase {
  checkpointId: string;
  saveId: string;
  sessionId: string;
  encounterId: string;
  createdAt: string;
}

export interface PreEncounterCheckpoint extends EncounterCheckpointBase {
  checkpointKind: 'pre_encounter';
  intent: EncounterStartIntent;
  snapshotHash: string;
}

export interface PostEncounterResultCheckpoint extends EncounterCheckpointBase {
  checkpointKind: 'post_result';
  result: SealedEncounterResult;
}

export type EncounterCheckpoint = PreEncounterCheckpoint | PostEncounterResultCheckpoint;

/** Persisted bridge state. The live combat engine itself is intentionally never saved. */
export interface EncounterRuntimeActiveState {
  session: EncounterSession;
  checkpoint: EncounterCheckpoint;
}

export interface EncounterRuntimeLedger {
  semanticProjections: SemanticProjection[];
  active?: EncounterRuntimeActiveState;
  appliedResultHashes: string[];
  narratedResultHashes: string[];
}

import { describe, expect, it } from 'vitest';
import {
  COMBAT_RULESET_VERSION,
  ENCOUNTER_CONTRACT_VERSION,
  LEGACY_COMBAT_RULESET_VERSION,
  REBALANCED_WAR_RULESET_VERSION,
  SEMANTIC_PROJECTION_VERSION,
  THEATER_WAR_RULESET_VERSION,
  WAR_RULESET_VERSION,
  type AbilitySemanticProfile,
  type EncounterStartIntent,
  type EquipmentSemanticProfile,
  type ItemCombatProfile,
  type TraitSemanticProfile,
  type TroopSemanticProfile,
  type UnsealedCombatResult,
  type UnsealedWarResult,
} from './EncounterContracts';
import {
  EQUIPMENT_QUALITY_BASELINES,
  ITEM_EFFECT_LIMITS,
  normalizeEquipmentQualityTier,
  validateEncounterResultPayload,
  validateEncounterStartIntent,
  validateSemanticProjection,
} from './EncounterContractValidation';

function createPersonalIntent(): EncounterStartIntent {
  return {
    contractVersion: ENCOUNTER_CONTRACT_VERSION,
    encounterId: 'encounter_personal_001',
    kind: 'personal_combat',
    rulesetVersion: COMBAT_RULESET_VERSION,
    sourceTurnNumber: 29,
    locationId: 'location_hanshui_camp',
    reason: '玩家在汉水大营遭遇张绣亲卫拦截。',
    seed: 'encounter_personal_001:seed',
    createdAt: '2026-07-20T00:00:00.000Z',
    playerParty: { actorIds: ['player_liuping', 'npc_ganning'] },
    enemyParty: { actorIds: ['npc_enemy_guard'] },
    partySelection: 'player_choice',
    policy: {
      lethality: 'standard',
      allowRetreat: true,
      allowSurrender: true,
      allowCapture: true,
      lootPolicy: 'actual_items_only',
    },
  };
}

function createWarIntent(): EncounterStartIntent {
  return {
    contractVersion: ENCOUNTER_CONTRACT_VERSION,
    encounterId: 'encounter_war_001',
    kind: 'war',
    rulesetVersion: WAR_RULESET_VERSION,
    sourceTurnNumber: 40,
    locationId: 'location_kulinpo',
    reason: '玩家直接指挥枯林坡阻击战。',
    seed: 'encounter_war_001:seed',
    createdAt: '2026-07-20T00:00:00.000Z',
    playerForce: {
      troopIds: ['troop_player_infantry', 'troop_player_cavalry'],
      commanderActorId: 'player_liuping',
    },
    enemyForce: {
      troopIds: ['troop_enemy_guard'],
      commanderActorId: 'npc_zhangxiu',
    },
    participation: {
      commandScope: 'independent',
      mission: 'defeat_local_force',
      playerCommitments: [
        { troopId: 'troop_player_infantry', committedStrength: 800 },
        { troopId: 'troop_player_cavalry', committedStrength: 200 },
      ],
      enemyCommitments: [
        { troopId: 'troop_enemy_guard', committedStrength: 500 },
      ],
    },
    objective: 'defeat_enemy',
    environmentTags: ['open'],
    policy: {
      lethality: 'standard',
      allowRetreat: true,
      allowSurrender: true,
      allowCapture: true,
      lootPolicy: 'actual_items_only',
    },
  };
}

function createUniqueArtProfile(): AbilitySemanticProfile {
  return {
    profileKind: 'ability',
    projectionVersion: SEMANTIC_PROJECTION_VERSION,
    sourceId: 'art_qitanshepanqiang',
    sourceType: 'unique_art',
    status: 'executable',
    rulesetScopes: ['personal_combat'],
    activation: 'active',
    targetMode: 'single_enemy',
    purpose: 'damage',
    powerClass: 'standard',
    powerMultiplier: 1.35,
    staminaCost: 14,
    accuracyModifier: 0,
    maxHits: 3,
    perEncounterLimit: 2,
    blockable: true,
    armorPiercing: false,
    canCrit: true,
    allowAutoUse: true,
    effects: [{
      trigger: 'before_attack',
      condition: 'always',
      operation: 'modify_damage_multiplier',
      target: 'single_enemy',
      value: 1.35,
      priority: 40,
    }],
  };
}

function createCombatResult(): UnsealedCombatResult {
  return {
    contractVersion: ENCOUNTER_CONTRACT_VERSION,
    sessionId: 'session_personal_001',
    encounterId: 'encounter_personal_001',
    kind: 'personal_combat',
    rulesetVersion: COMBAT_RULESET_VERSION,
    sourceTurnNumber: 29,
    seed: 'encounter_personal_001:seed',
    resolvedAt: '2026-07-20T00:15:00.000Z',
    outcome: 'player_victory',
    elapsedMinutes: 15,
    actionLog: [{
      sequence: 1,
      actionId: 'action_001',
      actorId: 'player_liuping',
      targetIds: ['npc_enemy_guard'],
      actionType: 'normal_attack',
      randomDrawStart: 0,
      randomDrawEnd: 3,
      summaryKey: 'combat.normal_attack.hit',
      values: { damage: 18 },
    }],
    deltas: [{
      idempotencyKey: 'session_personal_001:actor:npc_enemy_guard:hp',
      targetKind: 'actor',
      targetId: 'npc_enemy_guard',
      field: 'vitals.hp',
      operation: 'set',
      beforeValue: 18,
      afterValue: 0,
    }],
    combatants: [
      {
        actorId: 'player_liuping',
        side: 'player',
        hp: 84,
        stamina: 72,
        downCount: 0,
        statuses: [],
      },
      {
        actorId: 'npc_enemy_guard',
        side: 'enemy',
        hp: 0,
        stamina: 24,
        downCount: 1,
        statuses: ['downed'],
      },
    ],
    experienceAward: 30,
    lootItemIds: [],
    capturedEquipmentItemIds: [],
  };
}

function createWarResult(): UnsealedWarResult {
  return {
    contractVersion: ENCOUNTER_CONTRACT_VERSION,
    sessionId: 'session_war_001',
    encounterId: 'encounter_war_001',
    kind: 'war',
    rulesetVersion: WAR_RULESET_VERSION,
    sourceTurnNumber: 40,
    seed: 'encounter_war_001:seed',
    resolvedAt: '2026-07-20T01:00:00.000Z',
    outcome: 'player_victory',
    elapsedMinutes: 60,
    actionLog: [],
    deltas: [],
    objective: 'defeat_enemy',
    objectiveAchieved: true,
    exitReason: 'force_routed',
    forces: [
      {
        troopId: 'troop_player_infantry',
        side: 'player',
        initialStrength: 800,
        remainingStrength: 700,
        casualties: 100,
        capturedCount: 0,
        morale: 80,
        supply: 70,
        fatigue: 35,
        lifecycleStatus: 'active',
        routed: false,
        surrendered: false,
        captured: false,
        statuses: [],
      },
      {
        troopId: 'troop_enemy_guard',
        side: 'enemy',
        initialStrength: 500,
        remainingStrength: 120,
        casualties: 380,
        capturedCount: 0,
        morale: 0,
        supply: 30,
        fatigue: 85,
        lifecycleStatus: 'routed',
        routed: true,
        surrendered: false,
        captured: false,
        statuses: ['routed'],
      },
    ],
    roundsCompleted: 6,
    pursuit: {
      status: 'not_available',
      extraCasualties: 0,
      extraCaptured: 0,
    },
    commanders: [
      { actorId: 'player_liuping', side: 'player', outcome: 'active' },
      { actorId: 'npc_enemy_general', side: 'enemy', outcome: 'wounded' },
    ],
    experienceAward: 40,
    capturedItemIds: [],
  };
}

describe('EncounterContractValidation', () => {
  it('accepts valid personal-combat and war start intents', () => {
    expect(validateEncounterStartIntent(createPersonalIntent())).toEqual({ valid: true, errors: [] });
    expect(validateEncounterStartIntent(createWarIntent())).toEqual({ valid: true, errors: [] });
    const theaterIntent = createWarIntent();
    if (theaterIntent.kind !== 'war') throw new Error('unexpected intent kind');
    theaterIntent.rulesetVersion = THEATER_WAR_RULESET_VERSION;
    expect(validateEncounterStartIntent(theaterIntent)).toEqual({ valid: true, errors: [] });
    const legacyCombatIntent = createPersonalIntent();
    if (legacyCombatIntent.kind !== 'personal_combat') throw new Error('unexpected intent kind');
    legacyCombatIntent.rulesetVersion = LEGACY_COMBAT_RULESET_VERSION;
    expect(validateEncounterStartIntent(legacyCombatIntent)).toEqual({ valid: true, errors: [] });
    const rebalancedWarIntent = createWarIntent();
    if (rebalancedWarIntent.kind !== 'war') throw new Error('unexpected intent kind');
    rebalancedWarIntent.rulesetVersion = REBALANCED_WAR_RULESET_VERSION;
    expect(validateEncounterStartIntent(rebalancedWarIntent)).toEqual({ valid: true, errors: [] });
  });

  it('rejects personal combat with more than three actors on a side', () => {
    const intent = createPersonalIntent();
    if (intent.kind !== 'personal_combat') throw new Error('unexpected intent kind');
    intent.playerParty.actorIds = ['player_liuping', 'npc_a', 'npc_b', 'npc_c'];

    const result = validateEncounterStartIntent(intent);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('personal_combat.playerParty.actorIds 只能包含 1—3 个稳定 ID。');
  });

  it('rejects duplicate and cross-side participant IDs', () => {
    const intent = createPersonalIntent();
    if (intent.kind !== 'personal_combat') throw new Error('unexpected intent kind');
    intent.playerParty.actorIds = ['player_liuping', 'player_liuping'];
    intent.enemyParty.actorIds = ['player_liuping'];

    const result = validateEncounterStartIntent(intent);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('不得重复'))).toBe(true);
    expect(result.errors.some((error) => error.includes('不能同时出现在双方'))).toBe(true);
  });

  it('accepts closed encounter-scoped enemies and rejects undeclared or unstable scoped IDs', () => {
    const intent = createPersonalIntent();
    if (intent.kind !== 'personal_combat') throw new Error('unexpected intent kind');
    const scopedActorId = `${intent.encounterId}:scoped:enemy_1`;
    intent.enemyParty.actorIds = [scopedActorId];
    intent.scopedCombatants = [{
      actorId: scopedActorId,
      name: '持矛溃卒',
      archetype: 'rabble',
      weaponClass: 'polearm',
      armorClass: 'light',
    }];

    expect(validateEncounterStartIntent(intent)).toEqual({ valid: true, errors: [] });

    intent.scopedCombatants[0].actorId = 'scoped_enemy_without_encounter_prefix';
    const wrongPrefix = validateEncounterStartIntent(intent);
    expect(wrongPrefix.valid).toBe(false);
    expect(wrongPrefix.errors.some((error) => error.includes('必须以'))).toBe(true);
    expect(wrongPrefix.errors.some((error) => error.includes('必须且只能出现在一方'))).toBe(true);

    delete intent.scopedCombatants;
    const undeclared = validateEncounterStartIntent(intent);
    expect(undeclared.valid).toBe(false);
    expect(undeclared.errors).toContain(`本场临时参战者 ${scopedActorId} 缺少 scopedCombatants 声明。`);
  });

  it('accepts only locally marked friendly scoped escorts and validates scene availability', () => {
    const intent = createPersonalIntent();
    if (intent.kind !== 'personal_combat') throw new Error('unexpected intent kind');
    const escortId = `${intent.encounterId}:scoped:player_guard_1`;
    intent.escortAvailability = 'normal';
    intent.playerParty.actorIds = ['player_liuping', escortId];
    intent.scopedCombatants = [{
      actorId: escortId,
      name: '随身护卫甲',
      archetype: 'regular',
      weaponClass: 'standard',
      armorClass: 'light',
      systemRole: 'temporary_escort',
    }];
    expect(validateEncounterStartIntent(intent)).toEqual({ valid: true, errors: [] });

    delete intent.scopedCombatants[0].systemRole;
    expect(validateEncounterStartIntent(intent).errors.join('\n')).toContain('systemRole 必须为 temporary_escort');

    intent.scopedCombatants[0].systemRole = 'temporary_escort';
    intent.playerParty.actorIds = ['player_liuping'];
    intent.enemyParty.actorIds = [escortId];
    expect(validateEncounterStartIntent(intent).errors.join('\n')).toContain('只允许本地派生的我方临时护卫');

    intent.escortAvailability = 'unknown' as typeof intent.escortAvailability;
    expect(validateEncounterStartIntent(intent).errors.join('\n')).toContain('escortAvailability 不在白名单');
  });

  it('rejects unknown war environment tags and duplicate troop IDs', () => {
    const intent = createWarIntent();
    if (intent.kind !== 'war') throw new Error('unexpected intent kind');
    intent.environmentTags = ['open', 'unknown_terrain'] as typeof intent.environmentTags;
    intent.playerForce.troopIds = ['troop_player_infantry', 'troop_player_infantry'];

    const result = validateEncounterStartIntent(intent);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('unknown_terrain'))).toBe(true);
    expect(result.errors.some((error) => error.includes('不得重复'))).toBe(true);
  });

  it('requires a stable target holding for holding and siege objectives', () => {
    const intent = createWarIntent();
    if (intent.kind !== 'war') throw new Error('unexpected intent kind');
    intent.objective = 'capture_holding';

    const missing = validateEncounterStartIntent(intent);
    expect(missing.valid).toBe(false);
    expect(missing.errors).toContain('war.targetHoldingId 是领地/围城目标的必填稳定 ID。');

    intent.targetHoldingId = 'holding_xinye';
    expect(validateEncounterStartIntent(intent)).toEqual({ valid: true, errors: [] });

    intent.targetHoldingId = '新野县城';
    const unstable = validateEncounterStartIntent(intent);
    expect(unstable.valid).toBe(false);
    expect(unstable.errors).toContain('war.targetHoldingId 不是合法的稳定 ID。');
  });

  it('accepts a validated active unique-art projection', () => {
    expect(validateSemanticProjection(createUniqueArtProfile())).toEqual({ valid: true, errors: [] });
  });

  it('accepts a structured passive runtime recovery and rejects active or unsafe variants', () => {
    const passive = createUniqueArtProfile();
    if (passive.sourceType !== 'unique_art') throw new Error('unexpected profile kind');
    passive.activation = 'passive';
    passive.targetMode = 'self';
    passive.purpose = 'healing';
    passive.powerClass = 'light';
    passive.powerMultiplier = 1.1;
    passive.staminaCost = 8;
    passive.maxHits = 1;
    passive.perEncounterLimit = 1;
    passive.allowAutoUse = false;
    passive.rulesetScopes = ['runtime_turn'];
    passive.effects = [{
      trigger: 'after_runtime_turn',
      condition: 'always',
      operation: 'restore_hp',
      target: 'self',
      value: 4,
      priority: 10,
    }];

    expect(validateSemanticProjection(passive)).toEqual({ valid: true, errors: [] });
    expect(validateSemanticProjection({ ...passive, activation: 'active' }).valid).toBe(false);
    expect(validateSemanticProjection({
      ...passive,
      effects: [{ ...passive.effects[0], target: 'all_allies' }],
    }).valid).toBe(false);
  });

  it('accepts passive trait and equipment projections without guessing from names', () => {
    const trait: TraitSemanticProfile = {
      profileKind: 'ability',
      projectionVersion: SEMANTIC_PROJECTION_VERSION,
      sourceId: 'trait_calm_under_pressure',
      sourceType: 'trait',
      status: 'executable',
      rulesetScopes: ['personal_combat'],
      activation: 'passive',
      effects: [{
        trigger: 'before_attack',
        condition: 'always',
        operation: 'modify_accuracy',
        target: 'self',
        value: 5,
        priority: 20,
      }],
    };
    const equipment: EquipmentSemanticProfile = {
      profileKind: 'equipment',
      projectionVersion: SEMANTIC_PROJECTION_VERSION,
      sourceId: 'equipment_heavy_halberd',
      status: 'executable',
      rulesetScopes: ['personal_combat'],
      equipmentSlot: 'weapon',
      qualityTier: 'blue',
      weaponWeight: 'heavy',
      effects: [{
        trigger: 'battle_start',
        condition: 'always',
        operation: 'modify_speed',
        target: 'self',
        value: -10,
        priority: 10,
      }],
    };

    expect(validateSemanticProjection(trait)).toEqual({ valid: true, errors: [] });
    expect(validateSemanticProjection(equipment)).toEqual({ valid: true, errors: [] });
  });

  it('enforces structured equipment quality floors without reading item names or descriptions', () => {
    expect(EQUIPMENT_QUALITY_BASELINES.red).toEqual({
      weaponBaseDamage: 19,
      accuracyBonus: 8,
      armorPenetration: 8,
      blockBonus: 10,
      armorTier: 5,
    });
    expect(normalizeEquipmentQualityTier('传说级')).toBe('orange');
    expect(normalizeEquipmentQualityTier('金色')).toBe('orange');
    expect(normalizeEquipmentQualityTier('red')).toBe('red');
    expect(normalizeEquipmentQualityTier('御赐金色')).toBeUndefined();
    expect(normalizeEquipmentQualityTier('国宝')).toBeUndefined();
    expect(normalizeEquipmentQualityTier('家传')).toBeUndefined();
    expect(normalizeEquipmentQualityTier('精造')).toBeUndefined();
    expect(normalizeEquipmentQualityTier('祖传神甲')).toBeUndefined();

    const weakRedWeapon: EquipmentSemanticProfile = {
      profileKind: 'equipment',
      projectionVersion: SEMANTIC_PROJECTION_VERSION,
      sourceId: 'equipment_weak_red_weapon',
      status: 'executable',
      rulesetScopes: ['personal_combat'],
      equipmentSlot: 'weapon',
      qualityTier: 'red',
      weaponWeight: 'standard',
      weaponBaseDamage: 10,
      accuracyBonus: 2,
      armorPenetration: 1,
      effects: [],
    };
    const result = validateSemanticProjection(weakRedWeapon);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('weaponBaseDamage 低于 red 品级武器保底值 19。');
    expect(result.errors).toContain('accuracyBonus 低于 red 品级武器保底值 8。');
    expect(result.errors).toContain('armorPenetration 低于 red 品级武器保底值 8。');
  });

  it('keeps narrative-only projections out of executable effects', () => {
    const profile = createUniqueArtProfile();
    profile.status = 'narrative_only';

    const result = validateSemanticProjection(profile);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('narrative_only 投影不得包含可执行效果。');
  });

  it('rejects an unknown effect operation and a mismatched unique-art power class', () => {
    const profile = createUniqueArtProfile();
    if (profile.sourceType !== 'unique_art') throw new Error('unexpected profile kind');
    profile.staminaCost = 8;
    profile.effects[0] = {
      ...profile.effects[0],
      operation: 'invent_new_rule' as typeof profile.effects[number]['operation'],
    };

    const result = validateSemanticProjection(profile);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('invent_new_rule'))).toBe(true);
    expect(result.errors).toContain('标准绝艺的体力消耗必须为 14。');
  });

  it('rejects more than five unique-art hits', () => {
    const profile = createUniqueArtProfile();
    if (profile.sourceType !== 'unique_art') throw new Error('unexpected profile kind');
    profile.maxHits = 6;

    const result = validateSemanticProjection(profile);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('绝艺 maxHits 必须是 1—5 的整数。');
  });

  it('requires combat items to declare executable effects', () => {
    const profile: ItemCombatProfile = {
      profileKind: 'item',
      projectionVersion: SEMANTIC_PROJECTION_VERSION,
      sourceId: 'item_medicine',
      status: 'executable',
      rulesetScopes: ['personal_combat'],
      combatUse: true,
      qualityTier: 'green',
      consumable: true,
      quantityPerUse: 1,
      perEncounterLimit: 1,
      effects: [],
    };

    const result = validateSemanticProjection(profile);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('combatUse=true 的物品必须至少包含一个可执行效果。');
  });

  it('enforces the six consumable quality ceilings', () => {
    expect(ITEM_EFFECT_LIMITS).toEqual({
      white: 10,
      green: 20,
      blue: 30,
      purple: 50,
      orange: 80,
      red: 100,
    });

    for (const [qualityTier, limit] of Object.entries(ITEM_EFFECT_LIMITS) as Array<
      [ItemCombatProfile['qualityTier'], number]
    >) {
      const profile: ItemCombatProfile = {
        profileKind: 'item',
        projectionVersion: SEMANTIC_PROJECTION_VERSION,
        sourceId: `item_${qualityTier}_medicine`,
        status: 'executable',
        rulesetScopes: ['personal_combat'],
        combatUse: true,
        qualityTier,
        consumable: true,
        quantityPerUse: 1,
        perEncounterLimit: 1,
        effects: [{
          trigger: 'before_action',
          condition: 'always',
          operation: 'restore_hp',
          target: 'self',
          value: limit,
          priority: 20,
        }],
      };

      expect(validateSemanticProjection(profile)).toEqual({ valid: true, errors: [] });

      const excessive = {
        ...profile,
        effects: [{ ...profile.effects[0], value: limit + 1 }],
      };
      const excessiveResult = validateSemanticProjection(excessive);
      expect(excessiveResult.valid).toBe(false);
      expect(excessiveResult.errors).toContain(
        `effects[0].value 超出 ${qualityTier} 品级允许强度 ${limit}。`,
      );
    }
  });

  it('limits troop semantic tags to three unique whitelist values', () => {
    const profile: TroopSemanticProfile = {
      profileKind: 'troop',
      projectionVersion: SEMANTIC_PROJECTION_VERSION,
      sourceId: 'troop_test',
      status: 'executable',
      rulesetScopes: ['war'],
      primaryClass: 'infantry',
      tags: ['heavy', 'defensive', 'assault', 'heavy'],
      effects: [],
    };

    const result = validateSemanticProjection(profile);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('最多 3 个'))).toBe(true);
    expect(result.errors.some((error) => error.includes('不得重复'))).toBe(true);
  });

  it('accepts a bounded mixed troop composition whose shares total one hundred', () => {
    const profile: TroopSemanticProfile = {
      profileKind: 'troop',
      projectionVersion: SEMANTIC_PROJECTION_VERSION,
      sourceId: 'troop_mixed_test',
      status: 'executable',
      rulesetScopes: ['war'],
      primaryClass: 'mixed',
      tags: [],
      composition: [
        { primaryClass: 'cavalry', sharePercent: 40, tags: ['heavy', 'mobile'] },
        { primaryClass: 'infantry', sharePercent: 60, tags: ['anti_cavalry'] },
      ],
      effects: [],
    };

    expect(validateSemanticProjection(profile)).toEqual({ valid: true, errors: [] });
  });

  it('rejects ambiguous mixed troop composition instead of silently guessing it', () => {
    const profile: TroopSemanticProfile = {
      profileKind: 'troop',
      projectionVersion: SEMANTIC_PROJECTION_VERSION,
      sourceId: 'troop_invalid_mixed_test',
      status: 'executable',
      rulesetScopes: ['war'],
      primaryClass: 'mixed',
      tags: [],
      composition: [
        { primaryClass: 'infantry', sharePercent: 60, tags: ['anti_cavalry'] },
        { primaryClass: 'infantry', sharePercent: 30, tags: [] },
      ],
      effects: [],
    };
    const result = validateSemanticProjection(profile);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('sharePercent 总和'))).toBe(true);
    expect(result.errors.some((error) => error.includes('重复 primaryClass'))).toBe(true);
  });

  it('accepts a complete unsealed combat result', () => {
    expect(validateEncounterResultPayload(createCombatResult())).toEqual({ valid: true, errors: [] });
  });

  it('accepts a complete unsealed war result', () => {
    expect(validateEncounterResultPayload(createWarResult())).toEqual({ valid: true, errors: [] });
  });

  it('rejects inconsistent war casualties, capture counts and lifecycle flags', () => {
    const result = createWarResult();
    result.forces[0].casualties = 99;
    result.forces[1].capturedCount = 121;
    result.forces[1].lifecycleStatus = 'active';

    const validation = validateEncounterResultPayload(result);

    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes('initialStrength - remainingStrength'))).toBe(true);
    expect(validation.errors.some((error) => error.includes('capturedCount'))).toBe(true);
    expect(validation.errors.some((error) => error.includes('routed'))).toBe(true);
  });

  it('rejects unstable participant IDs before an encounter starts', () => {
    const intent = createPersonalIntent();
    if (intent.kind !== 'personal_combat') throw new Error('unexpected intent kind');
    intent.enemyParty.actorIds = ['张绣亲卫'];

    const result = validateEncounterStartIntent(intent);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('personal_combat.enemyParty.actorIds[0] 不是合法的稳定 ID。');
  });

  it('rejects duplicate settlement keys and invalid combatant ranges', () => {
    const result = createCombatResult();
    result.deltas.push({ ...result.deltas[0] });
    result.combatants[0].hp = 101;

    const validation = validateEncounterResultPayload(result);

    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes('idempotencyKey 不得重复'))).toBe(true);
    expect(validation.errors).toContain('combatants[0].hp 必须在 0—100 之间。');
  });
});

import { describe, expect, it } from 'vitest';
import {
  COMBAT_RULESET_VERSION,
  ENCOUNTER_CONTRACT_VERSION,
  SEMANTIC_PROJECTION_VERSION,
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
    capturedItemIds: [],
  };
}

describe('EncounterContractValidation', () => {
  it('accepts valid personal-combat and war start intents', () => {
    expect(validateEncounterStartIntent(createPersonalIntent())).toEqual({ valid: true, errors: [] });
    expect(validateEncounterStartIntent(createWarIntent())).toEqual({ valid: true, errors: [] });
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

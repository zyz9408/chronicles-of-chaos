import type { CharacterEquipmentItem } from '../types';
import {
  SEMANTIC_PROJECTION_VERSION,
  type EncounterScopedCombatant,
  type EquipmentSemanticProfile,
  type ItemQualityTier,
  type SemanticProjection,
} from './EncounterContracts';
import { EQUIPMENT_QUALITY_BASELINES } from './EncounterContractValidation';
import type { CombatCharacterSource } from './CombatTypes';

interface ScopedCombatantProfile {
  martial: number;
  luck: number;
  hp: number;
  stamina: number;
  qualityTier: ItemQualityTier;
}

const ARCHETYPE_PROFILES: Record<EncounterScopedCombatant['archetype'], ScopedCombatantProfile> = {
  rabble: { martial: 30, luck: 40, hp: 65, stamina: 70, qualityTier: 'white' },
  militia: { martial: 40, luck: 45, hp: 80, stamina: 80, qualityTier: 'white' },
  regular: { martial: 52, luck: 50, hp: 90, stamina: 90, qualityTier: 'green' },
  veteran: { martial: 68, luck: 55, hp: 100, stamina: 100, qualityTier: 'blue' },
  elite: { martial: 82, luck: 60, hp: 100, stamina: 100, qualityTier: 'purple' },
};

const ARCHETYPE_BUDGET_POINTS: Readonly<Record<EncounterScopedCombatant['archetype'], number>> = Object.freeze({
  rabble: 1,
  militia: 2,
  regular: 3,
  veteran: 5,
  elite: 8,
});
const ARCHETYPE_DOWNGRADE: Readonly<Record<EncounterScopedCombatant['archetype'], EncounterScopedCombatant['archetype'] | null>> = Object.freeze({
  rabble: null,
  militia: 'rabble',
  regular: 'militia',
  veteran: 'regular',
  elite: 'veteran',
});
export const SCOPED_ENEMY_COMBAT_BUDGET = 10 as const;

/** Keeps anonymous temporary enemies inside one deterministic encounter budget. */
export function balanceEncounterScopedEnemyComposition(
  combatants: readonly EncounterScopedCombatant[],
  enemyActorIds: readonly string[],
): EncounterScopedCombatant[] {
  const enemyIds = new Set(enemyActorIds);
  const enemyCount = combatants.filter((combatant) => (
    enemyIds.has(combatant.actorId) && combatant.systemRole !== 'temporary_escort'
  )).length;
  let processedEnemyCount = 0;
  let budgetUsed = 0;
  let exceptionalCount = 0;

  return combatants.map((combatant) => {
    if (!enemyIds.has(combatant.actorId) || combatant.systemRole === 'temporary_escort') return { ...combatant };
    processedEnemyCount += 1;
    const minimumBudgetForRemaining = enemyCount - processedEnemyCount;
    const availableBudget = Math.max(1, SCOPED_ENEMY_COMBAT_BUDGET - budgetUsed - minimumBudgetForRemaining);
    let archetype = combatant.archetype;
    if ((archetype === 'veteran' || archetype === 'elite') && exceptionalCount >= 1) {
      archetype = 'regular';
    }
    while (ARCHETYPE_BUDGET_POINTS[archetype] > availableBudget) {
      const downgraded = ARCHETYPE_DOWNGRADE[archetype];
      if (!downgraded) break;
      archetype = downgraded;
    }
    budgetUsed += ARCHETYPE_BUDGET_POINTS[archetype];
    if (archetype === 'veteran' || archetype === 'elite') exceptionalCount += 1;
    return archetype === combatant.archetype ? { ...combatant } : { ...combatant, archetype };
  });
}

const WEAPON_NAMES: Record<EncounterScopedCombatant['weaponClass'], string> = {
  unarmed: '徒手',
  light: '轻兵刃',
  standard: '制式兵刃',
  polearm: '长柄兵器',
  heavy: '重兵器',
  ranged: '弓弩',
};

const ARMOR_NAMES: Record<EncounterScopedCombatant['armorClass'], string> = {
  none: '无甲',
  light: '轻甲',
  medium: '中甲',
  heavy: '重甲',
};

export interface MaterializedScopedCombatant {
  source: CombatCharacterSource;
  projections: SemanticProjection[];
}

function createEquipment(
  actorId: string,
  slot: CharacterEquipmentItem['slot'],
  name: string,
  qualityTier: ItemQualityTier,
): CharacterEquipmentItem {
  return {
    id: `${actorId}:${slot}`,
    slot,
    name,
    quality: qualityTier,
    description: 'Encounter V2 本场临时参战者的规则装备；不进入长期人物或战利品账本。',
  };
}

function createWeaponProjection(
  equipment: CharacterEquipmentItem,
  weaponClass: EncounterScopedCombatant['weaponClass'],
  qualityTier: ItemQualityTier,
): EquipmentSemanticProfile {
  const baseline = EQUIPMENT_QUALITY_BASELINES[qualityTier];
  return {
    projectionVersion: SEMANTIC_PROJECTION_VERSION,
    sourceId: equipment.id,
    profileKind: 'equipment',
    status: 'executable',
    rulesetScopes: ['personal_combat'],
    effects: [],
    equipmentSlot: 'weapon',
    qualityTier,
    weaponWeight: weaponClass,
    weaponBaseDamage: baseline.weaponBaseDamage,
    accuracyBonus: baseline.accuracyBonus,
    armorPenetration: baseline.armorPenetration,
  };
}

function createArmorProjection(
  equipment: CharacterEquipmentItem,
  armorClass: EncounterScopedCombatant['armorClass'],
  qualityTier: ItemQualityTier,
): EquipmentSemanticProfile {
  const baseline = EQUIPMENT_QUALITY_BASELINES[qualityTier];
  return {
    projectionVersion: SEMANTIC_PROJECTION_VERSION,
    sourceId: equipment.id,
    profileKind: 'equipment',
    status: 'executable',
    rulesetScopes: ['personal_combat'],
    effects: [],
    equipmentSlot: 'armor',
    qualityTier,
    armorWeight: armorClass,
    blockBonus: baseline.blockBonus,
    armorTier: baseline.armorTier,
  };
}

export function materializeEncounterScopedCombatant(
  combatant: EncounterScopedCombatant,
): MaterializedScopedCombatant {
  const profile = ARCHETYPE_PROFILES[combatant.archetype];
  const equipment: CharacterEquipmentItem[] = [];
  const projections: SemanticProjection[] = [];

  if (combatant.weaponClass !== 'unarmed') {
    const weapon = createEquipment(
      combatant.actorId,
      'weapon',
      WEAPON_NAMES[combatant.weaponClass],
      profile.qualityTier,
    );
    equipment.push(weapon);
    projections.push(createWeaponProjection(weapon, combatant.weaponClass, profile.qualityTier));
  }

  if (combatant.armorClass !== 'none') {
    const armor = createEquipment(
      combatant.actorId,
      'armor',
      ARMOR_NAMES[combatant.armorClass],
      profile.qualityTier,
    );
    equipment.push(armor);
    projections.push(createArmorProjection(armor, combatant.armorClass, profile.qualityTier));
  }

  return {
    source: {
      id: combatant.actorId,
      name: combatant.name,
      abilityScores: {
        武力: profile.martial,
        机运: profile.luck,
      },
      vitals: {
        hp: profile.hp,
        maxHp: 100,
        stamina: profile.stamina,
        maxStamina: 100,
      },
      equipment,
      inventory: [],
      persistent: false,
      combatArchetype: combatant.archetype,
    },
    projections,
  };
}

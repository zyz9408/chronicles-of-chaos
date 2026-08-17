import type { RuntimeState } from '../types';
import {
  validateSemanticProjection,
} from '../encounterV2/EncounterContractValidation';
import type {
  ItemCombatProfile,
  SemanticEffect,
} from '../encounterV2/EncounterContracts';
import { normalizePlayerVitals } from './PlayerVitals';

export type PlayerRestorativeItemUseBlockReason =
  | 'item_missing'
  | 'profile_missing'
  | 'profile_not_restorative'
  | 'active_encounter'
  | 'quantity_insufficient'
  | 'condition_not_met'
  | 'already_full';

export interface PlayerRestorativeItemUsePreview {
  itemId: string;
  hasRestorativeUse: boolean;
  canUse: boolean;
  quantityPerUse: number;
  hpRestore: number;
  staminaRestore: number;
  effectText?: string;
  blockReason?: PlayerRestorativeItemUseBlockReason;
  blockMessage?: string;
}

export interface PlayerRestorativeItemUseResult {
  state: RuntimeState;
  applied: boolean;
  preview: PlayerRestorativeItemUsePreview;
  summary: string;
}

const SUPPORTED_CONDITIONS = new Set<SemanticEffect['condition']>([
  'always',
  'self_hp_below_30',
  'self_stamina_below_30',
]);

export function previewPlayerRestorativeItemUse(
  state: RuntimeState,
  itemId: string,
): PlayerRestorativeItemUsePreview {
  const item = state.player.inventory?.find((candidate) => candidate.id === itemId);
  if (!item) return blocked(itemId, 'item_missing', '目标物品已不在背包中。');

  const profile = findRestorativeItemProfile(state, itemId);
  if (!profile) return blocked(itemId, 'profile_missing', '该物品没有可执行的结构化恢复效果。');
  if (!isDirectUseRestorativeProfile(profile)) {
    return blocked(itemId, 'profile_not_restorative', '该物品只能在对应的战斗行动中使用。');
  }

  const quantityPerUse = profile.quantityPerUse;
  if (state.encounterV2?.active) {
    return blocked(
      itemId,
      'active_encounter',
      '当前冲突尚未结束，请在战斗行动中使用该物品。',
      { hasRestorativeUse: true, quantityPerUse },
    );
  }
  if (!Number.isFinite(item.quantity) || item.quantity < quantityPerUse) {
    return blocked(
      itemId,
      'quantity_insufficient',
      `物品数量不足，每次需要 ${quantityPerUse} 份。`,
      { hasRestorativeUse: true, quantityPerUse },
    );
  }

  const vitals = normalizePlayerVitals(state.player.vitals);
  const applicableEffects = profile.effects.filter((effect) => effectConditionMet(effect, vitals));
  const hasApplicableRestorativeEffect = applicableEffects.some(isSelfRestorativeEffect);
  if (!hasApplicableRestorativeEffect) {
    return blocked(
      itemId,
      'condition_not_met',
      '当前状态未满足该恢复品的使用条件。',
      { hasRestorativeUse: true, quantityPerUse },
    );
  }

  const restored = calculateRestoredVitals(vitals, applicableEffects);
  const hpRestore = restored.hp - vitals.hp;
  const staminaRestore = restored.stamina - vitals.stamina;
  const effectText = formatEffectText(hpRestore, staminaRestore);
  if (hpRestore <= 0 && staminaRestore <= 0) {
    return blocked(
      itemId,
      'already_full',
      '该物品可恢复的生命或体力已经处于上限。',
      {
        hasRestorativeUse: true,
        quantityPerUse,
        hpRestore,
        staminaRestore,
        effectText: formatNominalEffectText(profile.effects),
      },
    );
  }

  return {
    itemId,
    hasRestorativeUse: true,
    canUse: true,
    quantityPerUse,
    hpRestore,
    staminaRestore,
    effectText,
  };
}

export function applyPlayerRestorativeItemUse(
  state: RuntimeState,
  itemId: string,
): PlayerRestorativeItemUseResult {
  const preview = previewPlayerRestorativeItemUse(state, itemId);
  if (!preview.canUse) {
    return {
      state,
      applied: false,
      preview,
      summary: preview.blockMessage ?? '该物品当前不能使用。',
    };
  }

  const item = state.player.inventory?.find((candidate) => candidate.id === itemId);
  const profile = findRestorativeItemProfile(state, itemId);
  if (!item || !profile) {
    return {
      state,
      applied: false,
      preview: blocked(itemId, 'item_missing', '目标物品已不在背包中。'),
      summary: '目标物品已不在背包中。',
    };
  }

  const previousVitals = normalizePlayerVitals(state.player.vitals);
  const nextVitals = calculateRestoredVitals(
    previousVitals,
    profile.effects.filter((effect) => effectConditionMet(effect, previousVitals)),
  );
  const nextQuantity = Math.max(0, Math.floor(item.quantity) - profile.quantityPerUse);
  const nextInventory = (state.player.inventory ?? []).flatMap((candidate) => {
    if (candidate.id !== itemId) return [{ ...candidate }];
    return nextQuantity > 0 ? [{ ...candidate, quantity: nextQuantity }] : [];
  });
  const nextState: RuntimeState = {
    ...state,
    player: {
      ...state.player,
      vitals: nextVitals,
      inventory: nextInventory,
    },
  };
  const changes = [
    nextVitals.hp !== previousVitals.hp
      ? `生命 ${previousVitals.hp}→${nextVitals.hp}`
      : undefined,
    nextVitals.stamina !== previousVitals.stamina
      ? `体力 ${previousVitals.stamina}→${nextVitals.stamina}`
      : undefined,
  ].filter(Boolean).join('；');
  const quantitySummary = nextQuantity > 0
    ? `消耗 ${profile.quantityPerUse} 份，剩余 ${nextQuantity} 份`
    : `消耗 ${profile.quantityPerUse} 份，物品已用尽`;

  return {
    state: nextState,
    applied: true,
    preview,
    summary: `已使用「${item.name}」：${changes}；${quantitySummary}。`,
  };
}

function findRestorativeItemProfile(
  state: RuntimeState,
  itemId: string,
): ItemCombatProfile | undefined {
  const profile = state.encounterV2?.semanticProjections?.find((candidate) => (
    candidate.sourceId === itemId && candidate.profileKind === 'item'
  ));
  if (!profile || profile.profileKind !== 'item') return undefined;
  const validation = validateSemanticProjection(profile);
  return validation.valid ? profile : undefined;
}

function isDirectUseRestorativeProfile(profile: ItemCombatProfile): boolean {
  return profile.status === 'executable'
    && profile.combatUse
    && profile.consumable
    && Number.isInteger(profile.quantityPerUse)
    && profile.quantityPerUse > 0
    && profile.effects.length > 0
    && profile.effects.every((effect) => (
      isSelfRestorativeEffect(effect)
      && SUPPORTED_CONDITIONS.has(effect.condition)
      && Number.isFinite(effect.value)
      && effect.value > 0
    ));
}

function isSelfRestorativeEffect(effect: SemanticEffect): boolean {
  return effect.target === 'self'
    && (effect.operation === 'restore_hp' || effect.operation === 'restore_stamina');
}

function effectConditionMet(
  effect: SemanticEffect,
  vitals: ReturnType<typeof normalizePlayerVitals>,
): boolean {
  if (effect.condition === 'always') return true;
  if (effect.condition === 'self_hp_below_30') return vitals.hp / vitals.maxHp < 0.3;
  if (effect.condition === 'self_stamina_below_30') return vitals.stamina / vitals.maxStamina < 0.3;
  return false;
}

function calculateRestoredVitals(
  vitals: ReturnType<typeof normalizePlayerVitals>,
  effects: readonly SemanticEffect[],
): ReturnType<typeof normalizePlayerVitals> {
  let hp = vitals.hp;
  let stamina = vitals.stamina;
  for (const effect of [...effects].sort((left, right) => left.priority - right.priority)) {
    const amount = Math.max(0, Math.round(effect.value));
    if (effect.operation === 'restore_hp') hp = Math.min(vitals.maxHp, hp + amount);
    if (effect.operation === 'restore_stamina') stamina = Math.min(vitals.maxStamina, stamina + amount);
  }
  return { ...vitals, hp, stamina };
}

function formatEffectText(hpRestore: number, staminaRestore: number): string | undefined {
  const effects = [
    hpRestore > 0 ? `生命 +${hpRestore}` : undefined,
    staminaRestore > 0 ? `体力 +${staminaRestore}` : undefined,
  ].filter(Boolean);
  return effects.length > 0 ? effects.join(' · ') : undefined;
}

function formatNominalEffectText(effects: readonly SemanticEffect[]): string | undefined {
  const hp = effects
    .filter((effect) => effect.operation === 'restore_hp')
    .reduce((sum, effect) => sum + Math.max(0, Math.round(effect.value)), 0);
  const stamina = effects
    .filter((effect) => effect.operation === 'restore_stamina')
    .reduce((sum, effect) => sum + Math.max(0, Math.round(effect.value)), 0);
  return formatEffectText(hp, stamina);
}

function blocked(
  itemId: string,
  blockReason: PlayerRestorativeItemUseBlockReason,
  blockMessage: string,
  overrides: Partial<PlayerRestorativeItemUsePreview> = {},
): PlayerRestorativeItemUsePreview {
  return {
    itemId,
    hasRestorativeUse: false,
    canUse: false,
    quantityPerUse: 0,
    hpRestore: 0,
    staminaRestore: 0,
    ...overrides,
    blockReason,
    blockMessage,
  };
}

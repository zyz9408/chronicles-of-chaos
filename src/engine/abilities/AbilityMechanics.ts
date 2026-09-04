import type {
  AbilityMechanics,
  AbilityRule,
  CharacterTrait,
  CharacterUniqueArt,
} from '../types';

const MAX_RULES = 16;
const MAX_EFFECTS_PER_RULE = 8;
const learningPattern = /学习|修习|研习|领悟|掌握|传授|技能|绝艺/u;
const perfectLearningPattern = /完美|一学即会|一学便会|瞬间掌握|立即掌握|过目不忘|顷刻掌握/u;
const fastLearningPattern = /快速|迅速|极快|加速|倍速|事半功倍/u;

function sourceText(value: { label?: string; name?: string; description?: string; effectSummary?: string; promptHint?: string }): string {
  return [value.label, value.name, value.description, value.effectSummary, value.promptHint]
    .filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    .join('；')
    .normalize('NFKC');
}

function checksum(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function buildMechanics(compiledFrom: string, rules: AbilityRule[]): AbilityMechanics {
  const payload = { schemaVersion: 2 as const, mode: 'authoritative' as const, status: 'executable' as const, rules, compiledFrom, confirmedByPlayer: true };
  return { ...payload, checksum: checksum(payload) };
}

function isSafeRule(rule: AbilityRule): boolean {
  if (!rule || typeof rule !== 'object' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/u.test(rule.ruleId)) return false;
  if (!['on_unique_art_use', 'on_progress_award', 'on_skill_acquired'].includes(rule.trigger)) return false;
  if (
    !Array.isArray(rule.scopes)
    || rule.scopes.length === 0
    || !rule.scopes.every((scope) => ['runtime_turn', 'personal_combat', 'learning'].includes(scope))
    || !Array.isArray(rule.effects)
    || rule.effects.length === 0
    || rule.effects.length > MAX_EFFECTS_PER_RULE
  ) return false;
  if (!Number.isInteger(rule.priority) || rule.priority < -1000 || rule.priority > 1000) return false;
  return rule.effects.every((effect) => {
    if (effect.type === 'restore_to_max') return ['hp', 'stamina'].includes(effect.resource) && effect.target === 'self';
    if (effect.type === 'multiply_learning_progress') return Number.isFinite(effect.multiplier) && effect.multiplier > 0 && effect.multiplier <= 1000;
    if (effect.type === 'set_minimum_learning_progress') return Number.isFinite(effect.value) && effect.value >= 0 && effect.value <= 1_000_000;
    return effect.type === 'set_skill_to_max_level';
  });
}

export function validateAbilityMechanics(value: AbilityMechanics | undefined): value is AbilityMechanics {
  if (!value) return false;
  if (
    value.schemaVersion !== 2
    || !['narrative_only', 'balanced', 'authoritative'].includes(value.mode)
    || !['executable', 'invalid', 'pending_confirmation'].includes(value.status)
    || !Array.isArray(value.rules)
    || value.rules.length > MAX_RULES
    || !value.rules.every(isSafeRule)
    || typeof value.compiledFrom !== 'string'
    || typeof value.confirmedByPlayer !== 'boolean'
    || (value.mode === 'authoritative' && !value.confirmedByPlayer)
    || typeof value.checksum !== 'string'
  ) return false;
  const { checksum: storedChecksum, ...payload } = value;
  return storedChecksum === checksum(payload);
}

function cloneMechanics(value: AbilityMechanics): AbilityMechanics {
  return structuredClone(value);
}

export function compileTraitAbilityMechanics(trait: CharacterTrait): AbilityMechanics | undefined {
  if (validateAbilityMechanics(trait.mechanics)) return cloneMechanics(trait.mechanics);
  const text = sourceText(trait);
  if (!learningPattern.test(text)) return undefined;
  const perfect = perfectLearningPattern.test(text);
  const fast = fastLearningPattern.test(text);
  if (!perfect && !fast) return undefined;
  const awardEffects: AbilityRule['effects'] = [];
  if (fast) awardEffects.push({ type: 'multiply_learning_progress', multiplier: 5 });
  if (perfect) awardEffects.push({ type: 'set_minimum_learning_progress', value: 100 });
  const rules: AbilityRule[] = [{
    ruleId: `${trait.id}:learning-progress`, trigger: 'on_progress_award', scopes: ['learning'],
    effects: awardEffects, priority: 100,
  }];
  if (perfect) rules.push({
    ruleId: `${trait.id}:perfect-acquisition`, trigger: 'on_skill_acquired', scopes: ['learning'],
    effects: [{ type: 'set_skill_to_max_level' }], priority: 110,
  });
  return buildMechanics(text, rules);
}

export function compileUniqueArtAbilityMechanics(art: CharacterUniqueArt): AbilityMechanics | undefined {
  if (validateAbilityMechanics(art.mechanics)) return cloneMechanics(art.mechanics);
  const text = sourceText(art);
  const mentionsUse = /每次使用|每当使用|使用时|施展时|发动时|催动时/u.test(text);
  const mentionsFull = /恢复(?:全部|所有)?生命|回复(?:全部|所有)?生命|生命(?:恢复|回复|回满|复原)(?:至|到)?(?:满|上限|最大)|满血/u.test(text);
  if (!mentionsUse || !mentionsFull) return undefined;
  return buildMechanics(text, [{
    ruleId: `${art.id}:full-heal-on-use`, trigger: 'on_unique_art_use', scopes: ['runtime_turn', 'personal_combat'],
    effects: [{ type: 'restore_to_max', resource: 'hp', target: 'self', allowRevive: false }], priority: 100,
  }]);
}

export function abilityMechanicsSummary(mechanics: AbilityMechanics | undefined): string | undefined {
  if (!validateAbilityMechanics(mechanics) || mechanics.status !== 'executable') return undefined;
  const labels = mechanics.rules.flatMap((rule) => rule.effects.map((effect) => {
    if (effect.type === 'restore_to_max') return `${rule.trigger === 'on_unique_art_use' ? '使用时' : '触发时'}${effect.resource === 'hp' ? '生命' : '体力'}恢复至上限${effect.allowRevive ? '（可复活）' : ''}`;
    if (effect.type === 'multiply_learning_progress') return `学习进度 ×${effect.multiplier}`;
    if (effect.type === 'set_minimum_learning_progress') return `单次学习进度至少 ${effect.value}`;
    return '新学技能直接达到最高等级';
  }));
  return `${mechanics.mode === 'authoritative' ? '玩家权威' : mechanics.mode === 'balanced' ? '标准规则' : '仅叙事'}：${[...new Set(labels)].join('；')}`;
}

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
  return [value.label, value.name, value.effectSummary, value.description, value.promptHint]
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

export function buildMechanics(compiledFrom: string, rules: AbilityRule[]): AbilityMechanics {
  const payload = { schemaVersion: 2 as const, mode: 'authoritative' as const, status: 'executable' as const, rules, compiledFrom, confirmedByPlayer: true };
  return { ...payload, checksum: checksum(payload) };
}

function isSafeRule(rule: AbilityRule): boolean {
  if (!rule || typeof rule !== 'object' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/u.test(rule.ruleId)) return false;
  if (!['on_unique_art_use', 'on_progress_award', 'on_skill_acquired', 'on_time_elapsed', 'after_runtime_turn', 'passive_modifier'].includes(rule.trigger)) return false;
  if (rule.trigger === 'on_time_elapsed' && (!Number.isInteger(rule.intervalMinutes) || rule.intervalMinutes! < 1 || rule.intervalMinutes! > 43200)) return false;
  if (
    !Array.isArray(rule.scopes)
    || rule.scopes.length === 0
    || !rule.scopes.every((scope) => ['runtime_turn', 'personal_combat', 'learning', 'war'].includes(scope))
    || !Array.isArray(rule.effects)
    || rule.effects.length === 0
    || rule.effects.length > MAX_EFFECTS_PER_RULE
  ) return false;
  if (!Number.isInteger(rule.priority) || rule.priority < -1000 || rule.priority > 1000) return false;
  return rule.effects.every((effect) => {
    if (!effect || typeof effect !== 'object') return false;
    if ((effect.type === 'restore_to_max' || effect.type === 'restore_amount') && !['on_time_elapsed', 'after_runtime_turn', 'on_unique_art_use'].includes(rule.trigger)) return false;
    if ((effect.type === 'restore_to_max' || effect.type === 'restore_amount') && (rule.trigger === 'on_time_elapsed' ? !rule.scopes.includes('runtime_turn') : !rule.scopes.some(scope => scope === 'runtime_turn' || scope === 'personal_combat'))) return false;
    if (effect.type === 'numeric_modifier' && (rule.trigger !== 'passive_modifier' || !rule.scopes.includes(effect.metric === 'warPowerPercent' ? 'war' : 'personal_combat'))) return false;
    if ((effect.type === 'multiply_learning_progress' || effect.type === 'set_minimum_learning_progress') && (rule.trigger !== 'on_progress_award' || !rule.scopes.includes('learning'))) return false;
    if (effect.type === 'set_skill_to_max_level' && (rule.trigger !== 'on_skill_acquired' || !rule.scopes.includes('learning'))) return false;
    if (effect.type === 'restore_to_max') return ['hp', 'stamina'].includes(effect.resource) && effect.target === 'self';
    if (effect.type === 'restore_amount') return ['hp', 'stamina'].includes(effect.resource) && effect.target === 'self' && Number.isFinite(effect.value) && (effect.percent || Number.isInteger(effect.value)) && effect.value > 0 && effect.value <= (effect.percent ? 100 : 10000);
    if (effect.type === 'numeric_modifier') return ['damageMultiplier', 'accuracy', 'block', 'speed', 'warPowerPercent'].includes(effect.metric) && Number.isFinite(effect.value) && effect.value >= (effect.metric === 'damageMultiplier' ? 0.1 : 0) && effect.value <= (effect.metric === 'damageMultiplier' ? 10 : effect.metric === 'warPowerPercent' ? 280 : 100);
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
    || (value.status === 'executable' && value.rules.length === 0)
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
  const direct = compileRecoveryOrModifier(trait.id, text, false);
  if (!learningPattern.test(text)) return direct;
  const perfect = perfectLearningPattern.test(text);
  const fast = fastLearningPattern.test(text);
  if (!perfect && !fast) return direct;
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
  return buildMechanics(text, [...(direct?.rules ?? []), ...rules]);
}

export function compileUniqueArtAbilityMechanics(art: CharacterUniqueArt): AbilityMechanics | undefined {
  if (validateAbilityMechanics(art.mechanics)) return cloneMechanics(art.mechanics);
  const text = sourceText(art);
  const direct = compileRecoveryOrModifier(art.id, text, true);
  if (direct) return direct;
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
    const trigger = rule.trigger === 'on_time_elapsed' ? `每累计 ${rule.intervalMinutes} 游戏分钟` : rule.trigger === 'after_runtime_turn' ? '每个时间推进回合' : rule.trigger === 'on_unique_art_use' ? '使用时' : '被动';
    if (effect.type === 'restore_amount') return `${trigger}${effect.resource === 'hp' ? '生命' : '体力'} +${effect.value}${effect.percent ? '%上限' : ''}`;
    if (effect.type === 'numeric_modifier') return `${({ damageMultiplier: '伤害倍率', accuracy: '命中', block: '格挡', speed: '行动速度', warPowerPercent: '统领部队战力%' })[effect.metric]} ${effect.metric === 'damageMultiplier' ? '×' : '+'}${effect.value}`;
    if (effect.type === 'restore_to_max') return `${trigger}${effect.resource === 'hp' ? '生命' : '体力'}恢复至上限${effect.allowRevive ? '（可复活）' : ''}`;
    if (effect.type === 'multiply_learning_progress') return `学习进度 ×${effect.multiplier}`;
    if (effect.type === 'set_minimum_learning_progress') return `单次学习进度至少 ${effect.value}`;
    return '新学技能直接达到最高等级';
  }));
  return `${mechanics.mode === 'authoritative' ? '玩家权威' : mechanics.mode === 'balanced' ? '标准规则' : '仅叙事'}：${[...new Set(labels)].join('；')}`;
}

function compileRecoveryOrModifier(id: string, text: string, art: boolean): AbilityMechanics | undefined {
  text = text.replace(/血量|血条|生命值/gu, '生命');
  const rules: AbilityRule[] = [];
  const period = /每(?:隔)?\s*(\d+(?:\.\d+)?|一|二|两|三|四|五|六|七|八|九|十|半)?\s*(分钟|小时|时辰|天|日)/u.exec(text);
  const counts: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5 };
  const interval = period ? (counts[period[1]] ?? Number(period[1] ?? 1)) * (({ 分钟: 1, 小时: 60, 时辰: 120, 天: 1440, 日: 1440 } as Record<string, number>)[period[2]] ?? 1) : undefined;
  const perTurn = /每(?:个)?回合|每轮/u.test(text);
  const onUse = art && /每次(?:使用|发动|施展)|每当使用|使用时|使用后|发动时|施展时|催动时|(?:技能|绝艺|此招)(?:会|可以|能够)?(?:恢复|回复)/u.test(text);
  const full = /恢复(?:全部|所有)(?:的)?生命|回复(?:全部|所有)(?:的)?生命|恢复(?:到|至)?满|回复(?:到|至)?满|回满|满血|(?:生命|体力)(?:值)?恢复(?:至|到)?上限/u.test(text);
  const healing = /生命|回血|自愈|体力/u.test(text) && /恢复|回复|回满|回血|自愈/u.test(text)
    && !/(?:无法|不能|不会|不再)(?:自动)?(?:恢复|回复|回血|自愈)/u.test(text)
    && !/我军|友军|队友|全队|所有人|他人|群体|概率|几率|仅在|只有|除非/u.test(text);
  const amount = /(?:恢复|回复|回血)\s*(\d+(?:\.\d+)?)(%)?/u.exec(text);
  if (healing && (period || perTurn || onUse) && (full || amount || /微量|少量/u.test(text))) {
    const resource = /体力/u.test(text) && !/生命|回血|自愈/u.test(text) ? 'stamina' : 'hp';
    const effect: AbilityRule['effects'][number] = full ? { type: 'restore_to_max', resource, target: 'self', allowRevive: false }
      : { type: 'restore_amount', resource, target: 'self', value: amount ? Number(amount[1]) : 2, ...(amount?.[2] ? { percent: true } : {}) };
    const rule: AbilityRule = { ruleId: `${id}:authored-recovery`, trigger: period ? 'on_time_elapsed' : perTurn ? 'after_runtime_turn' : 'on_unique_art_use', scopes: period ? ['runtime_turn'] : ['runtime_turn', 'personal_combat'], effects: [effect], priority: 100, ...(interval ? { intervalMinutes: interval } : {}) };
    if (isSafeRule(rule)) rules.push(rule);
  }
  const metrics: Record<string, 'damageMultiplier' | 'accuracy' | 'block' | 'speed' | 'warPowerPercent'> = { 伤害: 'damageMultiplier', 攻击伤害: 'damageMultiplier', 命中: 'accuracy', 格挡: 'block', 行动速度: 'speed', 战争战力: 'warPowerPercent', 部队战力: 'warPowerPercent' };
  const seen = new Set<string>();
  for (const match of text.matchAll(/(攻击伤害|伤害|命中|格挡|行动速度|战争战力|部队战力)\s*(?:倍率)?\s*(×|x|\*|提高|增加|提升|\+)\s*(\d+(?:\.\d+)?)/giu)) {
    if (/受到|承受|敌方|敌人|对手|概率|几率/u.test(text.slice(Math.max(0, (match.index ?? 0) - 8), match.index))) continue;
    const metric = metrics[match[1]];
    if (!metric || seen.has(metric) || (metric === 'damageMultiplier' && !/[×x*]/iu.test(match[2]))) continue;
    const rule: AbilityRule = { ruleId: `${id}:authored-${metric}`, trigger: 'passive_modifier', scopes: metric === 'warPowerPercent' ? ['war'] : ['personal_combat'], effects: [{ type: 'numeric_modifier', metric, value: Number(match[3]) }], priority: 100 };
    if (isSafeRule(rule)) { rules.push(rule); seen.add(metric); }
  }
  return rules.length ? buildMechanics(text, rules) : undefined;
}

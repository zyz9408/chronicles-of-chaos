export type AbilityMechanicsMode = 'narrative_only' | 'balanced' | 'authoritative';
export type AbilityMechanicsStatus = 'executable' | 'invalid' | 'pending_confirmation';
export type AbilityRuleTrigger = 'on_unique_art_use' | 'on_progress_award' | 'on_skill_acquired' | 'on_time_elapsed' | 'after_runtime_turn' | 'passive_modifier';

export type AbilityRuleEffect =
  | { type: 'restore_amount'; resource: 'hp' | 'stamina'; target: 'self'; value: number; percent?: boolean }
  | { type: 'numeric_modifier'; metric: 'damageMultiplier' | 'accuracy' | 'block' | 'speed' | 'warPowerPercent'; value: number }
  | { type: 'restore_to_max'; resource: 'hp' | 'stamina'; target: 'self'; allowRevive?: boolean }
  | { type: 'multiply_learning_progress'; multiplier: number }
  | { type: 'set_minimum_learning_progress'; value: number }
  | { type: 'set_skill_to_max_level' };

export interface AbilityRule {
  ruleId: string;
  trigger: AbilityRuleTrigger;
  scopes: Array<'runtime_turn' | 'personal_combat' | 'learning' | 'war'>;
  intervalMinutes?: number;
  effects: AbilityRuleEffect[];
  priority: number;
  limits?: { perTurn?: number; perEncounter?: number; cooldownTurns?: number };
}

export interface AbilityMechanics {
  schemaVersion: 2;
  mode: AbilityMechanicsMode;
  status: AbilityMechanicsStatus;
  rules: AbilityRule[];
  compiledFrom: string;
  confirmedByPlayer: boolean;
  checksum: string;
}

export interface AbilityRuleExecutionTrace {
  executionId: string;
  eventId: string;
  ruleId: string;
  sourceAbilityId: string;
  sourceAbilityName: string;
  trigger: AbilityRuleTrigger;
  status: 'applied' | 'skipped';
  summary: string;
  before?: Record<string, number>;
  after?: Record<string, number>;
  occurredAt: string;
}

import type { RuntimeState, WorldBook } from '../types';

export type PromptModuleKind =
  | 'stable-prefix'
  | 'worldbook-core'
  | 'current-context'
  | 'state-writer'
  | 'conditional-protocol'
  | 'debug-only';

export interface PromptModule {
  id: string;
  title: string;
  kind: PromptModuleKind;
  priority: number;
  enabled: boolean;
  includeInPrompt: boolean;
  reason: string;
  content: string;
  estimatedTokens: number;
}

export interface BuildPromptModulesInput {
  worldBook: WorldBook;
  runtimeState: RuntimeState;
  narrativeContext: string;
  stateWriterContext: string;
}

export function estimatePromptTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 2));
}

export function buildPromptModules(input: BuildPromptModulesInput): PromptModule[] {
  const modules: Omit<PromptModule, 'estimatedTokens'>[] = [
    {
      id: 'stable-prefix',
      title: '稳定前缀',
      kind: 'stable-prefix',
      priority: 10,
      enabled: true,
      includeInPrompt: true,
      reason: '稳定加载：提供叙事身份、游戏定位和状态写入总纪律。',
      content: buildStablePrefix(),
    },
    {
      id: 'worldbook-core',
      title: '世界书核心',
      kind: 'worldbook-core',
      priority: 20,
      enabled: true,
      includeInPrompt: true,
      reason: `当前世界书：${input.worldBook.manifest.name}`,
      content: buildWorldBookCore(input.worldBook),
    },
    {
      id: 'current-context',
      title: '当前叙事上下文',
      kind: 'current-context',
      priority: 30,
      enabled: true,
      includeInPrompt: true,
      reason: '高频加载：当前回合正文叙事需要。',
      content: input.narrativeContext,
    },
    {
      id: 'state-writer',
      title: '状态写入上下文',
      kind: 'state-writer',
      priority: 40,
      enabled: true,
      includeInPrompt: false,
      reason: '高频加载：状态写入模型需要 ID 和命令约束。',
      content: input.stateWriterContext,
    },
  ];

  return modules
    .sort((left, right) => left.priority - right.priority)
    .map((module) => ({
      ...module,
      estimatedTokens: estimatePromptTokens(module.content),
    }));
}

function buildStablePrefix(): string {
  return [
    '你是《乱世风云录》的叙事主持者。',
    '游戏以玩家个人经历为中心，系统服务于真实连续的乱世体验，不替玩家经营表格。',
    '叙事必须尊重当前状态、人物记忆、地点事实、世界书边界和玩家输入。',
    '状态变化必须通过结构化命令写入，并接受系统校验。',
  ].join('\n');
}

function buildWorldBookCore(worldBook: WorldBook): string {
  const ontology = worldBook.ontology;
  return [
    `世界书：${worldBook.manifest.name}`,
    `世界书ID：${worldBook.manifest.id}`,
    `来源：${worldBook.manifest.source}`,
    `简介：${worldBook.manifest.description ?? worldBook.lore}`,
    `地区层级：${ontology.regionLevels.join('、') || '未定义'}`,
    `势力类型：${ontology.factionTypes.join('、') || '未定义'}`,
    `角色类型：${ontology.actorRoleTypes.join('、') || '未定义'}`,
    `冲突类型：${ontology.conflictTypes.join('、') || '未定义'}`,
  ].join('\n');
}

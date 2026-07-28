import type { SuggestedAction } from '../types';
import type { LlmClient, LlmMessage, LlmTokenUsage } from '../llm/LlmClient';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import { compileCreativePromptMessages } from '../prompts/CreativePromptCompiler';
import type { TavernManagementSettings } from '../prompts/TavernPresetStore';
import { parseNarratorResponse } from '../turn/NarratorResponseParser';
import type {
  SealedEncounterResult,
  UnsealedCombatResult,
  UnsealedWarResult,
} from './EncounterContracts';

export interface CombatNarrativePromptInput {
  result: SealedEncounterResult<UnsealedCombatResult>;
  encounterReason: string;
  locationLabel: string;
  participantNames: Record<string, string>;
  recentNarratives: string[];
  persistentPromptGuide?: string;
  tavernSettings?: TavernManagementSettings;
}

export interface GenerateCombatNarrativeInput {
  config: ApiConfigArchive;
  client: LlmClient;
  prompt: CombatNarrativePromptInput;
  signal?: AbortSignal;
  onContentDelta?: (delta: string) => void;
}

export interface GeneratedCombatNarrative {
  narrativeText: string;
  suggestedActions: SuggestedAction[];
  provider: string;
  model: string;
  usage?: LlmTokenUsage;
  rawResponse: string;
}

export interface WarNarrativePromptInput {
  result: SealedEncounterResult<UnsealedWarResult>;
  encounterReason: string;
  locationLabel: string;
  forceNames: Record<string, string>;
  commanderNames: Record<string, string>;
  recentNarratives: string[];
  persistentPromptGuide?: string;
  tavernSettings?: TavernManagementSettings;
}

export interface GenerateWarNarrativeInput {
  config: ApiConfigArchive;
  client: LlmClient;
  prompt: WarNarrativePromptInput;
  signal?: AbortSignal;
  onContentDelta?: (delta: string) => void;
}

export type GeneratedWarNarrative = GeneratedCombatNarrative;

function describeActionLog(input: CombatNarrativePromptInput): Array<Record<string, unknown>> {
  return input.result.actionLog.map((entry) => ({
    sequence: entry.sequence,
    actor: input.participantNames[entry.actorId] ?? entry.actorId,
    targets: entry.targetIds.map((targetId) => input.participantNames[targetId] ?? targetId),
    actionType: entry.actionType,
    summaryKey: entry.summaryKey,
    values: entry.values,
  }));
}

export function buildCombatNarrativeMessages(input: CombatNarrativePromptInput): LlmMessage[] {
  const systemPrompt = [
        '你是乱世风云录 V2 的战后叙事员。',
        '本地 Combat Engine 给出的封存战果是本回合战斗唯一事实源。',
        '你只负责把行动日志写成连贯、生动、符合人物身份的中文正文。',
        '不得修改胜负、生命、体力、倒地、死亡、俘虏、撤退、战利品、行动顺序或耗时。',
        '不得重新掷骰、重新判定，也不得输出 statePatches、writeback、upsertCombatRecord 或工程说明。',
        '正文使用【旁白】与【角色名】分段；不要把每个数值机械复述给玩家。',
        '只返回 JSON：{"narrativeText":"...","suggestedActions":[{"label":"...","description":"...","actionType":"..."}]}。',
      ].join('\n');
  const runtimeUserMessage = [
        `冲突缘由：${input.encounterReason}`,
        `地点：${input.locationLabel}`,
        `战果哈希：${input.result.resultHash}`,
        '参战人物：',
        JSON.stringify(input.participantNames, null, 2),
        '最近正文（仅用于承接语气，不得覆盖战果）：',
        input.recentNarratives.slice(-3).join('\n\n') || '无',
        input.persistentPromptGuide?.trim() || '',
        '封存战果：',
        JSON.stringify({
          outcome: input.result.outcome,
          elapsedMinutes: input.result.elapsedMinutes,
          combatants: input.result.combatants,
          experienceAward: input.result.experienceAward,
          lootItemIds: input.result.lootItemIds,
          capturedEquipmentItemIds: input.result.capturedEquipmentItemIds,
          actionLog: describeActionLog(input),
        }, null, 2),
      ].join('\n');
  return compileCreativePromptMessages({
    systemPrompt,
    runtimeUserMessage,
    scope: 'encounter',
    settings: input.tavernSettings,
  }).messages;
}

export async function generateCombatNarrative(
  input: GenerateCombatNarrativeInput,
): Promise<GeneratedCombatNarrative> {
  const generated = await input.client.generate({
    config: input.config,
    messages: buildCombatNarrativeMessages(input.prompt),
    responseFormat: 'json_object',
    temperature: Math.min(input.config.temperature ?? 0.8, 0.9),
    maxOutputTokens: input.config.maxOutputTokens,
    timeoutMs: 180_000,
    retryCount: 2,
    retryDelayMs: 1_500,
    signal: input.signal,
    onContentDelta: input.onContentDelta,
  });
  const parsed = parseNarratorResponse(generated.content);
  if (!parsed.narrativeText.trim()) throw new Error('战后叙事 API 没有返回正文。');
  return {
    narrativeText: parsed.narrativeText,
    suggestedActions: parsed.suggestedActions,
    provider: generated.provider,
    model: generated.model,
    usage: generated.usage,
    rawResponse: generated.content,
  };
}

function describeWarActionLog(input: WarNarrativePromptInput): Array<Record<string, unknown>> {
  return input.result.actionLog.map((entry) => ({
    sequence: entry.sequence,
    actor: input.forceNames[entry.actorId]
      ?? input.commanderNames[entry.actorId]
      ?? entry.actorId,
    targets: entry.targetIds.map((targetId) => (
      input.forceNames[targetId] ?? input.commanderNames[targetId] ?? targetId
    )),
    actionType: entry.actionType,
    summaryKey: entry.summaryKey,
    values: entry.values,
  }));
}

export function buildWarNarrativeMessages(input: WarNarrativePromptInput): LlmMessage[] {
  const systemPrompt = [
        '你是乱世风云录 V2 的战后叙事员。',
        '本地 War Engine 给出的封存战果是本回合战争唯一事实源。',
        '你只负责把逐轮行动日志写成连贯、生动、符合主将与部队身份的中文正文。',
        '不得修改胜负、目标是否达成、伤亡、俘虏、士气、补给、疲劳、溃散、投降、撤退、追击、领地结果、行动顺序或耗时。',
        '不得重新掷骰、重新判定，也不得输出 statePatches、writeback、upsertConflictRecord 或工程说明。',
        '正文使用【旁白】与【角色名】分段；表现战场变化，但不要逐项机械复述数值。',
        '只返回 JSON：{"narrativeText":"...","suggestedActions":[{"label":"...","description":"...","actionType":"..."}]}。',
      ].join('\n');
  const runtimeUserMessage = [
        `战争缘由：${input.encounterReason}`,
        `地点：${input.locationLabel}`,
        `战果哈希：${input.result.resultHash}`,
        `战争目标：${input.result.objective}`,
        `目标达成：${input.result.objectiveAchieved ? '是' : '否'}`,
        '部队名称：',
        JSON.stringify(input.forceNames, null, 2),
        '主将名称：',
        JSON.stringify(input.commanderNames, null, 2),
        '最近正文（仅用于承接语气，不得覆盖战果）：',
        input.recentNarratives.slice(-3).join('\n\n') || '无',
        input.persistentPromptGuide?.trim() || '',
        '封存战果：',
        JSON.stringify({
          outcome: input.result.outcome,
          elapsedMinutes: input.result.elapsedMinutes,
          objective: input.result.objective,
          objectiveAchieved: input.result.objectiveAchieved,
          exitReason: input.result.exitReason,
          roundsCompleted: input.result.roundsCompleted,
          forces: input.result.forces,
          pursuit: input.result.pursuit,
          commanders: input.result.commanders,
          actionLog: describeWarActionLog(input),
        }, null, 2),
      ].join('\n');
  return compileCreativePromptMessages({
    systemPrompt,
    runtimeUserMessage,
    scope: 'encounter',
    settings: input.tavernSettings,
  }).messages;
}

export async function generateWarNarrative(
  input: GenerateWarNarrativeInput,
): Promise<GeneratedWarNarrative> {
  const generated = await input.client.generate({
    config: input.config,
    messages: buildWarNarrativeMessages(input.prompt),
    responseFormat: 'json_object',
    temperature: Math.min(input.config.temperature ?? 0.8, 0.9),
    maxOutputTokens: input.config.maxOutputTokens,
    timeoutMs: 180_000,
    retryCount: 2,
    retryDelayMs: 1_500,
    signal: input.signal,
    onContentDelta: input.onContentDelta,
  });
  const parsed = parseNarratorResponse(generated.content);
  if (!parsed.narrativeText.trim()) throw new Error('战后叙事 API 没有返回正文。');
  return {
    narrativeText: parsed.narrativeText,
    suggestedActions: parsed.suggestedActions,
    provider: generated.provider,
    model: generated.model,
    usage: generated.usage,
    rawResponse: generated.content,
  };
}

import type {
  HoldingLedgerEntry,
  OpeningCrisisTemplate,
  PatchValidationResult,
  RuntimeState,
  StartBookmark,
  StatePatch,
  TimelineAnchor,
  WorldBook,
} from '../types';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import {
  resolveApiConfigForTaskAsync,
  resolveExplicitApiConfigForTaskAsync,
} from '../settings/ApiConfigManager';
import type { LlmClient } from '../llm/LlmClient';
import {
  extractLuanShiCommandFromPatch,
  normalizeLuanShiCommandPatch,
} from './LuanShiCommandPatch';
import { parseNarratorResponse } from './NarratorResponseParser';
import { composePrompt } from './PromptComposer';
import { prepareStatePatchTransaction } from './TurnOrchestrator';
import { resolveCurrentTimelineAnchors } from '../worldbook/WorldSnapshotResolver';
import {
  getMinimumHoldingCivilScaleLevelForValues,
  resolveHoldingCivilScaleLevel,
} from '../holdings/HoldingCapacityPolicy';
import { resolveHoldingCivilAdministrationScope } from '../holdings/HoldingCivilAdministration';

export const DEVELOPER_COMMAND_PREFIX = '/dev';
export const DEVELOPER_COMMAND_USAGE = '用法：/dev 要修正的事实，例如 /dev 左参第二曲的主将应该是赵云';

export type DeveloperCommandParseResult =
  | { kind: 'normal' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'developer'; fact: string };

export interface DeveloperFactOverrideInput {
  worldBook: WorldBook;
  runtimeState: RuntimeState;
  fact: string;
  bookmark?: StartBookmark;
  timelineAnchors?: TimelineAnchor[];
  crisis?: OpeningCrisisTemplate;
  llmClient: LlmClient;
  signal?: AbortSignal;
  resolvePrimaryConfig?: () => Promise<ApiConfigArchive | null>;
  resolveFallbackConfig?: () => Promise<ApiConfigArchive | null>;
}

export type DeveloperFactOverrideResult =
  | {
      ok: true;
      changed: boolean;
      state: RuntimeState;
      summary: string;
      patches: StatePatch[];
      validation: PatchValidationResult | null;
      usedFallback: boolean;
    }
  | {
      ok: false;
      reason: string;
      validation?: PatchValidationResult | null;
    };

const DEVELOPER_WRITEBACK_TIMEOUT_MS = 120_000;
const FORBIDDEN_DEVELOPER_COMMAND_ACTIONS = new Set([
  'pushNpcMemory',
  'recordTurnEvent',
]);

export function parseDeveloperCommandInput(input: string): DeveloperCommandParseResult {
  const trimmedStart = input.trimStart();
  if (!/^\/dev/i.test(trimmedStart)) return { kind: 'normal' };
  if (!/^\/dev(?:\s|$)/i.test(trimmedStart)) {
    return { kind: 'invalid', reason: `开发者命令前缀后必须有空格。${DEVELOPER_COMMAND_USAGE}` };
  }

  const fact = trimmedStart.slice(DEVELOPER_COMMAND_PREFIX.length).trim();
  if (!fact) return { kind: 'invalid', reason: DEVELOPER_COMMAND_USAGE };
  return { kind: 'developer', fact };
}

export async function executeDeveloperFactOverride(
  input: DeveloperFactOverrideInput,
): Promise<DeveloperFactOverrideResult> {
  const primaryConfig = await (input.resolvePrimaryConfig ?? (() => resolveApiConfigForTaskAsync('stateWriteback')))();
  if (!primaryConfig) {
    return { ok: false, reason: '没有可用的状态写回 API。请先在 API 设置中配置主剧情或状态写回 API。' };
  }

  const fallbackConfig = await (input.resolveFallbackConfig
    ?? (() => resolveExplicitApiConfigForTaskAsync('stateWritebackFallback')))();
  const configs = [primaryConfig];
  if (fallbackConfig && !isSameResolvedConfig(primaryConfig, fallbackConfig)) configs.push(fallbackConfig);

  const prompt = composePrompt(
    input.worldBook,
    input.bookmark,
    input.timelineAnchors ?? resolveCurrentTimelineAnchors(input.worldBook, input.runtimeState.currentDate),
    input.crisis,
    input.runtimeState,
    `${DEVELOPER_COMMAND_PREFIX} ${input.fact}`,
  );
  const systemPrompt = buildDeveloperFactSystemPrompt();
  const userPrompt = buildDeveloperFactUserPrompt(input.fact, input.runtimeState, prompt.stateWriterContext);
  let lastFailure = '状态写回 API 未返回可应用的结构化修改。';
  let lastValidation: PatchValidationResult | null | undefined;

  for (let index = 0; index < configs.length; index += 1) {
    try {
      const generated = await input.llmClient.generate({
        config: configs[index],
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
        maxOutputTokens: Math.min(configs[index].maxOutputTokens ?? 8_192, 8_192),
        responseFormat: 'json_object',
        timeoutMs: DEVELOPER_WRITEBACK_TIMEOUT_MS,
        retryCount: 0,
        signal: input.signal,
      });
      const response = parseNarratorResponse(generated.content);
      const rawPatches = response.statePatches?.length
        ? response.statePatches
        : response.statePatch
          ? [response.statePatch]
          : [];
      const patches = promoteDeveloperHoldingCivilScales(rawPatches, input.runtimeState);
      const forbiddenReason = findForbiddenDeveloperOutput(response, patches);
      if (forbiddenReason) {
        lastFailure = forbiddenReason;
        continue;
      }
      if (patches.length === 0) {
        lastFailure = cleanSummary(response.narrativeText)
          || '模型没有返回任何结构化修改；目标可能含糊、实体不存在或字段不受支持。';
        continue;
      }

      const prepared = prepareStatePatchTransaction(
        patches,
        input.worldBook,
        input.runtimeState,
        {},
        undefined,
        false,
      );
      lastValidation = prepared.patchValidation;
      if (!prepared.patchValidation?.valid || prepared.invalidPatchNotes.length > 0) {
        lastFailure = prepared.invalidPatchNotes.join('；')
          || prepared.patchValidation?.errors.join('；')
          || '结构化修改未通过本地校验。';
        continue;
      }

      const changed = !areStatesEqual(input.runtimeState, prepared.statePatchDraft);
      return {
        ok: true,
        changed,
        state: changed ? prepared.statePatchDraft : input.runtimeState,
        summary: cleanSummary(response.narrativeText)
          || (changed ? `已按开发者事实修正 ${prepared.statePatches.length} 项状态。` : '当前状态已经符合该事实，无需修改。'),
        patches: prepared.statePatches,
        validation: prepared.patchValidation,
        usedFallback: index > 0,
      };
    } catch (error) {
      if (input.signal?.aborted) throw error;
      lastFailure = error instanceof Error ? error.message : '状态写回 API 请求失败。';
    }
  }

  return { ok: false, reason: lastFailure, validation: lastValidation };
}

function buildDeveloperFactSystemPrompt(): string {
  return [
    '你是《乱世风云录》的开发者事实纠错器，只负责把一条已获授权的事实翻译为最小结构化状态补丁。',
    '这不是叙事请求。不得生成剧情、对话、判定、建议行动、时间推进、记忆、纪事、NPC 模拟、世界演化或 Encounter。',
    '开发者明确给出的事实具有最高事实权限，可绕过普通玩家主张的剧情证据门禁；除此之外的事实一律不得顺带修改。',
    '必须复用当前存档中的稳定 ID、既有单位和实体类型。不得按名称臆造 ID，不得创建目标未明确要求的新实体。',
    '如果同名目标不唯一、目标不存在、所需字段无法从当前状态确定、命令含义不明确或现有合同不支持，返回空 statePatches 并在 narrativeText 简短说明原因。',
    '仍须遵守 Schema、必填字段、数值单位、实体生命周期、引用完整性与局部更新合同。对既有实体只提交完成该事实所需的最小字段。',
    '纠正既有领地时，合同要求重复的完整字段必须逐字复制当前值；除开发者事实明确点名的字段外，不得顺带改变类型、状态、据点/城防 scaleLevel、民政范围、评分或归属。田亩、编户超过旧民政容量时不要推高 scaleLevel，本地会依法提升独立的 civilScaleLevel。',
    '只返回 JSON 对象：{"narrativeText":"一句简短的纠错结果或拒绝原因","suggestedActions":[],"ordinaryChecks":[],"statePatches":[],"statePatch":null}。',
    '禁止返回 writeback；禁止 Markdown；禁止在 narrativeText 中续写剧情。',
  ].join('\n');
}

/**
 * /dev 已被授权用于纠正真实账面值。若唯一阻碍只是旧档民政规模过小，
 * 在仍受类型绝对上限约束的前提下同步提升到能容纳事实的最小等级。
 */
function promoteDeveloperHoldingCivilScales(
  patches: StatePatch[],
  runtimeState: RuntimeState,
): StatePatch[] {
  return patches.map((rawPatch) => {
    const patch = normalizeLuanShiCommandPatch(rawPatch);
    const command = extractLuanShiCommandFromPatch(patch);
    if (command?.action !== 'upsertHoldingLedger') return patch;

    const previous = findDeveloperHolding(runtimeState.holdings ?? [], command);
    const target = {
      ...(previous ?? {}),
      ...command,
    } as HoldingLedgerEntry;
    const scope = command.civilAdministrationScope
      ?? previous?.civilAdministrationScope
      ?? resolveHoldingCivilAdministrationScope(target);
    if (scope === 'none') return patch;

    const baseline = resolveHoldingCivilScaleLevel({
      ...target,
      farmlandMu: undefined,
      registeredHouseholds: undefined,
    }, scope);
    const minimum = getMinimumHoldingCivilScaleLevelForValues(target, scope, baseline);
    if (minimum === undefined || (target.civilScaleLevel ?? 0) >= minimum) return patch;

    return {
      ...patch,
      type: 'luanshiCommand',
      payload: {
        command: {
          ...command,
          civilScaleLevel: minimum,
        },
      },
    } as StatePatch;
  });
}

function findDeveloperHolding(
  holdings: HoldingLedgerEntry[],
  command: Extract<ReturnType<typeof extractLuanShiCommandFromPatch>, { action: 'upsertHoldingLedger' }>,
): HoldingLedgerEntry | undefined {
  const holdingId = command.holdingId?.trim();
  if (holdingId) {
    const exact = holdings.find((holding) => holding.holdingId === holdingId);
    if (exact) return exact;
  }
  const locationId = command.locationId?.trim();
  if (locationId) {
    const byLocation = holdings.find((holding) => holding.locationId === locationId);
    if (byLocation) return byLocation;
  }
  const name = command.name?.trim();
  return name
    ? holdings.find((holding) => holding.name === name && holding.type === command.type)
    : undefined;
}

function buildDeveloperFactUserPrompt(
  fact: string,
  runtimeState: RuntimeState,
  stateWriterContext: string,
): string {
  return [
    '## 已授权开发者事实',
    fact,
    '',
    '## 当前纠错边界',
    `当前游戏时间：${runtimeState.currentDate} ${runtimeState.currentTime}`,
    `当前地点稳定 ID：${runtimeState.currentLocationId}`,
    '只修正上面的明确事实；不要推进时间，不要制造取得过程或补写历史。',
    '若纠正田亩或编户，保持既有 scaleLevel 原值；它是据点/城防规模，不是民政容量。civilScaleLevel 的必要提升由本地处理。',
    '',
    '## 当前状态与结构化写回合同',
    stateWriterContext,
  ].join('\n');
}

function findForbiddenDeveloperOutput(
  response: ReturnType<typeof parseNarratorResponse>,
  patches: StatePatch[],
): string | null {
  if (response.writeback) return '开发者纠错响应包含了禁止的后台写回结构，已拒绝应用。';
  if ((response.ordinaryChecks?.length ?? 0) > 0) return '开发者纠错响应包含了判定，已拒绝应用。';
  for (const patch of patches) {
    if (patch.type === 'timeAdvance') return '开发者纠错不得推进游戏时间。';
    const command = extractLuanShiCommandFromPatch(patch);
    if (command && FORBIDDEN_DEVELOPER_COMMAND_ACTIONS.has(command.action)) {
      return `开发者纠错不得写入 ${command.action}。`;
    }
  }
  return null;
}

function isSameResolvedConfig(left: ApiConfigArchive, right: ApiConfigArchive): boolean {
  return left.id === right.id && left.model === right.model;
}

function cleanSummary(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized === '模型没有返回可展示的正文。' ? '' : normalized.slice(0, 240);
}

function areStatesEqual(left: RuntimeState, right: RuntimeState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

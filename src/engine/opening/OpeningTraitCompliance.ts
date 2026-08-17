import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import type { LlmClient, LlmMessage, LlmTokenUsage } from '../llm/LlmClient';
import type {
  CharacterTrait,
  CharacterTraitRarity,
  RuntimeState,
  StatePatch,
  WorldBook,
} from '../types';
import type { PlayerTraitsUpdateCommand } from '../state/luanshiCommands';
import { applyLuanShiCommand } from '../state/luanshiReducers';
import { normalizeCharacterTraitRarity } from '../character/TraitRarity';
import { extractLuanShiCommandFromPatch } from '../turn/LuanShiCommandPatch';
import { validatePatch } from '../turn/StatePatchValidator';

const OPENING_TRAIT_REPAIR_TIMEOUT_MS = 60_000;

interface OpeningTraitResolutionRoute {
  config: ApiConfigArchive;
  client: LlmClient;
  label: string;
}

export interface OpeningTraitComplianceResult {
  state: RuntimeState;
  appliedPatches: StatePatch[];
  notes: string[];
  usage?: LlmTokenUsage;
  rawContent?: string;
}

interface ReconcileOpeningTraitComplianceInput {
  worldBook: WorldBook;
  initialState: RuntimeState;
  openingState: RuntimeState;
  openingNarrativeText: string;
  openingStatePatches: StatePatch[];
  mainApiConfig: ApiConfigArchive;
  mainLlmClient: LlmClient;
  stateWritebackApiConfig?: ApiConfigArchive | null;
  stateWritebackLlmClient?: LlmClient;
  stateWritebackFallbackApiConfig?: ApiConfigArchive | null;
  stateWritebackFallbackLlmClient?: LlmClient;
  signal?: AbortSignal;
}

export async function reconcileOpeningTraitCompliance(
  input: ReconcileOpeningTraitComplianceInput,
): Promise<OpeningTraitComplianceResult> {
  input.signal?.throwIfAborted();
  const initialTraits = (input.initialState.player.traits ?? []).map(cloneTrait);
  if (initialTraits.length === 0) {
    return {
      state: cloneRuntimeState(input.openingState),
      appliedPatches: [],
      notes: [],
    };
  }

  const openingTraitsById = new Map(
    (input.openingState.player.traits ?? []).map((trait) => [trait.id, trait]),
  );
  const patchTraitsById = collectOpeningTraitCandidates(input.openingStatePatches);
  const resolvedRarities = new Map<string, CharacterTraitRarity>();
  const pendingTraits: CharacterTrait[] = [];
  let recoveredFromOpeningPatch = 0;

  for (const trait of initialTraits) {
    const stableRarity = normalizeCharacterTraitRarity(trait.rarity);
    if (stableRarity) {
      resolvedRarities.set(trait.id, stableRarity);
      continue;
    }

    const openingRarity = normalizeCharacterTraitRarity(openingTraitsById.get(trait.id)?.rarity);
    const patchRarity = normalizeCharacterTraitRarity(patchTraitsById.get(trait.id)?.rarity);
    const resolvedRarity = openingRarity ?? patchRarity;
    if (resolvedRarity) {
      resolvedRarities.set(trait.id, resolvedRarity);
      if (!openingRarity && patchRarity) recoveredFromOpeningPatch += 1;
      continue;
    }

    if (isCustomTrait(trait)) {
      pendingTraits.push(trait);
    } else {
      resolvedRarities.set(trait.id, 'white');
    }
  }

  let usage: LlmTokenUsage | undefined;
  let rawContent: string | undefined;
  let repairRouteLabel: string | undefined;
  if (pendingTraits.length > 0) {
    const repair = await resolvePendingTraitRarities(input, pendingTraits);
    usage = repair.usage;
    rawContent = repair.rawContent;
    repairRouteLabel = repair.routeLabel;
    for (const [traitId, rarity] of repair.rarities) {
      resolvedRarities.set(traitId, rarity);
    }
  }

  const unresolvedTraits = initialTraits.filter((trait) => !resolvedRarities.has(trait.id));
  if (unresolvedTraits.length > 0) {
    throw new Error(
      `开局特质品级判定未完成：${unresolvedTraits.map((trait) => trait.label).join('、')}。`
      + '开场正文尚未保存，请重试或检查状态写回 API。',
    );
  }

  const resolvedTraits = initialTraits.map((trait) => ({
    ...trait,
    rarity: resolvedRarities.get(trait.id) as CharacterTraitRarity,
  }));
  const command: PlayerTraitsUpdateCommand = {
    action: 'updatePlayerTraits',
    characterId: input.initialState.player.id,
    characterName: input.initialState.player.name,
    traits: resolvedTraits,
    summary: '开局特质品级已独立核验并写入稳定档案。',
  };
  const patch: StatePatch = {
    type: 'luanshiCommand',
    payload: { command },
    reason: '开局特质品级独立合规写回。',
  };
  const validation = validatePatch(
    patch,
    input.worldBook,
    input.openingState.activeQuests.map((quest) => quest.id),
    input.openingState,
  );
  if (!validation.valid) {
    throw new Error(`开局特质独立写回未通过校验：${validation.errors.join('；')}`);
  }

  const notes = ['开局特质品级已独立核验，未受其他状态补丁成败影响'];
  if (recoveredFromOpeningPatch > 0) {
    notes.push(`从本次开局候选中恢复品级x${recoveredFromOpeningPatch}`);
  }
  if (repairRouteLabel) {
    notes.push(`补充判级使用${repairRouteLabel}`);
  }

  return {
    state: applyLuanShiCommand(cloneRuntimeState(input.openingState), command),
    appliedPatches: [patch],
    notes,
    usage,
    rawContent,
  };
}

function collectOpeningTraitCandidates(patches: StatePatch[]): Map<string, CharacterTrait> {
  const traitsById = new Map<string, CharacterTrait>();
  for (const patch of patches) {
    const command = extractLuanShiCommandFromPatch(patch);
    if (command?.action !== 'updatePlayerTraits' || !Array.isArray(command.traits)) continue;
    for (const trait of command.traits) {
      if (!trait || typeof trait.id !== 'string' || trait.id.trim().length === 0) continue;
      traitsById.set(trait.id, trait);
    }
  }
  return traitsById;
}

async function resolvePendingTraitRarities(
  input: ReconcileOpeningTraitComplianceInput,
  pendingTraits: CharacterTrait[],
): Promise<{
  rarities: Map<string, CharacterTraitRarity>;
  usage?: LlmTokenUsage;
  rawContent?: string;
  routeLabel?: string;
}> {
  const routes = buildResolutionRoutes(input);
  let lastError: unknown;

  for (const route of routes) {
    try {
      const result = await route.client.generate({
        config: route.config,
        messages: buildTraitResolutionMessages(input, pendingTraits),
        temperature: 0,
        maxOutputTokens: 1024,
        responseFormat: 'json_object',
        timeoutMs: OPENING_TRAIT_REPAIR_TIMEOUT_MS,
        retryCount: 0,
        signal: input.signal,
      });
      input.signal?.throwIfAborted();
      const rarities = parseTraitResolution(result.content, pendingTraits);
      if (rarities.size === pendingTraits.length) {
        return {
          rarities,
          usage: result.usage,
          rawContent: result.content,
          routeLabel: route.label,
        };
      }
      lastError = new Error('返回结果没有覆盖全部待判特质。');
    } catch (error) {
      input.signal?.throwIfAborted();
      lastError = error;
    }
  }

  throw new Error(
    `开局特质品级补充判定失败：${lastError instanceof Error ? lastError.message : 'API 未返回合法结果'}`,
  );
}

function buildResolutionRoutes(input: ReconcileOpeningTraitComplianceInput): OpeningTraitResolutionRoute[] {
  const primaryConfig = input.stateWritebackApiConfig ?? input.mainApiConfig;
  const primaryClient = input.stateWritebackApiConfig
    ? input.stateWritebackLlmClient ?? input.mainLlmClient
    : input.mainLlmClient;
  const routes: OpeningTraitResolutionRoute[] = [{
    config: primaryConfig,
    client: primaryClient,
    label: input.stateWritebackApiConfig ? '状态写回主要 API' : '主剧情 API',
  }];

  const fallbackConfig = input.stateWritebackFallbackApiConfig;
  if (
    fallbackConfig
    && input.stateWritebackFallbackLlmClient
    && apiConfigIdentity(fallbackConfig) !== apiConfigIdentity(primaryConfig)
  ) {
    routes.push({
      config: fallbackConfig,
      client: input.stateWritebackFallbackLlmClient,
      label: '状态写回备用 API',
    });
  }
  return routes;
}

function buildTraitResolutionMessages(
  input: ReconcileOpeningTraitComplianceInput,
  pendingTraits: CharacterTrait[],
): LlmMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是乱世风云录的开局特质品级核验器。只返回 JSON 对象，不写 Markdown、解释或正文。',
        '只允许返回 {"traits":[{"id":"稳定特质ID","rarity":"white|green|blue|purple|orange|red"}]}。',
        '六档依次为普通、良好、精良、珍贵、传说、绝世，red 最高。',
        '根据特质原始描述、世界设定、开局处境以及开场正文实际采用的强度判级；正文若已经采用压倒性、传说或绝世级解释，存档品级不得无故降为普通。',
        '不得改名、改描述、增删特质或输出其他状态字段。每个给定 id 必须恰好返回一次。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `世界：${input.worldBook.manifest.name}`,
        `时间：${input.openingState.currentDate}`,
        `地点：${input.openingState.currentLocationId}`,
        `主角：${input.initialState.player.name} / ${input.initialState.player.currentIdentity}`,
        '待判自定义特质：',
        JSON.stringify(pendingTraits.map((trait) => ({
          id: trait.id,
          label: trait.label,
          description: trait.description,
          promptHint: trait.promptHint,
        }))),
        '开场正文：',
        input.openingNarrativeText,
      ].join('\n'),
    },
  ];
}

function parseTraitResolution(
  rawContent: string,
  pendingTraits: CharacterTrait[],
): Map<string, CharacterTraitRarity> {
  const allowedIds = new Set(pendingTraits.map((trait) => trait.id));
  const parsed = JSON.parse(stripJsonFence(rawContent)) as { traits?: unknown };
  const entries = Array.isArray(parsed.traits) ? parsed.traits : [];
  const rarities = new Map<string, CharacterTraitRarity>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const rarity = normalizeCharacterTraitRarity(record.rarity);
    if (!allowedIds.has(id) || !rarity || rarities.has(id)) continue;
    rarities.set(id, rarity);
  }
  return rarities;
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function apiConfigIdentity(config: ApiConfigArchive): string {
  return [config.provider, config.baseUrl, config.model, config.apiKey].join('\u0000');
}

function isCustomTrait(trait: CharacterTrait): boolean {
  return trait.source === 'custom' || trait.id.startsWith('custom_trait_');
}

function cloneTrait(trait: CharacterTrait): CharacterTrait {
  return {
    ...trait,
    ...(trait.checkHooks ? { checkHooks: trait.checkHooks.map((hook) => ({ ...hook })) } : {}),
  };
}

function cloneRuntimeState(state: RuntimeState): RuntimeState {
  return JSON.parse(JSON.stringify(state)) as RuntimeState;
}

import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import { LlmEmptyContentError, type LlmClient, type LlmMessage, type LlmTokenUsage } from '../llm/LlmClient';
import type { RuntimeState, StatePatch, WorldBook } from '../types';
import type { LuanShiCommand } from '../state/luanshiCommands';
import { applyLuanShiCommand } from '../state/luanshiReducers';
import { extractLuanShiCommandFromPatch } from '../turn/LuanShiCommandPatch';
import { validatePatch } from '../turn/StatePatchValidator';

type OpeningLedgerGapKind = 'privateAsset' | 'holding';

interface OpeningLedgerGap {
  kind: OpeningLedgerGapKind;
  reason: string;
  evidence: string[];
}

export interface OpeningLedgerComplianceResult {
  state: RuntimeState;
  appliedPatches: StatePatch[];
  notes: string[];
  usage?: LlmTokenUsage;
  rawContent?: string;
}

interface ReconcileOpeningLedgerComplianceInput {
  worldBook: WorldBook;
  initialState: RuntimeState;
  openingState: RuntimeState;
  openingNarrativeText: string;
  apiConfig: ApiConfigArchive;
  llmClient: LlmClient;
  signal?: AbortSignal;
}

const LEDGER_REPAIR_ACTIONS = new Set<LuanShiCommand['action']>([
  'upsertPrivateAsset',
  'upsertHoldingLedger',
]);

export async function reconcileOpeningLedgerCompliance(
  input: ReconcileOpeningLedgerComplianceInput,
): Promise<OpeningLedgerComplianceResult> {
  input.signal?.throwIfAborted();
  let state = cloneRuntimeState(input.openingState);
  const notes: string[] = [];
  const appliedPatches: StatePatch[] = [];

  const sanitized = sanitizeOpeningLedgerState({
    initialState: input.initialState,
    openingState: state,
    openingNarrativeText: input.openingNarrativeText,
  });
  state = sanitized.state;
  notes.push(...sanitized.notes);

  const gaps = detectOpeningLedgerGaps({
    initialState: input.initialState,
    openingState: state,
    openingNarrativeText: input.openingNarrativeText,
  });

  if (gaps.length === 0) {
    return { state, appliedPatches, notes };
  }

  let repairResult: Awaited<ReturnType<LlmClient['generate']>>;
  try {
    repairResult = await input.llmClient.generate({
      config: input.apiConfig,
      messages: buildOpeningLedgerRepairMessages({
        initialState: input.initialState,
        openingState: state,
        openingNarrativeText: input.openingNarrativeText,
        gaps,
      }),
      temperature: 0,
      maxOutputTokens: input.apiConfig.maxOutputTokens,
      responseFormat: 'json_object',
      signal: input.signal,
    });
  } catch (error) {
    input.signal?.throwIfAborted();
    if (!(error instanceof LlmEmptyContentError)) throw error;
    notes.push('开局账本合规修复空响应，已保留开场；未补写可选账本');
    return {
      state,
      appliedPatches,
      notes,
      usage: error.usage,
    };
  }
  input.signal?.throwIfAborted();

  const knownQuestIds = state.activeQuests.map((quest) => quest.id);
  const repairPatches = parseRepairStatePatches(repairResult.content).filter(isOpeningLedgerRepairPatch);
  const rejectedNotes: string[] = [];

  for (const patch of repairPatches) {
    const validation = validatePatch(patch, input.worldBook, knownQuestIds, state);
    if (!validation.valid) {
      rejectedNotes.push(`${patch.type}: ${validation.errors.join('；')}`);
      continue;
    }

    const command = extractLuanShiCommandFromPatch(patch);
    if (!command || !LEDGER_REPAIR_ACTIONS.has(command.action)) continue;
    state = applyLuanShiCommand(state, command);
    appliedPatches.push(patch);
  }

  if (appliedPatches.length > 0) {
    notes.push(`开局账本合规修复：补写${formatAppliedLedgerPatchSummary(appliedPatches)}`);
  } else {
    notes.push('开局账本合规修复未返回可用账本补丁');
  }
  if (rejectedNotes.length > 0) {
    notes.push(`开局账本合规修复忽略无效补丁：${rejectedNotes.join('；')}`);
  }

  return {
    state,
    appliedPatches,
    notes,
    usage: repairResult.usage,
    rawContent: repairResult.content,
  };
}

function sanitizeOpeningLedgerState(input: {
  initialState: RuntimeState;
  openingState: RuntimeState;
  openingNarrativeText: string;
}): { state: RuntimeState; notes: string[] } {
  const state = cloneRuntimeState(input.openingState);
  state.holdings = state.holdings ?? [];
  state.privateAssets = state.privateAssets ?? [];
  const notes: string[] = [];
  const initialContext = buildInitialOpeningContext(input.initialState);
  const initialHoldings = input.initialState.holdings ?? [];

  if (initialHoldings.length === 0 && state.holdings.length > 0 && hasExplicitNoHoldingCue(initialContext)) {
    const removedCount = state.holdings.length;
    state.holdings = [];
    notes.push(`开局领地边界：移除不符合“无领地”开局的领地账本x${removedCount}`);
  }

  if (initialHoldings.length === 0 && state.holdings.length > 0) {
    const retainedHoldings: RuntimeState['holdings'] = [];
    let removedMilitaryOnlyHoldings = 0;
    for (const holding of state.holdings) {
      if (isMilitaryOnlyOpeningHolding(holding, input.openingNarrativeText, initialContext)) {
        removedMilitaryOnlyHoldings += 1;
      } else {
        retainedHoldings.push(holding);
      }
    }
    state.holdings = retainedHoldings;
    if (removedMilitaryOnlyHoldings > 0) {
      notes.push(`开局领地边界：移除仅表示军职或部队驻地的领地账本x${removedMilitaryOnlyHoldings}`);
    }
  }

  if (state.holdings.length > 0) {
    let strippedFields = 0;
    state.holdings = state.holdings.map((holding) => {
      const previous = initialHoldings.find((entry) => entry.holdingId === holding.holdingId);
      let nextHolding = holding;
      if (holding.localTreasury !== undefined && previous?.localTreasury === undefined) {
        const { localTreasury, ...rest } = nextHolding;
        nextHolding = rest;
        strippedFields += 1;
      }
      if (holding.localGranary !== undefined && previous?.localGranary === undefined) {
        const { localGranary, ...rest } = nextHolding;
        nextHolding = rest;
        strippedFields += 1;
      }

      return nextHolding;
    });

    if (strippedFields > 0) {
      notes.push(`开局府库粮仓边界：移除不再接受新写入的府库/粮仓精确数值x${strippedFields}`);
    }
  }

  return { state, notes };
}

function detectOpeningLedgerGaps(input: {
  initialState: RuntimeState;
  openingState: RuntimeState;
  openingNarrativeText: string;
}): OpeningLedgerGap[] {
  const initialContext = buildInitialOpeningContext(input.initialState);
  const openingPlayerContext = buildInitialOpeningContext(input.openingState);
  const combinedText = [
    initialContext,
    openingPlayerContext,
    input.openingNarrativeText,
  ].join('\n');
  const gaps: OpeningLedgerGap[] = [];

  if ((input.openingState.privateAssets?.length ?? 0) === 0 && hasPrivateAssetCue(combinedText) && !hasExplicitNoPrivateAssetCue(initialContext)) {
    gaps.push({
      kind: 'privateAsset',
      reason: '开局事实已明确私人庄园、田产、工坊、马场、铺面、私仓或佃户等私产，但未写入 privateAssets。',
      evidence: collectEvidenceLines(combinedText, PRIVATE_ASSET_EVIDENCE_PATTERNS),
    });
  }

  if ((input.openingState.holdings?.length ?? 0) === 0 && hasHoldingControlCue({
    initialContext,
    openingPlayerContext,
    openingNarrativeText: input.openingNarrativeText,
  })) {
    gaps.push({
      kind: 'holding',
      reason: '开局事实已明确主角实际掌管、临时控制或争夺具体城池、县邑、关隘或领地，但未写入 holdings。',
      evidence: collectEvidenceLines(combinedText, HOLDING_EVIDENCE_PATTERNS),
    });
  }

  return gaps;
}

function buildOpeningLedgerRepairMessages(input: {
  initialState: RuntimeState;
  openingState: RuntimeState;
  openingNarrativeText: string;
  gaps: OpeningLedgerGap[];
}): LlmMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是乱世风云录的开局领地/私产账本合规修复器。',
        '只返回一个 JSON 对象，不要输出 Markdown 或解释。',
        '不得输出 narrativeText，不得复制开局正文，不得输出 suggestedActions、ordinaryChecks、writeback 或非账本状态补丁。',
        '只允许在 statePatches 中补 type="luanshiCommand" 且 action 为 upsertPrivateAsset 或 upsertHoldingLedger 的缺失账本。',
        '不要硬编码具体历史人物、剧本、地点或势力结论；只能根据开局事实、正文、当前时间地点、主角身份和已有状态做保守补全。',
        '私人庄园、田产、工坊、马场、铺面、私仓、佃户等是 upsertPrivateAsset，不是 upsertHoldingLedger。',
        '补建私人产业必须使用 operation=create 并附 acquisition={kind:"opening",occurredAt,sourceRefId,summary}；玩家自称、夸耀或要求的夸张产业不是可信取得事实，无法保守确认时不得补建。',
        '只有实际掌管、临时控制、争夺、治理或失去具体城池、县邑、关隘、港口、村寨、领地时，才可 upsertHoldingLedger。',
        '军职、统兵、驻扎、守城、镇守、站上城墙、负责某段城防、军营、兵营、武库、库房、军械清点、斥候名册只表示人物在场、部队或军需上下文，不等于控制领地，也不得伪装成 controlEvidence。',
        '不得输出 localTreasury/localGranary；领地钱粮以资源账本为唯一真值。',
        '无法保守判断缺失账本时，返回空 statePatches。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `当前时间：${input.openingState.currentDate}`,
        `当前地点ID：${input.openingState.currentLocationId}`,
        `玩家：${formatPlayerProfile(input.openingState)}`,
        '',
        '开局额外要求与初始档案：',
        buildInitialOpeningContext(input.initialState),
        '',
        '已有领地账本：',
        formatExistingHoldingSummary(input.openingState),
        '',
        '已有私产账本：',
        formatExistingPrivateAssetSummary(input.openingState),
        '',
        '检测到的账本缺口：',
        formatOpeningLedgerGaps(input.gaps),
        '',
        '字段要求：',
        '- upsertPrivateAsset 必须包含 operation=create、privateAssetId/name/type/ownerScope/status/summary、acquisition={kind:"opening",occurredAt,sourceRefId,summary}；updatedAt 是引擎管理的技术时间戳，可省略；type 用 estate/farmland/workshop/ranch/shop/ferry/mine/other；ownerScope 用 personal/clan/household/retainer/faction；status 用 active/damaged/occupied/disputed/archived。初始规模必须保守，不得照抄玩家夸耀的万亩万户或自行宣称每日固定收益与库存。',
        '- upsertHoldingLedger 必须包含 operation=create、holdingId/name/type/status/summary/civilAdministrationScope/scaleLevel/agriculture/commerce/population/publicOrder/popularSupport/defense/recruitPotential/armory/horseSupply/updatedAt，并附 controlEvidence={kind:"opening",occurredAt,sourceRefId,summary}；households/territorial/mixed 还必须包含 corruption；civilAdministrationScope 只能用 none/households/territorial/mixed；新领地 type 只能用 county/city/fort/pass/camp/estate/port/village/other，county 是具体县城/县邑，州与郡国是区域父级，不得用 commandery 新建领地；status 只能用 controlled/contested/temporary/lost/archived；适用分数使用 0-100；city 最高 5 级，county/fort/pass/camp/port 最高 4 级，estate/other 最高 3 级，village 最高 2 级。',
        '- civilAdministrationScope=none 时六项民政评分必须为 0，且不得写 corruption/田亩/编户/豪强字段；腐败只表示税收、征收或经营收益损耗。households 时 agriculture=0 且不得写 farmlandMu；territorial/mixed 才可写全部民政字段。普通军营或纯设施通常是 none，明确管屯田和民户的屯田营才是 mixed；不得按名称机械猜测。',
        '- upsertHoldingLedger 在范围允许时可写 farmlandMu/registeredHouseholds/eliteControlledShare/localEliteRelation；不得写 localTreasury/localGranary。活动围城只写 siege 事实枚举。',
        '',
        '返回格式示例。只返回这个对象；禁止复制开局正文：',
        JSON.stringify({
          statePatches: [],
        }, null, 2),
        '',
        '开局正文只作为证据。不要复制正文，只据此补缺失账本：',
        input.openingNarrativeText,
      ].join('\n'),
    },
  ];
}

function parseRepairStatePatches(content: string): StatePatch[] {
  const parsed = parseJsonObject(content);
  if (!parsed) return [];

  const statePatches = Array.isArray(parsed.statePatches) ? parsed.statePatches : [];
  const patches = statePatches.map(parseRepairStatePatch).filter((patch): patch is StatePatch => Boolean(patch));
  const statePatch = parseRepairStatePatch(parsed.statePatch);
  return statePatch ? [...patches, statePatch] : patches;
}

function parseRepairStatePatch(value: unknown): StatePatch | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (
    value.type === 'luanshiCommand'
    && typeof value.action === 'string'
    && isRecord(value.payload)
    && !isRecord(value.payload.command)
  ) {
    return {
      type: 'luanshiCommand',
      payload: {
        command: normalizeRepairCommand({
          action: value.action,
          ...value.payload,
        }),
      },
      reason: typeof value.reason === 'string' ? value.reason : '开局账本合规修复',
    };
  }

  if (value.type === 'luanshiCommand' && isRecord(value.payload) && isRecord(value.payload.command)) {
    return {
      type: 'luanshiCommand',
      payload: {
        command: normalizeRepairCommand(value.payload.command),
      },
      reason: typeof value.reason === 'string' ? value.reason : '开局账本合规修复',
    };
  }

  return {
    type: value.type as StatePatch['type'],
    payload: isRecord(value.payload) ? value.payload : {},
    reason: typeof value.reason === 'string' ? value.reason : '开局账本合规修复',
  };
}

function normalizeRepairCommand(command: Record<string, unknown>): Record<string, unknown> {
  if (command.action !== 'upsertHoldingLedger') return command;

  const normalized: Record<string, unknown> = { ...command };
  if (normalized.status === 'active') {
    normalized.status = 'controlled';
  }
  if (
    normalized.type === 'province'
    || normalized.type === 'region'
    || normalized.type === 'state'
    || normalized.type === '州'
    || normalized.type === '大区'
  ) {
    normalized.type = 'other';
  }

  return normalized;
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  const jsonText = extractJsonText(content.trim());
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractJsonText(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? content).trim();
  if (!candidate) return null;
  if (candidate.startsWith('{') && candidate.endsWith('}')) return candidate;

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return candidate.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

function isOpeningLedgerRepairPatch(patch: StatePatch): boolean {
  const command = extractLuanShiCommandFromPatch(patch);
  return Boolean(command && LEDGER_REPAIR_ACTIONS.has(command.action));
}

function formatAppliedLedgerPatchSummary(patches: StatePatch[]): string {
  let privateAssets = 0;
  let holdings = 0;
  for (const patch of patches) {
    const command = extractLuanShiCommandFromPatch(patch);
    if (command?.action === 'upsertPrivateAsset') privateAssets += 1;
    if (command?.action === 'upsertHoldingLedger') holdings += 1;
  }
  return [
    privateAssets > 0 ? `私产x${privateAssets}` : '',
    holdings > 0 ? `领地x${holdings}` : '',
  ].filter(Boolean).join('、') || '无';
}

function buildInitialOpeningContext(state: RuntimeState): string {
  const player = state.player;
  return [
    `姓名：${player.name}`,
    `角色类型：${player.roleType}`,
    `出身：${player.birthOrigin ?? ''}`,
    `身份：${player.currentIdentity ?? player.summary ?? ''}`,
    `身份摘要：${player.identitySummary ?? ''}`,
    `所属势力：${player.factionName ?? ''}`,
    `效忠对象：${player.allegianceTarget ?? ''}`,
    `官职：${player.officeTitle ?? ''}`,
    `军职：${player.militaryTitle ?? ''}`,
    `爵位：${player.nobleTitle ?? ''}`,
    `开局额外要求：${typeof state.worldStateDelta.openingExtraRequest === 'string' ? state.worldStateDelta.openingExtraRequest : ''}`,
  ].filter(Boolean).join('\n');
}

function formatPlayerProfile(state: RuntimeState): string {
  const player = state.player;
  return [
    player.name,
    player.currentIdentity,
    player.officeTitle,
    player.militaryTitle,
    player.nobleTitle,
    player.factionName,
  ].filter(Boolean).join('；') || player.summary;
}

function formatExistingHoldingSummary(state: RuntimeState): string {
  const holdings = state.holdings ?? [];
  if (holdings.length === 0) return '- 当前无领地账本。';
  return holdings.map((holding) => (
    `- ${holding.holdingId}：${holding.name}；${holding.type}/${holding.status}；${holding.summary}`
  )).join('\n');
}

function formatExistingPrivateAssetSummary(state: RuntimeState): string {
  const privateAssets = state.privateAssets ?? [];
  if (privateAssets.length === 0) return '- 当前无私产账本。';
  return privateAssets.map((asset) => (
    `- ${asset.privateAssetId}：${asset.name}；${asset.type}/${asset.ownerScope}/${asset.status}；${asset.summary}`
  )).join('\n');
}

function formatOpeningLedgerGaps(gaps: OpeningLedgerGap[]): string {
  return gaps.map((gap) => [
    `- 类型：${gap.kind}`,
    `  原因：${gap.reason}`,
    `  证据：${gap.evidence.length > 0 ? gap.evidence.join(' / ') : '无可摘录短句，仅由身份或上下文触发。'}`,
  ].join('\n')).join('\n');
}

const PRIVATE_ASSET_EVIDENCE_PATTERNS = [
  /私产|庄园|田庄|田产|族田|家田|私仓|佃户|坞堡|工坊|马场|铺面|商铺|家业/g,
];

const HOLDING_EVIDENCE_PATTERNS = [
  /掌管|治理|实际控制|临时控制|争夺|领有|据有|封于|出镇|治所|辖有|接掌|到任|太守|刺史|州牧|县令|郡守|汉中王|都督/g,
];

function hasPrivateAssetCue(text: string): boolean {
  if (hasExplicitNoPrivateAssetCue(text)) return false;
  return /(私人|家族|宗族|祖传|自家|本家|家中|族中).{0,16}(庄园|田产|田庄|坞堡|私仓|工坊|马场|铺面|商铺|矿场|渡口|佃户)/.test(text)
    || /(私产|庄园|田庄|田产|族田|家田|私仓|佃户|坞堡|工坊|马场|铺面|商铺|家业)/.test(text);
}

function hasHoldingControlCue(input: {
  initialContext: string;
  openingPlayerContext: string;
  openingNarrativeText: string;
}): boolean {
  const playerContext = [
    input.initialContext,
    input.openingPlayerContext,
  ].join('\n');
  const combinedText = [
    playerContext,
    input.openingNarrativeText,
  ].join('\n');
  if (hasExplicitNoHoldingCue(combinedText)) return false;
  return hasPlayerTerritorialOfficeCue(playerContext)
    || hasNarrativeTerritorialGovernanceCue(input.openingNarrativeText);
}

function isMilitaryOnlyOpeningHolding(
  holding: NonNullable<RuntimeState['holdings']>[number],
  openingNarrativeText: string,
  initialContext: string,
): boolean {
  const evidenceText = [
    initialContext,
    openingNarrativeText,
    holding.name,
    holding.summary,
    holding.sourceNote,
    ...(holding.recentChanges ?? []),
  ].filter(Boolean).join('\n');

  if (hasTerritorialGovernanceCue(evidenceText)) return false;
  return holding.type === 'camp'
    || /(军职|军侯|司马|都尉|校尉|队率|屯长|统领|统率|率领|郡兵|士卒|戍卫|守卒|部队|军营|兵营|营地|武库|库房|军械|刀枪|弓弩|斥候)/.test(evidenceText);
}

function hasTerritorialGovernanceCue(text: string): boolean {
  return /(掌管|治理|实际控制|临时控制|争夺|领有|据有|封于|出镇|坐镇|辖有|接掌|到任).{0,24}(城|县|郡|州|关|寨|堡|领地|府库|粮仓|军府|郡府|县衙|港口|村寨|户口|田亩|赋税|政务)/.test(text)
    || /(太守|刺史|州牧|县令|郡守|汉中王|王府|都督|郡府主官|县衙主官)/.test(text);
}

function hasPlayerTerritorialOfficeCue(text: string): boolean {
  return /(身份|身份摘要|官职|爵位).{0,24}(太守|刺史|州牧|县令|郡守|汉中王|王府|都督|郡府主官|县衙主官)/.test(text);
}

function hasNarrativeTerritorialGovernanceCue(text: string): boolean {
  return /(主角|玩家|你|自己|本人).{0,24}(掌管|治理|实际控制|临时控制|争夺|领有|据有|封于|出镇|坐镇|辖有|接掌|到任).{0,24}(城|县|郡|州|关|寨|堡|领地|府库|粮仓|军府|郡府|县衙|港口|村寨|户口|田亩|赋税|政务)/.test(text);
}

function hasExplicitNoPrivateAssetCue(text: string): boolean {
  const matches = text.matchAll(/(无|没有|并无|未有|不曾有)(.{0,12})(庄园|田产|私产|田庄|私仓|家业|产业|铺面|商铺|马场|工坊|佃户)/g);
  for (const match of matches) {
    const middle = match[2] ?? '';
    if (!/(官职|官身|官位|官府|官方|印绶|虎符)/.test(middle)) return true;
  }
  return false;
}

function hasExplicitNoHoldingCue(text: string): boolean {
  return /(无|没有|并无|未有|不曾有).{0,16}(领地|城池|县邑|封地|地盘|治所|府库|粮仓|官方领地|自有城池)/.test(text)
    || /(寄寓|寄身|客将|流亡|逃亡|无官无地|无职无地)/.test(text);
}

function collectEvidenceLines(text: string, patterns: RegExp[]): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const evidence: string[] = [];

  for (const line of lines) {
    if (evidence.length >= 4) break;
    if (patterns.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(line);
    })) {
      evidence.push(line.slice(0, 120));
    }
  }

  return evidence;
}

function cloneRuntimeState(state: RuntimeState): RuntimeState {
  return JSON.parse(JSON.stringify(state)) as RuntimeState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

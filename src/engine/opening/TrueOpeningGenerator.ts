import type { ApiConfigArchive, ApiFeatureExecutionModes } from '../settings/ApiConfigManager';
import type { LlmClient } from '../llm/LlmClient';
import type { RuntimeState, TurnDisplayMeta, TurnProcessingStageEvent, WorldBook } from '../types';
import type { LlmTokenUsage } from '../llm/LlmClient';
import { resolvePromptTemplate } from '../prompts/PromptResolver';
import { buildNarrativeLengthGuidance } from '../prompts/NarrativeLengthGuidance';
import { executeTurn, type TurnResult } from '../turn/TurnOrchestrator';
import { reconcileOpeningLedgerCompliance } from './OpeningLedgerCompliance';
import { reconcileOpeningTraitCompliance } from './OpeningTraitCompliance';

export interface GenerateTrueOpeningOptions {
  apiConfig: ApiConfigArchive | null;
  featureExecutionModes?: ApiFeatureExecutionModes;
  stateWritebackApiConfig?: ApiConfigArchive | null;
  stateWritebackFallbackApiConfig?: ApiConfigArchive | null;
  npcCompletionApiConfig?: ApiConfigArchive | null;
  npcCompletionFallbackApiConfig?: ApiConfigArchive | null;
  llmClient: LlmClient;
  stateWritebackLlmClient?: LlmClient;
  stateWritebackFallbackLlmClient?: LlmClient;
  npcCompletionLlmClient?: LlmClient;
  npcCompletionFallbackLlmClient?: LlmClient;
  persistentPromptGuide?: string;
  onContentDelta?: (delta: string) => void;
  onContentReset?: () => void;
  onStageChange?: (event: TurnProcessingStageEvent) => void;
  signal?: AbortSignal;
}

export async function generateTrueOpening(
  worldBook: WorldBook,
  runtimeState: RuntimeState,
  options: GenerateTrueOpeningOptions,
): Promise<TurnResult> {
  options.signal?.throwIfAborted();
  if (!options.apiConfig) {
    throw new Error('开局前请先配置主剧情 API');
  }

  const result = await executeTurn(worldBook, runtimeState, buildOpeningPlayerInput(runtimeState), {
    apiConfig: options.apiConfig,
    featureExecutionModes: options.featureExecutionModes,
    stateWritebackApiConfig: options.stateWritebackApiConfig,
    stateWritebackFallbackApiConfig: options.stateWritebackFallbackApiConfig,
    npcCompletionApiConfig: options.npcCompletionApiConfig,
    npcCompletionFallbackApiConfig: options.npcCompletionFallbackApiConfig,
    llmClient: options.llmClient,
    stateWritebackLlmClient: options.stateWritebackLlmClient,
    stateWritebackFallbackLlmClient: options.stateWritebackFallbackLlmClient,
    npcCompletionLlmClient: options.npcCompletionLlmClient,
    npcCompletionFallbackLlmClient: options.npcCompletionFallbackLlmClient,
    persistentPromptGuide: options.persistentPromptGuide,
    onContentDelta: options.onContentDelta,
    onContentReset: options.onContentReset,
    onStageChange: options.onStageChange,
    signal: options.signal,
    openingInitialization: true,
    narratorWritebackOptions: {
      allowProtagonistProfileOverwrite: true,
    },
  });
  options.signal?.throwIfAborted();

  const traitCompliance = options.featureExecutionModes?.stateWriteback === 'bundledMain'
    ? { state: result.newRuntimeState, notes: [], rawContent: '', usage: undefined, appliedPatches: [] }
    : await reconcileOpeningTraitCompliance({
        worldBook,
        initialState: runtimeState,
        openingState: result.newRuntimeState,
        openingNarrativeText: result.narrativeText,
        openingStatePatches: result.statePatches ?? [],
        mainApiConfig: options.apiConfig,
        mainLlmClient: options.llmClient,
        stateWritebackApiConfig: options.stateWritebackApiConfig,
        stateWritebackLlmClient: options.stateWritebackLlmClient,
        stateWritebackFallbackApiConfig: options.stateWritebackFallbackApiConfig,
        stateWritebackFallbackLlmClient: options.stateWritebackFallbackLlmClient,
        signal: options.signal,
      });
  options.signal?.throwIfAborted();

  const ledgerCompliance = options.featureExecutionModes?.stateWriteback === 'bundledMain'
    ? { state: traitCompliance.state, notes: [], rawContent: '', usage: undefined, appliedPatches: [] }
    : await reconcileOpeningLedgerCompliance({
        worldBook,
        initialState: runtimeState,
        openingState: traitCompliance.state,
        openingNarrativeText: result.narrativeText,
        apiConfig: options.apiConfig,
        llmClient: options.llmClient,
        signal: options.signal,
      });
  options.signal?.throwIfAborted();

  const newRuntimeState = JSON.parse(JSON.stringify(ledgerCompliance.state)) as RuntimeState;
  const latestLog = newRuntimeState.turnLog[newRuntimeState.turnLog.length - 1];
  const complianceNotes = [...traitCompliance.notes, ...ledgerCompliance.notes];
  if (latestLog && complianceNotes.length > 0) {
    latestLog.statePatchSummary = [
      latestLog.statePatchSummary,
      complianceNotes.join('；'),
    ].filter(Boolean).join('；');
  }
  const traitTokenUsage = mergeTokenUsage(result.turnDisplayMeta, traitCompliance.usage);
  const tokenUsage = mergeTokenUsage(
    { ...result.turnDisplayMeta, ...traitTokenUsage },
    ledgerCompliance.usage,
  );
  const turnDisplayMeta: TurnDisplayMeta = {
    ...result.turnDisplayMeta,
    ...latestLog?.displayMeta,
    ...tokenUsage,
    rawResponse: traitCompliance.rawContent || ledgerCompliance.rawContent
      ? [
          result.turnDisplayMeta.rawResponse,
          ...(traitCompliance.rawContent
            ? ['\n\n[opening trait compliance repair]\n', traitCompliance.rawContent]
            : []),
          ...(ledgerCompliance.rawContent
            ? ['\n\n[opening ledger compliance repair]\n', ledgerCompliance.rawContent]
            : []),
        ].filter(Boolean).join('')
      : result.turnDisplayMeta.rawResponse,
    title: '开场剧情',
  };

  if (latestLog) {
    latestLog.displayMeta = turnDisplayMeta;
  }

  newRuntimeState.worldStateDelta = {
    ...newRuntimeState.worldStateDelta,
    trueOpeningGenerated: true,
  };

  return {
    ...result,
    statePatches: [
      ...(result.statePatches ?? []),
      ...traitCompliance.appliedPatches,
      ...ledgerCompliance.appliedPatches,
    ],
    newRuntimeState,
    turnDisplayMeta,
  };
}

function mergeTokenUsage(
  displayMeta: TurnDisplayMeta,
  usage?: LlmTokenUsage,
): Pick<
  TurnDisplayMeta,
  | 'promptTokens'
  | 'completionTokens'
  | 'totalTokens'
  | 'cacheReadTokens'
  | 'cacheWriteTokens'
  | 'cacheMissTokens'
> {
  if (!usage) {
    return {
      promptTokens: displayMeta.promptTokens,
      completionTokens: displayMeta.completionTokens,
      totalTokens: displayMeta.totalTokens,
      cacheReadTokens: displayMeta.cacheReadTokens,
      cacheWriteTokens: displayMeta.cacheWriteTokens,
      cacheMissTokens: displayMeta.cacheMissTokens,
    };
  }

  return {
    promptTokens: mergeUsageField(displayMeta.promptTokens, usage.promptTokens),
    completionTokens: mergeUsageField(displayMeta.completionTokens, usage.completionTokens),
    totalTokens: mergeUsageField(displayMeta.totalTokens, usage.totalTokens),
    cacheReadTokens: mergeUsageField(displayMeta.cacheReadTokens, usage.cacheReadTokens),
    cacheWriteTokens: mergeUsageField(displayMeta.cacheWriteTokens, usage.cacheWriteTokens),
    cacheMissTokens: mergeUsageField(displayMeta.cacheMissTokens, usage.cacheMissTokens),
  };
}

function mergeUsageField(first?: number, second?: number): number | undefined {
  if (first === undefined && second === undefined) return undefined;
  return (first ?? 0) + (second ?? 0);
}

function buildOpeningPlayerInput(runtimeState: RuntimeState): string {
  const extraRequest = runtimeState.worldStateDelta.openingExtraRequest;
  const openingExtraRequest = typeof extraRequest === 'string' ? extraRequest.trim() : '';
  const templateValues = { openingExtraRequest };

  return [
    '[true opening generation]',
    resolvePromptTemplate(
      'opening.trueOpeningPrompt',
      [
        '请根据当前世界书、时代剧本、开局书签、主角档案、初始地点、出身身份和开局额外要求，生成第一段可直接进入游戏的开场剧情。',
        '',
        'narrativeText 显示格式：',
        '- narrativeText 只写玩家可读正文，不写 thinking、短期记忆、命令规划、选项文本或 Markdown。',
        '- 叙述、动作、环境、心理活动请单独成行，并以 `【旁白】` 开头。',
        '- 角色直接说出口的台词请单独成行，并以 `【角色名】` 开头；只有开局额外要求提供了主角逐字台词时，才可用当前主角姓名标记并忠实承接，不要使用 `【你】`；否则禁止自行扩写 `【主角名】` 台词。',
        '- 临时出现的军士、门吏、仆从、路人等人物只要有直接台词，也必须使用可读姓名或身份标签，例如 `【王六】`、`【军士】`、`【门吏】`；不要把直接台词塞进 `【旁白】` 段。',
        '- 没有明确说话人的内容归入 `【旁白】`；不要在正文里输出 XML 标签或旧式命令块。',
        '',
        buildNarrativeLengthGuidance(),
      ].join('\n'),
      templateValues,
    ),
    resolvePromptTemplate(
      'opening.extraRequestPriority',
      '开局额外要求拥有最高优先级；若它与普通开局选项冲突，以开局额外要求为准，并用叙事自行圆合。',
      templateValues,
    ),
    resolvePromptTemplate(
      'opening.identityProfileProtocol',
      [
        '开局身份与基础画像必须落成可长期承接的具体档案，不得只照搬开局选项原文。',
        'If birthOrigin/currentIdentity is conceptual, concretize conceptual birthOrigin/currentIdentity into setting-specific stable archive values.',
        '例如“世家大族嫡系”“军中将校”“江湖游侠”等概念选项，应结合世界书、起点地点、年龄、姓名、开局处境和额外要求，转为具体出身、具体身份、具体官职/军职/所属关系；不要写时代包硬编码特例。',
        '如果玩家没有填写 appearance/personality，必须根据主角年龄、出身、身份、地点处境、世界书风格和开局剧情生成稳定 appearance/personality；它们是后续正文描写和文生图的基础锚点。',
        '开局具体化主角档案必须写入 writeback.protagonistProfile；至少在需要具体化或补全时写入 birthOrigin、currentIdentity、appearance、personality，并必须写入 personalEscortEntitlement。personalEscortEntitlement.status 只能是 none/customary；bases 只能使用 official_position/military_command/nobility/faction_leadership/household_status/explicit_retinue，customary 至少一项，none 必须为空数组，updatedAt 写当前游戏时间。依据已经成立的具体官职、军职、爵位、势力领导权、家门地位或明确长期随从关系判断，不得只按身份名称词语猜测。可选 birthOriginDescription、currentIdentityDescription、factionName、allegianceTarget、officeTitle、militaryTitle、nobleTitle、identitySummary。',
        '若开局正文、开局摘要、主角记忆或初始事项中确立了稳定身份事实，稳定身份事实不得只写入记忆、事项或正文，必须同步 writeback.protagonistProfile；如改用 statePatches，也必须同步 updateCharacterIdentity；不要让主角档案继续停留在概念选项。',
        '若开局生成了具体官职或军职，该具体职务应成为 currentIdentity 或 militaryTitle/officeTitle，而不是继续保留“军中将校”等概念标签。',
      ].join('\n'),
      templateValues,
    ),
    resolvePromptTemplate(
      'opening.reputationProtocol',
      [
        '开局声名与德行承接：如果主角档案中已有声名、德行、标签或摘要，真开局正文必须将它们作为旁人称呼、第一印象、信任或戒备、身份压力和局面反应的叙事锚点。',
        '不得机械复述数值，也不得把已有声名/德行当作不存在；应根据当前地点、在场人物身份、消息传播范围和开局处境自然融入动作、对话、态度和风险。',
        '若真开局正文实际确立新的公开评价、善恶口碑或长期声名后果，可使用 statePatches 中 type="luanshiCommand" 且 payload.command.action="updateCharacterReputation" 写回；没有新事实时不要为了开局机械改写。',
      ].join('\n'),
      templateValues,
    ),
    resolvePromptTemplate(
      'opening.factionLedgerProtocol',
      [
        'Opening faction ledger protocol:',
        '当前势力账本不得由静态种子预填；真开局必须根据开局时间、start bookmark、玩家身份、玩家地点、世界线 KnowledgeBase/StoryPack、世界书地图资料、本局事实和 model knowledge，判断玩家当下应知、应接触、可长期承接的势力事实。',
        '使用 statePatches 中 type="luanshiCommand" 且 payload.command.action="upsertFactionLedger" 写回；不要只把势力格局写进正文、记忆或临时摘要。',
        '如果玩家身份明确属于某个势力、玩家地点处在某个势力控制或争夺范围内，或当前剧本节点使某些势力与主角处境直接相关，应写入这些相关当前势力；不要生成天下所有势力，也不要把资料库概念、地域标签或历史背景硬写成当前实体。',
        '真开局势力账本不得为空：除非玩家明确是完全脱离势力网络的孤立开局，否则至少写入主角当前归属/直接接触势力，以及 1-3 个对当前处境有直接影响的对手、上级、地方、朝廷或盟友势力；具体内容仍由开局时间、身份、地点、资料库和本局事实判断。',
        '如果 opening narrative、当前事项、风声线索或纪事中已经点名具体官府、军府、朝廷、宗族、叛乱组织、部队归属或当前政治主体，并且它对玩家处境有承接价值，必须同时 upsertFactionLedger；不得只把它留在任务、风声、纪事或正文里。',
        '势力账本字段应区分 name/type/summary/stanceToPlayer/knownLevel/recentActions，以及 nominalAllegiance、legalIdentity、actualController、knownSphere、sourceNote、lastKnownAt、updatedAt、corePersonNpcIds、knownMemberNpcIds、relatedTroopIds 等可选字段。',
        'recentActions 不得省略；至少写 1 条当前已知行动、近期动作、控制举措或本局接触事实，不能只写 summary 后省略数组。',
        'type 必须使用中文势力类型，例如朝廷、政权、地方官府、军府、军阀集团、豪族宗族、叛乱组织、盗匪流寇、士人社群、游侠组织、宗族武装等；不得输出 warlord，也不得输出 clan/local_government/government 等英文枚举或下划线工程词。',
        'stanceToPlayer 必须写简短关系文本，例如亲善/友好/中立/戒备/敌对/自势力相关；不得写数字评分，也不得写 neutral/friendly/hostile 等英文枚举。',
        '若真开局明确主角有可承接的部曲、亲兵、守军、麾下士卒或直属兵力，必须使用 upsertTroopLedger 写入；relationToPlayer 必须写简短关系文本，不得写数字评分；upkeepSource 按军需来源写 player_resources/superior_provision/mixed/unknown，只有玩家自己的资源才是 player_resources，其他人物或势力的府库、自筹与拨付都属于 superior_provision。',
        '新建部队必须包含 quality、readiness、fatigue、lifecycleStatus、knownLevel、certainty；quality 使用低/中/高/精锐，readiness 使用低/中/高，fatigue 使用低/中/高/极高，lifecycleStatus 通常写 active，亲历清点写 knownLevel=亲历、certainty=confirmed。',
        '部队 knownLevel 是证据来源层级（亲历/听闻/推测），certainty 是可信度（confirmed/reported/rumor/uncertain），不得机械同步；可靠军报可以是听闻+confirmed，失联通常只降低 certainty，推测+confirmed 不得组合。',
        '开局已确认部队所在地点时，locationId 与 lastKnownLocationId 必须使用地图上下文中的同一 canonical 地点 ID，并写 lastKnownAt；位置未确认时省略这些字段，不得发明 unknown/loc_unknown 占位 ID。',
    'leaderNpcId 记录实际带兵将领，玩家本人实际带兵时写 player；真实任命的副将写 deputyNpcIds（最多两名），军师写 strategistNpcId，均逐字复用已建档 NPC 稳定 ID，不得按姓名猜测或重复任职。',
        '若已知部队归属势力，troop.factionId 指向真实归属势力；不要因缺 factionId 新建未知势力，也不要把营、曲、某部写成势力。',
        '朝廷、地方官府、军阀集团、豪族宗族等要区分名义归属、法理身份、实际控制者和已知势力范围；只听闻或推测的信息不得写成亲历。',
        '本局事实优先：若玩家行动或既有存档已经改变京师控制、皇位归属、关键人物生死或军队归属，不得强行拉回史实，只能按本局事实更新势力账本。',
      ].join('\n'),
      templateValues,
    ),
    resolvePromptTemplate(
      'opening.traitResolutionProtocol',
      [
        '主角开局特质请读取 worldStateDelta.openingTraitDetails：预设特质若已有 rarity，请将其作为稳定叙事权重；自定义特质若标注为“待开局 LLM 判定”，请根据特质描述、时代适配度和开局处境判断 white/green/blue/purple/orange/red（普通/良好/精良/珍贵/传说/绝世，red 最高）。特质等级只影响叙事权重和轻量判定，不直接给六维加点。正文对特质强度的表现必须与所写 rarity 一致，不得在正文中按传说或绝世表现、写回却给低品级。',
        'If any worldStateDelta.openingTraitDetails entry has rarity="??? LLM ??", add exactly one statePatches item with type="luanshiCommand" and payload.command.action="updatePlayerTraits". The command must write the complete player traits list, keep every already-resolved rarity unchanged, and resolve every pending custom trait rarity to white/green/blue/purple/orange/red. Do not omit this patch merely because another opening state patch may fail.',
      ].join('\n'),
      templateValues,
    ),
    resolvePromptTemplate(
      'opening.uniqueArtsProtocol',
      [
        '真开局必须根据主角出身、身份、年龄、开局处境、世界书和额外要求生成 1-3 条初始绝艺；绝艺是可学习、可升级的长期能力锚点，不是固定技能树或招式表。',
        '请在 statePatches 中使用 type="luanshiCommand" 且 payload.command.action="updateCharacterUniqueArts" 写回主角完整绝艺列表，characterType="player"。本地会同步 worldStateDelta.openingUniqueArts/openingUniqueArtDetails，供主角档案和后续剧情承接。',
        'uniqueArts 每项包含 id、name、rarity、domain、level、description、effectSummary、source、acquisition。真开局 acquisition 必须写 {kind:"opening",occurredAt,sourceRefId,summary}，sourceRefId 指向当前开局身份、出身或额外要求中确实支持该绝艺的来源；可含 maxLevel、progress、acquiredAt、promptHint、checkHooks、tags。',
        'rarity 使用 white/green/blue/purple/orange/red；domain 只能是 personalCombat/warfare/strategy/social/governance/survival/craft/other。',
        'domain=personalCombat/warfare 的初始绝艺必须在 writeback.semanticProjections 同批输出 sourceType=unique_art、sourceId 逐字等于该绝艺 id 的 executable 投影，并分别包含 personal_combat/war scope。稳定效果明确承诺每回合恢复生命/体力的初始绝艺还必须输出 passive/hybrid、runtime_turn + after_runtime_turn 的结构化恢复投影；个人战每轮也生效时增加 personal_combat + round_start。投影只定义长期稳定用途、目标和基础档位；本地会按绝艺当前等级生成本场有效数值，后续不得重复生成或覆盖。',
        '绝艺应从角色逻辑生成：武将可偏个人战或军略，谋士可偏 strategy/warfare/governance/social；不要硬编码关羽、诸葛亮等具体人物绝艺给主角，除非玩家开局明确要求且世界逻辑成立。',
      ].join('\n'),
      templateValues,
    ),
    resolvePromptTemplate(
      'opening.loadoutProtocol',
      [
        '初始行装不能使用本地预设模板，必须由你根据当前世界书、时代背景、历史人物或原创角色身份、出身、当前身份、地点处境和开局额外要求生成。',
        '请在 statePatches 中使用 type="luanshiCommand" 且 payload.command.action="updatePlayerLoadout" 写回主角初始行装，至少包含 personalMoney、equipment、inventory、summary。',
        'equipment 每项包含 id、slot、name、quality、description；slot 只能是 weapon/armor/mount/treasure；quality 使用粗劣/普通/精良/名品/传奇。weapon/armor/mount 各最多 1 件，treasure 最多 3 件。',
        'inventory 每项包含 id、name、quantity、description。equipment 与 inventory 各自列表内每个逻辑物品 id 必须唯一，不得把同一个通用 id 分配给不同物品；只有同一件装备同时出现在两份列表时才可复用同一 id，且 name 与 slot/equipSlot 一致。personalMoney 的底层单位是钱，1000钱仅显示为1贯；黄金不是 personalMoney 的高位单位。开局若确有黄金、金饼、马蹄金等实物财货，必须作为 category=material 的独立 inventory 物品按实际数量与形制记录，不得自行折成贯钱。个人钱财和实物黄金都要符合人物身份与处境：不要所有身份都给同一数值，也不要随意给超出身份逻辑的财富。',
      ].join('\n'),
      templateValues,
    ),
    resolvePromptTemplate(
      'opening.holdingAssetProtocol',
      [
        '开局领地与私人产业边界：',
        '没有实际控制、临时控制或争夺的具体领地时，不得输出 upsertHoldingLedger，也不得为玩家生成本地府库或本地粮仓。',
        '如果开局只说明主角本人、家族、家臣或部曲拥有私人庄园、田产、工坊、马场、铺面等使用 upsertPrivateAsset；私人产业不是控制领地，不得写成本地府库。',
        '明确拥有私人产业时，必须使用 upsertPrivateAsset 写回，operation=create 并附 acquisition={kind:"opening",occurredAt,sourceRefId,summary}，不得只写进正文、记忆或摘要；玩家自称、夸耀或要求的万亩万户产业不是可信事实，初始规模必须符合身份且通过本地上限。',
        '军职、统兵、驻扎、守城、镇守、站上城墙、负责某段城防、军营、兵营、武库、库房、军械清点、斥候名册只表示人物在场、部队或军需上下文，不等于控制领地，也不得伪装成 controlEvidence。',
        '只有当主角身份、所属势力、开局地点或开局额外要求明确让其掌管某个具体城池、县邑、关隘、港口、村寨或庄园领地，才可使用 upsertHoldingLedger。',
        '明确掌管具体领地时，必须使用 upsertHoldingLedger 写回，operation=create 并附 controlEvidence={kind:"opening",occurredAt,sourceRefId,summary}，不得只写进正文、记忆或摘要。',
        'upsertHoldingLedger 必须显式写 civilAdministrationScope=none/households/territorial/mixed：纯军营、关隘、堡垒或港口设施不应拥有腐败、田亩编户并使用 none；corruption 只适用于存在税收、征收或经营收益的 households/territorial/mixed；只有剧情明确同时管辖屯田或民户时才使用这些范围，不得按名称猜测。',
        '不得输出 localTreasury/localGranary；玩家个人钱财只写 updatePlayerLoadout.personalMoney，势力总资源只写 updateResourceLedger。',
        '开局不生成活动围城倒计时；若正文明确正在封锁或围城，只写 siege 的事实枚举，断补回合和可支撑回合由本地计算。',
      ].join('\n'),
      templateValues,
    ),
    resolvePromptTemplate(
      'opening.femaleNpcProfileProtocol',
      '开局若根据额外要求、世界书或剧情生成符合条件的女性 NPC，必须在 writeback.npcProfileSuggestions[] 的同一条 NPC 档案里携带 femaleProfile；如果改用 statePatches，则必须先 upsertNpcProfile 再 updateNpcFemaleProfile，二者必须使用同一个 npcId。已有 NPC 必须复用上下文提供的 npcId，不得生成漂移 ID。女性档案字段包括 birthday、addressToPlayer、appearanceDescription、bodyDescription、clothingStyle、personalityCore、affectionProgressionCondition、relationshipProgressionCondition、relationshipNetwork；其中 appearanceDescription、bodyDescription、clothingStyle 是后续正文与文生图锚点，必须写成完整稳定锚点和稳定档案真值。成人私密档案字段包括 adultPrivateProfile.summary、adultPrivateProfile.breastDescription、adultPrivateProfile.vaginaDescription、adultPrivateProfile.anusDescription、adultPrivateProfile.sexualPreferenceNotes、adultPrivateProfile.sensitiveSpotNotes、adultPrivateProfile.preferenceNotes、adultPrivateProfile.boundaryNotes、adultPrivateProfile.sensitiveNotes、adultPrivateProfile.relationshipRiskNotes、adultPrivateProfile.wombProfile、adultPrivateProfile.virgin、adultPrivateProfile.firstNightPartner、adultPrivateProfile.firstNightTime、adultPrivateProfile.firstNightDescription 等完整结构；身体字段是长期私密锚点和未来文生图锚点，偏好、边界、敏感、风险、子宫和初夜字段是长期信息，不得只用 summary 替代，不得写成正文小作文，不得使用“未知 / 不详 / 待补充 / 略 / 普通 / 正常”这类占位值，仍遵守现有年龄门禁。adultPrivateProfile 的身体字段要直白、具体、稳定，避免诗化比喻、审美套话和机械枚举。',
      templateValues,
    ),
    '开局 NPC 建档协议：人物志只保存具有长期承接价值的独立人物。新建人物必须在同一条 writeback.npcProfileSuggestions[] 或 upsertNpcProfile 中写 persistenceReason 与 persistenceEvidence；开局主要同伴、家人、上级、长期对手等使用 opening_cast，并在证据中说明其与开局主线的稳定关系。历史人物可用 historical_figure，已经承担事项、部队、领地、产业或势力结构职责者可用 active_system_role。主角本人不写入 NPC 档案。',
    '一次性普通斥候、流民、守门兵、村民、仆役、信使、临时敌兵即使临时有姓名、出场、发话、传令或参战，也不因此自动进入人物志；只留在正文，个人战需要时使用 Encounter V2 scopedCombatants。远场人物仅被多次点名也不是准入依据；只有世界书历史身份、明确长期战略身份、已经成立的系统职责或后续关系承诺才能建档。',
    '开局 NPC 档案字段使用严格 JSON 类型：sex 只能逐字写“男”“女”“其他”；age 必须是当前开局日期下大于 0 的整数；每个新 NPC 必须写完整 birthDate，格式为公元YYYY年MM月DD日，本地历法每月 30 天，月日可按人物背景合理虚构但一经建档不得改写；isPresent/isFocused 必须是布尔值；contactLevel 必须是大于等于 0 的有限数字，不得写 frequent/close 等文字；abilityScores 六项必须是数字；uniqueArts[].level 必须是 1—10 的整数，不得写 proficient/master 等文字。',
    '开局 NPC 档案特质必须写完整 traits[].id/label/description/source/rarity；traits[].source 不得省略或写空字符串，可用 identity、event、history、worldline、writeback 等简短来源。',
    '开局重要 NPC 行装：开局创建或补全当前局势关键的上级、君主、重臣、将领、豪族首脑、使者、谈判对象或直接交锋者时，若其身份/场景足以推断长期随身装备、官印符节、军令凭证、家族信物或随身文书，应在同一条 writeback.npcProfileSuggestions[].equipment / writeback.npcProfileSuggestions[].inventory 写入 1-3 件稳定行装。equipment 每项包含 id/slot/name/quality/description，slot 只能是 weapon/armor/mount/treasure；quality 只能写 white/green/blue/purple/orange/red，对应普通/良好/精良/珍贵/传说/绝世。御赐、国宝、家传、军府制式等来源或身份标签只能写在 name/description，不能作为 quality。inventory 每项包含 id/name/quantity/category/description，可选 quality 时同样使用六档内部值。每个逻辑物品使用唯一稳定 id，禁止重复装备和非宝物同槽并列；只有同一装备跨 equipment/inventory 镜像时才复用同一 id。不得硬编码具体名人专属宝物，不确定时写身份层级通用物件；普通远场传闻人物不要机械补行装。',
    openingExtraRequest
      ? `开局额外要求：${openingExtraRequest}`
      : '',
  ].filter(Boolean).join('\n');
}

import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import type { LlmClient } from '../llm/LlmClient';
import type { RuntimeState, TurnDisplayMeta, TurnProcessingStageEvent, WorldBook } from '../types';
import type { LlmTokenUsage } from '../llm/LlmClient';
import { resolvePromptTemplate } from '../prompts/PromptResolver';
import { buildNarrativeLengthGuidance } from '../prompts/NarrativeLengthGuidance';
import { executeTurn, type TurnResult } from '../turn/TurnOrchestrator';
import { reconcileOpeningLedgerCompliance } from './OpeningLedgerCompliance';

export interface GenerateTrueOpeningOptions {
  apiConfig: ApiConfigArchive | null;
  stateWritebackApiConfig?: ApiConfigArchive | null;
  npcCompletionApiConfig?: ApiConfigArchive | null;
  llmClient: LlmClient;
  stateWritebackLlmClient?: LlmClient;
  npcCompletionLlmClient?: LlmClient;
  persistentPromptGuide?: string;
  onContentDelta?: (delta: string) => void;
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
    throw new Error('真开局需要先配置主剧情 API');
  }

  const result = await executeTurn(worldBook, runtimeState, buildOpeningPlayerInput(runtimeState), {
    apiConfig: options.apiConfig,
    stateWritebackApiConfig: options.stateWritebackApiConfig,
    npcCompletionApiConfig: options.npcCompletionApiConfig,
    llmClient: options.llmClient,
    stateWritebackLlmClient: options.stateWritebackLlmClient,
    npcCompletionLlmClient: options.npcCompletionLlmClient,
    persistentPromptGuide: options.persistentPromptGuide,
    onContentDelta: options.onContentDelta,
    onStageChange: options.onStageChange,
    signal: options.signal,
    openingInitialization: true,
    narratorWritebackOptions: {
      allowProtagonistProfileOverwrite: true,
    },
  });
  options.signal?.throwIfAborted();

  const ledgerCompliance = await reconcileOpeningLedgerCompliance({
    worldBook,
    initialState: runtimeState,
    openingState: result.newRuntimeState,
    openingNarrativeText: result.narrativeText,
    apiConfig: options.apiConfig,
    llmClient: options.llmClient,
    signal: options.signal,
  });
  options.signal?.throwIfAborted();

  const newRuntimeState = JSON.parse(JSON.stringify(ledgerCompliance.state)) as RuntimeState;
  const latestLog = newRuntimeState.turnLog[newRuntimeState.turnLog.length - 1];
  if (latestLog && ledgerCompliance.notes.length > 0) {
    latestLog.statePatchSummary = [
      latestLog.statePatchSummary,
      ledgerCompliance.notes.join('；'),
    ].filter(Boolean).join('；');
  }
  const tokenUsage = mergeTokenUsage(result.turnDisplayMeta, ledgerCompliance.usage);
  const turnDisplayMeta: TurnDisplayMeta = {
    ...result.turnDisplayMeta,
    ...latestLog?.displayMeta,
    ...tokenUsage,
    rawResponse: ledgerCompliance.rawContent
      ? [
          result.turnDisplayMeta.rawResponse,
          '\n\n[opening ledger compliance repair]\n',
          ledgerCompliance.rawContent,
        ].filter(Boolean).join('')
      : result.turnDisplayMeta.rawResponse,
    title: '开场剧情',
    reasoningSummary: [
      latestLog?.displayMeta?.reasoningSummary ?? result.turnDisplayMeta.reasoningSummary,
      '本回合为真开局生成：模型根据世界书、开局选项、角色档案和开局额外要求生成第一段可游玩的局面，并应结构化写回初始行装。',
      ledgerCompliance.notes.length > 0 ? ledgerCompliance.notes.join('；') : '',
    ].filter(Boolean).join('\n\n'),
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
      ...ledgerCompliance.appliedPatches,
    ],
    newRuntimeState,
    turnDisplayMeta,
  };
}

function mergeTokenUsage(
  displayMeta: TurnDisplayMeta,
  usage?: LlmTokenUsage,
): Pick<TurnDisplayMeta, 'promptTokens' | 'completionTokens' | 'totalTokens'> {
  if (!usage) {
    return {
      promptTokens: displayMeta.promptTokens,
      completionTokens: displayMeta.completionTokens,
      totalTokens: displayMeta.totalTokens,
    };
  }

  return {
    promptTokens: mergeUsageField(displayMeta.promptTokens, usage.promptTokens),
    completionTokens: mergeUsageField(displayMeta.completionTokens, usage.completionTokens),
    totalTokens: mergeUsageField(displayMeta.totalTokens, usage.totalTokens),
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
        '开局具体化主角档案必须写入 writeback.protagonistProfile；至少在需要具体化或补全时写入 birthOrigin、currentIdentity、appearance、personality，可选 birthOriginDescription、currentIdentityDescription、factionName、allegianceTarget、officeTitle、militaryTitle、nobleTitle、identitySummary。',
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
        '若真开局明确主角有可承接的部曲、亲兵、守军、麾下士卒或直属兵力，必须使用 upsertTroopLedger 写入；relationToPlayer 必须写简短关系文本，不得写数字评分；upkeepSource 按军需来源写 player_resources/superior_provision/mixed/unknown。',
        '新建部队必须包含 quality、readiness、fatigue、lifecycleStatus、knownLevel、certainty；quality 使用低/中/高/精锐，readiness 使用低/中/高，fatigue 使用低/中/高/极高，lifecycleStatus 通常写 active，亲历清点写 knownLevel=亲历、certainty=confirmed。',
        '部队 knownLevel 是证据来源层级（亲历/听闻/推测），certainty 是可信度（confirmed/reported/rumor/uncertain），不得机械同步；可靠军报可以是听闻+confirmed，失联通常只降低 certainty，推测+confirmed 不得组合。',
        '开局已确认部队所在地点时，locationId 与 lastKnownLocationId 必须使用地图上下文中的同一 canonical 地点 ID，并写 lastKnownAt；位置未确认时省略这些字段，不得发明 unknown/loc_unknown 占位 ID。',
        '玩家亲自统领、直接清点或由主角麾下掌握的部队，leaderNpcId 写 player；副将、军侯、带兵副手、亲兵队率等下属不得把副手写成主将，可写入 NPC 档案、sourceNote 或 statusTags。',
        '若已知部队归属势力，troop.factionId 指向真实归属势力；不要因缺 factionId 新建未知势力，也不要把营、曲、某部写成势力。',
        '朝廷、地方官府、军阀集团、豪族宗族等要区分名义归属、法理身份、实际控制者和已知势力范围；只听闻或推测的信息不得写成亲历。',
        '本局事实优先：若玩家行动或既有存档已经改变京师控制、皇位归属、关键人物生死或军队归属，不得强行拉回史实，只能按本局事实更新势力账本。',
      ].join('\n'),
      templateValues,
    ),
    resolvePromptTemplate(
      'opening.traitResolutionProtocol',
      [
        '主角开局特质请读取 worldStateDelta.openingTraitDetails：预设特质若已有 rarity，请将其作为叙事权重；自定义特质若标注为“待开局 LLM 判定”，请根据特质描述、时代适配度和开局处境判断 white/green/blue/red/gold。特质等级只影响叙事权重和轻量判定，不直接给六维加点。',
        'If any worldStateDelta.openingTraitDetails entry has rarity="??? LLM ??", or if the opening context changes player trait weighting, add a statePatches item with type="luanshiCommand" and payload.command.action="updatePlayerTraits". The command must write the complete player traits list, keep stable preset rarity unless there is a clear opening reason, and resolve every custom trait rarity to white/green/blue/red/gold.',
      ].join('\n'),
      templateValues,
    ),
    resolvePromptTemplate(
      'opening.uniqueArtsProtocol',
      [
        '真开局必须根据主角出身、身份、年龄、开局处境、世界书和额外要求生成 1-3 条初始绝艺；绝艺是可学习、可升级的长期能力锚点，不是固定技能树或招式表。',
        '请在 statePatches 中使用 type="luanshiCommand" 且 payload.command.action="updateCharacterUniqueArts" 写回主角完整绝艺列表，characterType="player"。本地会同步 worldStateDelta.openingUniqueArts/openingUniqueArtDetails，供主角档案和后续剧情承接。',
        'uniqueArts 每项包含 id、name、rarity、domain、level、description、effectSummary、source；可含 maxLevel、progress、acquiredAt、promptHint、checkHooks、tags。',
        'rarity 使用 white/green/blue/red/gold；domain 只能是 personalCombat/warfare/strategy/social/governance/survival/craft/other。',
        '绝艺应从角色逻辑生成：武将可偏个人战或军略，谋士可偏 strategy/warfare/governance/social；不要硬编码关羽、诸葛亮等具体人物绝艺给主角，除非玩家开局明确要求且世界逻辑成立。',
      ].join('\n'),
      templateValues,
    ),
    resolvePromptTemplate(
      'opening.loadoutProtocol',
      [
        '初始行装不能使用本地预设模板，必须由你根据当前世界书、时代背景、历史人物或原创角色身份、出身、当前身份、地点处境和开局额外要求生成。',
        '请在 statePatches 中使用 type="luanshiCommand" 且 payload.command.action="updatePlayerLoadout" 写回主角初始行装，至少包含 personalMoney、equipment、inventory、summary。',
        'equipment 每项包含 id、slot、name、quality、description；slot 只能是 weapon/armor/mount/treasure；quality 使用粗劣/普通/精良/名品/传奇。',
        'inventory 每项包含 id、name、quantity、description。个人钱财要符合人物身份与处境：不要所有身份都给同一数值，也不要随意给超出身份逻辑的财富。',
      ].join('\n'),
      templateValues,
    ),
    resolvePromptTemplate(
      'opening.holdingAssetProtocol',
      [
        '开局领地与私人产业边界：',
        '没有实际控制、临时控制或争夺的具体领地时，不得输出 upsertHoldingLedger，也不得为玩家生成本地府库或本地粮仓。',
        '如果开局只说明主角本人、家族、家臣或部曲拥有私人庄园、田产、工坊、马场、铺面等使用 upsertPrivateAsset；私人产业不是控制领地，不得写成本地府库。',
        '明确拥有私人产业时，必须使用 upsertPrivateAsset 写回，不得只写进正文、记忆或摘要。',
        '军职、统兵、守城、镇守、军营、兵营、武库、库房、军械清点、斥候名册只表示部队或军需上下文，不等于控制领地；除非明确有治理、接掌、辖有、府库交接或民政权责，否则不得输出 upsertHoldingLedger。',
        '只有当主角身份、所属势力、开局地点或开局额外要求明确让其掌管某个具体城池、县邑、关隘、港口、村寨或庄园领地，才可使用 upsertHoldingLedger。',
        '明确掌管具体领地时，必须使用 upsertHoldingLedger 写回，不得只写进正文、记忆或摘要。',
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
    '开局 NPC 建档协议：opening narrative、当前事项、风声线索或纪事中若出现与玩家当前处境直接相关的在场人物、剧情关键 NPC、历史重点人物、上级/同僚/使者/敌将/谈判对象，应在 writeback.npcProfileSuggestions[] 写入人物志；主角本人不写入 NPC 档案；不要只在正文或动态条目中反复点名而不给稳定 npcId。',
    '开局或首回合正文若多次点名敌方将领、朝廷重臣、军府同僚、传令使者或战略对手，即使其不在场，也应建立简要人物志；可按听闻/远场人物记录 locationId/isPresent/isFocused，不得因为信息有限而完全不建档。',
    '开局 NPC 档案特质必须写完整 traits[].id/label/description/source/rarity；traits[].source 不得省略或写空字符串，可用 identity、event、history、worldline、writeback 等简短来源。',
    '开局重要 NPC 行装：开局创建或补全当前局势关键的上级、君主、重臣、将领、豪族首脑、使者、谈判对象或直接交锋者时，若其身份/场景足以推断长期随身装备、官印符节、军令凭证、家族信物或随身文书，应在同一条 writeback.npcProfileSuggestions[].equipment / writeback.npcProfileSuggestions[].inventory 写入 1-3 件稳定行装。equipment 每项包含 id/slot/name/quality/description，slot 只能是 weapon/armor/mount/treasure；inventory 每项包含 id/name/quantity/category/description。不得硬编码具体名人专属宝物，不确定时写身份层级通用物件；普通远场传闻人物不要机械补行装。',
    openingExtraRequest
      ? `开局额外要求：${openingExtraRequest}`
      : '',
  ].filter(Boolean).join('\n');
}

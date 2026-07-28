import { describe, expect, it } from 'vitest';
import { worldBook_ThreeKingdoms } from '../../worldbooks/threeKingdoms';
import { BrowserLlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { tryCreateGameClockFromDateLabel } from '../time/gameClock';
import type {
  LuanShiNpc,
  RuntimeState,
  TroopLedgerEntry,
} from '../types';
import { executeTurn, type TurnResult } from '../turn/TurnOrchestrator';
import { buildMilitarySupplyNarrativeProjection } from './MilitarySupplyNarrativeProjection';
import {
  NARRATIVE_QUALITY_BASELINE_CASES,
  NARRATIVE_QUALITY_PASSIVE_TURN_SEQUENCE,
  NARRATIVE_QUALITY_SUPPLY_CASES,
  type NarrativeQualityEvaluationCase,
  type NarrativeQualityScore,
} from './NarrativeQualityBaseline';

interface NodeFileSystemModule {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: boolean }): void;
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, content: string, encoding: 'utf8'): void;
}

interface TestProcess {
  env?: Record<string, string | undefined>;
  cwd(): string;
  getBuiltinModule(name: string): unknown;
}

const TEST_PROCESS = (globalThis as unknown as { process?: TestProcess }).process;
const TEST_ENV = TEST_PROCESS?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_NARRATIVE_QUALITY_REAL_API === '1';
const REAL_API_MODE = TEST_ENV.COC_V2_NARRATIVE_QUALITY_MODE === 'targeted' ? 'targeted' : 'full';
const CHECKPOINT_VERSION = 8;

type SampleCategory = 'historical' | 'passive' | 'remote' | 'supply';

interface QualityScores {
  characterDistinctiveness: NarrativeQualityScore;
  languageNaturalness: NarrativeQualityScore;
  narrativeMomentum: NarrativeQualityScore;
  factConsistency: NarrativeQualityScore;
}

interface QualitySampleResult {
  ordinal: number;
  caseId: string;
  category: SampleCategory;
  npcName?: string;
  narrativeText: string;
  nextState: RuntimeState;
  promptModuleIds: string[];
  promptEstimatedTokens: number;
  patchTypes: string[];
  locationWarnings: number;
  scores: QualityScores;
  flags: string[];
}

interface QualityCheckpoint {
  version: number;
  provider: string;
  model: string;
  samples: QualitySampleResult[];
}

let checkpointSamples: Map<number, QualitySampleResult> | undefined;

const HISTORICAL_SIGNATURES: Record<string, RegExp[]> = {
  cao_cao_early_office_negotiation: [/兵权|军权/, /名义|诏令|军令/, /宫门|西园|校尉/, /执行|调兵|值守/],
  sun_jian_after_battle_supply: [/粮|军需|粮道/, /伤兵|伤卒/, /战机|追击/, /袁术|军令|节制/],
  lv_bu_loyalty_crisis: [/试探|离间/, /来信|书信|信中/, /待遇|处境|安全/, /上级|主君|背叛/],
  liu_biao_gentry_council: [/豪族|宗族|蒯|蔡/, /名分|州牧/, /宗贼|清剿/, /秩序|立足|合作/],
  xun_yu_evacuation_everyday: [/道路|关津|路上/, /兵|军队|兵灾/, /族人|宗族|家眷/, /迁|离开|撤/],
  kong_rong_relief_diplomacy: [/名分|名义/, /求援|援兵/, /骑兵|突围/, /使者|信用|声望/],
  empress_he_private_pressure: [/少帝|天子|皇帝/, /何进|外戚/, /外兵|宫门|禁军/, /来源|站队|立场/],
  yuan_shao_coalition_council: [/盟主|盟约|联军/, /粮道|粮秣/, /前锋|先锋/, /诸镇|责任|军令|惩处/],
};

const HISTORICAL_FORBIDDEN: Record<string, RegExp[]> = {
  cao_cao_early_office_negotiation: [/魏王|曹丕|曹丞相|献帝|已经掌握北方|董卓必然入京/],
  sun_jian_after_battle_supply: [/江东之主|袁术已经明确断粮|玩家已经答应追击/],
  lv_bu_loyalty_crisis: [/招揽者身份已经确认|当场背叛|立即背叛/],
  liu_biao_gentry_council: [/豪族已经一致反叛|已经批准全面强征/],
  xun_yu_evacuation_everyday: [/曹操谋主|已经决定投奔曹操|必在.*被屠/],
  kong_rong_relief_diplomacy: [/援军已经答应|已经获得全部骑兵/],
  empress_he_private_pressure: [/何进已经发动兵变|向玩家作出.*承诺/],
  yuan_shao_coalition_council: [/各镇已经无条件服从|玩家被任命为前锋/],
};

const AGENCY_VIOLATION = /你(?:当即|立刻|随即|已经|最终)?(?:答应|同意|接受|承诺|决定(?:接受|出兵|发兵|结盟|宣战|处死|成婚|调拨|交出|投降)|下令(?:宣战|处死|出兵|发兵)|与\S{0,8}结盟)/;
const INTERNAL_PROTOCOL_LEAK = /Narrative Momentum|sourceId=|statePatch|结构化写回|写回边界|军需叙事真值/;
const PRESSURE_DELIVERY = /流民|粮草|粮道|缺口|期限|军报|催办|难民|断粮|告急/;
const REMOTE_DELIVERY = /书信|来信|使者|信使|来人|口信|消息|急报|送来/;
const DIRECT_QUOTE_MARKER = /[“”「」『』]/;
const GENERIC_ATMOSPHERE_PATTERNS = [
  /一时寂然|一时寂静|死寂|寂然/,
  /烛火|灯火|火盆|篝火/,
  /天气|秋风|寒风|河风|风声|猎猎|旌旗|幡旗/,
  /光线|微尘|阴影|暗影/,
  /空气.{0,12}(?:凝固|沉闷)|弥漫着|混合的气味/,
  /目光|眼神|鹰目/,
  /呼吸|喘息/,
  /仿佛|如同|宛如|犹如|好似/,
];
const COHORT_STYLE_CARRIERS: Array<{ id: string; pattern: RegExp; maxRate: number }> = [
  { id: 'gaze', pattern: /目光|眼神|鹰目/, maxRate: 0.7 },
  { id: 'comparison', pattern: /仿佛|如同|宛如|犹如|好似/, maxRate: 0.7 },
  { id: 'gesture-pause', pattern: /顿了顿|指尖|手指|负手/, maxRate: 0.65 },
];

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`叙事提质真实 API 长测缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_narrative_quality_batch5',
    name: 'Narrative Quality V1 Batch 5 isolated test',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0.55,
    maxOutputTokens: 5_000,
    createdAt: '2026-07-22T14:00:00.000Z',
    updatedAt: '2026-07-22T14:00:00.000Z',
  };
}

function getCheckpointPath(): string {
  const cwd = TEST_PROCESS?.cwd().replace(/\\/g, '/') ?? '.';
  const runId = (TEST_ENV.COC_V2_NARRATIVE_QUALITY_RUN_ID ?? '')
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-');
  const suffix = runId ? `-${runId}` : '';
  return `${cwd}/output/narrative-quality-v1/batch5-private-checkpoint${suffix}.json`;
}

function getFileSystem(): NodeFileSystemModule | undefined {
  return TEST_PROCESS?.getBuiltinModule('fs') as NodeFileSystemModule | undefined;
}

function loadCheckpointSamples(): Map<number, QualitySampleResult> {
  if (checkpointSamples) return checkpointSamples;
  checkpointSamples = new Map<number, QualitySampleResult>();
  const fs = getFileSystem();
  const path = getCheckpointPath();
  if (!fs?.existsSync(path)) return checkpointSamples;

  try {
    const parsed = JSON.parse(fs.readFileSync(path, 'utf8')) as QualityCheckpoint;
    const config = makeApiConfig();
    if (
      parsed.version !== CHECKPOINT_VERSION
      || parsed.provider !== config.provider
      || parsed.model !== config.model
      || !Array.isArray(parsed.samples)
    ) {
      return checkpointSamples;
    }
    for (const sample of parsed.samples) checkpointSamples.set(sample.ordinal, sample);
  } catch {
    // A damaged local-only checkpoint must never change production state or make the test pass.
  }
  return checkpointSamples;
}

function findCheckpointSample(ordinal: number, caseId: string): QualitySampleResult | undefined {
  const sample = loadCheckpointSamples().get(ordinal);
  return sample?.caseId === caseId ? sample : undefined;
}

function persistCheckpointSample(sample: QualitySampleResult): void {
  const samples = loadCheckpointSamples();
  samples.set(sample.ordinal, sample);
  const fs = getFileSystem();
  if (!fs) return;
  const path = getCheckpointPath();
  const directory = path.slice(0, path.lastIndexOf('/'));
  fs.mkdirSync(directory, { recursive: true });
  const config = makeApiConfig();
  const checkpoint: QualityCheckpoint = {
    version: CHECKPOINT_VERSION,
    provider: config.provider,
    model: config.model,
    samples: Array.from(samples.values()).sort((left, right) => left.ordinal - right.ordinal),
  };
  fs.writeFileSync(path, JSON.stringify(checkpoint), 'utf8');
}

function makeBaseState(currentDate: string, locationId: string, locationName: string): RuntimeState {
  const currentTime = tryCreateGameClockFromDateLabel(currentDate)
    ?? { year: 194, month: 5, day: 10, hour: 8, minute: 0 };
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: worldBook_ThreeKingdoms.manifest.id,
    worldBookVersion: worldBook_ThreeKingdoms.manifest.version,
    worldBookSource: 'official',
    startDate: currentDate,
    currentDate,
    currentTime,
    player: {
      id: 'player_batch5',
      name: '刘平',
      sex: '男',
      age: 24,
      roleType: '汉军军官',
      currentIdentity: '荆州军司马',
      level: 5,
      xp: 240,
      abilityScores: { 武力: 72, 统率: 76, 智力: 70, 政治: 63, 魅力: 66, 机运: 58 },
      vitals: { hp: 100, maxHp: 100, stamina: 92, maxStamina: 100 },
      personalMoney: 40,
      summary: '在乱世中逐步承担军政责任的汉军军官。',
    },
    currentLocationId: locationId,
    currentPlaceId: locationId,
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    locations: [{
      locationId,
      name: locationName,
      type: '场景',
      summary: `${locationName}，本轮只使用隔离测试事实。`,
      knownLevel: '亲历',
      recentEvents: [],
    }],
    npcs: [],
  });
}

function npcAge(name: string): number {
  return ({ 曹操: 35, 孙坚: 35, 吕布: 31, 刘表: 48, 荀彧: 26, 孔融: 37, 何氏: 34, 袁绍: 36 })[name] ?? 35;
}

function makeHistoricalNpc(entry: NarrativeQualityEvaluationCase, locationId: string): LuanShiNpc {
  return {
    npcId: `npc_${entry.id}`,
    name: entry.npc.name,
    sex: entry.npc.name === '何氏' ? '女' : '男',
    age: npcAge(entry.npc.name),
    role: entry.npc.role,
    currentIdentity: entry.npc.role,
    locationId,
    isPresent: true,
    isFocused: true,
    summary: `${entry.npc.role}。${entry.npc.boundary}`,
    appearance: '衣着、伤势与仪态均以当前场景事实为准。',
    personality: entry.npc.stableFactAnchors.join('；'),
    motivation: entry.npc.decisionBias,
    relationToPlayer: '正在就当前事项交换意见，尚未向玩家作出关键承诺。',
    contactLevel: 35,
    recentAttitude: '审慎评估玩家提议的现实代价',
    memories: [],
  };
}

function makeHistoricalState(entry: NarrativeQualityEvaluationCase): RuntimeState {
  const locationId = `loc_${entry.id}`;
  const state = makeBaseState(entry.currentDate, locationId, entry.location);
  state.npcs = [makeHistoricalNpc(entry, locationId)];
  state.localSituationNotes = [
    `当前局势：${entry.situation}`,
    `人物知识边界：${entry.npc.knowledgeBoundary}`,
    `必须保持：${entry.mustPreserve.join('；')}`,
    `不得虚构：${entry.mustNotInvent.join('；')}`,
  ];
  state.turnLog = [1, 2].map((turnNumber) => ({
    turnNumber,
    date: entry.currentDate,
    playerInput: '此前只是观察，没有作出新的关键决定。',
    narrativeText: `${entry.npc.name}目光一沉，先复述来意，随后只说仍需斟酌。`,
    fullNarrativeText: `${entry.npc.name}目光一沉，先复述来意，随后只说仍需斟酌。`,
    statePatchSummary: '隔离固定样本的重复风险前文',
    timestamp: `2026-07-22T13:0${turnNumber}:00.000Z`,
  }));

  if (entry.id === 'sun_jian_after_battle_supply' || entry.id === 'liu_biao_gentry_council') {
    state.activeQuests = [{
      id: `deadline_${entry.id}`,
      title: entry.id === 'sun_jian_after_battle_supply' ? '前军粮道决断期限' : '城外宗贼处置期限',
      description: entry.situation,
      status: 'active',
      currentStep: '相关人物必须在期限前报告现实约束，但不得替玩家作最终决定。',
      stakes: '若继续拖延，伤兵、粮道或地方秩序会恶化。',
      deadlineAt: entry.currentDate,
      priority: 'high',
      severity: 'major',
      relatedNpcIds: [state.npcs[0].npcId],
      relatedLocationIds: [locationId],
      createdAt: entry.currentDate,
      updatedAt: entry.currentDate,
    }];
  }
  return state;
}

function makePassiveState(): RuntimeState {
  const currentDate = '公元194年05月10日 08:00（辰时）';
  const locationId = 'loc_batch5_hanshui_camp';
  const state = makeBaseState(currentDate, locationId, '荆州 - 南郡 - 襄阳城 - 汉水大营');
  state.localSituationNotes = ['营内日常秩序稳定，但营外流民粮道事项已经进入期限压力。'];
  state.activeQuests = [{
    id: NARRATIVE_QUALITY_PASSIVE_TURN_SEQUENCE.sourceId,
    title: '安置流民并补上粮道缺口',
    description: '营外聚集的流民需要在粮道断续前获得安置与最低口粮。',
    status: 'active',
    currentStep: '等待玩家决定是调粮、求援、分流还是承担期限后果。',
    stakes: '拖延会让流民失序、疾病扩散并冲击营地粮道。',
    deadlineAt: NARRATIVE_QUALITY_PASSIVE_TURN_SEQUENCE.deadlineAt,
    priority: 'high',
    severity: 'critical',
    relatedLocationIds: [locationId],
    createdAt: currentDate,
    updatedAt: currentDate,
  }];
  return state;
}

function makeRemoteState(): RuntimeState {
  const currentDate = '公元194年05月10日 08:00（辰时）';
  const state = makeBaseState(currentDate, 'loc_batch5_xiangyang_office', '荆州 - 南郡 - 襄阳城 - 官署');
  state.npcs = [{
    npcId: 'npc_batch5_xunyou',
    name: '荀攸',
    sex: '男',
    age: 37,
    role: '远在洛阳旧官署网络中的故交',
    locationId: 'loc_luoyang',
    isPresent: false,
    isFocused: false,
    summary: '掌握一条即将失效的京师军情递送路线。',
    appearance: '不在当前场景。',
    personality: '谨慎、重视消息来源与递送安全。',
    motivation: '在驿路封闭前把一份警告送到玩家手中。',
    relationToPlayer: '旧识，存在尚未送达的紧急警告与未解决风险。',
    contactLevel: 65,
    recentAttitude: '急于建立可信联系',
    memories: [],
  }];
  state.npcAwarenessIndex = [{
    awarenessId: 'aware_batch5_xunyou_warning',
    npcId: 'npc_batch5_xunyou',
    name: '荀攸',
    sourceType: 'worldTrend',
    sourceIds: ['trend_batch5_courier_route'],
    contactLevel: 65,
    historicalImportance: 60,
    playerRelevance: ['old-relationship', 'direct-warning'],
    unresolvedHooks: ['驿路即将封闭', '警告尚未送达'],
    knownToPlayer: true,
    archiveVisible: false,
    updatedAt: currentDate,
  }];
  state.worldTrends = [{
    trendId: 'trend_batch5_courier_route',
    title: '京师驿路即将封闭',
    severity: '极高',
    summary: '连接洛阳与荆州的最后一条可信递送路线可能在今夜后中断。',
    knownToPlayer: true,
    status: 'active',
    scope: 'regional',
    certainty: 'confirmed',
    source: '驿站与故交的交叉消息',
    nextCheckAt: currentDate,
    npcAwarenessRefs: [{ npcId: 'npc_batch5_xunyou', name: '荀攸', playerRelevance: ['direct-warning'] }],
    updatedAt: currentDate,
  }];
  return state;
}

function makeTroop(
  troopId: string,
  name: string,
  size: number,
  upkeepSource: NonNullable<TroopLedgerEntry['upkeepSource']>,
  troopType = '步卒',
): TroopLedgerEntry {
  return {
    troopId,
    name,
    size,
    factionId: 'faction_batch5_player',
    troopType,
    quality: '中',
    fatigue: '低',
    readiness: '中',
    lifecycleStatus: 'active',
    knownLevel: '亲历',
    certainty: 'confirmed',
    locationId: 'loc_batch5_supply_camp',
    morale: 70,
    training: 65,
    supplies: 60,
    task: '驻防',
    relationToPlayer: '你直接统领',
    upkeepSource,
  };
}

function makeSupplyState(caseId: string): RuntimeState {
  const currentDate = '公元194年08月15日 10:00（巳时）';
  const locationId = 'loc_batch5_supply_camp';
  const state = makeBaseState(currentDate, locationId, '荆州 - 南郡 - 襄阳城 - 汉水大营军需处');
  state.npcs = [{
    npcId: `npc_quartermaster_${caseId}`,
    name: '军需官杜成',
    sex: '男',
    age: 42,
    role: '持有现行钱粮账册的正式军需官',
    locationId,
    isPresent: true,
    isFocused: true,
    summary: '负责按本地账本报告库存、供给结构和下月维护。',
    appearance: '案前摆着本月军需簿。',
    personality: '谨慎、按账目说话，不用模糊夸张替代数字。',
    motivation: '如实报告当前库存和下月责任，不替玩家作调度决定。',
    relationToPlayer: '直接向玩家呈报军需',
    contactLevel: 40,
    recentAttitude: '等待核账提问',
    memories: [],
  }];

  if (caseId === 'sufficient') {
    state.resources = { money: 400, grain: 600, horses: 40, arms: 80, recruits: 0, weapons: [], documents: [], tokens: [], importantSupplies: [] };
    state.troops = [makeTroop('troop_supply_player', '荆州步卒营', 120, 'player_resources')];
  } else if (caseId === 'mixedProvision') {
    state.resources = { money: 100, grain: 180, horses: 18, arms: 30, recruits: 0, weapons: [], documents: [], tokens: [], importantSupplies: [] };
    state.troops = [
      makeTroop('troop_supply_mixed', '荆州合供骑队', 160, 'mixed', '骑兵'),
      makeTroop('troop_supply_superior', '州府援军', 180, 'superior_provision'),
    ];
  } else {
    state.resources = { money: 4, grain: 45, horses: 1, arms: 2, recruits: 0, weapons: [], documents: [], tokens: [], importantSupplies: [] };
    state.troops = [makeTroop('troop_supply_shortage', '荆州前军营', 360, 'player_resources')];
  }
  return ensureLuanShiState(state);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isUsableLiveNarrative(narrativeText: string): boolean {
  return narrativeText.replace(/\s+/g, '').length >= 120;
}

async function executeLiveTurnWithRetry(state: RuntimeState, playerInput: string): Promise<TurnResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      if (attempt === 0) await delay(2_000);
      const result = await executeTurn(worldBook_ThreeKingdoms, state, playerInput, {
        apiConfig: makeApiConfig(),
        llmClient: new BrowserLlmClient(),
        // Match the production page: keep the public endpoint alive through the streamed response
        // without persisting or printing the private narrative chunks.
        onContentDelta: () => undefined,
      });
      if (!isUsableLiveNarrative(result.narrativeText)) {
        throw new Error('upstream returned a degenerate narrative placeholder');
      }
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        const message = error instanceof Error ? error.message : String(error);
        const capacityBackoff = /429|capacity|rate limit/i.test(message);
        const transientUpstreamFailure = /(?:500|502|503|504)|\bEOF\b|upstream|connection reset/i.test(message);
        await delay(
          capacityBackoff
            ? 30_000 * (attempt + 1)
            : transientUpstreamFailure
              ? 15_000 * (attempt + 1)
              : 5_000 * (attempt + 1),
        );
      }
    }
  }
  throw lastError;
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.filter((pattern) => pattern.test(text)).length;
}

function hasUnrequestedPlayerDialogue(text: string, playerInput: string, playerName: string): boolean {
  if (DIRECT_QUOTE_MARKER.test(playerInput)) return false;
  if (text.includes(`【${playerName}】`)) return true;
  const escapedPlayerName = playerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`我(?:乃|是|叫|名为)?${escapedPlayerName}(?:愿|将|决定|答应|同意|接受|承诺|下令)?`).test(text);
}

function formatChineseInteger(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 9_999) return '';
  if (value === 0) return '零';
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const units = ['', '十', '百', '千'];
  const source = String(value).split('').map(Number);
  const parts: string[] = [];
  let pendingZero = false;
  for (let index = 0; index < source.length; index += 1) {
    const digit = source[index];
    const unitIndex = source.length - index - 1;
    if (digit === 0) {
      pendingZero = parts.length > 0 && source.slice(index + 1).some((next) => next !== 0);
      continue;
    }
    if (pendingZero) parts.push('零');
    pendingZero = false;
    const omitLeadingOne = digit === 1 && unitIndex === 1 && parts.length === 0;
    if (!omitLeadingOne) parts.push(digits[digit]);
    parts.push(units[unitIndex]);
  }
  return parts.join('');
}

function includesNumericAnchor(text: string, value: number): boolean {
  if (text.includes(String(value))) return true;
  const chinese = formatChineseInteger(value);
  return Boolean(chinese && text.includes(chinese));
}

function collectCohortStyleFlags(samples: QualitySampleResult[]): string[] {
  if (samples.length === 0) return [];
  const flags = COHORT_STYLE_CARRIERS.flatMap(({ id, pattern, maxRate }) => {
    const sampleCount = samples.filter((sample) => pattern.test(sample.narrativeText)).length;
    return sampleCount / samples.length > maxRate
      ? [`cohort-carrier-overuse:${id}:${sampleCount}/${samples.length}`]
      : [];
  });
  const duplicateCounts = new Map<string, number>();
  for (const sample of samples) {
    const normalized = sample.narrativeText.replace(/\s+/g, '');
    duplicateCounts.set(normalized, (duplicateCounts.get(normalized) ?? 0) + 1);
  }
  const largestDuplicateGroup = Math.max(...duplicateCounts.values());
  if (largestDuplicateGroup > 1) {
    flags.push(`cohort-exact-duplicate:${largestDuplicateGroup}/${samples.length}`);
  }
  return flags;
}

function scoreLanguage(text: string): { score: NarrativeQualityScore; flags: string[] } {
  const flags: string[] = [];
  if (INTERNAL_PROTOCOL_LEAK.test(text)) flags.push('internal-protocol-leak');
  const parentheticalCount = (text.match(/[（(][^）)]{2,80}[）)]/g) ?? []).length;
  if (parentheticalCount >= 5) flags.push('parenthetical-action-overuse');
  const comparisonCount = (text.match(/仿佛|如同|宛如|犹如|好似/g) ?? []).length;
  if (comparisonCount >= 3) flags.push('comparison-overuse');
  const opening = text.replace(/^\s+/, '').slice(0, 260);
  if (countMatches(opening, GENERIC_ATMOSPHERE_PATTERNS) >= 3) {
    flags.push('generic-atmosphere-package');
  }
  if (text.length < 180) flags.push('thin-narrative');
  if (flags.includes('internal-protocol-leak')) return { score: 0, flags };
  return { score: flags.length === 0 ? 2 : 1, flags };
}

function scoreHistorical(
  entry: NarrativeQualityEvaluationCase,
  playerInput: string,
  result: TurnResult,
): { scores: QualityScores; flags: string[] } {
  const text = result.narrativeText;
  const flags: string[] = [];
  const signatureHits = countMatches(text, HISTORICAL_SIGNATURES[entry.id] ?? []);
  const forbiddenHits = countMatches(text, HISTORICAL_FORBIDDEN[entry.id] ?? []);
  if (forbiddenHits > 0) flags.push('historical-boundary-violation');
  if (AGENCY_VIOLATION.test(text) || hasUnrequestedPlayerDialogue(text, playerInput, result.newRuntimeState.player.name)) {
    flags.push('player-agency-violation');
  }
  if (!text.includes(entry.npc.name)) flags.push('historical-npc-not-visible');
  const language = scoreLanguage(text);
  flags.push(...language.flags);

  return {
    scores: {
      characterDistinctiveness: signatureHits >= 2 ? 2 : signatureHits === 1 ? 1 : 0,
      languageNaturalness: language.score,
      narrativeMomentum: text.includes(entry.npc.name) && text.length >= 180 ? 2 : 1,
      factConsistency: forbiddenHits === 0
        && !AGENCY_VIOLATION.test(text)
        && !hasUnrequestedPlayerDialogue(text, playerInput, result.newRuntimeState.player.name)
        ? 2
        : 0,
    },
    flags,
  };
}

function collectPatchTypes(result: TurnResult): string[] {
  return (result.statePatches ?? []).map((patch) => patch.type);
}

function toSample(
  ordinal: number,
  caseId: string,
  category: SampleCategory,
  result: TurnResult,
  scores: QualityScores,
  flags: string[],
  npcName?: string,
): QualitySampleResult {
  return {
    ordinal,
    caseId,
    category,
    npcName,
    narrativeText: result.narrativeText,
    nextState: result.newRuntimeState,
    promptModuleIds: result.promptModules.map((module) => module.id),
    promptEstimatedTokens: result.promptEstimatedTokens,
    patchTypes: collectPatchTypes(result),
    locationWarnings: result.locationWritebackErrors.length + result.routeWritebackErrors.length,
    scores,
    flags,
  };
}

async function runHistoricalPair(entry: NarrativeQualityEvaluationCase, firstOrdinal: number): Promise<QualitySampleResult[]> {
  let state = makeHistoricalState(entry);
  const inputs = [
    entry.playerAction,
    `我不作额外承诺，只请${entry.npc.name}说明他最担心的现实代价，并给出一个可执行的下一步。`,
  ];
  const samples: QualitySampleResult[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const caseId = `${entry.id}_${index + 1}`;
    const cached = findCheckpointSample(firstOrdinal + index, caseId);
    if (cached) {
      samples.push(cached);
      state = cached.nextState;
      continue;
    }
    const result = await executeLiveTurnWithRetry(state, inputs[index]);
    const scored = scoreHistorical(entry, inputs[index], result);
    const sample = toSample(
      firstOrdinal + index,
      caseId,
      'historical',
      result,
      scored.scores,
      scored.flags,
      entry.npc.name,
    );
    samples.push(sample);
    persistCheckpointSample(sample);
    state = result.newRuntimeState;
  }
  return samples;
}

async function runPassiveSequence(limit = NARRATIVE_QUALITY_PASSIVE_TURN_SEQUENCE.actions.length): Promise<QualitySampleResult[]> {
  let state = makePassiveState();
  const samples: QualitySampleResult[] = [];
  const actionCount = Math.min(limit, NARRATIVE_QUALITY_PASSIVE_TURN_SEQUENCE.actions.length);
  for (let index = 0; index < actionCount; index += 1) {
    const caseId = `passive_pressure_${index + 1}`;
    const cached = findCheckpointSample(17 + index, caseId);
    if (cached) {
      samples.push(cached);
      state = cached.nextState;
      continue;
    }
    const result = await executeLiveTurnWithRetry(
      state,
      NARRATIVE_QUALITY_PASSIVE_TURN_SEQUENCE.actions[index],
    );
    const text = result.narrativeText;
    const delivered = PRESSURE_DELIVERY.test(text);
    const language = scoreLanguage(text);
    const flags = [...language.flags];
    if (AGENCY_VIOLATION.test(text)
      || hasUnrequestedPlayerDialogue(text, NARRATIVE_QUALITY_PASSIVE_TURN_SEQUENCE.actions[index], state.player.name)) {
      flags.push('player-agency-violation');
    }
    const sample = toSample(
      17 + index,
      caseId,
      'passive',
      result,
      {
        characterDistinctiveness: 1,
        languageNaturalness: language.score,
        narrativeMomentum: delivered ? 2 : text.length >= 180 ? 1 : 0,
        factConsistency: AGENCY_VIOLATION.test(text)
          || hasUnrequestedPlayerDialogue(text, NARRATIVE_QUALITY_PASSIVE_TURN_SEQUENCE.actions[index], state.player.name)
          ? 0
          : 2,
      },
      flags,
    );
    samples.push(sample);
    persistCheckpointSample(sample);
    state = result.newRuntimeState;
  }
  return samples;
}

async function runRemoteDelivery(): Promise<QualitySampleResult[]> {
  const cached = findCheckpointSample(27, 'remote_xunyou_delivery');
  if (cached) return [cached];
  const state = makeRemoteState();
  const playerInput = '我留在官署核对日常文书，不主动安排新的差事。';
  const result = await executeLiveTurnWithRetry(state, playerInput);
  const delivered = result.narrativeText.includes('荀攸') && REMOTE_DELIVERY.test(result.narrativeText);
  const language = scoreLanguage(result.narrativeText);
  const sample = toSample(
    27,
    'remote_xunyou_delivery',
    'remote',
    result,
    {
      characterDistinctiveness: result.narrativeText.includes('荀攸') ? 2 : 0,
      languageNaturalness: language.score,
      narrativeMomentum: delivered ? 2 : 0,
      factConsistency: AGENCY_VIOLATION.test(result.narrativeText)
        || hasUnrequestedPlayerDialogue(result.narrativeText, playerInput, state.player.name)
        ? 0
        : 2,
    },
    [
      ...language.flags,
      ...(delivered ? [] : ['remote-delivery-missing']),
      ...(AGENCY_VIOLATION.test(result.narrativeText)
        || hasUnrequestedPlayerDialogue(result.narrativeText, playerInput, state.player.name)
        ? ['player-agency-violation']
        : []),
    ],
    '荀攸',
  );
  persistCheckpointSample(sample);
  return [sample];
}

function collectSupplyNumericAnchors(state: RuntimeState): number[] {
  const projection = buildMilitarySupplyNarrativeProjection(state).data;
  if (!projection) return [];
  return [
    projection.currentResources.grain,
    projection.monthlyRequired.grain,
    projection.externalProvision.grain,
    projection.playerRequired.grain,
    projection.shortage.grain,
  ].filter((value, index, values) => value > 0 && values.indexOf(value) === index);
}

async function runSupplyCase(caseId: string, ordinal: number): Promise<QualitySampleResult[]> {
  const fullCaseId = `supply_${caseId}`;
  const cached = findCheckpointSample(ordinal, fullCaseId);
  if (cached) return [cached];
  const state = makeSupplyState(caseId);
  const anchors = collectSupplyNumericAnchors(state);
  const playerInput = '我请军需官杜成对着现行账册逐项报告：当前粮草、下月总需、上级供给、玩家库存应承担和现有缺口。只报账本数字，不替我作调度决定。';
  const result = await executeLiveTurnWithRetry(state, playerInput);
  const numericHits = anchors.filter((value) => includesNumericAnchor(result.narrativeText, value)).length;
  const requiredHits = Math.min(2, anchors.length);
  const consistent = numericHits >= requiredHits;
  const language = scoreLanguage(result.narrativeText);
  const sample = toSample(
    ordinal,
    fullCaseId,
    'supply',
    result,
    {
      characterDistinctiveness: result.narrativeText.includes('军需官') || result.narrativeText.includes('杜成') ? 2 : 1,
      languageNaturalness: language.score,
      narrativeMomentum: result.narrativeText.length >= 180 ? 2 : 1,
      factConsistency: consistent
        && !AGENCY_VIOLATION.test(result.narrativeText)
        && !hasUnrequestedPlayerDialogue(result.narrativeText, playerInput, state.player.name)
        ? 2
        : 0,
    },
    [
      ...language.flags,
      ...(consistent ? [] : [`supply-numeric-mismatch:${numericHits}/${requiredHits}`]),
      ...(AGENCY_VIOLATION.test(result.narrativeText)
        || hasUnrequestedPlayerDialogue(result.narrativeText, playerInput, state.player.name)
        ? ['player-agency-violation']
        : []),
    ],
    '军需官杜成',
  );
  persistCheckpointSample(sample);
  return [sample];
}

function average(samples: QualitySampleResult[], key: keyof QualityScores): number {
  return samples.reduce((sum, sample) => sum + sample.scores[key], 0) / samples.length;
}

function redactedSummary(sample: QualitySampleResult): Record<string, unknown> {
  return {
    ordinal: sample.ordinal,
    caseId: sample.caseId,
    category: sample.category,
    npcName: sample.npcName,
    narrativeChars: sample.narrativeText.length,
    excerpt: sample.narrativeText.replace(/\s+/g, ' ').slice(0, 120),
    promptEstimatedTokens: sample.promptEstimatedTokens,
    promptModuleIds: sample.promptModuleIds,
    patchTypes: sample.patchTypes,
    locationWarnings: sample.locationWarnings,
    scores: sample.scores,
    flags: sample.flags,
  };
}

describe('Narrative Content Quality V1 acceptance scoring', () => {
  it('rejects an upstream placeholder that is too short to be a playable turn', () => {
    expect(isUsableLiveNarrative('暂时无法生成正文，请稍后重试。')).toBe(false);
    expect(isUsableLiveNarrative('【旁白】军报封泥已裂，曹操先问粮道还剩几日，随后把舆图推到你面前。'.repeat(5))).toBe(true);
  });

  it('accepts exact ledger values written as Chinese numerals', () => {
    expect(includesNumericAnchor('粮草六百石，月需一百二十石。', 600)).toBe(true);
    expect(includesNumericAnchor('粮草六百石，月需一百二十石。', 120)).toBe(true);
    expect(includesNumericAnchor('缺口八十三石。', 83)).toBe(true);
    expect(includesNumericAnchor('缺口八十三石。', 84)).toBe(false);
  });

  it('distinguishes quoted player wording from invented player dialogue', () => {
    expect(hasUnrequestedPlayerDialogue('【刘平】“我答应。”', '我询问军需。', '刘平')).toBe(true);
    expect(hasUnrequestedPlayerDialogue('我刘平愿以军司马之职代为上奏。', '我陈述风险。', '刘平')).toBe(true);
    expect(hasUnrequestedPlayerDialogue('【曹操】我愿先核对兵符。', '我陈述风险。', '刘平')).toBe(false);
    expect(hasUnrequestedPlayerDialogue('【刘平】“按账直报。”', '我说：“按账直报。”', '刘平')).toBe(false);
  });

  it('treats wrong-era identity substitution and duplicate narratives as blocking evidence', () => {
    expect(countMatches('曹丕称曹丞相，准备向献帝上奏。', HISTORICAL_FORBIDDEN.cao_cao_early_office_negotiation)).toBeGreaterThan(0);
    const duplicateSample = (ordinal: number): QualitySampleResult => ({
      ordinal,
      caseId: `duplicate_${ordinal}`,
      category: 'historical',
      npcName: '曹操',
      narrativeText: ordinal === 1 ? '【旁白】同一段正文。' : ' 【旁白】 同一段正文。 ',
      nextState: {} as RuntimeState,
      promptModuleIds: [],
      promptEstimatedTokens: 0,
      patchTypes: [],
      locationWarnings: 0,
      scores: { characterDistinctiveness: 0, languageNaturalness: 0, narrativeMomentum: 0, factConsistency: 0 },
      flags: [],
    });
    expect(collectCohortStyleFlags([duplicateSample(1), duplicateSample(2)]))
      .toContain('cohort-exact-duplicate:2/2');
  });

  it('penalizes a stacked generic atmosphere package without banning isolated details', () => {
    expect(scoreLanguage('【旁白】烛火摇曳，帐中一时寂然，空气仿佛凝固。他的目光锐利，呼吸沉重。随后才打开军报。').score).toBe(1);
    expect(scoreLanguage('【旁白】军报封泥已裂，曹操先问粮道还剩几日，随后把舆图推到你面前。'.repeat(6)).score).toBe(2);
  });
});

describe.skipIf(!REAL_API_ENABLED || REAL_API_MODE !== 'targeted')('Narrative Content Quality V1 targeted post-fix real API acceptance', () => {
  it('rechecks the failing style and player-boundary slices without repeating settled long-run coverage', async () => {
    const selectedIds = new Set([
      'cao_cao_early_office_negotiation',
      'sun_jian_after_battle_supply',
      'lv_bu_loyalty_crisis',
      'yuan_shao_coalition_council',
    ]);
    const selectedHistorical = NARRATIVE_QUALITY_BASELINE_CASES.filter((entry) => selectedIds.has(entry.id));
    const samples: QualitySampleResult[] = [];
    for (let index = 0; index < selectedHistorical.length; index += 1) {
      samples.push(...await runHistoricalPair(selectedHistorical[index], index * 2 + 1));
    }
    samples.push(...await runPassiveSequence(2));
    samples.push(...await runRemoteDelivery());
    samples.push(...await runSupplyCase('sufficient', 28));
    samples.sort((left, right) => left.ordinal - right.ordinal);

    const blockingFlags = samples.flatMap((sample) => sample.flags
      .filter((flag) => (
        flag === 'historical-boundary-violation'
        || flag === 'historical-npc-not-visible'
        || flag === 'player-agency-violation'
        || flag === 'internal-protocol-leak'
        || flag === 'remote-delivery-missing'
        || flag.startsWith('supply-numeric-mismatch')
      ))
      .map((flag) => `${sample.caseId}:${flag}`));
    const cohortStyleFlags = collectCohortStyleFlags(samples);
    const historicalSamples = samples.filter((sample) => sample.category === 'historical');

    console.log('NARRATIVE_QUALITY_BATCH5_TARGETED_SUMMARY', JSON.stringify({
      sampleCount: samples.length,
      blockingFlags,
      cohortStyleFlags,
      historicalCharacterDistinctiveness: average(historicalSamples, 'characterDistinctiveness'),
      languageNaturalness: average(samples, 'languageNaturalness'),
      locationWarnings: samples.reduce((sum, sample) => sum + sample.locationWarnings, 0),
    }));
    for (const sample of samples) {
      console.log('NARRATIVE_QUALITY_BATCH5_TARGETED_SAMPLE', JSON.stringify(redactedSummary(sample)));
    }

    expect(samples).toHaveLength(12);
    expect(historicalSamples).toHaveLength(8);
    expect(blockingFlags).toEqual([]);
    expect(cohortStyleFlags).toEqual([]);
    expect(average(historicalSamples, 'characterDistinctiveness')).toBeGreaterThanOrEqual(1.5);
    expect(average(samples, 'languageNaturalness')).toBeGreaterThanOrEqual(1.5);
    expect(samples.filter((sample) => sample.category === 'passive')).toHaveLength(2);
    expect(samples.some((sample) => sample.category === 'passive' && sample.scores.narrativeMomentum === 2)).toBe(true);
    expect(samples.some((sample) => sample.category === 'remote' && sample.scores.narrativeMomentum === 2)).toBe(true);
    expect(samples.some((sample) => sample.category === 'supply' && sample.scores.factConsistency === 2)).toBe(true);
    expect(samples.reduce((sum, sample) => sum + sample.locationWarnings, 0)).toBe(0);
  }, 3_600_000);
});

describe.skipIf(!REAL_API_ENABLED || REAL_API_MODE !== 'full')('Narrative Content Quality V1 Batch 5 real API long run', () => {
  it('runs 30 isolated production turns and meets the fixed acceptance gates', async () => {
    const samples: QualitySampleResult[] = [];
    for (let index = 0; index < NARRATIVE_QUALITY_BASELINE_CASES.length; index += 1) {
      samples.push(...await runHistoricalPair(NARRATIVE_QUALITY_BASELINE_CASES[index], index * 2 + 1));
    }
    samples.push(...await runPassiveSequence());
    samples.push(...await runRemoteDelivery());
    for (let index = 0; index < NARRATIVE_QUALITY_SUPPLY_CASES.length; index += 1) {
      samples.push(...await runSupplyCase(NARRATIVE_QUALITY_SUPPLY_CASES[index].id, 28 + index));
    }
    samples.sort((left, right) => left.ordinal - right.ordinal);
    const pressureSamples = samples.filter((sample) => sample.category === 'passive');
    const historicalSamples = samples.filter((sample) => sample.category === 'historical');
    const firstPressureDelivery = pressureSamples.findIndex((sample) => sample.scores.narrativeMomentum === 2) + 1;
    const blockingFlags = samples.flatMap((sample) => sample.flags
      .filter((flag) => (
        flag === 'historical-boundary-violation'
        || flag === 'historical-npc-not-visible'
        || flag === 'player-agency-violation'
        || flag === 'internal-protocol-leak'
        || flag === 'remote-delivery-missing'
        || flag.startsWith('supply-numeric-mismatch')
      ))
      .map((flag) => `${sample.caseId}:${flag}`));
    const cohortStyleFlags = collectCohortStyleFlags(samples);
    const averages = {
      historicalCharacterDistinctiveness: average(historicalSamples, 'characterDistinctiveness'),
      languageNaturalness: average(samples, 'languageNaturalness'),
      narrativeMomentum: average(samples, 'narrativeMomentum'),
      factConsistency: average(samples, 'factConsistency'),
    };

    console.log('NARRATIVE_QUALITY_BATCH5_SUMMARY', JSON.stringify({
      sampleCount: samples.length,
      historicalNpcCount: new Set(samples.filter((sample) => sample.category === 'historical').map((sample) => sample.npcName)).size,
      passiveTurnCount: pressureSamples.length,
      firstPressureDelivery,
      supplyCaseCount: samples.filter((sample) => sample.category === 'supply').length,
      remoteDeliveryCount: samples.filter((sample) => sample.category === 'remote' && sample.scores.narrativeMomentum === 2).length,
      blockingFlags,
      cohortStyleFlags,
      averages,
    }));
    for (const sample of samples) {
      console.log('NARRATIVE_QUALITY_BATCH5_SAMPLE', JSON.stringify(redactedSummary(sample)));
    }

    expect(samples).toHaveLength(30);
    expect(new Set(samples.filter((sample) => sample.category === 'historical').map((sample) => sample.npcName)).size).toBe(8);
    expect(pressureSamples).toHaveLength(10);
    expect(firstPressureDelivery).toBeGreaterThan(0);
    expect(firstPressureDelivery).toBeLessThanOrEqual(2);
    expect(samples.filter((sample) => sample.category === 'supply')).toHaveLength(3);
    expect(samples.filter((sample) => sample.category === 'remote' && sample.scores.narrativeMomentum === 2)).toHaveLength(1);
    expect(blockingFlags).toEqual([]);
    expect(cohortStyleFlags).toEqual([]);
    expect(averages.historicalCharacterDistinctiveness).toBeGreaterThanOrEqual(1.5);
    expect(averages.languageNaturalness).toBeGreaterThanOrEqual(1.5);
    expect(averages.narrativeMomentum).toBeGreaterThanOrEqual(1.5);
    expect(averages.factConsistency).toBeGreaterThanOrEqual(1.5);
  }, 3_600_000);
});

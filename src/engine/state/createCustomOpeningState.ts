import type {
  Actor,
  CharacterEffect,
  CharacterEquipmentItem,
  CharacterReputation,
  CharacterTrait,
  CharacterVitals,
  InventoryItem,
  MapNode,
  PlayerMemory,
  GameDifficultyLevel,
  NarrativePerspective,
  RuntimeState,
  StartBookmark,
  WorldlineRuntimeSettings,
  WorldBook,
} from '../types';
import { createPendingOpeningLoadout } from '../character/openingLoadout';
import { clampReputationScore, getFameTierLabel, getMoralityTierLabel } from '../character/reputation';
import { formatGameClock, tryCreateGameClockFromDateLabel } from '../time/gameClock';
import { ensureCompleteBirthDate } from '../time/npcAge';
import { ensureLuanShiState } from './createInitialRuntimeState';

export interface CreateCustomOpeningStateInput {
  worldBook: WorldBook;
  bookmark: StartBookmark;
  /** Deprecated: opening crisis is no longer selected locally; the true opening LLM creates the first crisis. */
  crisis?: unknown;
  playerName: string;
  courtesyName?: string;
  playerSex: '男' | '女' | '其他';
  playerAge: number;
  playerBirthMonth?: number;
  playerBirthDay?: number;
  origin: string;
  birthOrigin?: string;
  birthOriginDescription?: string;
  currentIdentity?: string;
  currentIdentityDescription?: string;
  locationId: string;
  sceneId?: string;
  sceneName?: string;
  sceneSummary?: string;
  locationPath?: string;
  situationSummary: string;
  appearance?: string;
  personality?: string;
  abilityScores?: Record<string, number>;
  level?: number;
  xp?: number;
  growthPoints?: number;
  vitals?: CharacterVitals;
  traits?: CharacterTrait[];
  effects?: CharacterEffect[];
  equipment?: CharacterEquipmentItem[];
  inventory?: InventoryItem[];
  personalMoney?: number;
  reputation?: CharacterReputation;
  playerMemory?: PlayerMemory;
  worldlineSettings?: WorldlineRuntimeSettings;
  gameDifficulty?: GameDifficultyLevel;
  combatDifficulty?: GameDifficultyLevel;
  warDifficulty?: GameDifficultyLevel;
  narrativePerspective?: NarrativePerspective;
  openingExtraRequest?: string;
  customNotes?: string;
}

const defaultVitals: CharacterVitals = {
  hp: 100,
  maxHp: 100,
  stamina: 100,
  maxStamina: 100,
};

const defaultReputation: CharacterReputation = {
  morality: 0,
  fame: 0,
  tags: [],
  summary: '德行与名声尚未展开，旁人主要依据出身、身份和眼前行为判断主角。',
};

const findMapNode = (nodes: MapNode[], locationId: string): MapNode | undefined => {
  for (const node of nodes) {
    if (node.id === locationId) return node;
    const child = node.subLocations ? findMapNode(node.subLocations, locationId) : undefined;
    if (child) return child;
  }
  return undefined;
};

const clean = (value?: string) => value?.trim() ?? '';
const floorAtLeast = (value: number | undefined, fallback: number, min = 0) =>
  Math.max(min, Math.floor(Number.isFinite(value) ? Number(value) : fallback));

interface OpeningReputationAccumulator {
  fame: number;
  morality: number;
  tags: CharacterReputation['tags'];
}

function addOpeningReputationTag(
  accumulator: OpeningReputationAccumulator,
  label: string,
  source: string,
): void {
  if (!accumulator.tags.some((tag) => tag.label === label && tag.source === source)) {
    accumulator.tags.push({ label, source });
  }
}

function addOpeningReputation(
  accumulator: OpeningReputationAccumulator,
  fame: number,
  morality: number,
  label: string,
): void {
  accumulator.fame += fame;
  accumulator.morality += morality;
  addOpeningReputationTag(accumulator, label, 'opening');
}

function deriveOpeningReputation(input: {
  origin: string;
  birthOrigin: string;
  currentIdentity: string;
  openingExtraRequest: string;
}): CharacterReputation {
  const accumulator: OpeningReputationAccumulator = {
    fame: 0,
    morality: 0,
    tags: [],
  };
  const originText = `${input.origin} ${input.birthOrigin}`;
  const identityText = input.currentIdentity;
  const extraText = input.openingExtraRequest;

  if (/宗室|世家|大族|士族|豪强|名门/.test(originText)) {
    addOpeningReputation(accumulator, 40, 10, '出身声望');
  } else if (/良家|匠医|医|士子|寒门/.test(originText)) {
    addOpeningReputation(accumulator, 10, 15, '清白出身');
  } else if (/商贾|商旅/.test(originText)) {
    addOpeningReputation(accumulator, 15, -5, '商路名声');
  } else if (/边郡|武家|部曲/.test(originText)) {
    addOpeningReputation(accumulator, 20, 0, '武家声名');
  } else if (/黄巾|贼|盗|流民|流亡|遗户|贫民|佃户/.test(originText)) {
    addOpeningReputation(accumulator, -15, 0, '出身受疑');
  }

  if (/朝中重臣|太守|刺史|州牧|重臣/.test(identityText)) {
    addOpeningReputation(accumulator, 80, 20, '身份名望');
  } else if (/县令|县长|县令长|官|小吏|军中将校|将校|队率|司马/.test(identityText)) {
    addOpeningReputation(accumulator, 45, 10, '身份名望');
  } else if (/游侠|任侠/.test(identityText)) {
    addOpeningReputation(accumulator, 35, 15, '任侠名声');
  } else if (/医者|方士|商旅|门客|幕僚|在野士人/.test(identityText)) {
    addOpeningReputation(accumulator, 20, 5, '身份小名');
  } else if (/黄巾|流亡|逃亡|盗|贼/.test(identityText)) {
    addOpeningReputation(accumulator, -45, -10, '身份受疑');
  }

  if (/清名|善名|仁义|有德|德望|赈济|救人|义举|乡里称/.test(extraText)) {
    addOpeningReputation(accumulator, 20, 85, '清名善行');
  }
  if (/恶名|骂名|失德|恶行|残暴|屠|劫掠|盗匪|贼名/.test(extraText)) {
    addOpeningReputation(accumulator, -80, -80, '恶名旧闻');
  }
  if (/无名|未成名|低调|隐姓|不为人知|不要.*有名|别.*有名/.test(extraText)) {
    accumulator.fame = Math.trunc(accumulator.fame / 2);
    addOpeningReputationTag(accumulator, '低调无名', 'opening');
  }

  const fame = clampReputationScore(accumulator.fame);
  const morality = clampReputationScore(accumulator.morality);
  const summary = accumulator.tags.length > 0
    ? `开局公论：名声${fame}（${getFameTierLabel(fame)}），德行${morality}（${getMoralityTierLabel(morality)}）；由${accumulator.tags.map((tag) => tag.label).join('、')}派生。`
    : defaultReputation.summary;

  return {
    fame,
    morality,
    tags: accumulator.tags,
    summary,
  };
}

export function createCustomOpeningState(input: CreateCustomOpeningStateInput) {
  const {
    worldBook,
    bookmark,
    playerName,
    courtesyName,
    playerSex,
    playerAge,
    playerBirthMonth,
    playerBirthDay,
    origin,
    birthOrigin,
    birthOriginDescription,
    currentIdentity,
    currentIdentityDescription,
    locationId,
    sceneId,
    sceneName,
    sceneSummary,
    locationPath,
    situationSummary,
    appearance,
    personality,
    abilityScores,
    level,
    xp,
    growthPoints,
    vitals,
    traits,
    effects,
    equipment,
    inventory,
    personalMoney,
    reputation,
    playerMemory,
    worldlineSettings,
    gameDifficulty,
    combatDifficulty,
    warDifficulty,
    narrativePerspective,
    openingExtraRequest,
    customNotes,
  } = input;

  const location = findMapNode(worldBook.openingLocationSeed ?? worldBook.mapSeed, locationId);
  const scene = sceneId ? findMapNode(location?.subLocations ?? [], sceneId) : undefined;
  const pendingLoadout = createPendingOpeningLoadout();
  const safeName = clean(playerName) || '无名氏';
  const safeCourtesyName = clean(courtesyName);
  const safeAppearance = clean(appearance);
  const safePersonality = clean(personality);
  const safeBirthOrigin = clean(birthOrigin);
  const safeBirthOriginDescription = clean(birthOriginDescription);
  const safeCurrentIdentity = clean(currentIdentity);
  const safeCurrentIdentityDescription = clean(currentIdentityDescription);
  const safeOpeningExtraRequest = clean(openingExtraRequest);
  const safeSceneId = clean(sceneId);
  const safeSceneName = clean(sceneName) || scene?.name || '';
  const safeSceneSummary = clean(sceneSummary) || scene?.summary || '';
  const safeLocationPath = clean(locationPath);
  const safeSituation = clean(situationSummary) || `${safeName}以${origin}身份踏入乱世。`;
  const openingClock = tryCreateGameClockFromDateLabel(bookmark.startDate);
  const openingDateLabel = openingClock ? formatGameClock(openingClock) : bookmark.startDate;
  const normalizedPlayerAge = floorAtLeast(playerAge, 18, 1);
  const playerBirthDate = ensureCompleteBirthDate({
    age: normalizedPlayerAge,
    currentDate: openingDateLabel,
    stableId: 'player_1',
    preferredMonth: playerBirthMonth,
    preferredDay: playerBirthDay,
  });
  const openingDeedSummary = `自定义开局：${safeName}以${origin}身份开始行动。`;
  const normalizedVitals = vitals ?? defaultVitals;
  const normalizedReputation = reputation ?? deriveOpeningReputation({
    origin,
    birthOrigin: safeBirthOrigin,
    currentIdentity: safeCurrentIdentity,
    openingExtraRequest: safeOpeningExtraRequest,
  });
  const normalizedTraits = traits ?? [];
  const normalizedOpeningTraitDetails = normalizedTraits.map((trait) => ({
    id: trait.id,
    label: trait.label,
    description: trait.description,
    source: trait.source,
    rarity: trait.rarity ?? '待开局 LLM 判定',
    promptHint: trait.promptHint,
    checkHooks: trait.checkHooks,
  }));  const normalizedEffects = effects ?? [];
  const normalizedEquipment = equipment ?? pendingLoadout.equipment;
  const normalizedInventory = inventory ?? pendingLoadout.inventory;
  const normalizedPersonalMoney = floorAtLeast(personalMoney, pendingLoadout.personalMoney);
  const normalizedPlayerMemory: PlayerMemory = playerMemory ?? {
    summary: [
      safeSituation,
      safeBirthOrigin ? `出身：${safeBirthOrigin}。` : '',
      safeCurrentIdentity ? `身份：${safeCurrentIdentity}。` : '',
      safeLocationPath ? `起点：${safeLocationPath}。` : '',
    ].filter(Boolean).join(''),
    keyDeeds: [
      {
        id: 'deed_opening_initial',
        date: openingDateLabel,
        locationId,
        summary: openingDeedSummary,
        impact: safeSituation,
      },
    ],
    recentTurns: [],
  };

  const summaryParts = [
    `一位${origin}。`,
    safeAppearance ? `外貌：${safeAppearance}。` : '',
    safePersonality ? `性格：${safePersonality}。` : '',
    safeSituation,
  ].filter(Boolean);

  const player: Actor = {
    id: 'player_1',
    name: safeName,
    courtesyName: safeCourtesyName || undefined,
    sex: playerSex,
    age: normalizedPlayerAge,
    birthDate: playerBirthDate,
    roleType: origin,
    socialClass: origin,
    birthOrigin: safeBirthOrigin || undefined,
    birthOriginDescription: safeBirthOriginDescription || undefined,
    currentIdentity: safeCurrentIdentity || undefined,
    currentIdentityDescription: safeCurrentIdentityDescription || undefined,
    locationId,
    appearance: safeAppearance || undefined,
    personality: safePersonality || undefined,
    abilityScores,
    level: floorAtLeast(level, 1, 1),
    xp: floorAtLeast(xp, 0),
    growthPoints: floorAtLeast(growthPoints, 0),
    vitals: normalizedVitals,
    traits: normalizedTraits,
    effects: normalizedEffects,
    equipment: normalizedEquipment,
    inventory: normalizedInventory,
    personalMoney: normalizedPersonalMoney,
    reputation: normalizedReputation,
    playerMemory: normalizedPlayerMemory,
    openingExtraRequest: safeOpeningExtraRequest || undefined,
    summary: summaryParts.join(''),
    situationSummary: safeSituation,
    customNotes: clean(customNotes) || undefined,
  };

  const baseState: RuntimeState = {
    engineVersion: '0.1.0',
    worldBookId: worldBook.manifest.id,
    worldBookVersion: worldBook.manifest.version,
    worldBookSource: worldBook.manifest.source,
    gameDifficulty,
    combatDifficulty,
    warDifficulty,
    narrativePerspective,
    worldlineSettings: {
      knowledgeMode: worldlineSettings?.knowledgeMode ?? 'default',
      knowledgeBaseId: worldlineSettings?.knowledgeBaseId,
      storyPackIds: worldlineSettings?.storyPackIds ?? [],
    },
    startBookmarkId: bookmark.id,
    startDate: openingDateLabel,
    currentDate: openingDateLabel,
    currentTime: openingClock,
    player,
    currentLocationId: locationId,
    currentPlaceId: locationId,
    currentSceneId: safeSceneId || undefined,
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {
      openingSituationSummary: safeSituation,
      openingAppearance: safeAppearance,
      openingPersonality: safePersonality,
      openingBirthOrigin: safeBirthOrigin,
      openingBirthOriginDescription: safeBirthOriginDescription,
      openingCurrentIdentity: safeCurrentIdentity,
      openingCurrentIdentityDescription: safeCurrentIdentityDescription,
      openingAbilityScores: abilityScores ?? {},
      openingLevel: floorAtLeast(level, 1, 1),
      openingVitals: normalizedVitals,
      openingReputation: normalizedReputation,
      openingTraits: normalizedTraits.map((trait) => trait.label),
      openingTraitDetails: normalizedOpeningTraitDetails,
      openingEffects: normalizedEffects.map((effect) => effect.label),
      openingEquipment: normalizedEquipment.map((item) => item.name),
      openingInventory: normalizedInventory.map((item) => `${item.name}x${item.quantity}`),
      openingPersonalMoney: normalizedPersonalMoney,
      openingLoadoutSummary: equipment || inventory || typeof personalMoney === 'number'
        ? '初始行装由外部输入显式提供。'
        : pendingLoadout.summary,
      openingExtraRequest: safeOpeningExtraRequest,
      openingCustomNotes: clean(customNotes),
      openingPlaceId: locationId,
      openingPlaceName: location?.name ?? locationId,
      openingSceneId: safeSceneId,
      openingSceneName: safeSceneName,
      openingSceneSummary: safeSceneSummary,
      openingLocationPath: safeLocationPath || [location?.name, safeSceneName].filter(Boolean).join(' - '),
      openingBookmarkLabel: bookmark.label,
    },
    turnLog: [],
    localSituationNotes: [
      safeSceneName
        ? `初始场景：${safeSceneName}。${safeLocationPath ? `路径：${safeLocationPath}。` : ''}`.trim()
        : '',
    ].filter(Boolean),
  };

  return ensureLuanShiState({
    ...baseState,
    locations: [
      {
        locationId,
        name: location?.name ?? locationId,
        type: location?.level ?? '地点',
        controller: location?.controlHint,
        summary: location?.summary ?? '玩家自定义开局地点，尚待叙事生成细化。',
        knownLevel: '亲历',
        recentEvents: [],
      },
    ],
    routes: [],
    resources: {
      money: 0,
      grain: 0,
      horses: 0,
      arms: 0,
      recruits: 0,
      weapons: [],
      documents: [],
      tokens: [],
      importantSupplies: [],
    },
    factions: [],
    troops: [],
    situationOverview: {
      summary: safeSituation,
      currentPressure: [],
      immediateHooks: [],
    },
    plotPlan: [],
    worldTrends: [
      {
        trendId: 'trend_opening_world',
        title: bookmark.label,
        severity: '中',
        summary: bookmark.situationSummary,
        knownToPlayer: true,
        updatedAt: openingDateLabel,
      },
    ],
    turnEvents: [
      {
        eventId: 'event_opening_initial',
        happenedAt: openingDateLabel,
        locationId,
        summary: openingDeedSummary,
        presentNpcIds: [],
        involvedNpcIds: [],
        visibility: '私密',
      },
    ],
  });
}

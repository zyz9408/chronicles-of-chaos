import type { LlmMessage } from '../engine/llm/LlmClient';
import type {
  CharacterTrait,
  MapNode,
  OpeningCharacterOption,
  WorldlineKnowledgeBase,
  WorldlineKnowledgeCard,
} from '../engine/types';

type HistoricalRoleSex = '男' | '女' | '其他';
type AbilityScores = Record<string, number>;

const DEFAULT_ABILITY_KEYS = ['武力', '统率', '智力', '政治', '魅力', '机运'];
const MAX_PROMPT_LOCATIONS = 120;
const LOCATION_MATCH_MIN_SCORE = 50;
const LOCATION_SUFFIXES = [
  '县城',
  '郡治',
  '城邑',
  '关隘',
  '渡口',
  '港口',
  '市镇',
  '聚落',
  '营寨',
  '驿站',
  '附近',
  '一带',
  '境内',
  '治所',
  '城中',
  '城内',
  '城外',
  '郡',
  '州',
  '国',
  '县',
  '城',
  '关',
];
const LOCATION_ALIAS_GROUPS = [
  { canonical: '许县', aliases: ['许都', '许昌'] },
  { canonical: '沛县城', aliases: ['小沛'] },
  { canonical: '下邳城', aliases: ['下邳'] },
];
const LOCATION_ALIAS_TO_CANONICAL_VARIANTS = buildLocationAliasToCanonicalVariants();
const LOCATION_ALIASES_BY_CANONICAL = buildLocationAliasesByCanonical();
const ABILITY_KEY_ALIASES: Record<string, string> = {
  [normalizeText('武力')]: '武力',
  [normalizeText('武')]: '武力',
  [normalizeText('武勇')]: '武力',
  [normalizeText('武艺')]: '武力',
  [normalizeText('战斗')]: '武力',
  [normalizeText('force')]: '武力',
  [normalizeText('martial')]: '武力',
  [normalizeText('combat')]: '武力',
  [normalizeText('统率')]: '统率',
  [normalizeText('统帅')]: '统率',
  [normalizeText('统率力')]: '统率',
  [normalizeText('统御')]: '统率',
  [normalizeText('指挥')]: '统率',
  [normalizeText('command')]: '统率',
  [normalizeText('commander')]: '统率',
  [normalizeText('leadership')]: '统率',
  [normalizeText('智力')]: '智力',
  [normalizeText('智')]: '智力',
  [normalizeText('智谋')]: '智力',
  [normalizeText('谋略')]: '智力',
  [normalizeText('才智')]: '智力',
  [normalizeText('intelligence')]: '智力',
  [normalizeText('intellect')]: '智力',
  [normalizeText('wisdom')]: '智力',
  [normalizeText('strategy')]: '智力',
  [normalizeText('政治')]: '政治',
  [normalizeText('政')]: '政治',
  [normalizeText('政务')]: '政治',
  [normalizeText('治理')]: '政治',
  [normalizeText('politics')]: '政治',
  [normalizeText('governance')]: '政治',
  [normalizeText('administration')]: '政治',
  [normalizeText('魅力')]: '魅力',
  [normalizeText('魅')]: '魅力',
  [normalizeText('人望')]: '魅力',
  [normalizeText('声望')]: '魅力',
  [normalizeText('charm')]: '魅力',
  [normalizeText('charisma')]: '魅力',
  [normalizeText('机运')]: '机运',
  [normalizeText('运')]: '机运',
  [normalizeText('运气')]: '机运',
  [normalizeText('幸运')]: '机运',
  [normalizeText('luck')]: '机运',
  [normalizeText('fortune')]: '机运',
};

export interface HistoricalRoleCompletionPayload {
  name?: string;
  courtesyName?: string;
  sex?: HistoricalRoleSex;
  age?: number;
  appearance?: string;
  personality?: string;
  birthOriginId?: string;
  currentIdentityId?: string;
  locationId?: string;
  situationSummary?: string;
  abilityScores?: AbilityScores;
  traitIds?: string[];
  supplementalNotes?: string;
}

export interface ApplyHistoricalRoleCompletionContext {
  currentHistoricalName: string;
  currentSex: HistoricalRoleSex;
  currentAge: number;
  currentBirthOriginId: string;
  currentIdentityId: string;
  currentLocationId: string;
  currentAbilityScores?: AbilityScores;
  currentTraitIds?: string[];
  birthOrigins: OpeningCharacterOption[];
  identities: OpeningCharacterOption[];
  traits: CharacterTrait[];
  mapSeed: MapNode[];
}

export interface HistoricalRoleLocationPathIds {
  regionId: string;
  commanderyId: string;
  locationId: string;
  sceneId: string;
}

export interface HistoricalRoleCompletionApplication {
  playerName: string;
  historicalName: string;
  courtesyName: string;
  sex: HistoricalRoleSex;
  age: number;
  appearance: string;
  personality: string;
  selectedBirthOriginId: string;
  selectedIdentityId: string;
  selectedLocationId: string;
  selectedLocationPathIds: HistoricalRoleLocationPathIds;
  situationSummary: string;
  abilityScores: AbilityScores;
  selectedTraitIds: string[];
  customNotes: string;
}

export interface BuildHistoricalRoleCompletionMessagesInput {
  worldName: string;
  bookmarkLabel: string;
  bookmarkStartDate?: string;
  bookmarkSummary?: string;
  historicalName: string;
  currentLocationId: string;
  birthOrigins: OpeningCharacterOption[];
  identities: OpeningCharacterOption[];
  traits: CharacterTrait[];
  mapSeed: MapNode[];
  knowledgeHints?: string[];
}

export interface BuildHistoricalRoleKnowledgeHintsInput {
  knowledgeBase?: WorldlineKnowledgeBase;
  worldBookId: string;
  historicalName: string;
  bookmarkLabel?: string;
  bookmarkStartDate?: string;
  bookmarkSummary?: string;
  currentLocationId?: string;
  limit?: number;
}

interface FlattenedMapNode {
  node: MapNode;
  path: MapNode[];
  pathLabel: string;
}

export function parseHistoricalRoleCompletionContent(content: string): HistoricalRoleCompletionPayload {
  const parsed = JSON.parse(extractJsonText(content));
  if (!isPlainObject(parsed)) {
    throw new Error('历史人物补全结果不是 JSON 对象');
  }

  return {
    name: readString(parsed.name),
    courtesyName: readString(parsed.courtesyName ?? parsed.styleName ?? parsed.zi),
    sex: readSex(parsed.sex),
    age: readNumber(parsed.age),
    appearance: readString(parsed.appearance),
    personality: readString(parsed.personality),
    birthOriginId: readString(parsed.birthOriginId ?? parsed.originId),
    currentIdentityId: readString(parsed.currentIdentityId ?? parsed.identityId),
    locationId: readLocationCandidate(parsed),
    situationSummary: readString(parsed.situationSummary ?? parsed.openingSituation),
    abilityScores: readAbilityScores(parsed.abilityScores),
    traitIds: readStringArray(parsed.traitIds),
    supplementalNotes: readString(parsed.supplementalNotes ?? parsed.customNotes ?? parsed.notes),
  };
}

export function applyHistoricalRoleCompletion(
  payload: HistoricalRoleCompletionPayload,
  context: ApplyHistoricalRoleCompletionContext,
): HistoricalRoleCompletionApplication {
  const allLocations = flattenMapNodes(context.mapSeed);
  const selectedLocation = resolveOpeningPlace(resolveLocation(payload.locationId, allLocations, context.currentLocationId));
  const pathIds = toLocationPathIds(selectedLocation);
  const name = trimOr(payload.name, context.currentHistoricalName);
  const selectedBirthOriginId = resolveOptionId(payload.birthOriginId, context.birthOrigins, context.currentBirthOriginId);
  const selectedIdentityId = resolveOptionId(payload.currentIdentityId, context.identities, context.currentIdentityId);
  const abilityScores = normalizeAbilityScores(payload.abilityScores, context.currentAbilityScores);
  const selectedTraitIds = normalizeTraitIds(payload.traitIds, context.traits, context.currentTraitIds);
  const situationSummary = trimOr(
    payload.situationSummary,
    `扮演历史人物${name}，以所选剧本与资料库补全后的档案进入乱世。`,
  );

  return {
    playerName: name,
    historicalName: name,
    courtesyName: trimOr(payload.courtesyName, ''),
    sex: payload.sex ?? context.currentSex,
    age: clampAge(payload.age ?? context.currentAge),
    appearance: trimOr(payload.appearance, ''),
    personality: trimOr(payload.personality, ''),
    selectedBirthOriginId,
    selectedIdentityId,
    selectedLocationId: pathIds.locationId,
    selectedLocationPathIds: pathIds,
    situationSummary,
    abilityScores,
    selectedTraitIds,
    customNotes: trimOr(
      payload.supplementalNotes,
      `史实人物补全：${name}；后续开场剧情应按当前剧本、身份、地点和资料库承接，不提前套用后期身份。`,
    ),
  };
}

export function buildHistoricalRoleCompletionMessages(
  input: BuildHistoricalRoleCompletionMessagesInput,
): LlmMessage[] {
  const locationOptions = formatLocationOptions(input.mapSeed, input.currentLocationId);
  const knowledgeHintText = input.knowledgeHints?.length
    ? input.knowledgeHints.map((hint, index) => `${index + 1}. ${hint}`).join('\n')
    : '无。';

  return [
    {
      role: 'system',
      content: [
        '你是乱世风云录的史实人物开局档案补全助手。',
        '你的任务是根据剧本节点、世界书选项、资料库提示和模型常识，补全可编辑的开局表单字段。',
        '不得把所有内容堆进补充设定；必须把外貌、性格、年龄、出身、当前身份、初始地点、能力和特质分别填入 JSON 字段。',
        '若史实人物与剧本年份冲突，按本局开局时间给出自洽状态，不提前套用后期身份、官爵、领地或势力成果。',
        '只输出一个 JSON 对象，不要输出 Markdown、解释、列表或额外正文。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `世界：${input.worldName}`,
        `剧本：${input.bookmarkLabel}`,
        `开局时间：${input.bookmarkStartDate || '未注明'}`,
        `剧本事件：${input.bookmarkSummary || '未注明'}`,
        `历史人物姓名：${input.historicalName}`,
        `界面当前默认地点 ID：${input.currentLocationId || '未选'}（仅在史实资料不足时作为保底，不代表历史人物必在此处）`,
        '',
        '可选出身 birthOriginId：',
        formatOpeningOptions(input.birthOrigins),
        '',
        '可选当前身份 currentIdentityId：',
        formatOpeningOptions(input.identities),
        '',
        '可选开局地点 locationId：',
        locationOptions,
        '',
        '可选特质 traitIds：',
        formatTraitOptions(input.traits),
        '',
        '资料库提示：',
        knowledgeHintText,
        '',
        '输出 JSON schema：',
        JSON.stringify({
          name: 'string',
          courtesyName: 'string',
          sex: '男|女|其他',
          age: 30,
          appearance: 'string',
          personality: 'string',
          birthOriginId: '必须从上方 birthOriginId 中选择',
          currentIdentityId: '必须从上方 currentIdentityId 中选择',
          locationId: '必须从上方 locationId 中选择',
          situationSummary: 'string',
          abilityScores: {
            武力: 50,
            统率: 50,
            智力: 50,
            政治: 50,
            魅力: 50,
            机运: 50,
          },
          traitIds: ['从上方 traitIds 中选择 1-3 个'],
          supplementalNotes: '只写长期承接提醒，不要复述全部档案',
        }, null, 2),
        '',
        '硬性规则：',
        '- name 应保持史实人物姓名，除非玩家输入明显是别名。',
        '- birthOriginId/currentIdentityId/locationId/traitIds 只能使用上方给出的 id；不要输出中文标签替代 id。',
        '- locationId 优先选择县 / 城邑 / 据点等具体地点 ID，不要只返回州、郡、国一类区域容器。',
        '- 如果史实人物在当前剧本时间明显不在界面当前默认地点，必须按史实状态重新选择 locationId；不得因为界面默认地点而保留默认地点。',
        '- 如果史实或剧情语境出现地点别名（如许都、许昌、小沛等），应选择上方标注该别名的具体 locationId；不要选择同郡第一个默认地点。',
        '- abilityScores 的键必须使用：武力、统率、智力、政治、魅力、机运；值必须是 1-99 的数字。',
        '- appearance/personality/situationSummary 要直接可用于开局，不要写成工程说明。',
        '- supplementalNotes 只放无法归入结构化字段但需要长期承接的注意事项。',
        '- 只输出一个 JSON 对象。',
      ].join('\n'),
    },
  ];
}

export function buildHistoricalRoleKnowledgeHints(input: BuildHistoricalRoleKnowledgeHintsInput): string[] {
  const base = input.knowledgeBase;
  if (!base) return [];

  const year = extractYear(input.bookmarkStartDate);
  const activeTexts = [
    input.historicalName,
    input.bookmarkLabel,
    input.bookmarkSummary,
  ].filter((item): item is string => Boolean(item?.trim()));

  return base.cards
    .filter((card) => card.worldBookId === input.worldBookId)
    .map((card) => ({
      card,
      score: scoreKnowledgeCard(card, {
        historicalName: input.historicalName,
        currentLocationId: input.currentLocationId,
        year,
        activeTexts,
      }),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.card.id.localeCompare(right.card.id);
    })
    .slice(0, input.limit ?? 6)
    .map(({ card }) => {
      const contradiction = card.contradictionHint ? `冲突处理：${card.contradictionHint}` : '';
      return [card.title, card.summary, contradiction].filter(Boolean).join('；');
    });
}

function extractJsonText(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readSex(value: unknown): HistoricalRoleSex | undefined {
  return value === '男' || value === '女' || value === '其他' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readLocationCandidate(parsed: Record<string, unknown>): string | undefined {
  const raw =
    parsed.locationId ??
    parsed.initialLocationId ??
    parsed.initialLocation ??
    parsed.location ??
    parsed.currentLocation ??
    parsed.startLocation ??
    parsed['初始地点'] ??
    parsed['地点'];
  const text = readString(raw);
  if (text) return text;
  if (!isPlainObject(raw)) return undefined;

  const explicitId = readString(raw.id ?? raw.locationId ?? raw.placeId ?? raw.initialLocationId);
  if (explicitId) return explicitId;
  const explicitPath = readString(raw.path ?? raw.pathLabel);
  if (explicitPath) return explicitPath;

  const parts = [
    raw.region,
    raw.regionId,
    raw.province,
    raw['州'],
    raw.commandery,
    raw.commanderyId,
    raw['郡'],
    raw['国'],
    raw.county,
    raw.countyId,
    raw.place,
    raw['县'],
    raw.name,
    raw['地点'],
  ]
    .map(readString)
    .filter((item): item is string => Boolean(item));

  return parts.length ? parts.join('') : undefined;
}

function readAbilityScores(value: unknown): AbilityScores | undefined {
  if (!isPlainObject(value)) return undefined;
  const result: AbilityScores = {};
  for (const [key, raw] of Object.entries(value)) {
    const score = readNumber(raw);
    if (score !== undefined) result[normalizeAbilityKey(key)] = clampAbility(score);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeAbilityScores(
  scores: AbilityScores | undefined,
  fallback: AbilityScores | undefined,
): AbilityScores {
  const base: AbilityScores = { ...(fallback ?? {}) };
  for (const key of DEFAULT_ABILITY_KEYS) {
    const score = scores?.[key] ?? base[key];
    if (score !== undefined) base[key] = clampAbility(score);
  }
  for (const [key, value] of Object.entries(scores ?? {})) {
    base[key] = clampAbility(value);
  }
  return base;
}

function normalizeTraitIds(
  traitIds: string[] | undefined,
  traits: CharacterTrait[],
  fallback: string[] | undefined,
): string[] {
  const validIds = new Set(traits.map((trait) => trait.id));
  const source = traitIds?.length ? traitIds : fallback ?? [];
  const result: string[] = [];
  for (const id of source) {
    if (validIds.has(id) && !result.includes(id)) {
      result.push(id);
    }
    if (result.length >= 3) break;
  }
  return result;
}

function resolveOptionId(
  candidate: string | undefined,
  options: OpeningCharacterOption[],
  fallback: string,
): string {
  const normalizedCandidate = candidate?.trim();
  if (normalizedCandidate) {
    const exact = options.find((option) => option.id === normalizedCandidate);
    if (exact) return exact.id;
    const byLabel = options.find((option) => option.label === normalizedCandidate);
    if (byLabel) return byLabel.id;
  }
  return options.some((option) => option.id === fallback) ? fallback : '';
}

function resolveLocation(
  candidate: string | undefined,
  locations: FlattenedMapNode[],
  fallbackId: string,
): FlattenedMapNode {
  const normalizedCandidate = candidate?.trim();
  if (normalizedCandidate) {
    const exact = locations.find((location) => location.node.id === normalizedCandidate);
    if (exact) return exact;
    const byName = locations.find((location) => location.node.name === normalizedCandidate || location.pathLabel === normalizedCandidate);
    if (byName) return byName;
    const fuzzy = resolveFuzzyLocation(normalizedCandidate, locations);
    if (fuzzy) return fuzzy;
  }
  return locations.find((location) => location.node.id === fallbackId) ?? locations[0] ?? {
    node: {
      id: '',
      name: '',
      level: '',
      summary: '',
      connectedRegionIds: [],
      controlHint: '',
      tensionHint: '',
    },
    path: [],
    pathLabel: '',
  };
}

function resolveFuzzyLocation(candidate: string, locations: FlattenedMapNode[]): FlattenedMapNode | undefined {
  const candidateVariants = buildLocationSearchVariants(candidate);
  if (!candidateVariants.length) return undefined;

  let best: { location: FlattenedMapNode; score: number } | undefined;
  for (const location of locations) {
    const score = scoreLocationMatch(candidateVariants, location);
    if (score < LOCATION_MATCH_MIN_SCORE) continue;
    if (!best || score > best.score) {
      best = { location, score };
    }
  }

  return best?.location;
}

function scoreLocationMatch(candidateVariants: string[], location: FlattenedMapNode): number {
  const id = normalizeText(location.node.id);
  const name = normalizeLocationText(location.node.name);
  const pathLabel = normalizeLocationText(location.pathLabel);
  const nodeNameVariants = buildLocationSearchVariants(location.node.name);
  const pathSegmentVariants = location.path.flatMap((node) => buildLocationSearchVariants(node.name));
  let best = 0;

  for (const candidate of candidateVariants) {
    if (candidate === id) best = Math.max(best, 100);
    if (candidate === name || candidate === pathLabel) best = Math.max(best, 96);
    if (nodeNameVariants.includes(candidate)) best = Math.max(best, 92);
    if (pathSegmentVariants.includes(candidate)) best = Math.max(best, 88);
    if (pathLabel.includes(candidate)) best = Math.max(best, 70 + Math.min(candidate.length, 10));

    for (const nodeVariant of nodeNameVariants) {
      if (isMeaningfulContainment(candidate, nodeVariant)) best = Math.max(best, 64);
    }
  }

  if (best <= 0) return 0;
  const layerBonus = location.node.mapLayer === 'place' ? 6 : location.node.mapLayer === 'scene' ? 0 : 2;
  return best + layerBonus + Math.min(location.path.length, 4);
}

function isMeaningfulContainment(left: string, right: string): boolean {
  if (left.length < 2 || right.length < 2) return false;
  return left.includes(right) || right.includes(left);
}

function buildLocationSearchVariants(value: string): string[] {
  const normalized = normalizeLocationText(value);
  const variants = new Set<string>();
  addLocationVariant(variants, normalized);

  const withoutSuffix = stripLocationSuffix(normalized);
  addLocationVariant(variants, withoutSuffix);

  for (const variant of [...variants]) {
    if (variant.startsWith('小') && variant.length > 2) {
      addLocationVariant(variants, variant.slice(1));
    }
  }
  addLocationAliasVariants(variants);

  return [...variants];
}

function addLocationVariant(variants: Set<string>, value: string): void {
  if (value.length >= 2) variants.add(value);
}

function addLocationAliasVariants(variants: Set<string>): void {
  const pending = [...variants];
  for (const variant of pending) {
    const canonicalVariants = LOCATION_ALIAS_TO_CANONICAL_VARIANTS.get(variant) ?? [];
    for (const canonicalVariant of canonicalVariants) {
      addLocationVariant(variants, canonicalVariant);
    }
  }
}

function normalizeLocationText(value: string): string {
  return normalizeText(value).replace(/[，,。；;：:、/／\\|_\-—\s（）()【】[\]《》<>]/g, '');
}

function stripLocationSuffix(value: string): string {
  let result = value;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LOCATION_SUFFIXES) {
      if (result.endsWith(suffix) && result.length > suffix.length + 1) {
        result = result.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }
  return result;
}

function buildBasicLocationSearchVariants(value: string): string[] {
  const normalized = normalizeLocationText(value);
  const variants = new Set<string>();
  addLocationVariant(variants, normalized);
  addLocationVariant(variants, stripLocationSuffix(normalized));
  for (const variant of [...variants]) {
    if (variant.startsWith('小') && variant.length > 2) {
      addLocationVariant(variants, variant.slice(1));
    }
  }
  return [...variants];
}

function buildLocationAliasToCanonicalVariants(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const group of LOCATION_ALIAS_GROUPS) {
    const canonicalVariants = buildBasicLocationSearchVariants(group.canonical);
    for (const alias of group.aliases) {
      for (const aliasVariant of buildBasicLocationSearchVariants(alias)) {
        map.set(aliasVariant, [...new Set([...(map.get(aliasVariant) ?? []), ...canonicalVariants])]);
      }
    }
  }
  return map;
}

function buildLocationAliasesByCanonical(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const group of LOCATION_ALIAS_GROUPS) {
    for (const canonicalVariant of buildBasicLocationSearchVariants(group.canonical)) {
      map.set(canonicalVariant, group.aliases);
    }
  }
  return map;
}

function resolveOpeningPlace(location: FlattenedMapNode): FlattenedMapNode {
  if (location.node.mapLayer === 'scene') {
    const path = location.path.slice(0, -1);
    const parent = path[path.length - 1];
    if (parent) return toFlattenedLocation(parent, path);
  }

  let selected = location;
  while (shouldExpandToConcretePlace(selected.node)) {
    const child = selected.node.subLocations?.[0];
    if (!child) break;
    selected = toFlattenedLocation(child, [...selected.path, child]);
  }

  return selected;
}

function shouldExpandToConcretePlace(node: MapNode): boolean {
  if (!node.subLocations?.length) return false;
  return node.mapLayer !== 'place' && node.mapLayer !== 'scene';
}

function toFlattenedLocation(node: MapNode, path: MapNode[]): FlattenedMapNode {
  return {
    node,
    path,
    pathLabel: path.map((item) => item.name).join(' - '),
  };
}

function toLocationPathIds(location: FlattenedMapNode): HistoricalRoleLocationPathIds {
  const path = location.path;
  const selectedNode = location.node;
  const selectedIsScene = selectedNode.mapLayer === 'scene';
  const placeNode = selectedIsScene ? path[path.length - 2] : selectedNode;

  return {
    regionId: path[0]?.id ?? '',
    commanderyId: path[1]?.id ?? '',
    locationId: placeNode?.id ?? selectedNode.id,
    sceneId: selectedIsScene ? selectedNode.id : '',
  };
}

function flattenMapNodes(nodes: MapNode[], path: MapNode[] = []): FlattenedMapNode[] {
  return nodes.flatMap((node) => {
    const nextPath = [...path, node];
    return [
      {
        node,
        path: nextPath,
    pathLabel: nextPath.map((item) => item.name).join(' - '),
      },
      ...flattenMapNodes(node.subLocations ?? [], nextPath),
    ];
  });
}

function formatOpeningOptions(options: OpeningCharacterOption[]): string {
  if (!options.length) return '- 无可用选项。';
  return options
    .map((option) => `- ${option.id}: ${option.label}${option.description ? ` — ${option.description}` : ''}`)
    .join('\n');
}

function formatTraitOptions(traits: CharacterTrait[]): string {
  if (!traits.length) return '- 无可用特质。';
  return traits
    .map((trait) => `- ${trait.id}: ${trait.label} — ${trait.description}`)
    .join('\n');
}

function formatLocationOptions(mapSeed: MapNode[], currentLocationId: string): string {
  const locations = flattenMapNodes(mapSeed);
  const selectableLocations = locations.filter(isPromptSelectableLocation);
  const current = locations.find((location) => location.node.id === currentLocationId);
  const currentPlace = current ? resolveOpeningPlace(current) : undefined;
  const promptSource = selectableLocations.length ? selectableLocations : locations;
  const promptLocations = promptSource.slice(0, MAX_PROMPT_LOCATIONS);
  if (currentPlace && !promptLocations.some((location) => location.node.id === currentPlace.node.id)) {
    promptLocations.push(currentPlace);
  }

  if (!promptLocations.length) return '- 无可用地点。';
  const suffix = promptSource.length > promptLocations.length
    ? `\n- 其余 ${promptSource.length - promptLocations.length} 个具体地点未列出；优先使用当前地点或剧本推荐地点。`
    : '';

  return promptLocations
    .map((location) => [
      `- ${location.node.id}: ${location.pathLabel || location.node.name}`,
      formatLocationMeta(location),
      location.node.summary ? ` — ${location.node.summary}` : '',
    ].join(''))
    .join('\n') + suffix;
}

function formatLocationMeta(location: FlattenedMapNode): string {
  const parts: string[] = [];
  if (location.node.level) parts.push(location.node.level);
  const aliases = LOCATION_ALIASES_BY_CANONICAL.get(normalizeLocationText(location.node.name)) ?? [];
  if (aliases.length > 0) parts.push(`别名：${aliases.join('、')}`);
  return parts.length ? `（${parts.join('；')}）` : '';
}

function isPromptSelectableLocation(location: FlattenedMapNode): boolean {
  if (location.node.mapLayer === 'scene') return false;
  return location.node.mapLayer === 'place' || !location.node.subLocations?.length;
}

function scoreKnowledgeCard(
  card: WorldlineKnowledgeCard,
  context: {
    historicalName: string;
    currentLocationId?: string;
    year?: number;
    activeTexts: string[];
  },
): number {
  let score = importanceScore(card.importance);
  const normalizedName = normalizeText(context.historicalName);
  const cardText = normalizeText([card.title, card.summary, ...(card.relatedNpcNames ?? []), ...(card.relatedTags ?? [])].join(' '));
  if (normalizedName && cardText.includes(normalizedName)) score += 12;
  if ((card.relatedNpcNames ?? []).some((name) => normalizeText(name) === normalizedName)) score += 8;
  if (context.currentLocationId && (card.relatedPlaceIds ?? []).includes(context.currentLocationId)) score += 3;
  if (context.year !== undefined && isYearInRange(card, context.year)) score += 3;
  if (context.activeTexts.some((text) => cardText.includes(normalizeText(text)))) score += 2;
  return score >= 6 ? score : 0;
}

function importanceScore(importance: WorldlineKnowledgeCard['importance']): number {
  if (importance === 'critical') return 5;
  if (importance === 'major') return 3;
  if (importance === 'normal') return 2;
  return 1;
}

function isYearInRange(card: WorldlineKnowledgeCard, year: number): boolean {
  if (!card.timeRange) return true;
  const start = extractYear(card.timeRange.start);
  const end = extractYear(card.timeRange.end);
  return (start === undefined || year >= start) && (end === undefined || year <= end);
}

function extractYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/(\d{2,4})/);
  return match ? Number(match[1]) : undefined;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function normalizeAbilityKey(key: string): string {
  const trimmed = key.trim();
  return ABILITY_KEY_ALIASES[normalizeText(trimmed)] ?? trimmed;
}

function trimOr(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function clampAge(value: number): number {
  return Math.max(1, Math.min(120, Math.round(value)));
}

function clampAbility(value: number): number {
  return Math.max(1, Math.min(99, Math.round(value)));
}

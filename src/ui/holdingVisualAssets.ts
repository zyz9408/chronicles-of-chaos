import type { HoldingPanelVisualProfile } from './holdingPanelModel';

type HoldingRegionKey = 'north' | 'central' | 'west' | 'jiangdong' | 'southwest';
type HoldingSceneConditionKey = 'ruined_small' | 'normal_medium' | 'prosperous_large';
type HoldingSceneFamilyKey = 'fort' | 'pass' | 'camp' | 'estate' | 'port' | 'village' | 'ferry';
type HoldingTypeKey = NonNullable<HoldingPanelVisualProfile['type']>;
type SpecialHoldingSceneKey =
  | 'luoyang'
  | 'changan'
  | 'xuchang'
  | 'yecheng'
  | 'jianye'
  | 'chengdu'
  | 'xiangyang'
  | 'hanzhong';

const DEFAULT_REGION: HoldingRegionKey = 'central';
const DEFAULT_CONDITION: HoldingSceneConditionKey = 'normal_medium';

const SPECIAL_CITY_MATCHERS: Array<{ key: SpecialHoldingSceneKey; needles: string[] }> = [
  { key: 'luoyang', needles: ['洛阳', 'luoyang'] },
  { key: 'changan', needles: ['长安', 'changan'] },
  { key: 'xuchang', needles: ['许昌', 'xuchang'] },
  { key: 'yecheng', needles: ['邺城', '鄴城', 'yecheng'] },
  { key: 'jianye', needles: ['建业', '建鄴', 'jianye'] },
  { key: 'chengdu', needles: ['成都', 'chengdu'] },
  { key: 'xiangyang', needles: ['襄阳', '襄陽', 'xiangyang'] },
  { key: 'hanzhong', needles: ['汉中', '漢中', 'hanzhong'] },
];

const REGION_MATCHERS: Array<{ key: HoldingRegionKey; needles: string[] }> = [
  { key: 'jiangdong', needles: ['江东', '江東', '吴郡', '吳郡', '会稽', '會稽', '丹阳', '丹陽', '庐江', '廬江', '豫章', '柴桑', 'jianye'] },
  { key: 'southwest', needles: ['益州', '巴蜀', '蜀郡', '巴郡', '南中', '牂牁', '越巂', '永昌', '交州', 'chengdu'] },
  { key: 'west', needles: ['关中', '關中', '雍州', '凉州', '涼州', '西凉', '西涼', '陇右', '隴右', '河西', '天水', '武都', 'changan'] },
  { key: 'north', needles: ['河北', '幽州', '并州', '并州', '冀州', '青州', '辽东', '遼東', '代郡', '上党', 'yecheng'] },
  { key: 'central', needles: ['中原', '司隶', '司隸', '豫州', '兖州', '兗州', '荆州', '荊州', '颍川', '潁川', '南阳', '南陽', '汝南', '陈留', '陳留', 'xuchang', 'xiangyang', 'luoyang'] },
];

const DIRECT_TYPE_FAMILIES: Partial<Record<HoldingTypeKey, HoldingSceneFamilyKey>> = {
  fort: 'fort',
  pass: 'pass',
  camp: 'camp',
  estate: 'estate',
  port: 'port',
  village: 'village',
};

const TYPE_TEXT_FAMILIES: Array<{ key: HoldingSceneFamilyKey; needles: string[] }> = [
  { key: 'fort', needles: ['堡垒', '堡壘', 'fort'] },
  { key: 'pass', needles: ['关隘', '關隘', 'pass'] },
  { key: 'camp', needles: ['军营', '軍營', 'camp'] },
  { key: 'estate', needles: ['庄园', '莊園', 'estate'] },
  { key: 'port', needles: ['港口', '港埠', 'port'] },
  { key: 'village', needles: ['乡里', '鄉里', 'village'] },
];

const OTHER_VISUAL_MATCHERS: Array<{ key: HoldingSceneFamilyKey; needles: string[] }> = [
  { key: 'ferry', needles: ['渡口', '津渡', 'ferry'] },
  { key: 'port', needles: ['船坞', '船塢', '水寨', '港埠', 'dock', 'shipyard'] },
  { key: 'camp', needles: ['营寨', '營寨', '营地', '營地', 'encampment'] },
  { key: 'pass', needles: ['关口', '關口', '隘口', '山口', 'checkpoint'] },
  { key: 'fort', needles: ['堡寨', '砦堡', '要塞', 'stronghold'] },
];

const HOLDING_SCENE_ASSET_KEYS = new Set<string>([
  ...REGION_MATCHERS.flatMap(({ key }) => (
    ['ruined_small', 'normal_medium', 'prosperous_large'] as const
  ).map((condition) => `holding_scene_region_${key}_${condition}_v01.png`)),
  ...SPECIAL_CITY_MATCHERS.flatMap(({ key }) => (
    ['ruined_small', 'normal_medium', 'prosperous_large'] as const
  ).map((condition) => `holding_scene_special_${key}_${condition}_v01.png`)),
  ...(['fort', 'pass', 'camp', 'estate', 'port', 'village'] as const).flatMap((key) => (
    ['ruined_small', 'normal_medium', 'prosperous_large'] as const
  ).map((condition) => `holding_scene_type_${key}_${condition}_v01.png`)),
  ...(['ruined_small', 'normal_medium', 'prosperous_large'] as const)
    .map((condition) => `holding_scene_visual_ferry_${condition}_v01.png`),
]);

export interface HoldingVisualAsset {
  assetKey: string;
  label: string;
}

export function resolveHoldingVisualAsset(profile: HoldingPanelVisualProfile): HoldingVisualAsset {
  return {
    assetKey: resolveHoldingVisualAssetKey(profile),
    label: profile.caption,
  };
}

export async function loadHoldingVisualManifest() {
  const module = await import('../generated/panelVisuals/holdingVisualManifest');
  return module.holdingVisualManifest;
}

export function resolveHoldingVisualAssetKey(profile: HoldingPanelVisualProfile): string {
  const condition = resolveSceneCondition(profile);
  const dedicatedFamily = resolveDedicatedSceneFamily(profile);
  if (dedicatedFamily) {
    const dedicatedKey = dedicatedFamily === 'ferry'
      ? `holding_scene_visual_ferry_${condition}_v01.png`
      : `holding_scene_type_${dedicatedFamily}_${condition}_v01.png`;
    if (HOLDING_SCENE_ASSET_KEYS.has(dedicatedKey)) return dedicatedKey;
  }

  const specialCity = resolveSpecialCity(profile);
  if (specialCity) {
    const specialKey = `holding_scene_special_${specialCity}_${condition}_v01.png`;
    if (HOLDING_SCENE_ASSET_KEYS.has(specialKey)) return specialKey;
  }

  const region = resolveRegion(profile);
  const regionalKey = `holding_scene_region_${region}_${condition}_v01.png`;
  if (HOLDING_SCENE_ASSET_KEYS.has(regionalKey)) return regionalKey;

  return `holding_scene_region_${DEFAULT_REGION}_${DEFAULT_CONDITION}_v01.png`;
}

function resolveDedicatedSceneFamily(profile: HoldingPanelVisualProfile): HoldingSceneFamilyKey | null {
  if (profile.type) {
    const directFamily = DIRECT_TYPE_FAMILIES[profile.type];
    if (directFamily) return directFamily;
    if (profile.type !== 'other') return null;
  } else {
    const normalizedType = profile.typeText.trim().toLowerCase();
    const textFamily = TYPE_TEXT_FAMILIES.find((matcher) => hasAny(normalizedType, matcher.needles))?.key;
    if (textFamily) return textFamily;
    if (!hasAny(normalizedType, ['其他', 'other'])) return null;
  }

  const source = buildVisualSearchText(profile);
  return OTHER_VISUAL_MATCHERS.find((matcher) => hasAny(source, matcher.needles))?.key ?? null;
}

function resolveSpecialCity(profile: HoldingPanelVisualProfile): SpecialHoldingSceneKey | null {
  const source = buildVisualSearchText(profile);
  return SPECIAL_CITY_MATCHERS.find((matcher) => hasAny(source, matcher.needles))?.key ?? null;
}

function resolveRegion(profile: HoldingPanelVisualProfile): HoldingRegionKey {
  const source = buildVisualSearchText(profile);
  return REGION_MATCHERS.find((matcher) => hasAny(source, matcher.needles))?.key ?? DEFAULT_REGION;
}

function resolveSceneCondition(profile: HoldingPanelVisualProfile): HoldingSceneConditionKey {
  const scale = extractFirstNumber(profile.scaleText);
  const collectionRates = extractPercentValues(profile.collectionText);
  const lowestCollectionRate = collectionRates.length > 0 ? Math.min(...collectionRates) : undefined;

  if (hasAny(profile.statusText, ['失去', '争夺', '临管', '临时', '受损', '破败', '归档'])) {
    return 'ruined_small';
  }
  if (lowestCollectionRate !== undefined && lowestCollectionRate < 45) return 'ruined_small';
  if (scale !== undefined && scale <= 2) return 'ruined_small';
  if (lowestCollectionRate !== undefined && lowestCollectionRate >= 75 && (scale ?? 3) >= 3) {
    return 'prosperous_large';
  }
  if (scale !== undefined && scale >= 4 && (lowestCollectionRate === undefined || lowestCollectionRate >= 60)) {
    return 'prosperous_large';
  }
  return 'normal_medium';
}

function buildVisualSearchText(profile: HoldingPanelVisualProfile): string {
  return [
    profile.name,
    profile.locationId,
    profile.typeText,
    profile.caption,
  ].filter(Boolean).join(' ').toLowerCase();
}

function extractFirstNumber(source: string): number | undefined {
  const match = source.match(/\d+/);
  if (!match) return undefined;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : undefined;
}

function extractPercentValues(source: string): number[] {
  return [...source.matchAll(/(\d+(?:\.\d+)?)%/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
}

function hasAny(source: string, needles: string[]): boolean {
  return needles.some((needle) => source.includes(needle.toLowerCase()));
}

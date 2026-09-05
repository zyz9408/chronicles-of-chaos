import type { BattleBriefingCard } from './battleBriefingQueueModel';
import { combatBackgroundVisualManifest } from '../generated/panelVisuals/combatBackgroundVisualManifest';
import { combatCharacterVisualManifest } from '../generated/panelVisuals/combatCharacterVisualManifest';
import { warBackgroundVisualManifest } from '../generated/panelVisuals/warBackgroundVisualManifest';
import { warForceVisualManifest } from '../generated/panelVisuals/warForceVisualManifest';
import type { ResponsiveVisualAssetEntry } from './panelVisualAssetLoader';

const responsiveVisualManifest: Record<string, ResponsiveVisualAssetEntry> = {
  ...combatBackgroundVisualManifest,
  ...combatCharacterVisualManifest,
  ...warBackgroundVisualManifest,
  ...warForceVisualManifest,
};

function getVisualEntry(sourceKey: string): ResponsiveVisualAssetEntry {
  const entry = responsiveVisualManifest[sourceKey];
  if (!entry) throw new Error(`Missing generated battle visual: ${sourceKey}`);
  return entry;
}

function getDisplayUrl(sourceKey: string): string {
  return getVisualEntry(sourceKey).display.url;
}

const sceneTrainingYardUrl = getDisplayUrl('combat_scene_han_training_yard_v01.png');
const sceneCityGateWallUrl = getDisplayUrl('combat_scene_city_gate_wall_v01.png');
const sceneStreetAlleyMarketUrl = getDisplayUrl('combat_scene_street_alley_market_v01.png');
const sceneGovernmentHallUrl = getDisplayUrl('combat_scene_government_hall_v01.png');
const sceneClanManorCourtyardUrl = getDisplayUrl('combat_scene_clan_manor_courtyard_v01.png');
const sceneMountainForestPathUrl = getDisplayUrl('combat_scene_mountain_forest_path_v01.png');
const sceneFerryRiverbankShipdeckUrl = getDisplayUrl('combat_scene_ferry_riverbank_shipdeck_v01.png');
const sceneBattlefieldEdgeUrl = getDisplayUrl('combat_scene_battlefield_edge_v01.png');

const warOpenFieldFormationUrl = getDisplayUrl('war_scene_open_field_formation_v01.png');
const warCitySiegeOuterWallUrl = getDisplayUrl('war_scene_city_siege_outer_wall_v01.png');
const warCityDefenseInnerGateUrl = getDisplayUrl('war_scene_city_defense_inner_gate_v01.png');
const warMilitaryCampRaidUrl = getDisplayUrl('war_scene_military_camp_raid_v01.png');
const warRiverBattleBankUrl = getDisplayUrl('war_scene_river_battle_bank_v01.png');
const warMountainAmbushPassUrl = getDisplayUrl('war_scene_mountain_ambush_pass_v01.png');
const warSupplyRouteRaidUrl = getDisplayUrl('war_scene_supply_route_raid_v01.png');
const warRoutPursuitDustUrl = getDisplayUrl('war_scene_rout_pursuit_dust_v01.png');

const warForceInfantryLineUrl = getDisplayUrl('war_force_infantry_line_v01.png');
const warForceCavalryChargeUrl = getDisplayUrl('war_force_cavalry_charge_v01.png');
const warForceRoutedSoldiersUrl = getDisplayUrl('war_force_routed_soldiers_v01.png');
const warForceSiegeAssaultUrl = getDisplayUrl('war_force_siege_assault_v01.png');
const warForceWallDefendersUrl = getDisplayUrl('war_force_wall_defenders_v01.png');
const warForceRiverBoatsUrl = getDisplayUrl('war_force_river_boats_v01.png');
const warForceSupplyConvoyUrl = getDisplayUrl('war_force_supply_convoy_v01.png');
const warForceCampRaidUrl = getDisplayUrl('war_force_camp_raid_v01.png');

const playerSwordUrl = getDisplayUrl('combat_player_over_shoulder_sword_cutout_v02.png');
const playerHalberdUrl = getDisplayUrl('combat_player_over_shoulder_halberd_v01.png');
const playerBowCrossbowUrl = getDisplayUrl('combat_player_over_shoulder_bow_crossbow_v01.png');
const playerDaggerUrl = getDisplayUrl('combat_player_over_shoulder_dagger_v01.png');
const playerUnarmoredSwordUrl = getDisplayUrl('combat_player_over_shoulder_unarmored_sword_v01.png');

const enemyHanSoldierUrls = [
  getDisplayUrl('combat_enemy_han_soldier_spear_front_v01.png'),
  getDisplayUrl('combat_enemy_han_soldier_spear_front_v02.png'),
];
const enemyYellowTurbanUrls = [
  getDisplayUrl('combat_enemy_yellow_turban_rebel_front_v01.png'),
  getDisplayUrl('combat_enemy_yellow_turban_rebel_front_v02.png'),
];
const enemyBanditUrls = [
  getDisplayUrl('combat_enemy_bandit_raider_front_v01.png'),
  getDisplayUrl('combat_enemy_bandit_raider_front_v02.png'),
];
const enemyClanRetainerUrls = [
  getDisplayUrl('combat_enemy_clan_retainer_front_v01.png'),
  getDisplayUrl('combat_enemy_clan_retainer_front_v02.png'),
];
const enemyEliteGuardUrls = [
  getDisplayUrl('combat_enemy_elite_guard_front_v01.png'),
  getDisplayUrl('combat_enemy_elite_guard_front_v02.png'),
];
const enemyAssassinUrls = [
  getDisplayUrl('combat_enemy_assassin_front_v01.png'),
  getDisplayUrl('combat_enemy_assassin_front_v02.png'),
];
const enemyArcherCrossbowmanUrls = [
  getDisplayUrl('combat_enemy_archer_crossbowman_front_v01.png'),
  getDisplayUrl('combat_enemy_archer_crossbowman_front_v02.png'),
];
const enemyRiverPirateUrls = [
  getDisplayUrl('combat_enemy_river_pirate_front_v01.png'),
  getDisplayUrl('combat_enemy_river_pirate_front_v02.png'),
];

export interface BattleBriefingVisualAssets {
  backgroundUrl: string;
  backgroundMobileUrl: string;
  forceLayerUrl?: string;
  forceLayerMobileUrl?: string;
  playerLayerUrl?: string;
  playerLayerMobileUrl?: string;
  enemyLayerUrl?: string;
  enemyLayerMobileUrl?: string;
  /** Ordered enemy variants for live encounters with more than one combatant. */
  enemyLayerUrls?: string[];
  enemyLayerMobileUrls?: string[];
  sceneLabel: string;
  forceLabel?: string;
  playerLabel?: string;
  enemyLabel?: string;
  effects: BattleBriefingVisualEffect[];
  effectClassNames: string[];
  effectLabel?: string;
}

export type BattleBriefingVisualEffectKey =
  | 'night'
  | 'rain'
  | 'snow'
  | 'fire'
  | 'arrows'
  | 'dust'
  | 'shock'
  | 'impact';

export interface BattleBriefingVisualEffect {
  key: BattleBriefingVisualEffectKey;
  className: string;
  label: string;
}

export function resolveBattleBriefingVisualAssets(card: BattleBriefingCard): BattleBriefingVisualAssets {
  const source = buildVisualSource(card);
  const seed = `${card.kind}|${card.recordId}|${card.occurredAt ?? ''}|${card.title}`;
  const scene = card.kind === 'battle'
    ? (selectWarScene(source) ?? selectScene(source, card.kind))
    : selectScene(source, card.kind);
  const force = card.kind === 'battle' ? selectWarForce(source, seed) : undefined;
  const effects = selectEffects(source, card.kind);
  const effectClassNames = effects.map((effect) => effect.className);
  const effectLabel = effects.map((effect) => effect.label).join(' / ') || undefined;

  if (card.kind === 'battle') {
    return {
      backgroundUrl: scene.url,
      backgroundMobileUrl: resolveMobileUrl(scene.url),
      forceLayerUrl: force?.url,
      forceLayerMobileUrl: force ? resolveMobileUrl(force.url) : undefined,
      sceneLabel: scene.label,
      forceLabel: force?.label,
      effects,
      effectClassNames,
      effectLabel,
    };
  }

  const player = selectPlayerLayer(source);
  const enemy = selectEnemyLayer(source, seed);

  return {
    backgroundUrl: scene.url,
    backgroundMobileUrl: resolveMobileUrl(scene.url),
    playerLayerUrl: player.url,
    playerLayerMobileUrl: resolveMobileUrl(player.url),
    enemyLayerUrl: enemy.url,
    enemyLayerMobileUrl: resolveMobileUrl(enemy.url),
    enemyLayerUrls: enemy.urls,
    enemyLayerMobileUrls: enemy.urls.map(resolveMobileUrl),
    sceneLabel: scene.label,
    playerLabel: player.label,
    enemyLabel: enemy.label,
    effects,
    effectClassNames,
    effectLabel,
  };
}

function resolveMobileUrl(displayUrl: string): string {
  const entry = Object.values(responsiveVisualManifest).find((candidate) => candidate.display.url === displayUrl);
  if (!entry) throw new Error(`Missing responsive battle visual for ${displayUrl}`);
  return entry.mobile.url;
}

function buildVisualSource(card: BattleBriefingCard): string {
  return [
    card.imageKey,
    ...card.visualTags,
    card.title,
    card.summary,
    card.location,
  ].filter(Boolean).join(' ').toLowerCase();
}

function selectWarScene(source: string): { url: string; label: string } | undefined {
  if (hasAny(source, [
    'campraid',
    'militarycamp',
    'camp',
    'stockade',
    'palisade',
    'nightattack',
    '营寨',
    '敌营',
    '劫营',
    '夜袭',
    '营门',
    '栅栏',
  ])) {
    return { url: warMilitaryCampRaidUrl, label: '营寨劫营' };
  }
  if (hasAny(source, [
    'supplyroute',
    'logisticsraid',
    'supply',
    'grain',
    'convoy',
    'baggage',
    '粮道',
    '辎重',
    '粮车',
    '押运',
    '断粮',
    '抢粮',
  ])) {
    return { url: warSupplyRouteRaidUrl, label: '粮道辎重' };
  }
  if (hasAny(source, [
    'mountainpass',
    'ambush',
    'mountain',
    'valley',
    'pass',
    '山谷',
    '伏击',
    '险道',
    '狭道',
    '截击',
  ])) {
    return { url: warMountainAmbushPassUrl, label: '山谷伏击' };
  }
  if (hasAny(source, [
    'rout',
    'routed',
    'routing',
    'pursuit',
    'pursue',
    'moralecollapse',
    '溃',
    '败兵',
    '追击',
    '尘土',
    '断旗',
  ])) {
    return { url: warRoutPursuitDustUrl, label: '溃退追击' };
  }
  if (hasAny(source, [
    'riverbattle',
    'river',
    'ferry',
    'ship',
    'boat',
    'water',
    '渡口',
    '河岸',
    '船',
    '舟',
    '水战',
    '水军',
  ])) {
    return { url: warRiverBattleBankUrl, label: '河岸水战' };
  }
  if (hasAny(source, [
    'innergate',
    'gatebreached',
    'breach',
    'streetfight',
    'gate defense',
    '破门',
    '城门内',
    '门内',
    '巷战',
    '拒马',
    '盾阵',
  ])) {
    return { url: warCityDefenseInnerGateUrl, label: '城门内防' };
  }
  if (hasAny(source, [
    'outerwall',
    'siege',
    'wallassault',
    'ladder',
    'assault',
    '攻城',
    '围城',
    '外墙',
    '云梯',
    '城墙外',
  ])) {
    return { url: warCitySiegeOuterWallUrl, label: '城墙攻守' };
  }
  if (hasAny(source, [
    'openfield',
    'formation',
    'fieldbattle',
    'battlefield',
    'plain',
    '平原',
    '野战',
    '军阵',
    '列阵',
    '阵线',
    '会战',
    '阵前',
  ])) {
    return { url: warOpenFieldFormationUrl, label: '平原军阵' };
  }
  return undefined;
}

function selectWarForce(source: string, seed: string): { url: string; label: string } | undefined {
  const force = selectWarForceCandidates(source);
  if (!force) {
    return undefined;
  }
  return {
    url: selectStableCandidate(force.urls, seed),
    label: force.label,
  };
}

function selectWarForceCandidates(source: string): { urls: string[]; label: string } | undefined {
  if (hasAny(source, [
    'campraid',
    'militarycamp',
    'camp',
    'stockade',
    'palisade',
    'nightattack',
    '营寨',
    '敌营',
    '劫营',
    '夜袭',
    '营门',
    '栅栏',
  ])) {
    return { urls: [warForceCampRaidUrl], label: '营寨乱兵' };
  }
  if (hasAny(source, [
    'supplyroute',
    'logisticsraid',
    'supply',
    'grain',
    'convoy',
    'baggage',
    '粮道',
    '辎重',
    '粮车',
    '押运',
    '断粮',
    '抢粮',
  ])) {
    return { urls: [warForceSupplyConvoyUrl], label: '辎重护队' };
  }
  if (hasAny(source, [
    'rout',
    'routed',
    'routing',
    'moralecollapse',
    '溃',
    '败兵',
    '溃退',
    '崩散',
    '断旗',
  ])) {
    return { urls: [warForceRoutedSoldiersUrl], label: '溃兵奔散' };
  }
  if (hasAny(source, [
    'cavalry',
    'horsemen',
    'mounted',
    'charge',
    'flank',
    'pursuit',
    'pursue',
    '骑兵',
    '骑队',
    '冲锋',
    '冲阵',
    '侧翼',
    '追击',
  ])) {
    return { urls: [warForceCavalryChargeUrl], label: '骑兵冲锋' };
  }
  if (hasAny(source, [
    'riverbattle',
    'river',
    'ferry',
    'ship',
    'boat',
    'water',
    '渡口',
    '河岸',
    '船',
    '舟',
    '水战',
    '水军',
  ])) {
    return { urls: [warForceRiverBoatsUrl], label: '舟船水军' };
  }
  if (hasAny(source, [
    'walldefenders',
    'innergate',
    'gatebreached',
    'gate defense',
    'defenders',
    'archers',
    '守城',
    '城门内',
    '门内',
    '墙头',
    '拒马',
    '盾阵',
    '弓弩压制',
  ])) {
    return { urls: [warForceWallDefendersUrl], label: '守城士卒' };
  }
  if (hasAny(source, [
    'outerwall',
    'siege',
    'wallassault',
    'ladder',
    'assault',
    '攻城',
    '围城',
    '外墙',
    '云梯',
    '城墙外',
  ])) {
    return { urls: [warForceSiegeAssaultUrl], label: '攻城兵群' };
  }
  if (hasAny(source, [
    'openfield',
    'formation',
    'fieldbattle',
    'battlefield',
    'battle',
    'war',
    'plain',
    'front',
    '平原',
    '野战',
    '军阵',
    '列阵',
    '阵线',
    '会战',
    '阵前',
  ])) {
    return { urls: [warForceInfantryLineUrl], label: '步卒阵线' };
  }
  return undefined;
}

function selectScene(source: string, kind: BattleBriefingCard['kind']): { url: string; label: string } {
  if (hasAny(source, ['river', 'ferry', 'ship', 'boat', 'water', 'pirate', '渡口', '河岸', '船', '水战', '水贼'])) {
    return { url: sceneFerryRiverbankShipdeckUrl, label: '渡口河岸' };
  }
  if (hasAny(source, ['government', 'office', 'hall', 'council', 'interrogation', '官署', '军议', '审问'])) {
    return { url: sceneGovernmentHallUrl, label: '官署军议厅' };
  }
  if (hasAny(source, ['clan', 'retainer', 'manor', 'courtyard', 'estate', '豪族', '庄园', '宅院', '家丁', '部曲'])) {
    return { url: sceneClanManorCourtyardUrl, label: '豪族宅院' };
  }
  if (hasAny(source, ['street', 'alley', 'market', 'town', '市集', '街巷', '抓捕', '逃脱'])) {
    return { url: sceneStreetAlleyMarketUrl, label: '街巷市集' };
  }
  if (hasAny(source, ['mountain', 'forest', 'path', 'ambush', 'bandit', '山道', '林地', '伏击', '山贼'])) {
    return { url: sceneMountainForestPathUrl, label: '山道林地' };
  }
  if (hasAny(source, ['gate', 'wall', 'city', '城门', '城墙', '守城', '入城'])) {
    return { url: sceneCityGateWallUrl, label: '城门城墙' };
  }
  if (kind === 'battle' || hasAny(source, ['battlefield', 'formation', 'front', 'duel', 'war', '阵前', '野战', '军阵'])) {
    return { url: sceneBattlefieldEdgeUrl, label: '野战边缘' };
  }
  return { url: sceneTrainingYardUrl, label: '校场军营' };
}

function selectPlayerLayer(source: string): { url: string; label: string } {
  if (hasAny(source, ['bow', 'crossbow', 'archer', '弓', '弩', '射'])) {
    return { url: playerBowCrossbowUrl, label: '弓弩越肩' };
  }
  if (hasAny(source, ['dagger', 'assassin', 'night', 'short blade', '刺客', '短刃', '夜袭', '暗杀'])) {
    return { url: playerDaggerUrl, label: '短刃越肩' };
  }
  if (hasAny(source, ['unarmored', 'scholar', 'official', 'robe', '文官', '士人', '便服', '官署'])) {
    return { url: playerUnarmoredSwordUrl, label: '轻装佩剑' };
  }
  if (hasAny(source, ['halberd', 'spear', 'gate', 'battlefield', '戟', '矛', '枪', '阵前', '城门'])) {
    return { url: playerHalberdUrl, label: '戟矛越肩' };
  }
  return { url: playerSwordUrl, label: '刀剑越肩' };
}

function selectEnemyLayer(source: string, seed: string): { url: string; urls: string[]; label: string } {
  const enemy = selectEnemyCandidates(source);
  const firstIndex = stableIndex(seed, enemy.urls.length);
  const urls = enemy.urls.map((_, offset) => enemy.urls[(firstIndex + offset) % enemy.urls.length]);
  return {
    url: urls[0] ?? '',
    urls,
    label: enemy.label,
  };
}

function selectEnemyCandidates(source: string): { urls: string[]; label: string } {
  if (hasAny(source, ['assassin', 'deathsworn', 'dagger', 'night', '刺客', '死士', '暗杀', '夜袭'])) {
    return { urls: enemyAssassinUrls, label: '刺客死士' };
  }
  if (hasAny(source, ['river', 'pirate', 'ferry', 'ship', 'boat', 'water', '水贼', '船兵', '渡口', '河岸'])) {
    return { urls: enemyRiverPirateUrls, label: '水贼船兵' };
  }
  if (hasAny(source, ['archer', 'crossbow', 'bow', '弓手', '弩手', '弓弩'])) {
    return { urls: enemyArcherCrossbowmanUrls, label: '弓弩手' };
  }
  if (hasAny(source, ['yellow', 'turban', 'rebel', '黄巾', '太平', '流民', '叛兵'])) {
    return { urls: enemyYellowTurbanUrls, label: '黄巾乱兵' };
  }
  if (hasAny(source, ['bandit', 'raider', 'mountain', 'routed', '山贼', '盗匪', '溃兵'])) {
    return { urls: enemyBanditUrls, label: '山贼溃兵' };
  }
  if (hasAny(source, ['clan', 'retainer', 'manor', 'estate', '豪族', '部曲', '家丁', '庄园'])) {
    return { urls: enemyClanRetainerUrls, label: '豪族部曲' };
  }
  if (hasAny(source, ['elite', 'guard', 'bodyguard', 'office', '精锐', '护卫', '亲兵', '官署'])) {
    return { urls: enemyEliteGuardUrls, label: '精锐护卫' };
  }
  return { urls: enemyHanSoldierUrls, label: '汉末士卒' };
}

function selectEffects(source: string, kind: BattleBriefingCard['kind']): BattleBriefingVisualEffect[] {
  const keys: BattleBriefingVisualEffectKey[] = [];
  const add = (key: BattleBriefingVisualEffectKey) => {
    if (!keys.includes(key)) {
      keys.push(key);
    }
  };

  if (hasAnyCue(source, ['夜'], ['night', 'nightattack', 'nightbattle'])) {
    add('night');
  }
  if (hasAnyCue(source, ['雨夜', '雨幕', '雨中', '雨水', '雨声', '雨势', '风雨', '暴雨', '大雨', '细雨', '下雨'], ['rain', 'rainy', 'storm'])) {
    add('rain');
  }
  if (hasAnyCue(source, ['雪', '风雪'], ['snow', 'blizzard'])) {
    add('snow');
  }
  if (hasAnyCue(source, ['火', '火攻', '焚', '燃'], ['fire', 'fireattack', 'burning'])) {
    add('fire');
  }
  if (hasAnyCue(source, ['箭', '箭雨', '弓弩', '弩'], ['arrow', 'arrows', 'arrowrain', 'archer', 'crossbow', 'bow'])) {
    add('arrows');
  }
  if (hasAnyCue(source, ['尘', '烟尘', '溃', '败兵'], ['dust', 'rout', 'routed', 'routing', 'moralecollapse'])) {
    add('dust');
  }

  if (kind === 'battle') {
    if (hasAnyCue(source, ['破门', '破城', '冲阵', '溃散', '崩', '突破'], [
      'gatebreached',
      'breach',
      'breakthrough',
      'charge',
      'commanderslain',
      'commanderkilled',
      'moralecollapse',
    ])) {
      add('shock');
    }
  } else if (hasAnyCue(source, ['受伤', '重伤', '血', '击中', '缴械'], [
    'wound',
    'seriouswound',
    'kill',
    'capture',
    'disarm',
    'hit',
    'injury',
    'blood',
  ])) {
    add('impact');
  }

  return keys.map((key) => ({
    key,
    className: `battle-briefing-effect--${key}`,
    label: visualEffectLabels[key],
  }));
}

const visualEffectLabels: Record<BattleBriefingVisualEffectKey, string> = {
  night: '夜色',
  rain: '雨幕',
  snow: '风雪',
  fire: '火光',
  arrows: '箭雨',
  dust: '尘土',
  shock: '冲击',
  impact: '受击',
};

function selectStableCandidate(candidates: string[], seed: string): string {
  if (candidates.length <= 1) {
    return candidates[0] ?? '';
  }
  return candidates[stableIndex(seed, candidates.length)];
}

function stableIndex(seed: string, modulo: number): number {
  let total = 0;
  for (let index = 0; index < seed.length; index += 1) {
    total = (total + seed.charCodeAt(index)) >>> 0;
  }
  return total % modulo;
}

function hasAny(source: string, needles: string[]): boolean {
  return needles.some((needle) => source.includes(needle));
}

function hasAnyCue(source: string, textNeedles: string[], tokenNeedles: string[]): boolean {
  return textNeedles.some((needle) => source.includes(needle))
    || tokenNeedles.some((token) => hasToken(source, token));
}

function hasToken(source: string, token: string): boolean {
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(token.toLowerCase())}([^a-z0-9]|$)`);
  return pattern.test(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

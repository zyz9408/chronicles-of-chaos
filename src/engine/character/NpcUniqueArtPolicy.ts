import type {
  CharacterUniqueArt,
  CharacterUniqueArtDomain,
  CharacterUniqueArtRarity,
  LuanShiNpc,
} from '../types';

export const NPC_UNIQUE_ART_ABILITY_NAMES = ['武力', '统率', '智力', '政治', '魅力', '机运'] as const;
export type NpcUniqueArtAbilityName = typeof NPC_UNIQUE_ART_ABILITY_NAMES[number];

export const CHARACTER_UNIQUE_ART_RARITIES: readonly CharacterUniqueArtRarity[] = [
  'white',
  'green',
  'blue',
  'purple',
  'orange',
  'red',
];

export const CHARACTER_UNIQUE_ART_RARITY_LABELS: Record<CharacterUniqueArtRarity, string> = {
  white: '普通',
  green: '良好',
  blue: '精良',
  purple: '珍贵',
  orange: '传说',
  red: '绝世',
};

const abilityDomainMap: Record<NpcUniqueArtAbilityName, CharacterUniqueArtDomain> = {
  武力: 'personalCombat',
  统率: 'warfare',
  智力: 'strategy',
  政治: 'governance',
  魅力: 'social',
  机运: 'survival',
};

const rarityRank: Record<CharacterUniqueArtRarity, number> = {
  white: 1,
  green: 2,
  blue: 3,
  purple: 4,
  orange: 5,
  red: 6,
};

export interface NpcUniqueArtDomainRequirement {
  abilityName: NpcUniqueArtAbilityName;
  score: number;
  domain: CharacterUniqueArtDomain;
  minimumRarity: CharacterUniqueArtRarity;
}

export interface NpcUniqueArtRequirement {
  highestAbilityName: NpcUniqueArtAbilityName;
  highestScore: number;
  minimumRarity: CharacterUniqueArtRarity;
  domainRequirements: NpcUniqueArtDomainRequirement[];
}

export interface NpcUniqueArtComplianceResult {
  compliant: boolean;
  requirement?: NpcUniqueArtRequirement;
  reasons: string[];
}

const localUniqueArtBlueprints: Record<CharacterUniqueArtDomain, {
  name: string;
  abilityLabel: string;
  sceneLabel: string;
}> = {
  personalCombat: { name: '临阵武艺', abilityLabel: '武力', sceneLabel: '个人战与临阵交锋' },
  warfare: { name: '行伍统御', abilityLabel: '统率', sceneLabel: '统军、布阵与战争指挥' },
  strategy: { name: '筹谋机断', abilityLabel: '智力', sceneLabel: '谋划、军略与临机判断' },
  governance: { name: '庶政经略', abilityLabel: '政治', sceneLabel: '领地治理、吏治与资源调度' },
  social: { name: '人情折冲', abilityLabel: '魅力', sceneLabel: '交涉、号召与关系经营' },
  survival: { name: '乱局应变', abilityLabel: '机运', sceneLabel: '险境求生与突发局势' },
  craft: { name: '百工专技', abilityLabel: '技艺', sceneLabel: '制造、修缮与专门技艺' },
  other: { name: '专门之艺', abilityLabel: '专长', sceneLabel: '与人物经历相符的专门场景' },
};

const localUniqueArtLevelByRarity: Record<CharacterUniqueArtRarity, number> = {
  white: 1,
  green: 2,
  blue: 3,
  purple: 4,
  orange: 5,
  red: 6,
};

export function minimumUniqueArtRarityForScore(score: number): CharacterUniqueArtRarity | undefined {
  if (!Number.isFinite(score) || score <= 50) return undefined;
  if (score >= 95) return 'red';
  if (score >= 90) return 'orange';
  if (score >= 80) return 'purple';
  if (score >= 70) return 'blue';
  if (score >= 60) return 'green';
  return 'white';
}

export function normalizeUniqueArtRarity(value?: string | null): CharacterUniqueArtRarity {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'gold') return 'red';
  return CHARACTER_UNIQUE_ART_RARITIES.includes(normalized as CharacterUniqueArtRarity)
    ? normalized as CharacterUniqueArtRarity
    : 'white';
}

export function compareUniqueArtRarity(left?: string | null, right?: string | null): number {
  return rarityRank[normalizeUniqueArtRarity(left)] - rarityRank[normalizeUniqueArtRarity(right)];
}

export function buildNpcUniqueArtRequirement(
  abilityScores?: Record<string, number>,
): NpcUniqueArtRequirement | undefined {
  if (!abilityScores) return undefined;
  const abilities = NPC_UNIQUE_ART_ABILITY_NAMES
    .map((abilityName) => ({
      abilityName,
      score: abilityScores[abilityName],
    }))
    .filter((entry): entry is { abilityName: NpcUniqueArtAbilityName; score: number } => (
      typeof entry.score === 'number' && Number.isFinite(entry.score)
    ))
    .sort((left, right) => right.score - left.score);
  const highest = abilities[0];
  const minimumRarity = highest ? minimumUniqueArtRarityForScore(highest.score) : undefined;
  if (!highest || !minimumRarity) return undefined;

  const exceptional = abilities.filter((entry) => entry.score >= 80);
  const warCandidates = abilities.filter((entry) => (
    (entry.abilityName === '统率' || entry.abilityName === '智力')
    && entry.score >= 70
  ));
  const requiredWarAbilities = warCandidates.length <= 1
    ? warCandidates
    : warCandidates.some((entry) => entry.score >= 80)
      ? warCandidates.filter((entry) => entry.score >= 80)
      : [warCandidates[0]];
  const coveredAbilities = [
    ...(exceptional.length > 0 ? exceptional : [highest]),
    ...requiredWarAbilities,
  ].filter((entry, index, all) => (
    all.findIndex((candidate) => candidate.abilityName === entry.abilityName) === index
  ));
  return {
    highestAbilityName: highest.abilityName,
    highestScore: highest.score,
    minimumRarity,
    domainRequirements: coveredAbilities.map((entry) => ({
      abilityName: entry.abilityName,
      score: entry.score,
      domain: abilityDomainMap[entry.abilityName],
      minimumRarity: minimumUniqueArtRarityForScore(entry.score) ?? 'white',
    })),
  };
}

export function evaluateNpcUniqueArtCompliance(
  npc: Pick<LuanShiNpc, 'abilityScores' | 'uniqueArts'>,
): NpcUniqueArtComplianceResult {
  const requirement = buildNpcUniqueArtRequirement(npc.abilityScores);
  if (!requirement) return { compliant: true, reasons: [] };
  const arts = npc.uniqueArts ?? [];
  const reasons: string[] = [];

  if (!arts.some((art) => compareUniqueArtRarity(art.rarity, requirement.minimumRarity) >= 0)) {
    reasons.push(
      `最高属性${requirement.highestAbilityName}${requirement.highestScore}需要至少一项`
      + `${CHARACTER_UNIQUE_ART_RARITY_LABELS[requirement.minimumRarity]}绝艺`,
    );
  }

  for (const domainRequirement of requirement.domainRequirements) {
    const covered = arts.some((art) => (
      art.domain === domainRequirement.domain
      && compareUniqueArtRarity(art.rarity, domainRequirement.minimumRarity) >= 0
    ));
    if (!covered) {
      reasons.push(
        `${domainRequirement.abilityName}${domainRequirement.score}需要`
        + `${CHARACTER_UNIQUE_ART_RARITY_LABELS[domainRequirement.minimumRarity]}`
        + `${domainRequirement.domain}绝艺`,
      );
    }
  }

  return {
    compliant: reasons.length === 0,
    requirement,
    reasons,
  };
}

/**
 * 主模型漏写 NPC 绝艺时使用的确定性本地兜底。
 *
 * 它只补政策要求的缺失领域或提高已有领域的最低品级，不调用第二个 LLM，
 * 不改名、不换 ID、不重置既有成长数据。生成结果随后仍须通过统一命令合同。
 */
export function completeNpcUniqueArtsLocally(
  npc: Pick<
    LuanShiNpc,
    'npcId' | 'name' | 'role' | 'currentIdentity' | 'summary' | 'traits' | 'abilityScores' | 'uniqueArts'
  >,
  currentDate: string,
): CharacterUniqueArt[] {
  const requirement = buildNpcUniqueArtRequirement(npc.abilityScores);
  if (!requirement) return mergeStableCharacterUniqueArts(npc.uniqueArts, []);

  const additions: CharacterUniqueArt[] = [];
  for (const domainRequirement of requirement.domainRequirements) {
    const existing = (npc.uniqueArts ?? [])
      .filter((art) => art.domain === domainRequirement.domain)
      .sort((left, right) => compareUniqueArtRarity(right.rarity, left.rarity))[0];
    if (
      existing
      && compareUniqueArtRarity(existing.rarity, domainRequirement.minimumRarity) >= 0
    ) {
      continue;
    }

    if (existing) {
      additions.push({
        ...cloneUniqueArt(existing),
        rarity: domainRequirement.minimumRarity,
      });
      continue;
    }

    additions.push(createLocalNpcUniqueArt(
      npc,
      domainRequirement,
      currentDate,
    ));
  }

  return mergeStableCharacterUniqueArts(npc.uniqueArts, additions);
}

function createLocalNpcUniqueArt(
  npc: Pick<LuanShiNpc, 'npcId' | 'name' | 'role' | 'currentIdentity' | 'summary' | 'traits'>,
  requirement: NpcUniqueArtDomainRequirement,
  currentDate: string,
): CharacterUniqueArt {
  const blueprint = localUniqueArtBlueprints[requirement.domain];
  const identity = npc.currentIdentity?.trim() || npc.role.trim() || npc.summary.trim() || '既有身份';
  const traitLabel = npc.traits?.find((trait) => trait.label.trim())?.label.trim();
  const stableName = traitLabel && !traitLabel.includes(blueprint.name)
    ? `${traitLabel}·${blueprint.name}`
    : blueprint.name;
  const safeNpcId = npc.npcId
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'npc';

  return {
    id: `art_${safeNpcId}_${requirement.domain}_baseline_v1`,
    name: stableName,
    rarity: requirement.minimumRarity,
    domain: requirement.domain,
    level: localUniqueArtLevelByRarity[requirement.minimumRarity],
    description: `${npc.name}凭借“${identity}”的长期经历形成的稳定${blueprint.name}。`,
    effectSummary: `在${blueprint.sceneLabel}中体现与${blueprint.abilityLabel}${requirement.score}相称的能力。`,
    source: 'writeback',
    acquisition: {
      kind: 'background',
      occurredAt: currentDate,
      sourceRefId: `npc-profile:${npc.npcId}:background`,
      summary: `${npc.name}既有身份、属性与人物档案确认了这项长期能力。`,
    },
    promptHint: `在相关场景中体现${npc.name}的${blueprint.name}，不得据此预定胜负。`,
    tags: ['NPC档案补全', requirement.abilityName],
  };
}

function normalizeArtIdentity(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000·•・—–‐\-_:：,，.。;；、'"“”‘’《》〈〉（）()【】[\]]+/g, '');
}

function cloneUniqueArt(art: CharacterUniqueArt): CharacterUniqueArt {
  return {
    ...art,
    ...(art.acquisition ? { acquisition: { ...art.acquisition } } : {}),
    ...(art.checkHooks ? { checkHooks: art.checkHooks.map((hook) => ({ ...hook })) } : {}),
    ...(art.tags ? { tags: [...art.tags] } : {}),
    ...(art.relatedNpcIds ? { relatedNpcIds: [...art.relatedNpcIds] } : {}),
    ...(art.relatedFactionIds ? { relatedFactionIds: [...art.relatedFactionIds] } : {}),
    ...(art.progressHistory ? { progressHistory: art.progressHistory.map((entry) => ({ ...entry })) } : {}),
  };
}

export function findStableCharacterUniqueArtIndex(
  existing: readonly CharacterUniqueArt[],
  incoming: Pick<CharacterUniqueArt, 'id' | 'name' | 'domain'>,
): number {
  const exactId = existing.findIndex((art) => art.id === incoming.id);
  if (exactId >= 0) return exactId;
  const incomingName = normalizeArtIdentity(incoming.name);
  return existing.findIndex((art) => (
    normalizeArtIdentity(art.name) === incomingName
    && art.domain === incoming.domain
  ));
}

function mergeExistingArt(existing: CharacterUniqueArt, incoming: CharacterUniqueArt): CharacterUniqueArt {
  const rarity = compareUniqueArtRarity(incoming.rarity, existing.rarity) >= 0
    ? normalizeUniqueArtRarity(incoming.rarity)
    : existing.rarity;
  return {
    ...cloneUniqueArt(existing),
    ...cloneUniqueArt(incoming),
    id: existing.id,
    name: existing.name,
    domain: existing.domain,
    source: existing.source,
    acquisition: existing.acquisition ?? incoming.acquisition,
    rarity,
    level: existing.level,
    progress: existing.progress,
    bankedProgress: existing.bankedProgress,
    progressHistory: existing.progressHistory?.map((entry) => ({ ...entry })),
    upgradedAt: existing.upgradedAt,
    ...(existing.maxLevel !== undefined
      ? { maxLevel: existing.maxLevel }
      : {}),
  };
}

function mergeStringLists(
  existing: readonly string[] | undefined,
  incoming: readonly string[] | undefined,
): string[] | undefined {
  const merged = [...new Set([...(existing ?? []), ...(incoming ?? [])].map((item) => item.trim()).filter(Boolean))];
  return merged.length > 0 ? merged : undefined;
}

function pickMoreCompleteText(existing: string | undefined, incoming: string | undefined): string | undefined {
  const left = existing?.trim();
  const right = incoming?.trim();
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

function mergeHistoricalDuplicateArt(
  existing: CharacterUniqueArt,
  duplicate: CharacterUniqueArt,
): CharacterUniqueArt {
  const duplicateIsFurtherAdvanced = duplicate.level > existing.level
    || (duplicate.level === existing.level && (duplicate.progress ?? 0) > (existing.progress ?? 0));
  const progressSource = duplicateIsFurtherAdvanced ? duplicate : existing;
  const progressHistory = [
    ...(existing.progressHistory ?? []),
    ...(duplicate.progressHistory ?? []),
  ].filter((entry, index, entries) => (
    entries.findIndex((candidate) => candidate.eventId === entry.eventId) === index
  ));
  const checkHooks = [
    ...(existing.checkHooks ?? []),
    ...(duplicate.checkHooks ?? []),
  ].filter((hook, index, hooks) => (
    hooks.findIndex((candidate) => (
      normalizeArtIdentity(candidate.scope) === normalizeArtIdentity(hook.scope)
      && normalizeArtIdentity(candidate.note) === normalizeArtIdentity(hook.note)
    )) === index
  ));
  return {
    ...cloneUniqueArt(existing),
    rarity: compareUniqueArtRarity(duplicate.rarity, existing.rarity) > 0
      ? normalizeUniqueArtRarity(duplicate.rarity)
      : normalizeUniqueArtRarity(existing.rarity),
    level: progressSource.level,
    progress: progressSource.progress,
    bankedProgress: Math.max(existing.bankedProgress ?? 0, duplicate.bankedProgress ?? 0) || undefined,
    maxLevel: Math.max(existing.maxLevel ?? 0, duplicate.maxLevel ?? 0) || undefined,
    description: pickMoreCompleteText(existing.description, duplicate.description) ?? '',
    effectSummary: pickMoreCompleteText(existing.effectSummary, duplicate.effectSummary) ?? '',
    promptHint: pickMoreCompleteText(existing.promptHint, duplicate.promptHint),
    acquisition: existing.acquisition ?? duplicate.acquisition,
    acquiredAt: existing.acquiredAt?.trim() || duplicate.acquiredAt?.trim(),
    upgradedAt: progressSource.upgradedAt?.trim() || existing.upgradedAt?.trim() || duplicate.upgradedAt?.trim(),
    checkHooks: checkHooks.length > 0 ? checkHooks.map((hook) => ({ ...hook })) : undefined,
    tags: mergeStringLists(existing.tags, duplicate.tags),
    relatedNpcIds: mergeStringLists(existing.relatedNpcIds, duplicate.relatedNpcIds),
    relatedFactionIds: mergeStringLists(existing.relatedFactionIds, duplicate.relatedFactionIds),
    progressHistory: progressHistory.length > 0 ? progressHistory.map((entry) => ({ ...entry })) : undefined,
  };
}

/**
 * 角色绝艺是持久档案。后续写回只允许按稳定 ID 追加或升级；
 * 缺项、空数组、漂移 ID、降级与改名都不能清除已经成立的绝艺。
 */
export function mergeStableCharacterUniqueArts(
  existingArts: readonly CharacterUniqueArt[] | undefined,
  incomingArts: readonly CharacterUniqueArt[] | undefined,
): CharacterUniqueArt[] {
  const merged: CharacterUniqueArt[] = [];
  for (const existing of existingArts ?? []) {
    const normalized = {
      ...cloneUniqueArt(existing),
      rarity: normalizeUniqueArtRarity(existing.rarity),
    };
    const duplicateIndex = findStableCharacterUniqueArtIndex(merged, normalized);
    if (duplicateIndex >= 0) {
      merged[duplicateIndex] = mergeHistoricalDuplicateArt(merged[duplicateIndex], normalized);
    } else {
      merged.push(normalized);
    }
  }
  for (const incoming of incomingArts ?? []) {
    const index = findStableCharacterUniqueArtIndex(merged, incoming);
    if (index >= 0) {
      merged[index] = mergeExistingArt(merged[index], incoming);
    } else {
      const acquisition = incoming.acquisition ? { ...incoming.acquisition } : undefined;
      merged.push({
        ...cloneUniqueArt(incoming),
        rarity: normalizeUniqueArtRarity(incoming.rarity),
        level: incoming.acquisition?.kind === 'opening' || incoming.acquisition?.kind === 'background'
          ? incoming.level
          : 1,
        progress: incoming.acquisition?.kind === 'opening' || incoming.acquisition?.kind === 'background'
          ? incoming.progress ?? 0
          : 0,
        bankedProgress: undefined,
        progressHistory: undefined,
        ...(acquisition ? {
          acquisition,
          acquiredAt: incoming.acquiredAt?.trim() || acquisition.occurredAt,
        } : {}),
      });
    }
  }
  return merged;
}

/** @deprecated Prefer the character-wide name for new call sites. */
export const mergeStableNpcUniqueArts = mergeStableCharacterUniqueArts;

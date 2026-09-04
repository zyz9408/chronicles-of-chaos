import registryJson from './ThreeKingdomsAvgRegistry.generated.json';

interface PortraitProfile {
  sex?: string;
  ageBand?: string;
  professionTags?: string[];
  socialTierTags?: string[];
  bodyTypeTags?: string[];
  temperamentTags?: string[];
  stableTraitIds?: string[];
}
interface PortraitSet {
  portraitSetId: string;
  canonicalId?: string;
  label: string;
  runtimeRoleAliases: string[];
  defaultVariant: string;
  profile: PortraitProfile;
}

interface SceneSet {
  sceneResourceId: string;
  runtimeSceneIds: string[];
  runtimePlaceIds: string[];
  aliases: string[];
  semanticProfile: {
    environment?: string;
    function?: string;
    placeSignature?: string;
    tags?: string[];
  };
}

const registry = registryJson as typeof registryJson & {
  fixedPortraitSets: PortraitSet[];
  genericPortraitSets: PortraitSet[];
  scenes: SceneSet[];
};

function normalize(value: string | undefined): string {
  return value?.normalize('NFKC').trim().toLowerCase().replace(/[\s_.:|/\\-]+/gu, '') ?? '';
}

function stableIndex(value: string, length: number): number {
  let hash = 2166136261;
  for (const character of value.normalize('NFKC')) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

function normalizedSex(value: string | undefined): 'male' | 'female' | undefined {
  const sex = normalize(value);
  if (sex === '男' || sex === 'male') return 'male';
  if (sex === '女' || sex === 'female') return 'female';
  return undefined;
}

export interface ThreeKingdomsPortraitSubject {
  actorId: string;
  name?: string;
  aliases?: string[];
  roleType?: string;
  sex?: string;
  ageBand?: string;
}

export function resolveThreeKingdomsPortraitSet(
  subject: ThreeKingdomsPortraitSubject,
): PortraitSet | undefined {
  const actorId = normalize(subject.actorId);
  const labels = new Set([subject.name, ...(subject.aliases ?? [])].map(normalize).filter(Boolean));
  const fixedMatches = registry.fixedPortraitSets.filter((set) => {
    const canonicalId = normalize(set.canonicalId);
    const canonicalTail = normalize(set.canonicalId?.split('.').pop());
    return Boolean(
      (canonicalId && (actorId === canonicalId || actorId.endsWith(canonicalTail)))
      || labels.has(normalize(set.label))
      || set.runtimeRoleAliases.some((alias) => labels.has(normalize(alias)) || actorId === normalize(alias)),
    );
  });
  if (fixedMatches.length === 1) return fixedMatches[0];

  const sex = normalizedSex(subject.sex);
  if (!sex) return undefined;
  const roleText = normalize([subject.roleType, subject.name, ...(subject.aliases ?? [])].filter(Boolean).join('|'));
  const compatible = registry.genericPortraitSets.filter((set) => normalizedSex(set.profile.sex) === sex);
  if (compatible.length === 0) return undefined;
  const scored = compatible.map((set) => ({
    set,
    score: [...set.runtimeRoleAliases, ...(set.profile.professionTags ?? [])]
      .reduce((score, tag) => score + (normalize(tag) && roleText.includes(normalize(tag)) ? 1 : 0), 0)
      + (subject.ageBand && normalize(subject.ageBand) === normalize(set.profile.ageBand) ? 1 : 0),
  }));
  const bestScore = Math.max(...scored.map((entry) => entry.score));
  const pool = scored.filter((entry) => entry.score === bestScore).map((entry) => entry.set);
  return pool[stableIndex(subject.actorId, pool.length)];
}

export interface ThreeKingdomsSceneContext {
  runtimeSceneId?: string;
  runtimePlaceId?: string;
  locationId?: string;
  labels?: string[];
}

export function resolveThreeKingdomsSceneResource(
  context: ThreeKingdomsSceneContext,
): SceneSet | undefined {
  const sceneId = normalize(context.runtimeSceneId);
  const placeId = normalize(context.runtimePlaceId);
  const direct = registry.scenes.filter((scene) => (
    (sceneId && scene.runtimeSceneIds.some((id) => normalize(id) === sceneId))
    || (placeId && scene.runtimePlaceIds.some((id) => normalize(id) === placeId))
  ));
  if (direct.length === 1) return direct[0];

  const candidates = [
    context.runtimeSceneId,
    context.runtimePlaceId,
    context.locationId,
    ...(context.labels ?? []),
  ].map(normalize).filter(Boolean);
  const scored = registry.scenes.map((scene) => {
    const resourceTail = normalize(scene.sceneResourceId.split(':').pop());
    const keys = [resourceTail, ...scene.aliases.map(normalize), normalize(scene.semanticProfile.placeSignature)].filter(Boolean);
    const score = candidates.reduce((total, candidate) => total + Math.max(0, ...keys.map((key) => (
      candidate === key ? 100 : key.length >= 2 && (candidate.includes(key) || key.includes(candidate)) ? key.length : 0
    ))), 0);
    return { scene, score };
  }).filter((entry) => entry.score > 0).sort((left, right) => right.score - left.score);
  return scored.length > 0 && (scored.length === 1 || scored[0].score > scored[1].score)
    ? scored[0].scene
    : undefined;
}

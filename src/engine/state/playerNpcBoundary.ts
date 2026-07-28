import type { CharacterEquipmentItem, InventoryItem, RuntimeState } from '../types';

type PlayerProfile = RuntimeState['player'];

export type ProtagonistNpcCandidate = {
  npcId?: string | null;
  name?: string | null;
  courtesyName?: string | null;
  artName?: string | null;
  aliases?: string[] | null;
  commonAddress?: string | null;
  birthOrigin?: string | null;
  currentIdentity?: string | null;
  currentIdentityDescription?: string | null;
  factionName?: string | null;
  allegianceTarget?: string | null;
  officeTitle?: string | null;
  militaryTitle?: string | null;
  nobleTitle?: string | null;
  identitySummary?: string | null;
  summary?: string | null;
  role?: string | null;
  relationToPlayer?: string | null;
  equipment?: CharacterEquipmentItem[] | null;
  inventory?: InventoryItem[] | null;
};

const SELF_RELATION_TOKENS = new Set([
  '本人',
  '自己',
  '主角',
  '玩家',
  '主角本人',
  '玩家本人',
  '主角自己',
  '玩家自己',
  'self',
  'protagonist',
  'player',
  'playercharacter',
]);

const SELF_RELATION_PHRASES = [
  '就是主角',
  '即为主角',
  '等同主角',
  '主角本人',
  '玩家本人',
  '主角自己',
  '玩家自己',
  '自指主角',
  'self',
  'protagonist',
  'playercharacter',
];

export const PROTAGONIST_NPC_REJECTION_MESSAGE =
  'upsertNpcProfile 不得把主角本人创建或更新为 NPC 档案；主角事实请使用 protagonistProfile / updateCharacterIdentity / updatePlayerLoadout 等玩家路径。';

export function isProtagonistNpcClone(
  state: Pick<RuntimeState, 'player'>,
  candidate: ProtagonistNpcCandidate,
): boolean {
  const player = state.player;
  if (!player) return false;
  const selfRelation = hasSelfRelation(candidate.relationToPlayer);
  const nameMatches = sharesPlayerIdentityName(player, candidate);
  const idSignalsProtagonist = hasProtagonistLikeNpcId(player, candidate);
  if (idSignalsProtagonist && nameMatches) return true;

  if (!selfRelation.any) return false;
  if (nameMatches || idSignalsProtagonist) return true;

  return countSharedProtagonistFacts(player, candidate) > 0;
}

export function filterProtagonistNpcClones<T extends ProtagonistNpcCandidate>(
  state: Pick<RuntimeState, 'player'>,
  candidates: readonly T[],
): T[] {
  return candidates.filter((candidate) => !isProtagonistNpcClone(state, candidate));
}

function hasSelfRelation(value: string | null | undefined): { any: boolean; exact: boolean } {
  const normalized = normalizeText(value);
  if (!normalized) return { any: false, exact: false };
  if (SELF_RELATION_TOKENS.has(normalized)) return { any: true, exact: true };
  return {
    any: SELF_RELATION_PHRASES.some((phrase) => normalized.includes(phrase)),
    exact: false,
  };
}

function sharesPlayerIdentityName(player: PlayerProfile, candidate: ProtagonistNpcCandidate): boolean {
  const playerNames = new Set(identityNameTokens(player));
  if (playerNames.size === 0) return false;
  return identityNameTokens(candidate).some((token) => playerNames.has(token));
}

function identityNameTokens(value: {
  name?: string | null;
  courtesyName?: string | null;
  artName?: string | null;
  aliases?: string[] | null;
  commonAddress?: string | null;
}): string[] {
  return [
    value.name,
    value.courtesyName,
    value.artName,
    value.commonAddress,
    ...(value.aliases ?? []),
  ]
    .map(normalizeText)
    .filter((token): token is string => Boolean(token && token.length >= 2));
}

function hasProtagonistLikeNpcId(player: PlayerProfile, candidate: ProtagonistNpcCandidate): boolean {
  const npcId = normalizeIdentifier(candidate.npcId);
  if (!npcId) return false;

  const playerId = normalizeIdentifier(player.id);
  if (playerId && (npcId === playerId || npcId === `npc${playerId}`)) return true;

  return npcId === 'npcplayer'
    || npcId === 'playernpc'
    || npcId.includes('protagonist')
    || npcId.includes('self');
}

function countSharedProtagonistFacts(player: PlayerProfile, candidate: ProtagonistNpcCandidate): number {
  const candidateText = [
    candidate.role,
    candidate.birthOrigin,
    candidate.currentIdentity,
    candidate.currentIdentityDescription,
    candidate.factionName,
    candidate.allegianceTarget,
    candidate.officeTitle,
    candidate.militaryTitle,
    candidate.nobleTitle,
    candidate.identitySummary,
    candidate.summary,
    ...(candidate.equipment ?? []).map((item) => item.name),
    ...(candidate.inventory ?? []).map((item) => item.name),
  ].map(normalizeText).filter(Boolean).join('\n');
  if (!candidateText) return 0;

  const facts = [
    player.birthOrigin,
    player.currentIdentity,
    player.currentIdentityDescription,
    player.factionName,
    player.allegianceTarget,
    player.officeTitle,
    player.militaryTitle,
    player.nobleTitle,
    player.identitySummary,
    ...(player.equipment ?? []).map((item) => item.name),
    ...(player.inventory ?? []).map((item) => item.name),
  ]
    .map(normalizeText)
    .filter((value): value is string => Boolean(value && value.length >= 2));

  return new Set(facts.filter((fact) => candidateText.includes(fact))).size;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLocaleLowerCase().replace(/[\s　·・,，.。:：;；、()（）【】\[\]"“”'‘’`]+/g, '')
    : '';
}

function normalizeIdentifier(value: unknown): string {
  return typeof value === 'string'
    ? value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '')
    : '';
}

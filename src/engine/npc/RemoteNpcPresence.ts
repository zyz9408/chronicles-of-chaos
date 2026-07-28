import type { LuanShiNpc, NpcAwarenessEntry, RemoteNpcPresenceBeat, RuntimeState, WorldTrendEntry } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { isNpcPhysicallyPresent } from '../state/npcPresence';
import { isWorldChronicleEligible, isWorldChronicleOngoing } from '../state/worldChroniclePolicy';

export interface RemoteNpcPresenceSelectionOptions {
  maxBeats?: number;
}

interface Candidate {
  awarenessId: string;
  npcId?: string;
  name: string;
  contactLevel: number;
  historicalImportance: number;
  playerRelevance: string[];
  unresolvedHooks: string[];
  sourceIds: string[];
  sourceType: NpcAwarenessEntry['sourceType'];
  npc?: LuanShiNpc;
  lastPresenceBeatAt?: string;
  cooldownUntil?: string;
}

interface ScoredCandidate {
  candidate: Candidate;
  score: number;
  reason: string;
  beatType: RemoteNpcPresenceBeat['beatType'];
}

export function selectRemoteNpcPresenceBeats(
  state: RuntimeState,
  options: RemoteNpcPresenceSelectionOptions = {},
): RemoteNpcPresenceBeat[] {
  const normalized = ensureLuanShiState(state);
  const maxBeats = options.maxBeats ?? 3;
  const candidates = buildCandidates(normalized).filter((candidate) => !isCoolingDown(candidate, normalized.currentDate));
  const worldTrends = normalized.worldTrends
    .filter((trend) => trend.knownToPlayer)
    .filter(isWorldChronicleEligible)
    .filter(isWorldChronicleOngoing);

  return candidates
    .map((candidate) => scoreCandidate(candidate, worldTrends))
    .filter((item): item is ScoredCandidate => item !== undefined)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxBeats)
    .map(({ candidate, score, reason, beatType }) => ({
      beatId: `remote_${candidate.awarenessId}`,
      awarenessId: candidate.awarenessId,
      npcId: candidate.npcId,
      name: candidate.name,
      beatType,
      triggerReason: reason,
      suggestedDelivery: suggestDelivery(beatType),
      relevanceSummary: summarizeCandidate(candidate),
      urgency: classifyRemoteNpcUrgency(score),
      sourceIds: candidate.sourceIds,
    }));
}

function classifyRemoteNpcUrgency(score: number): RemoteNpcPresenceBeat['urgency'] {
  if (score >= 36) return 'high';
  if (score >= 12) return 'medium';
  return 'low';
}

function buildCandidates(state: ReturnType<typeof ensureLuanShiState>): Candidate[] {
  const byKey = new Map<string, Candidate>();

  for (const entry of state.npcAwarenessIndex) {
    const key = entry.npcId ?? entry.name;
    byKey.set(key, {
      awarenessId: entry.awarenessId,
      npcId: entry.npcId,
      name: entry.name,
      contactLevel: entry.contactLevel,
      historicalImportance: entry.historicalImportance ?? 0,
      playerRelevance: entry.playerRelevance ?? [],
      unresolvedHooks: entry.unresolvedHooks ?? [],
      sourceIds: entry.sourceIds,
      sourceType: entry.sourceType,
      npc: entry.npcId ? state.npcs.find((npc) => npc.npcId === entry.npcId) : undefined,
      lastPresenceBeatAt: entry.lastPresenceBeatAt,
      cooldownUntil: entry.cooldownUntil,
    });
  }

  for (const npc of state.npcs) {
    if (isNpcPhysicallyPresent(state, npc) || npc.isFocused) continue;
    if ((npc.contactLevel ?? 0) <= 0) continue;
    const key = npc.npcId;
    const existing = byKey.get(key);
    if (existing) {
      existing.npc = npc;
      existing.contactLevel = Math.max(existing.contactLevel, npc.contactLevel ?? 0);
      existing.playerRelevance = uniqueStrings([...existing.playerRelevance, 'known-relationship']);
      continue;
    }

    byKey.set(key, {
      awarenessId: `awareness_${npc.npcId}`,
      npcId: npc.npcId,
      name: npc.name,
      contactLevel: npc.contactLevel ?? 0,
      historicalImportance: 0,
      playerRelevance: ['known-relationship'],
      unresolvedHooks: inferNpcRelationshipHooks(npc),
      sourceIds: [`npc:${npc.npcId}`],
      sourceType: 'npcProfile',
      npc,
    });
  }

  return Array.from(byKey.values());
}

function scoreCandidate(candidate: Candidate, worldTrends: WorldTrendEntry[]): ScoredCandidate | undefined {
  const trendMatches = worldTrends.filter((trend) => candidateMatchesTrend(candidate, trend));
  const hasPlayerRelevance = candidate.playerRelevance.length > 0;
  const hasContact = candidate.contactLevel > 0;
  const hasHooks = candidate.unresolvedHooks.length > 0;
  const hasTrend = trendMatches.length > 0;

  if (!hasPlayerRelevance && !hasContact && !hasHooks && !hasTrend) {
    return undefined;
  }

  let score = 0;
  score += Math.min(candidate.contactLevel, 100) / 10;
  score += candidate.playerRelevance.length * 8;
  score += candidate.unresolvedHooks.length * 6;
  score += trendMatches.length * 10;
  score += Math.min(candidate.historicalImportance, 100) / 20;

  const reasonParts = [
    hasContact ? `contactLevel=${candidate.contactLevel}` : '',
    hasPlayerRelevance ? `relevance=${candidate.playerRelevance.join(',')}` : '',
    hasHooks ? `hooks=${candidate.unresolvedHooks.join(',')}` : '',
    hasTrend ? `worldTrend=${trendMatches.map((trend) => trend.trendId).join(',')}` : '',
  ].filter(Boolean);

  return {
    candidate,
    score,
    reason: reasonParts.join('; '),
    beatType: chooseBeatType(candidate, trendMatches),
  };
}

function candidateMatchesTrend(candidate: Candidate, trend: WorldTrendEntry): boolean {
  if (candidate.sourceIds.includes(trend.trendId)) return true;
  if (candidate.npcId && trend.npcAwarenessRefs?.some((ref) => ref.npcId === candidate.npcId)) return true;
  return trend.npcAwarenessRefs?.some((ref) => !candidate.npcId && ref.name === candidate.name) ?? false;
}

function isCoolingDown(candidate: Candidate, currentDate: string): boolean {
  const cooldownUntil = candidate.cooldownUntil?.trim();
  if (!cooldownUntil) return false;

  const currentAnchor = parseTemporalValue(currentDate);
  const cooldownAnchor = parseTemporalValue(cooldownUntil);
  if (currentAnchor !== undefined && cooldownAnchor !== undefined) {
    return currentAnchor < cooldownAnchor;
  }

  return currentDate.localeCompare(cooldownUntil) < 0;
}

function parseTemporalValue(value: string): number | undefined {
  const match = value.match(/(\d{1,4})\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2}):(\d{1,2}))?/);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] ? Number(match[4]) : 8;
  const minute = match[5] ? Number(match[5]) : 0;
  if ([year, month, day, hour, minute].some((part) => !Number.isFinite(part))) return undefined;

  return (((year * 12 + month) * 30 + day) * 24 + hour) * 60 + minute;
}

function chooseBeatType(candidate: Candidate, trends: WorldTrendEntry[]): RemoteNpcPresenceBeat['beatType'] {
  const lowerHooks = candidate.unresolvedHooks.join(' ').toLowerCase();
  const relevance = candidate.playerRelevance.join(' ').toLowerCase();
  if (relevance.includes('same-location') || lowerHooks.includes('recruit') || lowerHooks.includes('invite')) {
    return 'invitation';
  }
  if (candidate.contactLevel >= 20) return 'letter';
  if (candidate.sourceType === 'rumor') return 'rumor';
  if (trends.length > 0 || candidate.sourceType === 'worldTrend') return 'publicMention';
  return 'request';
}

function suggestDelivery(beatType: RemoteNpcPresenceBeat['beatType']): string {
  switch (beatType) {
    case 'letter':
      return 'letter, messenger, trusted intermediary';
    case 'invitation':
      return 'envoy, invitation, recruitment rumor';
    case 'rumor':
      return 'street rumor, tavern talk, local report';
    case 'publicMention':
      return 'public news, court report, caravan relay';
    case 'warning':
      return 'warning letter or urgent messenger';
    case 'absence':
      return 'noted silence or lack of reply';
    case 'envoy':
      return 'envoy or delegated speaker';
    case 'request':
    default:
      return 'message, request, or indirect approach';
  }
}

function summarizeCandidate(candidate: Candidate): string {
  const parts = [
    candidate.npc ? `known NPC: ${candidate.npc.name}` : 'hidden awareness entry',
    candidate.contactLevel > 0 ? `contact ${candidate.contactLevel}` : '',
    candidate.playerRelevance.length > 0 ? candidate.playerRelevance.join(', ') : '',
    candidate.unresolvedHooks.length > 0 ? candidate.unresolvedHooks.join('; ') : '',
  ].filter(Boolean);
  return parts.join(' | ');
}

function inferNpcRelationshipHooks(npc: LuanShiNpc): string[] {
  const text = `${npc.relationToPlayer ?? ''} ${npc.recentAttitude ?? ''}`.toLowerCase();
  const hooks: string[] = [];
  if (text.includes('risk') || text.includes('secret') || text.includes('unresolved')) {
    hooks.push('unresolved relationship risk');
  }
  if (text.includes('old') || text.includes('acquaintance')) {
    hooks.push('old relationship may resurface');
  }
  return hooks;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

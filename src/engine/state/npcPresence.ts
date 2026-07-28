import type { LuanShiNpc, RuntimeState } from '../types';
import { parseNarratorResponse } from '../turn/NarratorResponseParser';

interface StructuredPresenceEvidence {
  isPresent: boolean;
  locationId?: string;
}

interface ScenePresenceSnapshot {
  hasStructuredTransition: boolean;
  evidenceByNpcId: Map<string, StructuredPresenceEvidence>;
}

const scenePresenceCache = new WeakMap<RuntimeState, ScenePresenceSnapshot>();
const RECENT_STRUCTURED_PRESENCE_TURN_LIMIT = 12;

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function getCurrentLocationIds(state: RuntimeState): Set<string> {
  const currentLocationId = state.currentLocationId?.trim();
  const legacyPlaceId = state.currentPlaceId?.trim();
  const currentSceneId = state.currentSceneId?.trim();
  const locationIds = new Set<string>();

  // currentLocationId is the canonical cursor. currentPlaceId is only a
  // compatibility fallback; accepting both unconditionally lets a stale
  // legacy value keep NPCs at the previous place marked present.
  if (currentLocationId) locationIds.add(currentLocationId);
  else if (legacyPlaceId) locationIds.add(legacyPlaceId);

  if (currentSceneId) locationIds.add(currentSceneId);

  // Old saves may store the scene in both currentLocationId/currentSceneId
  // while retaining its parent place in currentPlaceId. In that explicit
  // shape the parent remains a valid coarse-grained NPC location.
  if (currentLocationId && currentSceneId === currentLocationId && legacyPlaceId) {
    locationIds.add(legacyPlaceId);
  }

  return locationIds;
}

function readPatchCommand(patch: { type: string; payload?: Record<string, unknown> }): Record<string, unknown> | undefined {
  const payload = patch.payload;
  if (!payload) return undefined;
  if (patch.type === 'luanshiCommand') {
    const nested = payload.command;
    return nested && typeof nested === 'object' && !Array.isArray(nested)
      ? nested as Record<string, unknown>
      : payload;
  }
  if (patch.type === 'updateNpcPresence' || patch.type === 'upsertNpcProfile') {
    return { action: patch.type, ...payload };
  }
  return undefined;
}

function getParsedStatePatches(rawResponse?: string): Array<{ type: string; payload?: Record<string, unknown> }> {
  if (!hasText(rawResponse)) return [];
  const response = parseNarratorResponse(rawResponse);
  const patches = [...(response.statePatches ?? [])];
  if (response.statePatch && !patches.includes(response.statePatch)) patches.push(response.statePatch);
  return patches as Array<{ type: string; payload?: Record<string, unknown> }>;
}

function readTransitionTarget(
  patches: Array<{ type: string; payload?: Record<string, unknown> }>,
  currentLocationIds: Set<string>,
): string | undefined {
  for (let index = patches.length - 1; index >= 0; index -= 1) {
    const patch = patches[index];
    if (patch.type !== 'locationChange') continue;
    const toLocationId = patch.payload?.toLocationId;
    const toSceneId = patch.payload?.toSceneId;
    if (hasText(toSceneId) && currentLocationIds.has(toSceneId.trim())) return toSceneId.trim();
    if (hasText(toLocationId) && currentLocationIds.has(toLocationId.trim())) return toLocationId.trim();
  }
  return undefined;
}

function buildScenePresenceSnapshot(state: RuntimeState): ScenePresenceSnapshot {
  const cached = scenePresenceCache.get(state);
  if (cached) return cached;

  const snapshot: ScenePresenceSnapshot = {
    hasStructuredTransition: false,
    evidenceByNpcId: new Map(),
  };
  const logs = state.turnLog ?? [];
  const currentLocationIds = getCurrentLocationIds(state);
  let transitionIndex = -1;
  const parsedByIndex = new Map<number, Array<{ type: string; payload?: Record<string, unknown> }>>();

  // recordTurnEvent is the strongest same-turn roster fact available to both
  // the writeback validator and the UI.  It survives save compaction even when
  // the older location-change raw response has already been pruned.
  for (const event of state.turnEvents ?? []) {
    if (event.happenedAt !== state.currentDate) continue;
    if (currentLocationIds.size > 0 && !currentLocationIds.has(event.locationId.trim())) continue;
    for (const npcId of event.presentNpcIds) {
      if (!hasText(npcId)) continue;
      snapshot.evidenceByNpcId.set(npcId.trim(), {
        isPresent: true,
        locationId: event.locationId.trim(),
      });
    }
  }

  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const patches = getParsedStatePatches(logs[index]?.displayMeta?.rawResponse);
    parsedByIndex.set(index, patches);
    if (readTransitionTarget(patches, currentLocationIds)) {
      transitionIndex = index;
      snapshot.hasStructuredTransition = true;
      break;
    }
  }

  const evidenceStartIndex = transitionIndex >= 0
    ? transitionIndex
    : Math.max(0, logs.length - RECENT_STRUCTURED_PRESENCE_TURN_LIMIT);
  if (logs.length > 0) {
    for (let index = evidenceStartIndex; index < logs.length; index += 1) {
      const log = logs[index];
      const patches = parsedByIndex.get(index) ?? getParsedStatePatches(log?.displayMeta?.rawResponse);

      for (const patch of patches) {
        const command = readPatchCommand(patch);
        if (!command) continue;
        const action = command.action;
        const npcId = command.npcId;
        if ((action !== 'updateNpcPresence' && action !== 'upsertNpcProfile') || !hasText(npcId)) continue;
        if (typeof command.isPresent !== 'boolean') continue;
        snapshot.evidenceByNpcId.set(npcId.trim(), {
          isPresent: command.isPresent,
          ...(hasText(command.locationId) ? { locationId: command.locationId.trim() } : {}),
        });
      }
    }
  }

  scenePresenceCache.set(state, snapshot);
  return snapshot;
}

function isEvidenceAtCurrentLocation(
  state: RuntimeState,
  evidence: StructuredPresenceEvidence,
): boolean {
  if (!evidence.isPresent) return false;
  if (!evidence.locationId) return true;
  const currentLocationIds = getCurrentLocationIds(state);
  return currentLocationIds.size === 0 || currentLocationIds.has(evidence.locationId);
}

/**
 * Legacy recovery helper only. Runtime presence must use structured commands,
 * same-turn event rosters, and canonical location fields instead of prose.
 */
export function narrativeHasNpcSpeakerTag(narrativeText: string | undefined, npc: LuanShiNpc): boolean {
  if (!hasText(narrativeText)) return false;
  const speakerNames = new Set<string>();
  for (const match of narrativeText.matchAll(/【([^】]+)】/g)) {
    const name = match[1]?.trim();
    if (name && name !== '旁白') speakerNames.add(name);
  }
  return [npc.name, npc.courtesyName, npc.artName, npc.commonAddress, ...(npc.aliases ?? [])]
    .filter(hasText)
    .some((name) => speakerNames.has(name.trim()));
}

/**
 * Resolves physical presence without mutating legacy runtime state.
 *
 * `isPresent` remains the writer-controlled intent flag, while a known NPC
 * location must also match the player's current place/scene. NPCs from older
 * saves that do not yet have a location keep their legacy flag semantics.
 */
export function isNpcPhysicallyPresent(state: RuntimeState, npc: LuanShiNpc): boolean {
  const sceneSnapshot = buildScenePresenceSnapshot(state);
  const structuredEvidence = sceneSnapshot.evidenceByNpcId.get(npc.npcId);
  if (structuredEvidence) return isEvidenceAtCurrentLocation(state, structuredEvidence);

  if (sceneSnapshot.hasStructuredTransition) {
    return false;
  }

  if (!npc.isPresent) return false;

  const npcLocationId = npc.locationId?.trim();
  if (!npcLocationId) return true;

  const currentLocationIds = getCurrentLocationIds(state);

  return currentLocationIds.size === 0 || currentLocationIds.has(npcLocationId);
}

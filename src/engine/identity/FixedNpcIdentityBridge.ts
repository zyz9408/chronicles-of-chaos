import type { RuntimeState } from '../types';
import type { NarratorResponse } from '../turn/MockNarrator';
import registry from '../avg/ThreeKingdomsAvgRegistry.generated.json';

const normalize = (value?: string) => value?.normalize('NFKC').trim().toLowerCase() ?? '';
const sexKey = (value?: string) => value === '男' || value === 'male' ? 'male' : value === '女' || value === 'female' ? 'female' : undefined;
type Subject = { name?: string; sex?: string; aliases?: string[] | null };

export function resolveFixedIdentity(subject: Subject): string | undefined {
  const labels = new Set([subject.name, ...(subject.aliases ?? [])].map(normalize).filter(Boolean));
  const matches = registry.fixedPortraitSets.filter((entry) => [entry.label, ...entry.runtimeRoleAliases].some((label) => labels.has(normalize(label))));
  if (matches.length !== 1 || !sexKey(subject.sex) || matches[0].profile.sex !== sexKey(subject.sex)) return undefined;
  return matches[0].canonicalId;
}

function canonicalNpc(state: RuntimeState, subject: Subject): string | undefined {
  const fixedId = resolveFixedIdentity(subject);
  if (!fixedId || state.worldBookId !== 'threeKingdoms') return undefined;
  const record = registry.fixedPortraitSets.find((entry) => entry.canonicalId === fixedId)!;
  const labels = new Set([record.label, ...record.runtimeRoleAliases].map(normalize));
  const matches = (state.npcs ?? []).filter((npc) => npc.worldBookIdentity?.canonicalId === fixedId
    || [npc.name, ...(npc.aliases ?? [])].some((label) => labels.has(normalize(label))));
  if (matches.length > 1) return undefined;
  if (matches.length === 1) {
    const npc = matches[0];
    if (sexKey(npc.sex) !== sexKey(subject.sex) || (npc.worldBookIdentity && (npc.worldBookIdentity.worldBookId !== state.worldBookId || npc.worldBookIdentity.canonicalId !== fixedId))) return undefined;
    return npc.npcId;
  }
  const id = `npc:fixed:${state.worldBookId}:${fixedId}`;
  if (state.player.id === id || state.knownActors.some((actor) => actor.id === id) || state.npcs?.some((npc) => npc.npcId === id)) return undefined;
  return id;
}

/** Only an unambiguous worldbook identity is linked; never use prose or change birthdays. */
export function linkFixedNpcIdentities(state: RuntimeState): RuntimeState {
  if (state.worldBookId !== 'threeKingdoms') return state;
  let changed = false;
  const npcs = state.npcs?.map((npc) => {
    const canonicalId = resolveFixedIdentity(npc);
    if (!canonicalId || npc.worldBookIdentity || canonicalNpc(state, npc) !== npc.npcId) return npc;
    changed = true;
    return { ...npc, worldBookIdentity: { worldBookId: state.worldBookId, canonicalId } };
  });
  return changed ? { ...state, npcs } : state;
}

export function bridgeFixedNpcResponse(state: RuntimeState, response: NarratorResponse): NarratorResponse {
  if (state.worldBookId !== 'threeKingdoms') return response;
  const aliases = new Map<string, string>();
  const conflicting = new Set<string>();
  const add = (id: string, target: string) => {
    if (aliases.has(id) && aliases.get(id) !== target) conflicting.add(id);
    else aliases.set(id, target);
  };
  const profiles: Array<Subject & { npcId: string }> = [...(response.writeback?.npcProfileSuggestions ?? [])];
  for (const patch of response.statePatches ?? (response.statePatch ? [response.statePatch] : [])) {
    const command = patch.payload?.command as Record<string, unknown> | undefined;
    if (command?.action === 'upsertNpcProfile' && typeof command.npcId === 'string' && typeof command.name === 'string' && typeof command.sex === 'string') profiles.push(command as unknown as Subject & { npcId: string });
  }
  for (const profile of profiles) {
    const target = canonicalNpc(state, profile);
    const existing = state.npcs?.find((npc) => npc.npcId === profile.npcId);
    if (!target || (existing && resolveFixedIdentity(existing) !== resolveFixedIdentity(profile))) continue;
    add(profile.npcId, target);
  }
  for (const actor of state.avgPresentation?.speakerActors ?? []) {
    const subject = { name: actor.labels[0], aliases: actor.labels, sex: actor.profileSnapshot.sex };
    const target = canonicalNpc(state, subject);
    // A visual identity alone never admits a new NPC.
    if (target && (state.npcs?.some((npc) => npc.npcId === target) || [...aliases.values()].includes(target))) add(actor.actorId, target);
  }
  for (const id of conflicting) aliases.delete(id);
  if (!aliases.size) return response;
  const rewrite = (value: unknown, key = ''): unknown => {
    if (['presentationSpeakerFacts', 'speakerFacts', 'speakerBindings', 'avgPresentation', 'turnLog'].includes(key)) return value;
    if (typeof value === 'string') return key !== 'speakerActorId' && /^(?:id|.*Id|.*Ids)$/u.test(key) ? aliases.get(value) ?? value : value;
    if (Array.isArray(value)) return value.map((item) => rewrite(item, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, rewrite(item, field)]));
    return value;
  };
  return rewrite(response) as NarratorResponse;
}

/** A promoted fixed actor can keep a previous local visual without rewriting frozen history. */
export function fixedNpcVisualAliases(state: RuntimeState, actorId: string): string[] {
  const npc = state.npcs?.find((entry) => entry.npcId === actorId);
  if (!npc || canonicalNpc(state, npc) !== actorId) return [];
  const fixedId = resolveFixedIdentity(npc);
  const actors = (state.avgPresentation?.speakerActors ?? []).filter((actor) => resolveFixedIdentity({ name: actor.labels[0], aliases: actor.labels, sex: actor.profileSnapshot.sex }) === fixedId);
  return fixedId && actors.length === 1 ? [actors[0].actorId] : [];
}

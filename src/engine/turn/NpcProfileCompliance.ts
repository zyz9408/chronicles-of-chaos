import type { RuntimeState } from '../types';
import { extractLuanShiCommandFromPatch } from './LuanShiCommandPatch';
import type { NarratorNpcProfileSuggestion, NarratorResponse } from './MockNarrator';

export interface MissingNpcProfileCandidate {
  npcId: string;
  name: string;
  persistenceReason: NonNullable<NarratorNpcProfileSuggestion['persistenceReason']>;
  /** turnSummary 已确认人物跨过长期准入边界；补档不得把它重新裁定为临时人物。 */
  admissionConfirmed: boolean;
  mentionCount: number;
  reasons: string[];
  evidence: string[];
}

interface CandidateDraft {
  npcId: string;
  name: string;
  persistenceReason: NonNullable<NarratorNpcProfileSuggestion['persistenceReason']>;
  admissionConfirmed: boolean;
  reasons: Set<string>;
  evidence: string[];
}

/**
 * NPC 人物志补全是结构化档案修复，不是正文命名实体识别。
 *
 * 主模型只要已经明确提交了一份具备长期准入理由的档案或结构化准入事实，
 * 且人物没有进入 acceptedRuntimeState，才允许调用辅助模型修复。正文点名、
 * 临时发言、风声、纪事与 NPC 记忆均不足以证明人物应进入长期人物志。
 */
export function detectMissingNpcProfileCandidates(input: {
  runtimeState: RuntimeState;
  acceptedRuntimeState?: RuntimeState;
  response: NarratorResponse;
  limit?: number;
}): MissingNpcProfileCandidate[] {
  const knownIds = new Set<string>();
  const knownNames = new Set<string>([input.runtimeState.player.name]);
  addKnownNpcIdentities(knownIds, knownNames, input.runtimeState);
  if (input.acceptedRuntimeState) {
    addKnownNpcIdentities(knownIds, knownNames, input.acceptedRuntimeState);
  }

  const drafts = new Map<string, CandidateDraft>();
  const addCandidate = (
    profile: Pick<NarratorNpcProfileSuggestion, 'npcId' | 'name' | 'persistenceReason' | 'persistenceEvidence' | 'summary'>,
    reason: string,
    admissionConfirmed = false,
  ) => {
    const npcId = profile.npcId.trim();
    const name = profile.name.trim();
    const persistenceReason = profile.persistenceReason;
    const persistenceEvidence = profile.persistenceEvidence?.trim();
    if (
      !npcId
      || !name
      || knownIds.has(npcId)
      || knownNames.has(name)
      || !persistenceReason
      || !persistenceEvidence
    ) {
      return;
    }

    const existing: CandidateDraft = drafts.get(npcId) ?? {
      npcId,
      name,
      persistenceReason,
      admissionConfirmed,
      reasons: new Set<string>(),
      evidence: [],
    };
    existing.admissionConfirmed ||= admissionConfirmed;
    existing.reasons.add(reason);
    for (const evidence of [persistenceEvidence, profile.summary.trim()]) {
      if (evidence && !existing.evidence.includes(evidence) && existing.evidence.length < 4) {
        existing.evidence.push(evidence);
      }
    }
    drafts.set(npcId, existing);
  };

  for (const profile of input.response.writeback?.npcProfileSuggestions ?? []) {
    addCandidate(profile, '人物志建议未通过本地合同');
  }

  for (const fact of input.response.writeback?.turnSummary?.npcAdmissions ?? []) {
    addCandidate({
      npcId: fact.npcId,
      name: fact.name,
      persistenceReason: fact.persistenceReason,
      persistenceEvidence: fact.persistenceEvidence,
      summary: fact.summary,
    }, '结构化人物准入事实尚未形成有效人物志', true);
  }

  for (const patch of collectStatePatches(input.response)) {
    const command = extractLuanShiCommandFromPatch(patch);
    if (command?.action !== 'upsertNpcProfile') continue;
    addCandidate(command, '人物志命令未通过本地合同');
  }

  return Array.from(drafts.values())
    .map((draft) => ({
      npcId: draft.npcId,
      name: draft.name,
      persistenceReason: draft.persistenceReason,
      admissionConfirmed: draft.admissionConfirmed,
      mentionCount: 1,
      reasons: Array.from(draft.reasons),
      evidence: draft.evidence,
    }))
    .slice(0, input.limit ?? 4);
}

function addKnownNpcIdentities(ids: Set<string>, names: Set<string>, state: RuntimeState): void {
  for (const npc of state.npcs ?? []) {
    if (npc.npcId.trim()) ids.add(npc.npcId.trim());
    for (const value of [npc.name, npc.courtesyName, npc.artName, npc.commonAddress, ...(npc.aliases ?? [])]) {
      if (value?.trim()) names.add(value.trim());
    }
  }
  for (const actor of state.knownActors ?? []) {
    if (actor.id?.trim()) ids.add(actor.id.trim());
    if (actor.name?.trim()) names.add(actor.name.trim());
  }
}

function collectStatePatches(response: NarratorResponse) {
  return [
    ...(response.statePatches ?? []),
    ...(response.statePatch ? [response.statePatch] : []),
  ];
}

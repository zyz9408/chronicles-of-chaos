import type { LlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import type { RuntimeState, WorldBook } from '../types';
import type { StatePatch } from '../types/statePatch';
import type { StateWritebackDisposition, StateWritebackRejectedCandidate } from '../types/stateWritebackRecovery';
import { canonicalStringify } from '../encounterV2/EncounterDeterminism';
import {
  applyStateWritebackRecovery,
  inspectStateWritebackRecovery,
  previewStateWritebackRecovery,
  type StateWritebackRecoveryPreview,
  type StateWritebackRecoveryVerification,
} from './StateWritebackRecovery';
import { prepareStatePatchTransaction } from '../turn/TurnOrchestrator';

const FROZEN_TOP_LEVEL_KEYS = new Set<keyof RuntimeState>([
  'currentDate', 'currentTime', 'currentLocationId', 'currentPlaceId', 'currentSceneId',
  'locations', 'routes', 'mapNodes', 'routeEdges', 'turnLog', 'stateWritebackRecovery',
]);

export type StateWritebackRecoveryPreparationResult =
  | {
      status: 'ready';
      preview: StateWritebackRecoveryPreview;
      repairAttemptCount: number;
      selectedSlotCount: number;
      applySlotCount: number;
      quarantinedDomains: string[];
    }
  | {
      status: 'none' | 'legacy_unavailable' | 'stale_lineage' | 'corrupt_evidence' | 'applied' | 'unresolved';
      message: string;
      repairAttemptCount?: number;
      diagnostics?: string[];
    };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function patchSlotIdentity(patch: StatePatch): string {
  const record = patch as StatePatch & { payload?: { command?: { action?: unknown } } };
  const action = typeof record.payload?.command?.action === 'string'
    ? record.payload.command.action.trim()
    : '';
  return `${String(patch.type)}\0${action}`;
}

function hasExactSlotSkeleton(initial: StatePatch[], candidate: StatePatch[]): boolean {
  return candidate.length === initial.length
    && candidate.every((patch, index) => patchSlotIdentity(patch) === patchSlotIdentity(initial[index]));
}

export function createStateWritebackRecoveryVerification(
  worldBook: WorldBook,
): StateWritebackRecoveryVerification {
  return {
    verifySemanticEvidence: ({ preTurnState, capsule, disposition }) => {
      if (worldBook.manifest.id !== capsule.worldBookId
        || preTurnState.worldBookId !== capsule.worldBookId
        || capsule.initialPatches.length === 0
        || capsule.rejectedCandidates.length === 0
        || disposition.recoveryStatus !== 'future-recovery-available') return false;
      const patchIndexes = new Set(capsule.quarantinedPatchIndexes);
      if (patchIndexes.size !== capsule.quarantinedPatchIndexes.length
        || capsule.quarantinedPatchIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= capsule.initialPatches.length)) {
        return false;
      }
      const dispositionIndexes = new Set(
        (disposition.quarantinedDomains ?? []).flatMap((domain) => domain.patchIndexes),
      );
      if ([...patchIndexes].some((index) => !dispositionIndexes.has(index))) return false;
      return capsule.rejectedCandidates.every((candidate, index) => (
        candidate.attempt === index + 1
        && candidate.attempt <= 2
        && hasExactSlotSkeleton(capsule.initialPatches, candidate.patches)
        && candidate.diagnostics.every((diagnostic, diagnosticIndex) => (
          Number.isInteger(diagnostic.patchIndex)
          && diagnostic.patchIndex >= 0
          && diagnostic.patchIndex < candidate.patches.length
          && diagnostic.errors.length > 0
          && (diagnosticIndex === 0 || candidate.diagnostics[diagnosticIndex - 1].patchIndex < diagnostic.patchIndex)
        ))
      ));
    },
  };
}

function parseJsonObject(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)?.[1]?.trim();
  const source = fenced ?? trimmed;
  const first = source.indexOf('{');
  const last = source.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('重整 API 未返回 JSON 对象。');
  const parsed = JSON.parse(source.slice(first, last + 1)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('重整 API 返回格式无效。');
  return parsed as Record<string, unknown>;
}

function readCandidatePatches(content: string): StatePatch[] {
  const payload = parseJsonObject(content);
  const value = Array.isArray(payload.statePatches)
    ? payload.statePatches
    : Array.isArray(payload.patches)
      ? payload.patches
      : undefined;
  if (!value) throw new Error('重整 API 未返回 statePatches。');
  return clone(value) as StatePatch[];
}

function formatDiagnostics(candidate: StateWritebackRejectedCandidate | undefined): string[] {
  return (candidate?.diagnostics ?? []).flatMap((diagnostic) => (
    diagnostic.errors.map((error) => `槽位 ${diagnostic.patchIndex}: ${error}`)
  ));
}

function buildRepairMessages(input: {
  capsule: NonNullable<RuntimeState['stateWritebackRecovery']>;
  attempt: number;
  previousCandidate?: StateWritebackRejectedCandidate;
}) {
  const diagnostics = formatDiagnostics(input.previousCandidate);
  return [
    {
      role: 'system' as const,
      content: [
        '你是状态写回重整器。只修复结构化 statePatches，不改正文，不新增、删除、合并或重排槽位。',
        '每个槽位必须保持原 type；luanshiCommand 必须保持原 command.action。',
        '仅修正诊断指出的非法字段，并返回 JSON：{"statePatches":[...]}。不要返回解释。',
      ].join('\n'),
    },
    {
      role: 'user' as const,
      content: [
        `重整尝试：${input.attempt}/2`,
        `冻结正文：${input.capsule.frozenNarrativeText}`,
        `原始槽位：${JSON.stringify(input.capsule.initialPatches)}`,
        `上一候选：${JSON.stringify(input.previousCandidate?.patches ?? input.capsule.initialPatches)}`,
        `严格校验错误：${diagnostics.length > 0 ? diagnostics.join('；') : '按原隔离槽位修正'}`,
        `只允许修改槽位索引：${input.capsule.quarantinedPatchIndexes.join(', ')}`,
      ].join('\n\n'),
    },
  ];
}

function diagnosticsFromPreparation(
  preparation: ReturnType<typeof prepareStatePatchTransaction>,
): StateWritebackRejectedCandidate['diagnostics'] {
  return preparation.patchValidationResults.flatMap((validation, index) => (
    validation.valid
      ? []
      : [{
          patchIndex: preparation.sourcePatchIndexes[index] ?? index,
          errors: [...validation.errors],
          warnings: [...validation.warnings],
        }]
  ));
}

function buildProposedState(input: {
  currentState: RuntimeState;
  preTurnState: RuntimeState;
  initialPatches: StatePatch[];
  repairedPatches: StatePatch[];
  quarantinedPatchIndexes: number[];
  worldBook: WorldBook;
}): RuntimeState | undefined {
  const quarantined = new Set(input.quarantinedPatchIndexes);
  const baseline = prepareStatePatchTransaction(
    input.initialPatches.filter((_, index) => !quarantined.has(index)),
    input.worldBook,
    input.preTurnState,
    {},
    undefined,
    false,
  );
  const repaired = prepareStatePatchTransaction(
    input.repairedPatches,
    input.worldBook,
    input.preTurnState,
    {},
    undefined,
    false,
  );
  if (repaired.patchValidation?.valid !== true || repaired.statePatches.length !== input.repairedPatches.length) return undefined;
  const proposed = clone(input.currentState);
  for (const key of Object.keys(repaired.statePatchDraft) as Array<keyof RuntimeState>) {
    if (FROZEN_TOP_LEVEL_KEYS.has(key)) continue;
    if (canonicalStringify(baseline.statePatchDraft[key]) !== canonicalStringify(repaired.statePatchDraft[key])) {
      (proposed as unknown as Record<string, unknown>)[key] = clone(repaired.statePatchDraft[key]);
    }
  }
  return proposed;
}

export async function prepareStateWritebackRecovery(input: {
  currentState: RuntimeState;
  worldBook: WorldBook;
  apiConfig: ApiConfigArchive;
  llmClient: LlmClient;
  signal?: AbortSignal;
}): Promise<StateWritebackRecoveryPreparationResult> {
  const verification = createStateWritebackRecoveryVerification(input.worldBook);
  const preflight = inspectStateWritebackRecovery(input.currentState, verification);
  if (preflight.status !== 'ready') {
    return {
      status: preflight.status,
      message: 'message' in preflight ? preflight.message : preflight.status === 'applied'
        ? '本回合状态写回已经重整。'
        : '当前没有可安全重整的状态写回。',
    };
  }
  const capsule = preflight.capsule;
  const latestTurn = input.currentState.turnLog[input.currentState.turnLog.length - 1];
  const disposition = latestTurn?.displayMeta?.stateWriteback as StateWritebackDisposition | undefined;
  let previousCandidate = capsule.rejectedCandidates[capsule.rejectedCandidates.length - 1];
  const attempted: StateWritebackRejectedCandidate[] = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    input.signal?.throwIfAborted();
    let patches: StatePatch[];
    try {
      const generated = await input.llmClient.generate({
        config: input.apiConfig,
        messages: buildRepairMessages({ capsule, attempt, previousCandidate }),
        responseFormat: 'json_object',
        temperature: 0,
        maxOutputTokens: 4096,
        retryCount: 0,
        signal: input.signal,
      });
      patches = readCandidatePatches(generated.content);
    } catch (error) {
      if (input.signal?.aborted) throw error;
      previousCandidate = {
        attempt,
        patches: clone(previousCandidate?.patches ?? capsule.initialPatches),
        writebackJson: '{}',
        diagnostics: [{
          patchIndex: capsule.quarantinedPatchIndexes[0] ?? 0,
          errors: [`重整响应无法解析：${error instanceof Error ? error.message : '未知错误'}`],
          warnings: [],
        }],
      };
      attempted.push(previousCandidate);
      continue;
    }
    if (!hasExactSlotSkeleton(capsule.initialPatches, patches)
      || patches.some((patch, index) => (
        !capsule.quarantinedPatchIndexes.includes(index)
        && canonicalStringify(patch) !== canonicalStringify(capsule.initialPatches[index])
      ))) {
      previousCandidate = { attempt, patches, writebackJson: '{}', diagnostics: [{
        patchIndex: 0,
        errors: ['重整候选改变了冻结槽位骨架或未隔离槽位。'],
        warnings: [],
      }] };
      attempted.push(previousCandidate);
      continue;
    }
    const prepared = prepareStatePatchTransaction(patches, input.worldBook, preflight.preTurnState, {}, undefined, false);
    const diagnostics = diagnosticsFromPreparation(prepared);
    const candidate: StateWritebackRejectedCandidate = {
      attempt,
      patches,
      writebackJson: '{}',
      diagnostics,
    };
    if (diagnostics.length > 0) {
      attempted.push(candidate);
      previousCandidate = candidate;
      continue;
    }
    const proposedState = buildProposedState({
      currentState: input.currentState,
      preTurnState: preflight.preTurnState,
      initialPatches: capsule.initialPatches,
      repairedPatches: patches,
      quarantinedPatchIndexes: capsule.quarantinedPatchIndexes,
      worldBook: input.worldBook,
    });
    if (!proposedState) {
      attempted.push(candidate);
      previousCandidate = candidate;
      continue;
    }
    const preview = previewStateWritebackRecovery({ currentState: input.currentState, proposedState, verification });
    if (preview.state.stateWritebackRecovery) {
      preview.state.stateWritebackRecovery.recoveryAttempts = clone(attempted);
      preview.state.stateWritebackRecovery.selectedRecoveryCandidate = clone(candidate);
    }
    return {
      status: 'ready',
      preview,
      repairAttemptCount: attempt,
      selectedSlotCount: patches.length,
      applySlotCount: capsule.quarantinedPatchIndexes.length,
      quarantinedDomains: [...new Set(
        (disposition?.quarantinedDomains ?? [])
          .map((domain) => domain.domain),
      )],
    };
  }
  return {
    status: 'unresolved',
    message: '状态写回重整候选仍未通过严格校验，未应用任何状态。',
    repairAttemptCount: attempted.length,
    diagnostics: formatDiagnostics(previousCandidate),
  };
}

export function commitPreparedStateWritebackRecovery(input: {
  currentState: RuntimeState;
  preview: StateWritebackRecoveryPreview;
  worldBook: WorldBook;
  appliedAt?: string;
}) {
  return applyStateWritebackRecovery(
    input.currentState,
    input.preview,
    createStateWritebackRecoveryVerification(input.worldBook),
    input.appliedAt,
  );
}

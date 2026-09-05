import { canonicalStringify, hashCanonicalValue } from '../encounterV2/EncounterDeterminism';
import type { RuntimeState } from '../types';
import type {
  StateWritebackDisposition,
  StateWritebackRecoveryCapsule,
  StateWritebackRejectedCandidate,
} from '../types/stateWritebackRecovery';
import type { StatePatch } from '../types/statePatch';
import { compactRuntimeStateForPersistence } from '../save/RuntimeStateCompaction';

const INTEGRITY_MESSAGE = '恢复证据完整性校验失败，未应用重整。';

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withoutRecovery(state: RuntimeState): RuntimeState {
  const copy = jsonClone(state);
  delete copy.stateWritebackRecovery;
  return copy;
}

function withoutRecoveryAnchor(state: RuntimeState): RuntimeState {
  const copy = withoutRecovery(state);
  const latest = copy.turnLog[copy.turnLog.length - 1];
  if (latest?.displayMeta?.stateWritebackRecoveryAnchor) {
    delete latest.displayMeta.stateWritebackRecoveryAnchor;
  }
  return copy;
}

function withoutAvgPresentation(state: RuntimeState): RuntimeState {
  const copy = jsonClone(state);
  delete copy.avgPresentation;
  for (const turn of copy.turnLog) {
    delete turn.avgPresentation;
    delete turn.avgVisualSnapshot;
  }
  return copy;
}

function stateHeadFingerprint(state: RuntimeState, version: 2 | 3): string {
  const head = withoutRecoveryAnchor(state);
  // Only presentation metadata is excluded. Narrative, time, map, character
  // facts, resources, memory and all other gameplay state remain protected.
  return hashCanonicalValue(version === 3 ? withoutAvgPresentation(compactRuntimeStateForPersistence(head)) : head);
}

function evidencePayload(input: {
  worldBookId: string;
  sourceTurnNumber: number;
  sourceTurnTimestamp: string;
  frozenNarrativeText: string;
  frozenNarrativeFingerprint: string;
  preTurnStateJson: string;
  preTurnStateFingerprint: string;
  sourceHeadFingerprint: string;
  initialPatches: StatePatch[];
  initialWritebackJson?: string;
  rejectedCandidates: StateWritebackRejectedCandidate[];
  quarantinedPatchIndexes: number[];
  disposition: StateWritebackDisposition;
  createdAt: string;
}) {
  return input;
}

export function createStateWritebackRecoveryCapsule(input: {
  schemaVersion?: 2 | 3;
  preTurnState: RuntimeState;
  postTurnState: RuntimeState;
  frozenNarrativeText: string;
  initialPatches: StatePatch[];
  initialWritebackJson?: string;
  rejectedCandidates: StateWritebackRejectedCandidate[];
  quarantinedPatchIndexes: number[];
}): StateWritebackRecoveryCapsule {
  const sourceTurn = input.postTurnState.turnLog[input.postTurnState.turnLog.length - 1];
  if (!sourceTurn) throw new Error('state writeback recovery requires one committed source turn');
  if (sourceTurn.fullNarrativeText !== input.frozenNarrativeText) {
    throw new Error('state writeback recovery narrative evidence does not match the committed turn');
  }
  const disposition = sourceTurn.displayMeta?.stateWriteback;
  if (!disposition || disposition.recoveryStatus !== 'future-recovery-available') {
    throw new Error('state writeback recovery requires a frozen future-recovery disposition');
  }

  const schemaVersion = input.schemaVersion ?? 3;
  const preTurnState = withoutRecovery(input.preTurnState);
  const postTurnHead = withoutRecoveryAnchor(input.postTurnState);
  const preTurnStateJson = canonicalStringify(preTurnState);
  const sourceHeadFingerprint = stateHeadFingerprint(input.postTurnState, schemaVersion);
  const frozenNarrativeFingerprint = hashCanonicalValue(input.frozenNarrativeText);
  const quarantinedPatchIndexes = [...new Set(input.quarantinedPatchIndexes)].sort((a, b) => a - b);
  const payload = evidencePayload({
    worldBookId: postTurnHead.worldBookId,
    sourceTurnNumber: sourceTurn.turnNumber,
    sourceTurnTimestamp: sourceTurn.timestamp,
    frozenNarrativeText: input.frozenNarrativeText,
    frozenNarrativeFingerprint,
    preTurnStateJson,
    preTurnStateFingerprint: hashCanonicalValue(preTurnState),
    sourceHeadFingerprint,
    initialPatches: jsonClone(input.initialPatches),
    ...(input.initialWritebackJson ? { initialWritebackJson: input.initialWritebackJson } : {}),
    rejectedCandidates: jsonClone(input.rejectedCandidates),
    quarantinedPatchIndexes,
    disposition: jsonClone(disposition),
    createdAt: sourceTurn.timestamp,
  });
  const fullEvidenceIdentity = hashCanonicalValue(payload);
  const capsuleId = `state-writeback-recovery:v${schemaVersion}:${fullEvidenceIdentity}`;
  sourceTurn.displayMeta = {
    ...sourceTurn.displayMeta,
    stateWritebackRecoveryAnchor: {
      schemaVersion,
      capsuleId,
      fullEvidenceIdentity,
      sourceHeadFingerprint,
      sourceTurnNumber: sourceTurn.turnNumber,
      sourceTurnTimestamp: sourceTurn.timestamp,
    },
  };
  return {
    schemaVersion,
    capsuleId,
    fullEvidenceIdentity,
    sourceHeadFingerprint,
    status: 'pending',
    worldBookId: postTurnHead.worldBookId,
    sourceTurnNumber: sourceTurn.turnNumber,
    sourceTurnTimestamp: sourceTurn.timestamp,
    frozenNarrativeText: input.frozenNarrativeText,
    frozenNarrativeFingerprint,
    preTurnStateJson,
    preTurnStateFingerprint: hashCanonicalValue(preTurnState),
    expectedHeadFingerprint: sourceHeadFingerprint,
    initialPatches: jsonClone(input.initialPatches),
    ...(input.initialWritebackJson ? { initialWritebackJson: input.initialWritebackJson } : {}),
    rejectedCandidates: jsonClone(input.rejectedCandidates),
    quarantinedPatchIndexes,
    createdAt: sourceTurn.timestamp,
  };
}

export type StateWritebackRecoveryPreflight =
  | { status: 'none' }
  | { status: 'legacy_unavailable'; code: 'missing-recovery-capsule'; message: string }
  | { status: 'stale_lineage'; code: 'state-head-changed'; message: string }
  | { status: 'corrupt_evidence'; code: 'recovery-capsule-integrity'; message: string }
  | { status: 'applied'; capsule: StateWritebackRecoveryCapsule }
  | { status: 'ready'; capsule: StateWritebackRecoveryCapsule; preTurnState: RuntimeState };

export interface StateWritebackRecoveryVerification {
  verifySemanticEvidence(input: {
    preTurnState: RuntimeState;
    capsule: StateWritebackRecoveryCapsule;
    disposition: StateWritebackDisposition;
  }): boolean;
}

export function inspectStateWritebackRecovery(
  state: RuntimeState,
  verification?: StateWritebackRecoveryVerification,
): StateWritebackRecoveryPreflight {
  const capsule = state.stateWritebackRecovery;
  if (!capsule) {
    return state.lastPatchValidation?.valid === false
      ? { status: 'legacy_unavailable', code: 'missing-recovery-capsule', message: '旧存档没有可验证的恢复证据。' }
      : { status: 'none' };
  }
  if (![2, 3].includes(capsule.schemaVersion) || capsule.worldBookId !== state.worldBookId) {
    return { status: 'stale_lineage', code: 'state-head-changed', message: '存档世界或恢复证据版本已变化，未应用重整。' };
  }
  const latest = state.turnLog[state.turnLog.length - 1];
  if (latest?.turnNumber !== capsule.sourceTurnNumber || latest.timestamp !== capsule.sourceTurnTimestamp) {
    return { status: 'stale_lineage', code: 'state-head-changed', message: '已经进入其他回合，旧回合重整不再应用；可以继续正常行动。' };
  }
  const validated = validateEvidence(state, capsule, verification);
  if (!validated) {
    return { status: 'corrupt_evidence', code: 'recovery-capsule-integrity', message: INTEGRITY_MESSAGE };
  }
  if (capsule.status === 'applied') return { status: 'applied', capsule };
  if (stateHeadFingerprint(state, capsule.schemaVersion) !== capsule.expectedHeadFingerprint) {
    return { status: 'stale_lineage', code: 'state-head-changed', message: '存档已在失败回合后发生变化，未应用过期重整。' };
  }
  return { status: 'ready', capsule, preTurnState: validated };
}

/**
 * Rebind a pending capsule after deterministic UI-side turn staging and before
 * the turn is first persisted. The existing evidence must still be intact.
 */
export function finalizePendingStateWritebackRecoveryHead(
  state: RuntimeState,
  verification: StateWritebackRecoveryVerification,
): RuntimeState {
  const capsule = state.stateWritebackRecovery;
  if (!capsule || capsule.status !== 'pending') return state;
  const latest = state.turnLog[state.turnLog.length - 1];
  // Finalization is only for evidence created for this new turn, never an
  // inherited pending record from an earlier failed writeback.
  if (latest?.turnNumber !== capsule.sourceTurnNumber || latest.timestamp !== capsule.sourceTurnTimestamp) return state;
  const preTurnState = validateEvidence(state, capsule, verification);
  if (!preTurnState) throw new Error(INTEGRITY_MESSAGE);

  const finalized = jsonClone(state);
  finalized.stateWritebackRecovery = createStateWritebackRecoveryCapsule({
    preTurnState,
    postTurnState: finalized,
    frozenNarrativeText: capsule.frozenNarrativeText,
    initialPatches: capsule.initialPatches,
    ...(capsule.initialWritebackJson ? { initialWritebackJson: capsule.initialWritebackJson } : {}),
    rejectedCandidates: capsule.rejectedCandidates,
    quarantinedPatchIndexes: capsule.quarantinedPatchIndexes,
  });
  return finalized;
}

/**
 * Upgrade intact v2 evidence, including saves made stale solely by the old
 * deterministic AVG materializer. A guessed earlier head is NEVER trusted:
 * it must reproduce the exact original fingerprint, with every non-visual
 * field unchanged. Otherwise leave the stale/corrupt record untouched.
 */
export function upgradeLegacyStateWritebackRecovery(
  state: RuntimeState,
  verification: StateWritebackRecoveryVerification,
): RuntimeState {
  const capsule = state.stateWritebackRecovery;
  if (!capsule || capsule.schemaVersion !== 2 || capsule.status !== 'pending') return state;
  const preTurnState = validateEvidence(state, capsule, verification);
  if (!preTurnState) return state;
  let matches = stateHeadFingerprint(state, 2) === capsule.expectedHeadFingerprint;
  for (let mask = 1; !matches && mask < 16; mask += 1) {
    const candidate = withoutRecovery(state);
    const latest = candidate.turnLog[candidate.turnLog.length - 1];
    if ((mask & 1) && candidate.avgPresentation) {
      const previous = preTurnState.avgPresentation?.visualPartitionId;
      if (previous === undefined) delete candidate.avgPresentation.visualPartitionId;
      else candidate.avgPresentation.visualPartitionId = previous;
    }
    if ((mask & 2) && candidate.avgPresentation) {
      const previous = preTurnState.avgPresentation?.portraitBindings;
      if (previous === undefined) delete candidate.avgPresentation.portraitBindings;
      else candidate.avgPresentation.portraitBindings = jsonClone(previous);
    }
    if (mask & 4) delete latest.avgVisualSnapshot;
    if ((mask & 8) && latest.avgPresentation) delete latest.avgPresentation.sceneBinding;
    // Both an absent container and an existing empty container occurred in old
    // saves; preserve that distinction when reconstructing their exact hash.
    matches = stateHeadFingerprint(candidate, 2) === capsule.expectedHeadFingerprint;
    const emptyGlobal = candidate.avgPresentation && !Object.keys(candidate.avgPresentation).length;
    const emptyTurn = latest.avgPresentation && !Object.keys(latest.avgPresentation).length;
    if (!matches && emptyGlobal) {
      delete candidate.avgPresentation;
      matches = stateHeadFingerprint(candidate, 2) === capsule.expectedHeadFingerprint;
    }
    if (!matches && emptyTurn) {
      delete latest.avgPresentation;
      matches = stateHeadFingerprint(candidate, 2) === capsule.expectedHeadFingerprint;
      if (!matches && emptyGlobal) {
        candidate.avgPresentation = {};
        matches = stateHeadFingerprint(candidate, 2) === capsule.expectedHeadFingerprint;
      }
    }
  }
  if (!matches) return state;
  return finalizePendingStateWritebackRecoveryHead(state, verification);
}

function validateEvidence(
  state: RuntimeState,
  capsule: StateWritebackRecoveryCapsule,
  verification?: StateWritebackRecoveryVerification,
): RuntimeState | undefined {
  try {
    return validateEvidenceFields(state, capsule, verification);
  } catch {
    // Imported/legacy evidence can violate the static TypeScript shape. Report
    // corrupt evidence instead of crashing the entire game during load.
    return undefined;
  }
}

function validateEvidenceFields(
  state: RuntimeState,
  capsule: StateWritebackRecoveryCapsule,
  verification?: StateWritebackRecoveryVerification,
): RuntimeState | undefined {
  if (hashCanonicalValue(capsule.frozenNarrativeText) !== capsule.frozenNarrativeFingerprint) return undefined;
  let preTurnState: RuntimeState;
  try {
    preTurnState = JSON.parse(capsule.preTurnStateJson) as RuntimeState;
  } catch {
    return undefined;
  }
  if (
    preTurnState.worldBookId !== capsule.worldBookId
    || preTurnState.stateWritebackRecovery !== undefined
    || canonicalStringify(preTurnState) !== capsule.preTurnStateJson
    || hashCanonicalValue(preTurnState) !== capsule.preTurnStateFingerprint
  ) return undefined;

  const sourceTurn = state.turnLog[state.turnLog.length - 1];
  const anchor = sourceTurn?.displayMeta?.stateWritebackRecoveryAnchor;
  const disposition = sourceTurn?.displayMeta?.stateWriteback;
  if (
    !sourceTurn || !anchor || !disposition
    || sourceTurn.turnNumber !== capsule.sourceTurnNumber
    || sourceTurn.timestamp !== capsule.sourceTurnTimestamp
    || sourceTurn.fullNarrativeText !== capsule.frozenNarrativeText
    || capsule.createdAt !== capsule.sourceTurnTimestamp
    || anchor.sourceHeadFingerprint !== capsule.sourceHeadFingerprint
    || capsule.expectedHeadFingerprint !== capsule.sourceHeadFingerprint
    || anchor.schemaVersion !== capsule.schemaVersion
    || anchor.sourceTurnNumber !== capsule.sourceTurnNumber
    || anchor.sourceTurnTimestamp !== capsule.sourceTurnTimestamp
  ) return undefined;

  const identity = hashCanonicalValue(evidencePayload({
    worldBookId: capsule.worldBookId,
    sourceTurnNumber: capsule.sourceTurnNumber,
    sourceTurnTimestamp: capsule.sourceTurnTimestamp,
    frozenNarrativeText: capsule.frozenNarrativeText,
    frozenNarrativeFingerprint: capsule.frozenNarrativeFingerprint,
    preTurnStateJson: capsule.preTurnStateJson,
    preTurnStateFingerprint: capsule.preTurnStateFingerprint,
    sourceHeadFingerprint: capsule.sourceHeadFingerprint,
    initialPatches: capsule.initialPatches,
    ...(capsule.initialWritebackJson ? { initialWritebackJson: capsule.initialWritebackJson } : {}),
    rejectedCandidates: capsule.rejectedCandidates,
    quarantinedPatchIndexes: capsule.quarantinedPatchIndexes,
    disposition,
    createdAt: capsule.createdAt,
  }));
  if (
    capsule.capsuleId !== `state-writeback-recovery:v${capsule.schemaVersion}:${identity}`
    || capsule.fullEvidenceIdentity !== identity
    || anchor.capsuleId !== capsule.capsuleId
    || anchor.fullEvidenceIdentity !== identity
    || !verification?.verifySemanticEvidence({ preTurnState, capsule, disposition })
  ) return undefined;
  return preTurnState;
}

export interface StateWritebackRecoveryPreview {
  status: 'ready';
  capsuleId: string;
  expectedHeadFingerprint: string;
  proposedStateFingerprint: string;
  state: RuntimeState;
}

export function previewStateWritebackRecovery(input: {
  currentState: RuntimeState;
  proposedState: RuntimeState;
  verification: StateWritebackRecoveryVerification;
}): StateWritebackRecoveryPreview {
  const preflight = inspectStateWritebackRecovery(input.currentState, input.verification);
  if (preflight.status !== 'ready') {
    throw new Error(`state writeback recovery is not ready: ${preflight.status}`);
  }
  assertFrozenTurnBoundary(input.currentState, input.proposedState, preflight.capsule);
  const state = jsonClone(input.proposedState);
  state.stateWritebackRecovery = jsonClone(preflight.capsule);
  return {
    status: 'ready',
    capsuleId: preflight.capsule.capsuleId,
    expectedHeadFingerprint: preflight.capsule.expectedHeadFingerprint,
    proposedStateFingerprint: hashCanonicalValue(withoutRecovery(state)),
    state,
  };
}

export function applyStateWritebackRecovery(
  currentState: RuntimeState,
  preview: StateWritebackRecoveryPreview,
  verification: StateWritebackRecoveryVerification,
  appliedAt = new Date().toISOString(),
): { status: 'applied' | 'already_applied' | 'stale_lineage'; state: RuntimeState } {
  const currentCapsule = currentState.stateWritebackRecovery;
  if (currentCapsule?.capsuleId === preview.capsuleId && currentCapsule.status === 'applied') {
    return { status: 'already_applied', state: currentState };
  }
  const preflight = inspectStateWritebackRecovery(currentState, verification);
  if (
    preflight.status !== 'ready'
    || preflight.capsule.capsuleId !== preview.capsuleId
    || preflight.capsule.expectedHeadFingerprint !== preview.expectedHeadFingerprint
    || hashCanonicalValue(withoutRecovery(preview.state)) !== preview.proposedStateFingerprint
  ) return { status: 'stale_lineage', state: currentState };

  const state = jsonClone(preview.state);
  const pending = state.stateWritebackRecovery;
  if (!pending || pending.status !== 'pending' || pending.capsuleId !== preview.capsuleId) {
    return { status: 'stale_lineage', state: currentState };
  }
  assertFrozenTurnBoundary(currentState, state, preflight.capsule);
  if (pending.schemaVersion === 3) {
    // An image can change while a repair request is in flight. Keep the latest
    // presentation rather than reverting it to the preview's earlier snapshot.
    if (currentState.avgPresentation) state.avgPresentation = jsonClone(currentState.avgPresentation);
    else delete state.avgPresentation;
    state.turnLog = jsonClone(currentState.turnLog);
  }
  const appliedHeadFingerprint = hashCanonicalValue(withoutRecovery(state));
  state.stateWritebackRecovery = { ...pending, status: 'applied', appliedAt, appliedHeadFingerprint };
  return { status: 'applied', state };
}

function assertFrozenTurnBoundary(
  current: RuntimeState,
  proposed: RuntimeState,
  capsule: StateWritebackRecoveryCapsule,
): void {
  const frozenKeys = [
    'currentDate', 'currentTime', 'currentLocationId', 'currentPlaceId', 'currentSceneId',
    'locations', 'routes', 'mapNodes', 'routeEdges', 'turnLog',
  ] as const;
  const currentFrozen = capsule.schemaVersion === 3 ? withoutAvgPresentation(current) : current;
  const proposedFrozen = capsule.schemaVersion === 3 ? withoutAvgPresentation(proposed) : proposed;
  const currentBoundary = Object.fromEntries(frozenKeys.map((key) => [key, currentFrozen[key]]));
  const proposedBoundary = Object.fromEntries(frozenKeys.map((key) => [key, proposedFrozen[key]]));
  const currentTurn = current.turnLog[current.turnLog.length - 1];
  const proposedTurn = proposed.turnLog[proposed.turnLog.length - 1];
  if (
    canonicalStringify(jsonClone(currentBoundary)) !== canonicalStringify(jsonClone(proposedBoundary))
    || currentTurn?.turnNumber !== capsule.sourceTurnNumber
    || currentTurn?.timestamp !== capsule.sourceTurnTimestamp
    || currentTurn?.fullNarrativeText !== capsule.frozenNarrativeText
    || proposedTurn?.fullNarrativeText !== capsule.frozenNarrativeText
  ) throw new Error('state writeback recovery violated the frozen turn boundary');
}

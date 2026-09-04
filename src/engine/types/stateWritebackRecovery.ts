import type { StatePatch } from './statePatch';

export interface StateWritebackRejectedCandidate {
  attempt: number;
  patches: StatePatch[];
  writebackJson: string;
  diagnostics: Array<{
    patchIndex: number;
    errors: string[];
    warnings: string[];
  }>;
}

export interface StateWritebackDisposition {
  recoveryStatus: 'future-recovery-available';
  quarantinedDomains?: Array<{
    domain: string;
    patchIndexes: number[];
  }>;
  [key: string]: unknown;
}

export interface StateWritebackRecoveryAnchor {
  schemaVersion: 2;
  capsuleId: string;
  fullEvidenceIdentity: string;
  sourceHeadFingerprint: string;
  sourceTurnNumber: number;
  sourceTurnTimestamp: string;
}

export interface StateWritebackRecoveryCapsule {
  schemaVersion: 2;
  capsuleId: string;
  fullEvidenceIdentity: string;
  sourceHeadFingerprint: string;
  status: 'pending' | 'applied';
  worldBookId: string;
  sourceTurnNumber: number;
  sourceTurnTimestamp: string;
  frozenNarrativeText: string;
  frozenNarrativeFingerprint: string;
  preTurnStateJson: string;
  preTurnStateFingerprint: string;
  expectedHeadFingerprint: string;
  initialPatches: StatePatch[];
  initialWritebackJson?: string;
  rejectedCandidates: StateWritebackRejectedCandidate[];
  recoveryAttempts?: StateWritebackRejectedCandidate[];
  selectedRecoveryCandidate?: StateWritebackRejectedCandidate;
  quarantinedPatchIndexes: number[];
  createdAt: string;
  appliedAt?: string;
  appliedHeadFingerprint?: string;
}

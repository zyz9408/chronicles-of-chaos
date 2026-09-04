import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import type { StatePatch } from '../types/statePatch';
import {
  applyStateWritebackRecovery,
  createStateWritebackRecoveryCapsule,
  finalizePendingStateWritebackRecoveryHead,
  inspectStateWritebackRecovery,
  previewStateWritebackRecovery,
} from './StateWritebackRecovery';

const verifier = { verifySemanticEvidence: () => true };

function makeState(turn = false): RuntimeState {
  return {
    engineVersion: '1.8.4',
    worldBookId: 'test-world',
    worldBookVersion: '1',
    worldBookSource: 'official',
    startDate: '公元190年01月01日',
    currentDate: '公元190年01月01日',
    currentLocationId: 'loc_camp',
    player: { id: 'player', name: '刘备', roleType: '游侠', summary: '' },
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: turn ? [{
      turnNumber: 1,
      date: '公元190年01月01日',
      playerInput: '整顿营务',
      narrativeText: '关羽点清兵册。',
      fullNarrativeText: '关羽点清兵册。',
      statePatchSummary: '部分写回已隔离',
      timestamp: '2026-08-24T00:00:00.000Z',
      displayMeta: {
        stateWriteback: {
          recoveryStatus: 'future-recovery-available',
          quarantinedDomains: [{ domain: 'military', patchIndexes: [0] }],
        },
      },
    }] : [],
    localSituationNotes: [],
  };
}

function makeCapsuleState() {
  const pre = makeState();
  const post = makeState(true);
  const patch: StatePatch = {
    type: 'localSituationChanged',
    payload: { description: '军营已经完成整顿。' },
    reason: '军营整顿完成',
  };
  const capsule = createStateWritebackRecoveryCapsule({
    preTurnState: pre,
    postTurnState: post,
    frozenNarrativeText: '关羽点清兵册。',
    initialPatches: [patch],
    rejectedCandidates: [{
      attempt: 1,
      patches: [patch],
      writebackJson: '{}',
      diagnostics: [{ patchIndex: 0, errors: ['数量非法'], warnings: [] }],
    }],
    quarantinedPatchIndexes: [0, 0],
  });
  post.stateWritebackRecovery = capsule;
  return { pre, post, capsule };
}

describe('StateWritebackRecovery', () => {
  it('creates a v2 capsule anchored to the committed source turn', () => {
    const { post, capsule } = makeCapsuleState();

    expect(capsule.capsuleId).toMatch(/^state-writeback-recovery:v2:fnv1a64:/);
    expect(capsule.quarantinedPatchIndexes).toEqual([0]);
    expect(post.turnLog[0].displayMeta?.stateWritebackRecoveryAnchor).toMatchObject({
      capsuleId: capsule.capsuleId,
      sourceTurnNumber: 1,
    });
    expect(inspectStateWritebackRecovery(post, verifier).status).toBe('ready');
  });

  it('rejects tampered evidence and a changed state head', () => {
    const tampered = makeCapsuleState().post;
    tampered.stateWritebackRecovery!.frozenNarrativeText = '被篡改的正文';
    expect(inspectStateWritebackRecovery(tampered, verifier).status).toBe('corrupt_evidence');

    const changed = makeCapsuleState().post;
    changed.localSituationNotes.push('失败回合后新增的事实');
    expect(inspectStateWritebackRecovery(changed, verifier).status).toBe('stale_lineage');
  });

  it('finalizes deterministic pre-save staging against the actual persisted head', () => {
    const staged = makeCapsuleState().post;
    staged.localSituationNotes.push('已排入回合后维护队列');
    expect(inspectStateWritebackRecovery(staged, verifier).status).toBe('stale_lineage');

    const finalized = finalizePendingStateWritebackRecoveryHead(staged, verifier);

    expect(finalized).not.toBe(staged);
    expect(finalized.localSituationNotes).toEqual(['已排入回合后维护队列']);
    expect(finalized.stateWritebackRecovery?.capsuleId).not.toBe(staged.stateWritebackRecovery?.capsuleId);
    expect(inspectStateWritebackRecovery(finalized, verifier).status).toBe('ready');
  });

  it('previews and applies a repair without changing narrative, time, map, or turn order', () => {
    const { post } = makeCapsuleState();
    const proposed = structuredClone(post);
    proposed.worldStateDelta.campReady = true;
    const preview = previewStateWritebackRecovery({ currentState: post, proposedState: proposed, verification: verifier });
    const applied = applyStateWritebackRecovery(post, preview, verifier, '2026-08-24T00:01:00.000Z');

    expect(applied.status).toBe('applied');
    expect(applied.state.worldStateDelta.campReady).toBe(true);
    expect(applied.state.currentDate).toBe(post.currentDate);
    expect(applied.state.turnLog).toEqual(post.turnLog);
    expect(applied.state.stateWritebackRecovery).toMatchObject({
      status: 'applied',
      appliedAt: '2026-08-24T00:01:00.000Z',
    });
    expect(applyStateWritebackRecovery(applied.state, preview, verifier).status).toBe('already_applied');
  });

  it('refuses a preview that rewrites the committed turn boundary', () => {
    const { post } = makeCapsuleState();
    const proposed = structuredClone(post);
    proposed.currentDate = '公元190年01月02日';

    expect(() => previewStateWritebackRecovery({ currentState: post, proposedState: proposed, verification: verifier }))
      .toThrow('frozen turn boundary');
  });
});

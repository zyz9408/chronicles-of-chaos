import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import type { StatePatch } from '../types/statePatch';
import {
  applyStateWritebackRecovery,
  createStateWritebackRecoveryCapsule,
  finalizePendingStateWritebackRecoveryHead,
  inspectStateWritebackRecovery,
  previewStateWritebackRecovery,
  upgradeLegacyStateWritebackRecovery,
} from './StateWritebackRecovery';
import { materializeAvgPresentation } from '../avg/AvgPresentationMaterializer';
import { compactRuntimeStateForPersistence } from '../save/RuntimeStateCompaction';

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

function makeCapsuleState(schemaVersion: 2 | 3 = 3) {
  const pre = makeState();
  const post = makeState(true);
  const patch: StatePatch = {
    type: 'localSituationChanged',
    payload: { description: '军营已经完成整顿。' },
    reason: '军营整顿完成',
  };
  const capsule = createStateWritebackRecoveryCapsule({
    schemaVersion,
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
  it('creates a v3 capsule anchored to the committed source turn', () => {
    const { post, capsule } = makeCapsuleState();

    expect(capsule.capsuleId).toMatch(/^state-writeback-recovery:v3:fnv1a64:/);
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

  it('keeps v3 recovery ready after AVG materialization and JSON save/load', () => {
    const { post } = makeCapsuleState();
    const visual = materializeAvgPresentation(post, { saveId: 'save', turnNumber: 1, playerPortraitMode: 'show' }).state;
    expect(visual).not.toBe(post);
    expect(inspectStateWritebackRecovery(visual, verifier).status).toBe('ready');
    expect(inspectStateWritebackRecovery(JSON.parse(JSON.stringify(visual)), verifier).status).toBe('ready');
  });

  it('preserves AVG changes made after preview while applying only the repaired gameplay state', () => {
    const { post } = makeCapsuleState();
    const proposed = structuredClone(post);
    proposed.worldStateDelta.campReady = true;
    const preview = previewStateWritebackRecovery({ currentState: post, proposedState: proposed, verification: verifier });
    const visual = materializeAvgPresentation(post, { saveId: 'save', turnNumber: 1, playerPortraitMode: 'show' }).state;
    const result = applyStateWritebackRecovery(visual, preview, verifier);
    expect(result.status).toBe('applied');
    expect(result.state.avgPresentation).toEqual(visual.avgPresentation);
    expect(result.state.turnLog).toEqual(visual.turnLog);
    expect(result.state.worldStateDelta.campReady).toBe(true);
  });

  it.each(['player', 'time', 'location', 'map', 'narrative', 'memory'])(
    'still rejects real %s changes after AVG materialization', (change) => {
      const { post } = makeCapsuleState();
      const visual = materializeAvgPresentation(post, { saveId: 'save', turnNumber: 1, playerPortraitMode: 'show' }).state;
      if (change === 'player') visual.player.name = '另一人';
      if (change === 'time') visual.currentDate = '公元190年01月02日';
      if (change === 'location') visual.currentLocationId = 'other';
      if (change === 'map') visual.routes = [];
      if (change === 'narrative') visual.turnLog[0].fullNarrativeText = '改写正文';
      if (change === 'memory') visual.localSituationNotes.push('新增事实');
      expect(inspectStateWritebackRecovery(visual, verifier).status).not.toBe('ready');
    },
  );

  it('does not let the expected head or source anchor be independently rewritten', () => {
    const { post } = makeCapsuleState();
    post.stateWritebackRecovery!.expectedHeadFingerprint = 'forged';
    expect(inspectStateWritebackRecovery(post, verifier).status).toBe('corrupt_evidence');
    const anchored = makeCapsuleState().post;
    anchored.turnLog[0].displayMeta!.stateWritebackRecoveryAnchor!.sourceTurnNumber = 99;
    expect(inspectStateWritebackRecovery(anchored, verifier).status).toBe('corrupt_evidence');
  });

  it('upgrades v2 only if the exact original head can be proven before AVG-only changes', () => {
    const { post } = makeCapsuleState(2);
    const visual = materializeAvgPresentation(post, { saveId: 'save', turnNumber: 1, playerPortraitMode: 'show' }).state;
    expect(inspectStateWritebackRecovery(visual, verifier).status).toBe('stale_lineage');
    const upgraded = upgradeLegacyStateWritebackRecovery(visual, verifier);
    expect(upgraded.stateWritebackRecovery?.schemaVersion).toBe(3);
    expect(inspectStateWritebackRecovery(upgraded, verifier).status).toBe('ready');
    expect(upgraded.avgPresentation).toEqual(visual.avgPresentation);
    expect(upgraded.turnLog[0].avgVisualSnapshot).toEqual(visual.turnLog[0].avgVisualSnapshot);
    const changed = structuredClone(visual);
    changed.localSituationNotes.push('真正的新状态');
    expect(upgradeLegacyStateWritebackRecovery(changed, verifier)).toBe(changed);
    const tampered = structuredClone(visual);
    tampered.stateWritebackRecovery!.frozenNarrativeText = '改写';
    expect(upgradeLegacyStateWritebackRecovery(tampered, verifier)).toBe(tampered);
  });

  it('does not finalize a previous-turn capsule against a later turn or bypass current-turn integrity', () => {
    const { post } = makeCapsuleState();
    post.turnLog.push({ ...post.turnLog[0], turnNumber: 2, timestamp: 'later', displayMeta: undefined });
    expect(finalizePendingStateWritebackRecoveryHead(post, verifier)).toBe(post);
    expect(inspectStateWritebackRecovery(post, verifier).status).toBe('stale_lineage');
    const sameTurn = makeCapsuleState().post;
    sameTurn.stateWritebackRecovery!.frozenNarrativeText = '损坏';
    expect(() => finalizePendingStateWritebackRecoveryHead(sameTurn, verifier)).toThrow('完整性校验失败');
  });

  it('keeps recovery valid when normal saving compacts older diagnostic records', () => {
    const { pre, post, capsule } = makeCapsuleState();
    const source = post.turnLog[0];
    post.turnLog = Array.from({ length: 7 }, (_, index) => ({
      ...structuredClone(source), turnNumber: index + 1,
      displayMeta: { ...source.displayMeta, rawResponse: `old diagnostics ${index}` },
    }));
    post.stateWritebackRecovery = createStateWritebackRecoveryCapsule({
      preTurnState: pre, postTurnState: post, frozenNarrativeText: capsule.frozenNarrativeText,
      initialPatches: capsule.initialPatches, rejectedCandidates: capsule.rejectedCandidates,
      quarantinedPatchIndexes: capsule.quarantinedPatchIndexes,
    });
    const stored = compactRuntimeStateForPersistence(post);
    expect(stored.turnLog[0].displayMeta?.rawResponse).toBeUndefined();
    expect(inspectStateWritebackRecovery(stored, verifier).status).toBe('ready');
    expect(inspectStateWritebackRecovery(post, verifier).status).toBe('ready');
  });

  it('reports malformed legacy evidence without crashing the load or upgrading it', () => {
    const { post } = makeCapsuleState(2);
    post.stateWritebackRecovery!.frozenNarrativeText = undefined as never;
    expect(inspectStateWritebackRecovery(post, verifier).status).toBe('corrupt_evidence');
    expect(upgradeLegacyStateWritebackRecovery(post, verifier)).toBe(post);
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RuntimeState, WorldBook } from '../engine/types';
import type { StatePatch } from '../engine/types/statePatch';
import { createStateWritebackRecoveryCapsule } from '../engine/state/StateWritebackRecovery';
import type { StateWritebackRecoveryPreparationResult } from '../engine/state/StateWritebackRecoveryService';
import { StateWritebackRecoveryPanel } from './StateWritebackRecoveryPanel';

const worldBook = { manifest: { id: 'test-world' }, mapSeed: [] } as unknown as WorldBook;

function makeState(turn = false): RuntimeState {
  return {
    engineVersion: '1.8.4', worldBookId: 'test-world', worldBookVersion: '1', worldBookSource: 'official',
    startDate: '公元190年01月01日', currentDate: '公元190年01月01日', currentLocationId: 'loc_camp',
    player: { id: 'player', name: '刘备', roleType: '游侠', summary: '' },
    knownActors: [], knownFactions: [], relationships: [], knownRumors: [], activeQuests: [],
    playerResources: {}, worldStateDelta: {}, localSituationNotes: [],
    turnLog: turn ? [{
      turnNumber: 1, date: '公元190年01月01日', playerInput: '整顿营务',
      narrativeText: '营务已经整顿。', fullNarrativeText: '营务已经整顿。', statePatchSummary: '部分隔离',
      timestamp: '2026-08-24T00:00:00.000Z',
      displayMeta: { stateWriteback: {
        recoveryStatus: 'future-recovery-available',
        quarantinedDomains: [{ domain: 'military', patchIndexes: [0] }],
      } },
    }] : [],
  };
}

function recoverableState(): RuntimeState {
  const pre = makeState();
  const post = makeState(true);
  const patch = { type: 'localSituationChanged', payload: {}, reason: '整顿' } as StatePatch;
  post.stateWritebackRecovery = createStateWritebackRecoveryCapsule({
    preTurnState: pre, postTurnState: post, frozenNarrativeText: '营务已经整顿。', initialPatches: [patch],
    rejectedCandidates: [{ attempt: 1, patches: [patch], writebackJson: '{}', diagnostics: [{
      patchIndex: 0, errors: ['字段无效'], warnings: [],
    }] }],
    quarantinedPatchIndexes: [0],
  });
  return post;
}

const noop = () => undefined;

describe('StateWritebackRecoveryPanel', () => {
  it('shows a user-reachable recovery action for a valid pending capsule', () => {
    const html = renderToStaticMarkup(<StateWritebackRecoveryPanel
      runtimeState={recoverableState()} worldBook={worldBook} preview={null}
      isPreparing={false} isApplying={false} onPrepare={noop} onCancelPreview={noop} onApplyPreview={noop}
    />);
    expect(html).toContain('state-writeback-recovery-prepare');
    expect(html).toContain('重新整理本回合写回');
  });

  it('renders frozen-boundary preview details before applying', () => {
    const preview = {
      status: 'ready', repairAttemptCount: 2, selectedSlotCount: 3, applySlotCount: 1,
      quarantinedDomains: ['military'], preview: {},
    } as Extract<StateWritebackRecoveryPreparationResult, { status: 'ready' }>;
    const html = renderToStaticMarkup(<StateWritebackRecoveryPanel
      runtimeState={makeState()} worldBook={worldBook} preview={preview}
      isPreparing={false} isApplying={false} onPrepare={noop} onCancelPreview={noop} onApplyPreview={noop}
    />);
    expect(html).toContain('状态写回重整预览');
    expect(html).toContain('部队与军务');
    expect(html).toContain('确认应用重整');
  });
});

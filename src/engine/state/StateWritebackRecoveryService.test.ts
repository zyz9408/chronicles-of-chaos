import { describe, expect, it } from 'vitest';
import type { LlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import type { RuntimeState, WorldBook } from '../types';
import type { StatePatch } from '../types/statePatch';
import { createStateWritebackRecoveryCapsule } from './StateWritebackRecovery';
import {
  commitPreparedStateWritebackRecovery,
  prepareStateWritebackRecovery,
} from './StateWritebackRecoveryService';

const worldBook = { manifest: { id: 'test-world' }, mapSeed: [] } as unknown as WorldBook;
const apiConfig = {
  id: 'test', name: 'test', provider: 'openai_compatible', baseUrl: 'https://example.invalid', apiKey: 'test', model: 'test',
  createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z',
} as unknown as ApiConfigArchive;

function makeState(turn = false): RuntimeState {
  return {
    engineVersion: '1.8.4', worldBookId: 'test-world', worldBookVersion: '1', worldBookSource: 'official',
    startDate: '公元190年01月01日', currentDate: '公元190年01月01日', currentLocationId: 'loc_camp',
    player: { id: 'player', name: '刘备', roleType: '游侠', summary: '' },
    knownActors: [], knownFactions: [], relationships: [], knownRumors: [], activeQuests: [],
    playerResources: {}, worldStateDelta: {}, localSituationNotes: [],
    turnLog: turn ? [{
      turnNumber: 1, date: '公元190年01月01日', playerInput: '整顿营务',
      narrativeText: '营务已经整顿。', fullNarrativeText: '营务已经整顿。',
      statePatchSummary: '部分写回已隔离', timestamp: '2026-08-24T00:00:00.000Z',
      displayMeta: { stateWriteback: {
        recoveryStatus: 'future-recovery-available',
        quarantinedDomains: [{ domain: 'other', patchIndexes: [0] }],
      } },
    }] : [],
  };
}

function makeRecoverableState(recoveryPatch?: StatePatch): RuntimeState {
  const pre = makeState();
  const post = makeState(true);
  const invalidPatch: StatePatch = recoveryPatch ?? {
    type: 'localSituationChanged', payload: { description: '' }, reason: '营务整顿',
  };
  post.stateWritebackRecovery = createStateWritebackRecoveryCapsule({
    preTurnState: pre,
    postTurnState: post,
    frozenNarrativeText: '营务已经整顿。',
    initialPatches: [invalidPatch],
    rejectedCandidates: [{
      attempt: 1,
      patches: [invalidPatch],
      writebackJson: '{}',
      diagnostics: [{ patchIndex: 0, errors: ['notes 不能为空'], warnings: [] }],
    }],
    quarantinedPatchIndexes: [0],
  });
  return post;
}

describe('StateWritebackRecoveryService', () => {
  it('prepares, previews and commits a bounded repair without changing the frozen turn', async () => {
    const state = makeRecoverableState();
    const client: LlmClient = { generate: async () => ({
      provider: 'openai_compatible', model: 'test',
      content: JSON.stringify({ statePatches: [{
        type: 'localSituationChanged', payload: { notes: ['营务已经完成整顿。'] }, reason: '营务整顿',
      }] }),
    }) };

    const prepared = await prepareStateWritebackRecovery({
      currentState: state, worldBook, apiConfig, llmClient: client,
    });
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;
    const committed = commitPreparedStateWritebackRecovery({
      currentState: state, preview: prepared.preview, worldBook, appliedAt: '2026-08-24T00:01:00.000Z',
    });
    expect(committed.status).toBe('applied');
    expect(committed.state.localSituationNotes).toContain('营务已经完成整顿。');
    expect(committed.state.currentDate).toBe(state.currentDate);
    expect(committed.state.turnLog[0].fullNarrativeText).toBe('营务已经整顿。');
  });

  it('rejects a repair that mutates an unquarantined slot', async () => {
    const state = makeRecoverableState();
    state.stateWritebackRecovery!.quarantinedPatchIndexes = [];
    const client: LlmClient = { generate: async () => ({
      provider: 'openai_compatible', model: 'test',
      content: JSON.stringify({ statePatches: [{
        type: 'localSituationChanged', payload: { notes: ['越界修改'] }, reason: '改写',
      }] }),
    }) };
    const result = await prepareStateWritebackRecovery({ currentState: state, worldBook, apiConfig, llmClient: client });
    expect(result.status).toBe('corrupt_evidence');
  });

  it('uses the second bounded attempt after an invalid first response', async () => {
    const state = makeRecoverableState();
    let calls = 0;
    const client: LlmClient = { generate: async () => {
      calls += 1;
      return {
        provider: 'openai_compatible', model: 'test',
        content: calls === 1 ? 'not json' : JSON.stringify({ statePatches: [{
          type: 'localSituationChanged', payload: { notes: ['二次重整成功。'] }, reason: '营务整顿',
        }] }),
      };
    } };
    const result = await prepareStateWritebackRecovery({ currentState: state, worldBook, apiConfig, llmClient: client });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.repairAttemptCount).toBe(2);
    expect(result.preview.state.stateWritebackRecovery?.recoveryAttempts).toHaveLength(1);
    expect(result.preview.state.stateWritebackRecovery?.selectedRecoveryCandidate?.attempt).toBe(2);
  });

  it('compares normalized LuanShi drafts using their JSON storage form', async () => {
    const state = makeRecoverableState({
      type: 'luanshiCommand',
      reason: '府库粮草写回格式错误',
      payload: {
        command: {
          action: 'updateResourceLedger',
          grain: '很多',
          summary: '',
        },
      },
    } as StatePatch);
    const client: LlmClient = { generate: async () => ({
      provider: 'openai_compatible', model: 'test',
      content: JSON.stringify({ statePatches: [{
        type: 'luanshiCommand',
        reason: '府库粮草写回格式修复',
        payload: {
          command: {
            action: 'updateResourceLedger',
            grain: 2_000,
            summary: '府库现存粮草二千石。',
          },
        },
      }] }),
    }) };

    const prepared = await prepareStateWritebackRecovery({
      currentState: state, worldBook, apiConfig, llmClient: client,
    });

    expect(prepared.status).toBe('ready');
  });
});

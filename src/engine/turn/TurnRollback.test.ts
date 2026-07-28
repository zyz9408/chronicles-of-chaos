import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import {
  createTurnRollbackSnapshot,
  restoreTurnRollbackSnapshot,
} from './TurnRollback';

function makeState(turns: number): RuntimeState {
  return {
    engineVersion: '0.1.0',
    worldBookId: 'threeKingdoms',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '189年9月',
    currentDate: '公元189年09月01日 08:00（辰时）',
    currentTime: {
      year: 189,
      month: 9,
      day: 1,
      hour: 8,
      minute: 0,
    },
    player: {
      id: 'player_1',
      name: '刘达',
      roleType: '军中将校',
      summary: '汉室远支。',
    },
    currentLocationId: 'loc_luoyang',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: Array.from({ length: turns }, (_, index) => ({
      turnNumber: index + 1,
      date: '公元189年09月01日 08:00（辰时）',
      playerInput: `行动${index + 1}`,
      narrativeText: `正文${index + 1}`,
      fullNarrativeText: `正文${index + 1}`,
      statePatchSummary: '测试',
      timestamp: `2026-06-18T00:00:0${index}.000Z`,
    })),
    localSituationNotes: [],
  };
}

describe('TurnRollback', () => {
  it('restores the exact pre-turn state and returns the action for editing or rerolling', () => {
    const before = makeState(1);
    const after = makeState(2);
    after.player.name = '被错误改动';
    after.currentDate = '公元189年09月01日 09:00（巳时）';
    after.currentTime = {
      year: 189,
      month: 9,
      day: 1,
      hour: 9,
      minute: 0,
    };

    const snapshot = createTurnRollbackSnapshot({
      beforeState: before,
      actionText: '把口粮分了，继续打小股贼寇搜集粮食',
      createdAt: '2026-06-18T00:00:00.000Z',
    });

    const restored = restoreTurnRollbackSnapshot(snapshot, after);

    expect(restored.state).toEqual(snapshot.beforeState);
    expect(restored.state.currentDate).toBe('公元189年09月01日 08:00（辰时）');
    expect(restored.state.currentTime).toEqual({
      year: 189,
      month: 9,
      day: 1,
      hour: 8,
      minute: 0,
    });
    expect(restored.actionText).toBe('把口粮分了，继续打小股贼寇搜集粮食');
    expect(after.player.name).toBe('被错误改动');
  });

  it('normalizes historical state when a rollback snapshot bypasses the storage reader', () => {
    const before = makeState(1);
    before.memoryArchive = undefined;
    before.troops = [{
      troopId: 'troop_legacy',
      name: '旧档郡兵',
      troopType: '步卒',
      size: 300,
      morale: 50,
      training: 60,
      supplies: 40,
      task: '巡守新野',
      relationToPlayer: '你直接统领',
    } as any];
    before.relationships = [{
      id: 'relationship_rollback_legacy',
      actorId: 'actor_source',
      targetId: 'actor_target',
      targetType: 'actor',
      type: 'neutral',
      value: 5,
      description: 'Legacy rollback relationship.',
    } as RuntimeState['relationships'][number]];

    const snapshot = createTurnRollbackSnapshot({
      beforeState: before,
      actionText: '继续巡守',
      createdAt: '2026-06-18T00:00:00.000Z',
    });
    const restored = restoreTurnRollbackSnapshot(snapshot, makeState(2));

    expect(restored.state.engineVersion).toBe('0.1.0');
    expect(restored.state.memoryArchive).toBeDefined();
    expect(restored.state.troops?.[0]).toMatchObject({
      quality: '中',
      fatigue: '低',
      readiness: '中',
      lifecycleStatus: 'active',
    });
    expect(restored.state.relationships[0]).toMatchObject({
      targetKind: 'actor',
      targetType: 'actor',
    });
  });

  it('does not trust a caller-supplied migration marker when creating a rollback snapshot', () => {
    const before = makeState(1);
    before.memoryArchive = undefined;

    const snapshot = createTurnRollbackSnapshot({
      beforeState: before,
      actionText: '保持当前快照',
      createdAt: '2026-06-18T00:00:00.000Z',
      runtimeStateMigrationVersion: 3,
    } as any);
    const restored = restoreTurnRollbackSnapshot(snapshot, makeState(2));

    expect(restored.state.memoryArchive).toBeDefined();
  });

  it('migrates a version-1 rollback snapshot restored without the snapshot store', () => {
    const before = makeState(1);
    before.relationships = [{
      id: 'relationship_direct_rollback_legacy',
      actorId: 'actor_source',
      targetId: 'faction_target',
      targetType: 'faction',
      type: 'neutral',
      value: 5,
      description: 'Direct legacy rollback relationship.',
    } as RuntimeState['relationships'][number]];
    const legacySnapshot = {
      beforeState: before,
      actionText: '恢复旧快照',
      createdAt: '2026-06-18T00:00:00.000Z',
      runtimeStateMigrationVersion: 1,
    } as ReturnType<typeof createTurnRollbackSnapshot>;

    const restored = restoreTurnRollbackSnapshot(legacySnapshot, makeState(2));

    expect(restored.state.relationships[0]).toMatchObject({
      targetKind: 'faction',
      targetType: 'faction',
    });
  });

  it('rejects a legacy rollback snapshot with an out-of-range relationship value', () => {
    const before = makeState(1);
    before.relationships = [{
      id: 'relationship_rollback_out_of_range',
      actorId: 'actor_source',
      targetId: 'actor_target',
      targetType: 'actor',
      type: 'neutral',
      value: -101,
      description: 'Invalid rollback relationship.',
    }];
    const legacySnapshot = {
      beforeState: before,
      actionText: '恢复非法旧快照',
      createdAt: '2026-06-18T00:00:00.000Z',
      runtimeStateMigrationVersion: 1,
    } as ReturnType<typeof createTurnRollbackSnapshot>;
    const current = makeState(2);

    expect(() => restoreTurnRollbackSnapshot(legacySnapshot, current))
      .toThrow(/value|关系值|-100|100/);
    expect(current).toEqual(makeState(2));
  });
});

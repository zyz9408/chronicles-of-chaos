import { describe, expect, it } from 'vitest';
import {
  createValidatedWarProjectionBundle,
  createWarEncounterSnapshot,
} from './WarSnapshotAdapter';
import {
  makeTroopProfile,
  makeWarArtProfile,
  makeWarCommander,
  makeWarIntent,
  makeWarTraitProfile,
  makeWarTroop,
} from './WarTestFixtures';

describe('WarSnapshotAdapter', () => {
  it('builds a frozen stable-order snapshot from troop IDs, structured fields and explicit projections', () => {
    const intent = makeWarIntent(
      ['troop_player_infantry', 'troop_player_naval'],
      ['troop_enemy_cavalry'],
    );
    const playerCommander = makeWarCommander('player_liuping');
    const enemyCommander = makeWarCommander('npc_enemy_commander');
    const projections = createValidatedWarProjectionBundle([
      makeTroopProfile('troop_player_infantry', 'infantry', ['anti_cavalry']),
      makeTroopProfile('troop_player_naval', 'naval', ['assault']),
      makeTroopProfile('troop_enemy_cavalry', 'cavalry', ['mobile']),
      makeWarTraitProfile('player_liuping_trait_stable_command'),
      makeWarArtProfile('player_liuping_art_decisive_order'),
    ]);
    const snapshot = createWarEncounterSnapshot({
      sessionId: 'session_war_batch3',
      intent,
      playerTroops: [
        makeWarTroop('troop_player_naval', { supplies: '粮草两日' }),
        makeWarTroop('troop_player_infantry', { quality: '精锐' }),
      ],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander,
      enemyCommander,
      projections,
    });

    expect(snapshot.forces.map((force) => force.troopId)).toEqual([
      'troop_player_infantry',
      'troop_player_naval',
      'troop_enemy_cavalry',
    ]);
    expect(snapshot.forces[0]).toMatchObject({
      stableOrder: 0,
      side: 'player',
      quality: 125,
      primaryClass: 'infantry',
      tags: ['anti_cavalry'],
    });
    expect(snapshot.forces[1]).toMatchObject({ supply: 35, supplyKnown: true, primaryClass: 'naval' });
    expect(snapshot.commanders.player).toMatchObject({ actorId: 'player_liuping', weightedScore: 62.5 });
    expect(snapshot.commanders.player?.traitProfiles).toHaveLength(1);
    expect(snapshot.commanders.player?.uniqueArtProfiles).toHaveLength(1);
    expect(snapshot.snapshotHash).toMatch(/^fnv1a64:/);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.forces)).toBe(true);
    expect(() => {
      (snapshot.forces as Array<{ morale: number }>)[0].morale = 0;
    }).toThrow();
  });

  it('does not infer a primary class from troopType or name when no projection exists', () => {
    const snapshot = createWarEncounterSnapshot({
      sessionId: 'session_war_no_guess',
      intent: makeWarIntent(),
      playerTroops: [makeWarTroop('troop_player_infantry', { name: '白马义从', troopType: '骑兵' })],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry', { name: '水军', troopType: '水军' })],
      playerCommander: makeWarCommander('player_liuping'),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      projections: createValidatedWarProjectionBundle([]),
    });

    expect(snapshot.forces.map((force) => force.primaryClass)).toEqual(['mixed', 'mixed']);
  });

  it('does not impose an arbitrary three-troop limit on either war side', () => {
    const playerIds = ['troop_player_1', 'troop_player_2', 'troop_player_3', 'troop_player_4'];
    const snapshot = createWarEncounterSnapshot({
      sessionId: 'session_war_many_forces',
      intent: makeWarIntent(playerIds, ['troop_enemy_1']),
      playerTroops: playerIds.map((troopId) => makeWarTroop(troopId)),
      enemyTroops: [makeWarTroop('troop_enemy_1')],
      playerCommander: makeWarCommander('player_liuping'),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      projections: createValidatedWarProjectionBundle([]),
    });

    expect(snapshot.forces.filter((force) => force.side === 'player')).toHaveLength(4);
  });

  it('rejects terminal/routed troops, missing sources and duplicate projection IDs', () => {
    const base = {
      sessionId: 'session_war_invalid',
      intent: makeWarIntent(),
      playerTroops: [makeWarTroop('troop_player_infantry')],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander: makeWarCommander('player_liuping'),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      projections: createValidatedWarProjectionBundle([]),
    };

    expect(() => createWarEncounterSnapshot({
      ...base,
      playerTroops: [makeWarTroop('troop_player_infantry', { lifecycleStatus: 'merged' })],
    })).toThrow(/终态/);
    expect(() => createWarEncounterSnapshot({
      ...base,
      playerTroops: [makeWarTroop('troop_player_infantry', { lifecycleStatus: 'routed' })],
    })).toThrow(/溃散/);
    expect(() => createWarEncounterSnapshot({ ...base, enemyTroops: [] })).toThrow(/troop_enemy_cavalry/);
    expect(() => createValidatedWarProjectionBundle([
      makeTroopProfile('troop_player_infantry'),
      makeTroopProfile('troop_player_infantry'),
    ])).toThrow(/重复/);
  });
});

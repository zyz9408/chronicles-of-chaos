import { describe, expect, it } from 'vitest';
import {
  createValidatedWarProjectionBundle,
  createWarEncounterSnapshot,
} from './WarSnapshotAdapter';
import {
  AGGRESSIVE_WAR_RULESET_VERSION,
  COMMAND_WAR_RULESET_VERSION,
  LEGACY_WAR_RULESET_VERSION,
  THEATER_WAR_RULESET_VERSION,
  WAR_RULESET_VERSION,
} from './EncounterContracts';
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
      warDifficulty: 'hard',
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
    expect(snapshot.warDifficulty).toBe('hard');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.forces)).toBe(true);
    expect(() => {
      (snapshot.forces as Array<{ morale: number }>)[0].morale = 0;
    }).toThrow();
  });

  it('defaults missing or invalid war difficulty to standard before freezing the snapshot', () => {
    const base = {
      sessionId: 'session_war_difficulty_default',
      intent: makeWarIntent(),
      playerTroops: [makeWarTroop('troop_player_infantry')],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander: makeWarCommander('player_liuping'),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      projections: createValidatedWarProjectionBundle([]),
    };
    expect(createWarEncounterSnapshot(base).warDifficulty).toBe('standard');
    expect(createWarEncounterSnapshot({
      ...base,
      warDifficulty: 'legacy' as never,
    }).warDifficulty).toBe('standard');
  });

  it('repairs stale exact fatigue from an older ordinary-turn recovery writeback', () => {
    const snapshot = createWarEncounterSnapshot({
      sessionId: 'session_war_fatigue_repair',
      intent: makeWarIntent(),
      playerTroops: [makeWarTroop('troop_player_infantry', {
        fatigue: '低',
        warFatiguePercent: 85,
      })],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander: makeWarCommander('player_liuping'),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      projections: createValidatedWarProjectionBundle([]),
    });

    expect(snapshot.forces.find((force) => force.troopId === 'troop_player_infantry')?.fatigue).toBe(15);
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

  it('materializes authoritative heavy cavalry combat tags from the structured logistics class', () => {
    const snapshot = createWarEncounterSnapshot({
      sessionId: 'session_war_structured_heavy_cavalry',
      intent: makeWarIntent(),
      playerTroops: [makeWarTroop('troop_player_infantry', {
        troopType: '骑兵',
        logisticsClass: 'heavy_cavalry',
      })],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander: makeWarCommander('player_liuping'),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      projections: createValidatedWarProjectionBundle([]),
    });

    expect(snapshot.forces[0]).toMatchObject({
      primaryClass: 'cavalry',
      tags: ['heavy', 'mobile', 'assault'],
      troopProfile: {
        sourceId: 'troop_player_infantry',
        status: 'executable',
        rulesetScopes: ['war'],
      },
    });
  });

  it('does not retrofit new heavy-cavalry projections into an existing War V2.3 checkpoint', () => {
    const intent = makeWarIntent();
    intent.rulesetVersion = THEATER_WAR_RULESET_VERSION;
    const snapshot = createWarEncounterSnapshot({
      sessionId: 'session_war_v23_heavy_cavalry_compatibility',
      intent,
      playerTroops: [makeWarTroop('troop_player_infantry', {
        troopType: '骑兵',
        logisticsClass: 'heavy_cavalry',
      })],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander: makeWarCommander('player_liuping'),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      projections: createValidatedWarProjectionBundle([]),
    });

    expect(snapshot.snapshotVersion).toBe(3);
    expect(snapshot.forces[0]).toMatchObject({ primaryClass: 'mixed', tags: [] });
    expect(snapshot.forces[0].troopProfile).toBeUndefined();
  });

  it('freezes only the locally deployable establishment after logistics losses', () => {
    const snapshot = createWarEncounterSnapshot({
      sessionId: 'session_war_deployable_establishment',
      intent: makeWarIntent(undefined, undefined, { player: [340] }),
      playerTroops: [makeWarTroop('troop_player_infantry', { size: 500, deployableSize: 340 })],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander: makeWarCommander('player_liuping'),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      projections: createValidatedWarProjectionBundle([]),
    });

    expect(snapshot.forces.find((force) => force.troopId === 'troop_player_infantry')?.initialStrength).toBe(340);
  });

  it('caps a stale deployable overflow by surviving troop size while retaining an exact legacy hash path', () => {
    const input = {
      sessionId: 'session_war_stale_deployable_overflow',
      intent: makeWarIntent(undefined, undefined, { player: [282] }),
      playerTroops: [makeWarTroop('troop_player_infantry', { size: 282, deployableSize: 300 })],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander: makeWarCommander('player_liuping'),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      projections: createValidatedWarProjectionBundle([]),
    };
    const snapshot = createWarEncounterSnapshot(input);
    const legacySnapshot = createWarEncounterSnapshot({
      ...input,
      preserveLegacyDeployableOverflow: true,
    });

    expect(snapshot.forces.find((force) => force.troopId === 'troop_player_infantry')).toMatchObject({
      initialStrength: 282,
      sourceStrength: 282,
      commitmentKind: 'full',
    });
    expect(legacySnapshot.forces.find((force) => force.troopId === 'troop_player_infantry')).toMatchObject({
      initialStrength: 282,
      sourceStrength: 300,
      commitmentKind: 'detachment',
    });
    expect(legacySnapshot.snapshotHash).not.toBe(snapshot.snapshotHash);
    expect(() => createWarEncounterSnapshot({
      ...input,
      intent: makeWarIntent(undefined, undefined, { player: [300] }),
    })).toThrow('局部投入兵力必须在 1—282 之间');
  });

  it('materializes a stable compatibility projection for a structured warfare art when the API omitted it', () => {
    const snapshot = createWarEncounterSnapshot({
      sessionId: 'session_war_player_art_compatibility',
      intent: makeWarIntent(),
      playerTroops: [makeWarTroop('troop_player_infantry')],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander: makeWarCommander('player_liuping', {
        uniqueArts: [{
          id: 'art_player_formation',
          name: '军阵整肃',
          rarity: 'orange',
          domain: 'warfare',
          level: 4,
          description: '稳定军阵。',
          effectSummary: '提高军势协同。',
          source: 'opening',
        }],
      }),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      projections: createValidatedWarProjectionBundle([
        makeTroopProfile('troop_player_infantry'),
        makeTroopProfile('troop_enemy_cavalry'),
      ]),
    });

    const profile = snapshot.commanders.player?.uniqueArtProfiles.find(
      (candidate) => candidate.sourceId === 'art_player_formation',
    );
    expect(profile).toMatchObject({
      sourceId: 'art_player_formation',
      status: 'executable',
      rulesetScopes: ['war'],
      targetMode: 'all_allies',
    });
    expect(profile?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        trigger: 'before_war_resolution',
        operation: 'modify_effective_strength',
        target: 'own_force',
      }),
    ]));
    expect(profile?.effects[0]?.value).toBeGreaterThanOrEqual(120);
    expect(snapshot.commanders.player?.uniqueArtLabels).toEqual({ art_player_formation: '军阵整肃' });
  });

  it('keeps War V2.4 art values stable while applying the stronger War V2.5 projection', () => {
    const art = {
      id: 'art_player_formation',
      name: '军阵整肃',
      rarity: 'orange' as const,
      domain: 'warfare' as const,
      level: 4,
      description: '稳定军阵。',
      effectSummary: '提高军势协同。',
      source: 'opening',
    };
    const build = (rulesetVersion: typeof AGGRESSIVE_WAR_RULESET_VERSION | typeof WAR_RULESET_VERSION) => {
      const intent = makeWarIntent();
      intent.rulesetVersion = rulesetVersion;
      return createWarEncounterSnapshot({
        sessionId: `session_war_art_${rulesetVersion}`,
        intent,
        playerTroops: [makeWarTroop('troop_player_infantry')],
        enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
        playerCommander: makeWarCommander('player_liuping', { uniqueArts: [art] }),
        enemyCommander: makeWarCommander('npc_enemy_commander'),
        projections: createValidatedWarProjectionBundle([
          makeTroopProfile('troop_player_infantry'),
          makeTroopProfile('troop_enemy_cavalry'),
        ]),
      }).commanders.player!.uniqueArtProfiles[0];
    };

    const v24 = build(AGGRESSIVE_WAR_RULESET_VERSION);
    const current = build(WAR_RULESET_VERSION);
    expect(v24.powerClass).toBe('ultimate');
    expect(current.powerClass).toBe('ultimate');
    expect(current.effects[0].value).toBeGreaterThan(v24.effects[0].value);
  });

  it('repairs an unusable narrative-only warfare projection from structured art fields', () => {
    const narrativeOnly = makeWarArtProfile('art_player_formation');
    narrativeOnly.status = 'narrative_only';
    narrativeOnly.effects = [];
    const snapshot = createWarEncounterSnapshot({
      sessionId: 'session_war_player_art_narrative_only',
      intent: makeWarIntent(),
      playerTroops: [makeWarTroop('troop_player_infantry')],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander: makeWarCommander('player_liuping', {
        uniqueArts: [{
          id: 'art_player_formation',
          name: '军阵整肃',
          rarity: 'orange',
          domain: 'warfare',
          level: 4,
          description: '稳定军阵。',
          effectSummary: '提高军势协同。',
          source: 'opening',
        }],
      }),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      projections: createValidatedWarProjectionBundle([
        makeTroopProfile('troop_player_infantry'),
        makeTroopProfile('troop_enemy_cavalry'),
        narrativeOnly,
      ]),
    });

    expect(snapshot.commanders.player?.uniqueArtProfiles).toEqual([
      expect.objectContaining({
        sourceId: 'art_player_formation',
        status: 'executable',
        rulesetScopes: ['war'],
      }),
    ]);
    expect(snapshot.commanders.player?.uniqueArtLabels).toEqual({
      art_player_formation: '军阵整肃',
    });
  });

  it('repairs a valid but personal-only art projection before war execution', () => {
    const personalOnly = makeWarArtProfile('art_player_formation');
    personalOnly.rulesetScopes = ['personal_combat'];
    personalOnly.effects = [{
      trigger: 'before_attack',
      condition: 'always',
      operation: 'extra_attack',
      target: 'single_enemy',
      value: 1,
      priority: 20,
      perEncounterLimit: 1,
    }];
    const snapshot = createWarEncounterSnapshot({
      sessionId: 'session_war_player_art_scope_repair',
      intent: makeWarIntent(),
      playerTroops: [makeWarTroop('troop_player_infantry')],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander: makeWarCommander('player_liuping', {
        uniqueArts: [{
          id: 'art_player_formation',
          name: '军阵整肃',
          rarity: 'orange',
          domain: 'warfare',
          level: 4,
          description: '稳定军阵。',
          effectSummary: '提高军势协同。',
          source: 'opening',
        }],
      }),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      projections: createValidatedWarProjectionBundle([
        makeTroopProfile('troop_player_infantry'),
        makeTroopProfile('troop_enemy_cavalry'),
        personalOnly,
      ]),
    });

    const profile = snapshot.commanders.player?.uniqueArtProfiles[0];
    expect(profile?.rulesetScopes).toEqual(['personal_combat', 'war']);
    expect(profile?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: 'before_attack' }),
      expect.objectContaining({ trigger: 'before_war_resolution', target: 'own_force' }),
    ]));
  });

  it('repairs a projection that claims war scope but has no executable war effect', () => {
    const mislabeledWarProfile = makeWarArtProfile('art_player_formation');
    mislabeledWarProfile.rulesetScopes = ['war'];
    mislabeledWarProfile.effects = [{
      trigger: 'before_attack',
      condition: 'always',
      operation: 'extra_attack',
      target: 'single_enemy',
      value: 1,
      priority: 20,
      perEncounterLimit: 1,
    }];
    const snapshot = createWarEncounterSnapshot({
      sessionId: 'session_war_player_art_effect_repair',
      intent: makeWarIntent(),
      playerTroops: [makeWarTroop('troop_player_infantry')],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander: makeWarCommander('player_liuping', {
        uniqueArts: [{
          id: 'art_player_formation',
          name: '军阵整肃',
          rarity: 'orange',
          domain: 'warfare',
          level: 4,
          description: '稳定军阵。',
          effectSummary: '提高军势协同。',
          source: 'opening',
        }],
      }),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      projections: createValidatedWarProjectionBundle([
        makeTroopProfile('troop_player_infantry'),
        makeTroopProfile('troop_enemy_cavalry'),
        mislabeledWarProfile,
      ]),
    });

    const profile = snapshot.commanders.player?.uniqueArtProfiles[0];
    expect(profile?.rulesetScopes).toEqual(['war']);
    expect(profile?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: 'before_attack' }),
      expect.objectContaining({
        trigger: 'before_war_resolution',
        operation: 'modify_effective_strength',
        target: 'own_force',
      }),
    ]));
  });

  it('freezes only explicitly participating officers and their executable war arts in V2.1', () => {
    const zhao = makeWarCommander('npc_zhao_yun', {
      name: '赵云',
      uniqueArts: [{
        id: 'art_zhao_break_formation',
        name: '七进七出',
        rarity: 'orange',
        domain: 'warfare',
        level: 4,
        description: '冲阵破敌。',
        effectSummary: '提高有效战力。',
        source: 'history',
      }],
    });
    const intent = makeWarIntent();
    intent.rulesetVersion = COMMAND_WAR_RULESET_VERSION;
    const snapshot = createWarEncounterSnapshot({
      sessionId: 'session_war_officers',
      intent,
      playerTroops: [makeWarTroop('troop_player_infantry')],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander: makeWarCommander('player_liuping'),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      playerOfficers: [{ source: zhao, role: 'deputy', troopIds: ['troop_player_infantry'] }],
      projections: createValidatedWarProjectionBundle([
        makeWarArtProfile('art_zhao_break_formation'),
      ]),
    });

    expect(snapshot.snapshotVersion).toBe(2);
    expect(snapshot.officers?.player).toEqual([
      expect.objectContaining({
        actorId: 'npc_zhao_yun',
        name: '赵云',
        role: 'deputy',
        troopIds: ['troop_player_infantry'],
        uniqueArtLabels: { art_zhao_break_formation: '七进七出' },
      }),
    ]);
    expect(snapshot.officers?.enemy).toEqual([]);
  });

  it('omits absent optional commanders from the JSON-safe snapshot', () => {
    const intent = makeWarIntent();
    delete intent.playerForce.commanderActorId;
    delete intent.enemyForce.commanderActorId;

    const snapshot = createWarEncounterSnapshot({
      sessionId: 'session_war_no_commanders',
      intent,
      playerTroops: [makeWarTroop('troop_player_infantry')],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      projections: createValidatedWarProjectionBundle([]),
    });

    expect(snapshot.commanders).toEqual({});
    expect(Object.keys(snapshot.commanders)).toEqual([]);
    expect(snapshot.snapshotHash).toMatch(/^fnv1a64:/);
  });

  it('keeps only the declared side when a war has one commander', () => {
    const intent = makeWarIntent();
    delete intent.enemyForce.commanderActorId;

    const snapshot = createWarEncounterSnapshot({
      sessionId: 'session_war_player_commander_only',
      intent,
      playerTroops: [makeWarTroop('troop_player_infantry')],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander: makeWarCommander('player_liuping'),
      projections: createValidatedWarProjectionBundle([]),
    });

    expect(snapshot.commanders.player?.actorId).toBe('player_liuping');
    expect(snapshot.commanders.enemy).toBeUndefined();
    expect(Object.keys(snapshot.commanders)).toEqual(['player']);
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

  it('keeps snapshot hashes stable across player-level reward metadata', () => {
    const base = {
      sessionId: 'session_war_level_compat',
      intent: makeWarIntent(),
      playerTroops: [makeWarTroop('troop_player_infantry')],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander: makeWarCommander('player_liuping'),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      projections: createValidatedWarProjectionBundle([]),
    };
    const legacyEquivalent = createWarEncounterSnapshot(base);
    const leveled = createWarEncounterSnapshot({ ...base, playerLevel: 5 });

    expect(leveled.playerLevel).toBe(5);
    expect(leveled.snapshotHash).toBe(legacyEquivalent.snapshotHash);
  });

  it('reconstructs legacy V2.0 pending snapshots without adding V2.1 officer fields', () => {
    const intent = makeWarIntent();
    intent.rulesetVersion = LEGACY_WAR_RULESET_VERSION;
    const snapshot = createWarEncounterSnapshot({
      sessionId: 'session_war_legacy_pending',
      intent,
      playerTroops: [makeWarTroop('troop_player_infantry')],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander: makeWarCommander('player_liuping'),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      playerOfficers: [{
        source: makeWarCommander('npc_zhao_yun'),
        role: 'deputy',
        troopIds: ['troop_player_infantry'],
      }],
      projections: createValidatedWarProjectionBundle([]),
    });

    expect(snapshot.snapshotVersion).toBe(1);
    expect(snapshot.officers).toBeUndefined();
    expect(snapshot.commanders.player?.leadershipKnown).toBeUndefined();
    expect(snapshot.commanders.player?.uniqueArtLabels).toBeUndefined();
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

  it('freezes local commitments separately from source formations and applies capped theater pressure', () => {
    const intent = makeWarIntent(
      ['troop_player_detachment'],
      ['troop_enemy_local'],
      { player: [100], enemy: [200], commandScope: 'subordinate_sector' },
    );
    intent.participation = {
      ...intent.participation!,
      alliedMainForceIds: ['troop_imperial_main_force'],
      enemyMainForceIds: ['troop_rebel_main_force'],
      superiorCommanderActorId: 'npc_huangfu_song',
    };

    const snapshot = createWarEncounterSnapshot({
      sessionId: 'session_war_subordinate_sector',
      intent,
      playerTroops: [makeWarTroop('troop_player_detachment', { size: 500 })],
      enemyTroops: [makeWarTroop('troop_enemy_local', { size: 600 })],
      theaterTroops: {
        allied: [makeWarTroop('troop_imperial_main_force', {
          detailLevel: 'intelligence',
          lifecycleStatus: 'unknown',
          strengthEstimate: { min: 20_000, max: 30_000 },
        })],
        enemy: [makeWarTroop('troop_rebel_main_force', {
          detailLevel: 'intelligence',
          lifecycleStatus: 'unknown',
          strengthEstimate: { min: 45_000, max: 55_000 },
        })],
      },
      playerCommander: makeWarCommander('player_liuping'),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      projections: createValidatedWarProjectionBundle([]),
    });

    expect(snapshot.snapshotVersion).toBe(3);
    expect(snapshot.forces.find((force) => force.troopId === 'troop_player_detachment')).toMatchObject({
      initialStrength: 100,
      sourceStrength: 500,
      commitmentKind: 'detachment',
    });
    expect(snapshot.theaterContext).toMatchObject({
      commandScope: 'subordinate_sector',
      alliedEstimatedStrength: 25_000,
      enemyEstimatedStrength: 50_000,
      superiorCommanderActorId: 'npc_huangfu_song',
    });
    expect(snapshot.theaterContext!.playerSupportFactor).toBeGreaterThanOrEqual(0.88);
    expect(snapshot.theaterContext!.playerSupportFactor).toBeLessThanOrEqual(1.12);
  });

  it('rejects intelligence-only formations from direct War Engine participation', () => {
    expect(() => createWarEncounterSnapshot({
      sessionId: 'session_war_intelligence_direct_rejected',
      intent: makeWarIntent(),
      playerTroops: [makeWarTroop('troop_player_infantry', {
        detailLevel: 'intelligence',
        lifecycleStatus: 'unknown',
      })],
      enemyTroops: [makeWarTroop('troop_enemy_cavalry')],
      playerCommander: makeWarCommander('player_liuping'),
      enemyCommander: makeWarCommander('npc_enemy_commander'),
      projections: createValidatedWarProjectionBundle([]),
    })).toThrow(/军情档案/);
  });
});

import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import {
  advancePregnancyLifecycle,
  recordPlayerPregnancyRisk,
  resolvePregnancy,
} from './PregnancyLifecycle';
import { tryCreateGameClockFromDateLabel } from '../time/gameClock';

function makeState(age = 24): RuntimeState {
  return {
    engineVersion: 'test',
    worldBookId: 's184_original_yingchuan',
    worldBookVersion: '1',
    worldBookSource: 'official',
    startDate: '公元189年09月01日 08:00（辰时）',
    currentDate: '公元189年09月01日 08:00（辰时）',
    currentTime: { year: 189, month: 9, day: 1, hour: 8, minute: 0 },
    currentLocationId: 'loc_yingchuan',
    player: {
      id: 'player',
      name: '刘平',
      roleType: '游侠',
      summary: '游历颍川。',
      locationId: 'loc_yingchuan',
      attributes: {},
    },
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    npcs: [{
      npcId: 'npc_lady_he',
      name: '何氏',
      sex: '女',
      age,
      ageKnownAtDate: '公元189年09月01日 08:00（辰时）',
      role: '乡绅之女',
      locationId: 'loc_yingchuan',
      isPresent: true,
      isFocused: true,
      summary: '与主角保持长期关系。',
      appearance: '衣着素雅。',
      personality: '谨慎。',
      motivation: '保全家人。',
      relationToPlayer: '亲密',
      contactLevel: 80,
      recentAttitude: '信任',
      memories: [],
      femaleProfile: {
        adultPrivateProfile: {
          enabled: true,
          ageConfirmedAdult: true,
          wombProfile: { status: '未受孕' },
        },
      },
    }],
    bondThreads: [],
    turnEvents: [],
  } as RuntimeState;
}

describe('PregnancyLifecycle', () => {
  it('merges same-day exposures into one deterministic check and increases its chance', () => {
    const first = recordPlayerPregnancyRisk(makeState(), {
      npcId: 'npc_lady_he',
      riskType: 'unprotected',
      summary: '本回合明确发生未避孕的体内射精。',
    }, 'standard');
    const repeated = recordPlayerPregnancyRisk(first, {
      npcId: 'npc_lady_he',
      riskType: 'tryingToConceive',
      summary: '双方明确继续备孕。',
    }, 'standard');
    const firstPregnancy = first.npcs?.[0]?.femaleProfile?.adultPrivateProfile?.wombProfile?.pregnancy;
    const repeatedPregnancy = repeated.npcs?.[0]?.femaleProfile?.adultPrivateProfile?.wombProfile?.pregnancy;

    expect(firstPregnancy).toMatchObject({
      status: 'pendingCheck',
      exposureCount: 1,
      fatherCharacterIds: ['player'],
      paternityStatus: 'known',
    });
    expect(repeatedPregnancy?.pregnancyId).toBe(firstPregnancy?.pregnancyId);
    expect(repeatedPregnancy?.rollBasisPoints).toBe(firstPregnancy?.rollBasisPoints);
    expect(repeatedPregnancy?.exposureCount).toBe(2);
    expect(repeatedPregnancy?.chanceBasisPoints).toBeGreaterThan(firstPregnancy?.chanceBasisPoints ?? 0);
    expect(repeated.npcs?.[0]?.femaleProfile?.adultPrivateProfile?.wombProfile?.pendingPregnancyChecks)
      .toBeUndefined();
  });

  it('creates one independent delayed check for each different exposure day', () => {
    const first = recordPlayerPregnancyRisk(makeState(), {
      npcId: 'npc_lady_he',
      riskType: 'unprotected',
      summary: '第一日发生有效行为。',
    }, 'standard');
    const secondDayState = {
      ...first,
      currentDate: '公元189年09月02日 08:00（辰时）',
      currentTime: { year: 189, month: 9, day: 2, hour: 8, minute: 0 },
    } as RuntimeState;
    const second = recordPlayerPregnancyRisk(secondDayState, {
      npcId: 'npc_lady_he',
      riskType: 'unprotected',
      summary: '第二日再次发生有效行为。',
    }, 'standard');
    const wombProfile = second.npcs?.[0]?.femaleProfile?.adultPrivateProfile?.wombProfile;
    const firstCheck = wombProfile?.pregnancy;
    const secondCheck = wombProfile?.pendingPregnancyChecks?.[0];

    expect(firstCheck).toMatchObject({
      status: 'pendingCheck',
      firstExposureAt: '公元189年09月01日 08:00（辰时）',
      exposureCount: 1,
    });
    expect(secondCheck).toMatchObject({
      status: 'pendingCheck',
      firstExposureAt: '公元189年09月02日 08:00（辰时）',
      exposureCount: 1,
    });
    expect(secondCheck?.pregnancyId).not.toBe(firstCheck?.pregnancyId);
    expect(dayIndex(secondCheck!.checkAt) - dayIndex(firstCheck!.checkAt)).toBe(1);
    expect(wombProfile?.inseminationRecords?.map((record) => record.pregnancyCheckDate))
      .toEqual([firstCheck?.checkAt, secondCheck?.checkAt]);
  });

  it('promotes the next exposure-day check after the earlier batch fails', () => {
    const queued = createTwoDayRiskQueue();
    const wombBefore = queued.npcs![0]!.femaleProfile!.adultPrivateProfile!.wombProfile!;
    const firstCheckId = wombBefore.pregnancy!.pregnancyId;
    const secondCheckId = wombBefore.pendingPregnancyChecks![0]!.pregnancyId;
    wombBefore.pregnancy!.rollBasisPoints = 9_999;

    const atFirstCheck = {
      ...queued,
      currentDate: wombBefore.pregnancy!.checkAt,
      currentTime: undefined,
    } as RuntimeState;
    const next = advancePregnancyLifecycle(atFirstCheck);
    const wombAfter = next.npcs?.[0]?.femaleProfile?.adultPrivateProfile?.wombProfile;

    expect(wombAfter?.lastPregnancyCheck).toMatchObject({
      result: 'notPregnant',
    });
    expect(wombAfter?.lastPregnancyCheck?.cycleKey).toContain('cycle_');
    expect(wombAfter?.pregnancy).toMatchObject({
      pregnancyId: secondCheckId,
      status: 'pendingCheck',
    });
    expect(wombAfter?.pregnancy?.pregnancyId).not.toBe(firstCheckId);
    expect(wombAfter?.pendingPregnancyChecks).toBeUndefined();
    expect(wombAfter?.status).toBe('待怀孕判定');
  });

  it('invalidates all later exposure-day checks when an earlier batch succeeds', () => {
    const queued = createTwoDayRiskQueue();
    const wombBefore = queued.npcs![0]!.femaleProfile!.adultPrivateProfile!.wombProfile!;
    const firstCheckId = wombBefore.pregnancy!.pregnancyId;
    wombBefore.pregnancy!.rollBasisPoints = 0;

    const atFirstCheck = {
      ...queued,
      currentDate: wombBefore.pregnancy!.checkAt,
      currentTime: undefined,
    } as RuntimeState;
    const next = advancePregnancyLifecycle(atFirstCheck);
    const wombAfter = next.npcs?.[0]?.femaleProfile?.adultPrivateProfile?.wombProfile;

    expect(wombAfter?.pregnancy).toMatchObject({
      pregnancyId: firstCheckId,
      status: 'suspected',
      conceptionAt: '公元189年09月01日 08:00（辰时）',
    });
    expect(wombAfter?.lastPregnancyCheck?.result).toBe('pregnant');
    expect(wombAfter?.pendingPregnancyChecks).toBeUndefined();
  });

  it('does not create pregnancy state for a minor or when the setting is off', () => {
    const minor = recordPlayerPregnancyRisk(makeState(17), {
      npcId: 'npc_lady_he',
      riskType: 'unprotected',
      summary: '非法测试输入。',
    }, 'standard');
    const disabled = recordPlayerPregnancyRisk(makeState(), {
      npcId: 'npc_lady_he',
      riskType: 'unprotected',
      summary: '关闭设置时不应创建。',
    }, 'off');

    expect(minor.npcs?.[0]?.femaleProfile?.adultPrivateProfile?.wombProfile?.pregnancy).toBeUndefined();
    expect(disabled.npcs?.[0]?.femaleProfile?.adultPrivateProfile?.wombProfile?.pregnancy).toBeUndefined();
  });

  it('resolves the saved roll once after the check date and never rerolls on reload', () => {
    const pending = recordPlayerPregnancyRisk(makeState(), {
      npcId: 'npc_lady_he',
      riskType: 'tryingToConceive',
      summary: '明确备孕。',
    }, 'high');
    const pregnancy = pending.npcs?.[0]?.femaleProfile?.adultPrivateProfile?.wombProfile?.pregnancy;
    expect(pregnancy).toBeDefined();

    const afterCheck = {
      ...pending,
      currentDate: pregnancy!.checkAt,
      currentTime: undefined,
    } as RuntimeState;
    const resolvedOnce = advancePregnancyLifecycle(afterCheck);
    const resolvedTwice = advancePregnancyLifecycle(JSON.parse(JSON.stringify(resolvedOnce)) as RuntimeState);

    expect(resolvedTwice).toEqual(resolvedOnce);
    expect(resolvedOnce.npcs?.[0]?.femaleProfile?.adultPrivateProfile?.wombProfile?.lastPregnancyCheck?.rollBasisPoints)
      .toBe(pregnancy?.rollBasisPoints);
  });

  it('creates a normal child NPC and kinship bond when a confirmed pregnancy is delivered', () => {
    const state = makeState();
    const mother = state.npcs![0]!;
    mother.femaleProfile!.adultPrivateProfile!.wombProfile!.pregnancy = {
      pregnancyId: 'preg_test_birth',
      status: 'deliveryDue',
      cycleKey: 'cycle_test',
      firstExposureAt: '公元189年01月01日 08:00（辰时）',
      checkAt: '公元189年01月24日 08:00（辰时）',
      exposureCount: 1,
      chanceBasisPoints: 1800,
      rollBasisPoints: 100,
      fatherCharacterIds: ['player'],
      paternityStatus: 'known',
      disclosure: 'public',
      conceptionAt: '公元189年01月01日 08:00（辰时）',
      confirmedAt: '公元189年02月16日 08:00（辰时）',
      estimatedDueAt: '公元189年10月01日 08:00（辰时）',
      deliveryWindowStartAt: '公元189年09月21日 08:00（辰时）',
      deliveryWindowEndAt: '公元189年10月11日 08:00（辰时）',
    };

    const next = resolvePregnancy(state, {
      npcId: 'npc_lady_he',
      outcome: 'liveBirth',
      childName: '刘安',
      childSex: '男',
      summary: '何氏平安产下一子。',
    });
    const child = next.npcs?.find((npc) => npc.npcId === 'npc_child_preg_test_birth');

    expect(child).toMatchObject({
      name: '刘安',
      sex: '男',
      age: 0,
      birthDate: '公元189年09月01日',
      parentLinks: { motherNpcId: 'npc_lady_he', fatherCharacterId: 'player' },
    });
    expect(next.bondThreads).toContainEqual(expect.objectContaining({
      bondThreadId: 'bond_kinship_npc_child_preg_test_birth',
      targetNpcIds: ['npc_child_preg_test_birth'],
      bondType: 'kinship',
    }));
    expect(mother.femaleProfile?.adultPrivateProfile?.wombProfile?.pregnancy?.status).toBe('deliveryDue');
    expect(next.npcs?.[0]?.femaleProfile?.adultPrivateProfile?.wombProfile?.pregnancy).toMatchObject({
      status: 'postpartum',
      childNpcId: 'npc_child_preg_test_birth',
    });
  });

  it('safely resolves an overdue delivery as a live birth instead of inventing an adverse outcome', () => {
    const state = makeState();
    state.currentDate = '公元189年10月11日 08:00（辰时）';
    state.currentTime = { year: 189, month: 10, day: 11, hour: 8, minute: 0 };
    state.npcs![0]!.femaleProfile!.adultPrivateProfile!.wombProfile!.pregnancy = {
      pregnancyId: 'preg_overdue_test',
      status: 'deliveryDue',
      cycleKey: 'cycle_overdue',
      firstExposureAt: '公元189年01月01日 08:00（辰时）',
      checkAt: '公元189年01月24日 08:00（辰时）',
      exposureCount: 1,
      chanceBasisPoints: 1800,
      rollBasisPoints: 100,
      fatherCharacterIds: ['player'],
      paternityStatus: 'known',
      disclosure: 'public',
      conceptionAt: '公元189年01月01日 08:00（辰时）',
      confirmedAt: '公元189年02月16日 08:00（辰时）',
      estimatedDueAt: '公元189年10月01日 08:00（辰时）',
      deliveryWindowStartAt: '公元189年09月21日 08:00（辰时）',
      deliveryWindowEndAt: '公元189年10月11日 08:00（辰时）',
    };

    const next = advancePregnancyLifecycle(state);
    const pregnancy = next.npcs?.[0]?.femaleProfile?.adultPrivateProfile?.wombProfile?.pregnancy;

    expect(pregnancy).toMatchObject({
      status: 'postpartum',
      outcome: 'liveBirth',
      childNpcId: 'npc_child_preg_overdue_test',
    });
    expect(next.npcs?.some((npc) => npc.npcId === 'npc_child_preg_overdue_test')).toBe(true);
  });
});

function createTwoDayRiskQueue(): RuntimeState {
  const first = recordPlayerPregnancyRisk(makeState(), {
    npcId: 'npc_lady_he',
    riskType: 'unprotected',
    summary: '第一日发生有效行为。',
  }, 'standard');
  return recordPlayerPregnancyRisk({
    ...first,
    currentDate: '公元189年09月02日 08:00（辰时）',
    currentTime: { year: 189, month: 9, day: 2, hour: 8, minute: 0 },
  } as RuntimeState, {
    npcId: 'npc_lady_he',
    riskType: 'unprotected',
    summary: '第二日再次发生有效行为。',
  }, 'standard');
}

function dayIndex(label: string): number {
  const clock = tryCreateGameClockFromDateLabel(label);
  if (!clock) throw new Error(`Invalid test clock: ${label}`);
  return ((clock.year - 1) * 12 + (clock.month - 1)) * 30 + (clock.day - 1);
}

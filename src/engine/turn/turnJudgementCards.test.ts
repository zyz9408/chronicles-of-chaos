import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { buildBattleJudgementCards, buildOrdinaryJudgementCards } from './turnJudgementCards';

function baseState(): RuntimeState {
  return {
    currentDate: '189-09-01',
    currentLocationId: 'loc_luoyang',
    player: {
      id: 'player',
      name: '萧行',
      role: '军候',
      stats: {},
      inventory: [],
      relationships: [],
    },
    knownActors: [],
    knownFactions: [],
    knownRumors: [],
    activeQuests: [],
    turnLog: [],
    worldStateDelta: {},
  } as unknown as RuntimeState;
}

describe('turnJudgementCards', () => {
  it('turns ordinary checks into inline judgement cards', () => {
    const cards = buildOrdinaryJudgementCards([
      {
        checkId: 'check_gate_probe',
        label: '察言观色',
        target: '门吏',
        ability: '智力',
        difficulty: 16,
        total: 23,
        result: '成功',
        summary: '你从门吏话里的停顿判断出他有所隐瞒。',
        details: [{ label: '基础', value: 14, text: '智力' }],
        tags: ['日常'],
      },
    ], { check_gate_probe: 12 });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      cardId: 'ordinary:check_gate_probe',
      kind: 'ordinary',
      eyebrow: '判定',
      title: '察言观色',
      target: '门吏',
      difficulty: 16,
      total: 23,
      result: '成功',
      experienceAward: 12,
    });
  });

  it('creates inline battle judgement cards only for newly added battle and combat records', () => {
    const previous = baseState();
    const next = {
      ...baseState(),
      conflicts: [
        {
          conflictId: 'conflict_camp_review',
          type: '军事冲突',
          title: '审视屯骑营全军军容',
          summary: '屯骑营军容整肃，军心可用。',
          occurredAt: '189-09-01 午时',
          outcome: '大成功',
          scope: 'selfRelated',
          recordLevel: 'full',
          locationName: '洛阳城',
          judgement: {
            method: 'warJudgementV1',
            scoreBreakdown: {
              troopBase: 8,
              commander: 21,
              tactical: 4,
              total: 33,
              notes: ['眼力与兵法', '军将境圆满'],
            },
          },
          decisiveFactors: ['军容齐整'],
        },
      ],
      combatRecords: [
        {
          combatId: 'combat_yard_probe',
          kind: 'duel',
          title: '校场试刀',
          summary: '主角以刀背逼退挑战者。',
          occurredAt: '189-09-01 午时',
          participants: [],
          playerInvolved: true,
          resultLevel: 'win',
          outcome: '小胜',
          significance: 'notable',
          judgement: {
            method: 'combatJudgementV1',
            scoreBreakdown: {
              personalBase: 18,
              equipment: 3,
              total: 21,
              notes: ['武力', '环首刀'],
            },
          },
        },
      ],
    } as unknown as RuntimeState;

    const cards = buildBattleJudgementCards(previous, next);

    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      cardId: 'battle:conflict_camp_review',
      kind: 'battle',
      eyebrow: '战事判定',
      title: '审视屯骑营全军军容',
      result: '大成功',
      total: 33,
      panel: {
        type: 'battles',
        selectedId: 'conflict_camp_review',
      },
    });
    expect(cards[1]).toMatchObject({
      cardId: 'combat:combat_yard_probe',
      kind: 'combat',
      eyebrow: '战斗判定',
      title: '校场试刀',
      result: '小胜',
      total: 21,
      panel: {
        type: 'combats',
        selectedId: 'combat_yard_probe',
      },
    });
  });
});

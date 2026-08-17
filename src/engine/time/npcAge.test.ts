import { describe, expect, it } from 'vitest';
import type { Actor, LuanShiNpc } from '../types';
import {
  deriveActorCurrentAge,
  deriveNpcCurrentAge,
  ensureCompleteBirthDate,
  isAdultFemaleNpcAt,
  normalizeCompleteBirthDate,
} from './npcAge';

const baseNpc: LuanShiNpc = {
  npcId: 'npc_test',
  name: '测试人物',
  sex: '女',
  age: 17,
  role: '测试角色',
  isPresent: true,
  isFocused: true,
  summary: '测试摘要。',
  appearance: '测试外貌。',
  personality: '测试性格。',
  motivation: '测试动机。',
  relationToPlayer: '测试关系。',
  contactLevel: 1,
  recentAttitude: '测试态度',
  memories: [],
};

describe('npc age derivation', () => {
  it('derives current age from ageKnownAtDate and current game date', () => {
    const npc = {
      ...baseNpc,
      age: 17,
      ageKnownAtDate: '公元189年09月01日 08:00（辰时）',
    };

    expect(deriveNpcCurrentAge(npc, '公元190年09月01日 08:00（辰时）')).toBe(18);
    expect(isAdultFemaleNpcAt(npc, '公元190年09月01日 08:00（辰时）')).toBe(true);
  });

  it('uses parseable birthDate before static age', () => {
    const npc = {
      ...baseNpc,
      age: 33,
      birthDate: '公元181年09月02日',
    };

    expect(deriveNpcCurrentAge(npc, '公元199年09月01日 08:00（辰时）')).toBe(17);
    expect(deriveNpcCurrentAge(npc, '公元199年09月02日 08:00（辰时）')).toBe(18);
  });

  it('does not use female profile birthday as an age anchor', () => {
    const npc = {
      ...baseNpc,
      age: 22,
      femaleProfile: {
        birthday: '公元156年',
      },
    };

    expect(deriveNpcCurrentAge(npc, '公元189年09月01日 08:00（辰时）')).toBe(22);
  });

  it('falls back to the required current age field when no age anchor exists', () => {
    const npc = {
      ...baseNpc,
      age: 33,
    };

    expect(deriveNpcCurrentAge(npc, '公元199年09月01日 08:00（辰时）')).toBe(33);
    expect(isAdultFemaleNpcAt(npc, '公元199年09月01日 08:00（辰时）')).toBe(true);
  });

  it('normalizes only complete 12-month / 30-day birthdays', () => {
    expect(normalizeCompleteBirthDate('公元156年4月12日 08:00（辰时）')).toBe('公元156年04月12日');
    expect(normalizeCompleteBirthDate('156-04-12')).toBe('公元156年04月12日');
    expect(normalizeCompleteBirthDate('公元156年')).toBeUndefined();
    expect(normalizeCompleteBirthDate('公元156年13月01日')).toBeUndefined();
    expect(normalizeCompleteBirthDate('公元156年04月31日')).toBeUndefined();
  });

  it('derives the opening birthday year from age and whether the birthday has passed', () => {
    expect(ensureCompleteBirthDate({
      age: 18,
      currentDate: '公元184年03月01日 08:00（辰时）',
      stableId: 'player_1',
      preferredMonth: 2,
      preferredDay: 18,
    })).toBe('公元166年02月18日');
    expect(ensureCompleteBirthDate({
      age: 18,
      currentDate: '公元184年03月01日 08:00（辰时）',
      stableId: 'player_1',
      preferredMonth: 4,
      preferredDay: 18,
    })).toBe('公元165年04月18日');
  });

  it('creates an idempotent deterministic birthday for a legacy NPC', () => {
    const input = {
      age: 33,
      ageKnownAtDate: '公元194年04月15日 09:00（巳时）',
      currentDate: '公元195年01月01日 08:00（辰时）',
      stableId: 'npc_zhao_yun',
    } as const;
    const first = ensureCompleteBirthDate(input);
    const second = ensureCompleteBirthDate(input);
    expect(first).toBe(second);
    expect(first).toMatch(/^公元\d+年\d{2}月\d{2}日$/);
    expect(deriveNpcCurrentAge({ ...baseNpc, age: 33, birthDate: first }, input.ageKnownAtDate)).toBe(33);
  });

  it('derives player age from the same canonical birthday contract', () => {
    const actor: Actor = {
      id: 'player_1',
      name: '刘兴',
      roleType: '军吏',
      summary: '测试主角',
      age: 99,
      birthDate: '公元166年03月02日',
    };
    expect(deriveActorCurrentAge(actor, '公元184年03月01日 08:00（辰时）')).toBe(17);
    expect(deriveActorCurrentAge(actor, '公元184年03月02日 08:00（辰时）')).toBe(18);
  });
});

import { describe, expect, it } from 'vitest';
import type { LuanShiNpc } from '../types';
import { deriveNpcCurrentAge, isAdultFemaleNpcAt } from './npcAge';

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
});

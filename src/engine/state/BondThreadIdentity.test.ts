import { describe, expect, it } from 'vitest';
import type { BondThreadEntry, LuanShiNpc } from '../types';
import { normalizeBondThreads, resolveBondTargetNpcIdsByExactName } from './BondThreadIdentity';

const npc = (npcId: string, name: string) => ({ npcId, name } as LuanShiNpc);
const bond = (targetNames: string[]): BondThreadEntry => ({
  bondThreadId: 'bond_test',
  targetNames,
  bondType: 'ally',
  status: 'active',
  summary: '长期盟友',
  lastUpdatedAt: '公元184年03月01日 08:00（辰时）',
});

describe('BondThreadIdentity', () => {
  it('为唯一精确姓名匹配的旧羁绊补入稳定 NPC ID', () => {
    expect(normalizeBondThreads([bond(['曹操'])], [npc('npc_caocao', '曹操')])[0].targetNpcIds)
      .toEqual(['npc_caocao']);
  });

  it('同名人物不唯一时保持姓名模式，不做模糊绑定', () => {
    const npcs = [npc('npc_a', '张三'), npc('npc_b', '张三')];
    expect(resolveBondTargetNpcIdsByExactName(['张三'], npcs)).toEqual([]);
    expect(normalizeBondThreads([bond(['张三'])], npcs)[0].targetNpcIds).toBeUndefined();
  });
});

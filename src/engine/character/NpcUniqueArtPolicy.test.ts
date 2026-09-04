import { describe, expect, it } from 'vitest';
import type { CharacterUniqueArt } from '../types';
import {
  buildNpcUniqueArtRequirement,
  completeNpcUniqueArtsLocally,
  evaluateNpcUniqueArtCompliance,
  mergeStableNpcUniqueArts,
  minimumUniqueArtRarityForScore,
} from './NpcUniqueArtPolicy';

function makeArt(overrides: Partial<CharacterUniqueArt> = {}): CharacterUniqueArt {
  return {
    id: 'art_cloud_spear',
    name: '云龙枪势',
    rarity: 'orange',
    domain: 'personalCombat',
    level: 3,
    description: '以迅疾枪势压制近身之敌。',
    effectSummary: '个人战中强化枪术、突进与破阵。',
    source: 'history',
    ...overrides,
  };
}

describe('NpcUniqueArtPolicy', () => {
  it('maps NPC ability bands to six unique-art rarities', () => {
    expect(minimumUniqueArtRarityForScore(50)).toBeUndefined();
    expect(minimumUniqueArtRarityForScore(51)).toBe('white');
    expect(minimumUniqueArtRarityForScore(60)).toBe('green');
    expect(minimumUniqueArtRarityForScore(70)).toBe('blue');
    expect(minimumUniqueArtRarityForScore(80)).toBe('purple');
    expect(minimumUniqueArtRarityForScore(90)).toBe('orange');
    expect(minimumUniqueArtRarityForScore(95)).toBe('red');
  });

  it('requires a peerless personal-combat art for a 95 martial NPC', () => {
    const requirement = buildNpcUniqueArtRequirement({
      武力: 96,
      统率: 85,
      智力: 70,
      政治: 58,
      魅力: 82,
      机运: 64,
    });
    expect(requirement?.minimumRarity).toBe('red');
    expect(requirement?.domainRequirements).toEqual([
      { abilityName: '武力', score: 96, domain: 'personalCombat', minimumRarity: 'red' },
      { abilityName: '统率', score: 85, domain: 'warfare', minimumRarity: 'purple' },
      { abilityName: '魅力', score: 82, domain: 'social', minimumRarity: 'purple' },
    ]);
  });

  it('requires stable war arts from leadership or intelligence beginning at 70', () => {
    expect(buildNpcUniqueArtRequirement({
      武力: 96, 统率: 72, 智力: 75, 政治: 40, 魅力: 40, 机运: 40,
    })?.domainRequirements).toEqual([
      { abilityName: '武力', score: 96, domain: 'personalCombat', minimumRarity: 'red' },
      { abilityName: '智力', score: 75, domain: 'strategy', minimumRarity: 'blue' },
    ]);
    expect(buildNpcUniqueArtRequirement({
      武力: 60, 统率: 92, 智力: 83, 政治: 40, 魅力: 40, 机运: 40,
    })?.domainRequirements).toEqual([
      { abilityName: '统率', score: 92, domain: 'warfare', minimumRarity: 'orange' },
      { abilityName: '智力', score: 83, domain: 'strategy', minimumRarity: 'purple' },
    ]);
  });

  it('reports missing quality and domain coverage without rejecting an ordinary NPC', () => {
    expect(evaluateNpcUniqueArtCompliance({
      abilityScores: { 武力: 50, 统率: 48, 智力: 45, 政治: 42, 魅力: 46, 机运: 49 },
      uniqueArts: [],
    }).compliant).toBe(true);

    const result = evaluateNpcUniqueArtCompliance({
      abilityScores: { 武力: 96, 统率: 70, 智力: 65, 政治: 50, 魅力: 58, 机运: 60 },
      uniqueArts: [makeArt({ rarity: 'orange' })],
    });
    expect(result.compliant).toBe(false);
    expect(result.reasons.join('；')).toContain('绝世');
    expect(result.reasons.join('；')).toContain('personalCombat');
  });

  it('preserves stable art identity and prevents later list omission or downgrade', () => {
    const existing = makeArt({ rarity: 'red', level: 4 });
    expect(mergeStableNpcUniqueArts([existing], [])).toEqual([existing]);

    const merged = mergeStableNpcUniqueArts([existing], [
      makeArt({
        id: 'drifted_art_id',
        rarity: 'green',
        level: 2,
        description: '模型后续改写的说明。',
      }),
      makeArt({
        id: 'art_war_command',
        name: '锐骑节制',
        rarity: 'purple',
        domain: 'warfare',
        level: 2,
      }),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      id: 'art_cloud_spear',
      name: '云龙枪势',
      rarity: 'red',
      domain: 'personalCombat',
      level: 4,
      description: '模型后续改写的说明。',
    });
    expect(merged[1]).toMatchObject({
      id: 'art_war_command',
      rarity: 'purple',
      domain: 'warfare',
    });
  });

  it('keeps a frozen authored rule when later writeback changes its prose', () => {
    const existing = makeArt({
      id: 'art_full_heal',
      name: '万象回春',
      description: '每次使用必定恢复所有生命。',
      effectSummary: '恢复所有生命。',
    });
    const first = mergeStableNpcUniqueArts([existing], []);
    const merged = mergeStableNpcUniqueArts(first, [{
      ...existing,
      description: '后续模型将它改写为普通疗伤。',
      effectSummary: '少量恢复生命。',
    }]);

    expect(merged[0].mechanics?.rules[0].effects).toEqual([
      expect.objectContaining({ type: 'restore_to_max', resource: 'hp' }),
    ]);
  });

  it('self-heals duplicate arts already persisted under drifted IDs', () => {
    const merged = mergeStableNpcUniqueArts([
      makeArt({
        id: 'art_genius_strategy',
        name: '鬼才·筹谋机断',
        rarity: 'blue',
        domain: 'strategy',
        level: 2,
        progress: 80,
        description: '善于筹谋。',
      }),
      makeArt({
        id: 'art_genius_strategy_drifted',
        name: '鬼才 · 筹谋机断',
        rarity: 'orange',
        domain: 'strategy',
        level: 4,
        progress: 25,
        description: '善于在复杂局势中筹谋，并把握稍纵即逝的破局时机。',
      }),
    ], []);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'art_genius_strategy',
      name: '鬼才·筹谋机断',
      rarity: 'orange',
      level: 4,
      progress: 25,
      description: '善于在复杂局势中筹谋，并把握稍纵即逝的破局时机。',
    });
  });

  it('locally completes every required domain once without replacing an established art identity', () => {
    const existing = makeArt({ rarity: 'orange', level: 4 });
    const completed = completeNpcUniqueArtsLocally({
      npcId: 'npc_zhaoyun',
      name: '赵云',
      role: '骑将',
      currentIdentity: '白马骑将',
      summary: '以勇武和骑战闻名。',
      traits: [{ id: 'trait_brave', label: '忠勇', description: '临阵不退。', source: 'history' }],
      abilityScores: { 武力: 96, 统率: 85, 智力: 75, 政治: 62, 魅力: 88, 机运: 66 },
      uniqueArts: [existing],
    }, '公元194年02月01日');

    expect(evaluateNpcUniqueArtCompliance({
      abilityScores: { 武力: 96, 统率: 85, 智力: 75, 政治: 62, 魅力: 88, 机运: 66 },
      uniqueArts: completed,
    }).compliant).toBe(true);
    expect(completed).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: existing.id, name: existing.name, rarity: 'red', level: 4 }),
      expect.objectContaining({ domain: 'warfare', rarity: 'purple' }),
      expect.objectContaining({ domain: 'social', rarity: 'purple' }),
    ]));
    expect(completeNpcUniqueArtsLocally({
      npcId: 'npc_zhaoyun',
      name: '赵云',
      role: '骑将',
      currentIdentity: '白马骑将',
      summary: '以勇武和骑战闻名。',
      traits: [],
      abilityScores: { 武力: 96, 统率: 85, 智力: 75, 政治: 62, 魅力: 88, 机运: 66 },
      uniqueArts: completed,
    }, '公元194年02月02日')).toEqual(completed);
  });

  it('normalizes the former gold rarity to the six-tier peerless value', () => {
    const legacy = makeArt({ rarity: 'gold' as CharacterUniqueArt['rarity'] });
    expect(mergeStableNpcUniqueArts([legacy], [])).toEqual([
      expect.objectContaining({ id: legacy.id, rarity: 'red' }),
    ]);
  });
});

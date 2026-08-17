import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../../engine/types';
import { buildWorldlineKnowledgeProjection } from '../../engine/worldline/WorldlineKnowledgeProjection';
import { threeKingdomsKnowledgeBase } from './knowledgeBase';
import { THREE_KINGDOMS_KNOWLEDGE_BASE_CAI_YAN } from './knowledgeBaseCaiYan';

describe('THREE_KINGDOMS_KNOWLEDGE_BASE_CAI_YAN', () => {
  it('registers a complete four-card Cai Yan profile in the production knowledge base', () => {
    expect(threeKingdomsKnowledgeBase.version).toBe('0.5.1');
    expect(THREE_KINGDOMS_KNOWLEDGE_BASE_CAI_YAN).toHaveLength(4);

    const ids = THREE_KINGDOMS_KNOWLEDGE_BASE_CAI_YAN.map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);

    const productionIds = new Set(threeKingdomsKnowledgeBase.cards.map((card) => card.id));
    for (const card of THREE_KINGDOMS_KNOWLEDGE_BASE_CAI_YAN) {
      expect(productionIds.has(card.id), card.id).toBe(true);
      expect(card.worldBookId).toBe('threeKingdoms');
      expect(card.sourceLabel).toContain('后汉书');
      expect(card.summary.length).toBeLessThanOrEqual(240);
    }
  });

  it('anchors 174 as the adopted birth year without inventing a historical month or day', () => {
    const profile = THREE_KINGDOMS_KNOWLEDGE_BASE_CAI_YAN.find(
      (card) => card.id === 'tk3k_caiyan_early_174_194',
    );

    expect(profile?.kind).toBe('personTimeline');
    expect(profile?.summary).toContain('公元174年');
    expect(profile?.summary).toContain('史料不载月日');
    expect(profile?.summary).toContain('蔡邕');
    expect(profile?.summary).toContain('卫仲道');
    expect(profile?.relatedNpcNames).toEqual(
      expect.arrayContaining(['蔡琰', '蔡文姬', '蔡昭姬']),
    );
    expect(profile?.contradictionHint).toContain('月日');
    expect(profile?.contradictionHint).toContain('保持稳定');
  });

  it('covers captivity, return, remarriage and textual transmission as separate stages', () => {
    const captivity = THREE_KINGDOMS_KNOWLEDGE_BASE_CAI_YAN.find(
      (card) => card.id === 'tk3k_caiyan_xiongnu_194_207',
    );
    const returned = THREE_KINGDOMS_KNOWLEDGE_BASE_CAI_YAN.find(
      (card) => card.id === 'tk3k_caiyan_return_after_207',
    );

    expect(captivity?.summary).toMatch(/兴平|南匈奴/);
    expect(captivity?.summary).toContain('十二年');
    expect(captivity?.summary).toContain('二子');
    expect(returned?.summary).toContain('金璧');
    expect(returned?.summary).toContain('董祀');
    expect(returned?.summary).toContain('四百篇');
  });

  it('preserves the disputed authorship boundary for Hu Jia Shi Ba Pai', () => {
    const writings = THREE_KINGDOMS_KNOWLEDGE_BASE_CAI_YAN.find(
      (card) => card.id === 'tk3k_caiyan_writings_boundary',
    );

    expect(writings?.kind).toBe('customRule');
    expect(writings?.summary).toContain('悲愤诗');
    expect(writings?.summary).toContain('胡笳十八拍');
    expect(writings?.summary).toContain('作者归属仍有争议');
    expect(writings?.contradictionHint).toContain('史料不确定性');
  });

  it('projects the period-correct profile when Cai Yan is an active NPC', () => {
    const result = buildWorldlineKnowledgeProjection({
      state: {
        worldBookId: 'threeKingdoms',
        currentDate: '公元184年03月01日 08:00（辰时）',
        currentLocationId: 'loc_yanzhou_chenliu',
        npcs: [
          {
            npcId: 'npc_historical_caiyan',
            name: '蔡琰',
            isPresent: false,
            isFocused: true,
            memories: [],
          },
        ],
        activeQuests: [],
        knownRumors: [],
        worldTrends: [],
      } as unknown as RuntimeState,
      knowledgeBase: threeKingdomsKnowledgeBase,
      storyPacks: [],
      mode: 'default',
    });

    expect(result.hints.map((hint) => hint.id)).toContain('tk3k_caiyan_early_174_194');
    expect(result.text).toContain('公元174年');
    expect(result.text).toContain('史料不载月日');
  });
});

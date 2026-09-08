import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import type { NarratorResponse } from '../turn/MockNarrator';
import { bridgeFixedNpcResponse, fixedNpcVisualAliases, linkFixedNpcIdentities } from './FixedNpcIdentityBridge';

const state = { worldBookId: 'threeKingdoms', player: { id: 'player' }, knownActors: [], npcs: [],
  avgPresentation: { speakerActors: [{ actorId: 'avg-presentation:qiao', labels: ['大乔'], profileSnapshot: { sex: 'female' } }] },
} as unknown as RuntimeState;
const response = { narrativeText: '大乔说话。', suggestedActions: [], statePatch: null,
  writeback: { npcProfileSuggestions: [{ npcId: 'avg-presentation:qiao', name: '大乔', sex: '女', birthDate: '公元170年01月01日' }],
    heroineThreadUpdates: [{ npcId: 'avg-presentation:qiao' }],
    presentationSpeakerFacts: [{ speakerActorId: 'avg-presentation:qiao' }],
  },
} as unknown as NarratorResponse;

describe('fixed NPC world/visual identity bridge', () => {
  it('uses one deterministic world identity without changing narrative, dates or visual facts', () => {
    const mapped = bridgeFixedNpcResponse(state, response);
    const id = mapped.writeback!.npcProfileSuggestions![0].npcId;
    expect(id).toMatch(/^npc:fixed:threeKingdoms:/);
    expect(JSON.stringify(mapped.writeback)).toContain(`"heroineThreadUpdates":[{"npcId":"${id}"}]`);
    expect(mapped.narrativeText).toBe(response.narrativeText);
    expect(mapped.writeback!.npcProfileSuggestions![0].birthDate).toBe('公元170年01月01日');
    expect(mapped.writeback!.presentationSpeakerFacts).toEqual(response.writeback!.presentationSpeakerFacts);
    expect(bridgeFixedNpcResponse(state, response)).toEqual(mapped);
  });
  it('reuses the existing NPC and only links unique compatible visual identities', () => {
    const saved = { ...state, npcs: [{ npcId: 'qiao-existing', name: '大乔', sex: '女' }] } as RuntimeState;
    expect(bridgeFixedNpcResponse(saved, response).writeback!.npcProfileSuggestions![0].npcId).toBe('qiao-existing');
    expect(linkFixedNpcIdentities(saved).npcs![0].worldBookIdentity?.canonicalId).toContain('qiao');
    expect(fixedNpcVisualAliases(saved, 'qiao-existing')).toEqual(['avg-presentation:qiao']);
    expect(fixedNpcVisualAliases(state, 'qiao-existing')).toEqual([]);
    for (const npcs of [[...saved.npcs!, { ...saved.npcs![0], npcId: 'duplicate' }], [{ ...saved.npcs![0], sex: '男' }], [{ ...saved.npcs![0], worldBookIdentity: { worldBookId: 'other', canonicalId: 'other' } }]]) {
      const conflicted = { ...saved, npcs } as RuntimeState;
      expect(bridgeFixedNpcResponse(conflicted, response).writeback!.npcProfileSuggestions![0].npcId).toBe('avg-presentation:qiao');
      expect(fixedNpcVisualAliases(conflicted, 'qiao-existing')).toEqual([]);
    }
  });
});

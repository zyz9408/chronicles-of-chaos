import { describe, expect, it } from 'vitest';
import type { NarratorWritebackProtocol } from './MockNarrator';
import { mergeRepairWritebackProtocol } from './writebackDedupe';
import { makeCombatIntent, makeTraitProfile } from '../encounterV2/CombatTestFixtures';

function makeWriteback(
  value: Partial<NarratorWritebackProtocol>,
): NarratorWritebackProtocol {
  return {
    npcMemorySuggestions: [],
    locationWriteSuggestions: [],
    routeWriteSuggestions: [],
    questChanges: [],
    debugNotes: [],
    ...value,
  };
}

describe('mergeRepairWritebackProtocol', () => {
  it('treats explicit undefined as omitted and keeps the original item position', () => {
    const original = makeWriteback({
      questChanges: [{
        action: 'add',
        questId: ' quest_watch_gate ',
        title: 'Watch the gate',
        summary: 'Keep the original summary.',
        source: undefined,
        affectedNpcIds: ['npc_b', 'npc_a'],
      }],
    });
    const repaired = makeWriteback({
      questChanges: [{
        affectedNpcIds: ['npc_a', 'npc_b'],
        priority: 'high',
        summary: 'Do not overwrite the original summary.',
        title: 'watch the gate!',
        questId: 'quest_watch_gate',
        action: 'complete',
      }],
    });

    const merged = mergeRepairWritebackProtocol(original, repaired);

    expect(merged.questChanges).toEqual([{
      action: 'add',
      questId: ' quest_watch_gate ',
      title: 'Watch the gate',
      summary: 'Keep the original summary.',
      affectedNpcIds: ['npc_b', 'npc_a'],
      priority: 'high',
    }]);
  });

  it('uses canonical structural fallback for insufficient identities without merging different targets', () => {
    const original = makeWriteback({
      questChanges: [{
        action: 'add',
        summary: 'Search the unnamed road.',
        affectedNpcIds: ['npc_b', 'npc_a'],
      }],
      worldEventUpdates: [{
        eventId: undefined,
        summary: 'An unnamed event update.',
        affectedPlaceIds: ['place_b', 'place_a'],
      }],
    } as unknown as Partial<NarratorWritebackProtocol>);
    const repaired = makeWriteback({
      questChanges: [
        {
          affectedNpcIds: ['npc_a', 'npc_b'],
          summary: ' search the unnamed road! ',
          action: 'add',
        },
        {
          action: 'add',
          summary: 'Search the unnamed road.',
          affectedNpcIds: ['npc_c'],
        },
      ],
      worldEventUpdates: [{
        affectedPlaceIds: ['place_a', 'place_b'],
        summary: ' an unnamed event update! ',
        eventId: undefined,
      }],
    } as unknown as Partial<NarratorWritebackProtocol>);

    const merged = mergeRepairWritebackProtocol(original, repaired);

    expect(merged.questChanges).toHaveLength(2);
    expect(merged.questChanges[0].affectedNpcIds).toEqual(['npc_b', 'npc_a']);
    expect(merged.questChanges[1].affectedNpcIds).toEqual(['npc_c']);
    expect(merged.worldEventUpdates).toHaveLength(1);
  });

  it('does not use incomplete location or route identities as semantic keys', () => {
    const original = makeWriteback({
      locationWriteSuggestions: [{
        name: 'Unnamed Ford',
        kind: 'crossing',
        summary: 'The first ford has a stone marker.',
        permanence: 'temporary',
      }],
      routeWriteSuggestions: [{
        fromPlaceId: 'place_a',
        toPlaceId: 'place_b',
        name: 'Unnamed Track',
        status: 'open',
        knownLevel: '听闻',
      }],
    });
    const repaired = makeWriteback({
      locationWriteSuggestions: [{
        name: 'unnamed ford!',
        kind: 'crossing',
        summary: 'The second ford has no marker.',
        permanence: 'temporary',
      }],
      routeWriteSuggestions: [{
        fromPlaceId: 'place_a',
        toPlaceId: 'place_b',
        name: 'unnamed track!',
        status: 'closed',
        knownLevel: '听闻',
      }],
    });

    const merged = mergeRepairWritebackProtocol(original, repaired);

    expect(merged.locationWriteSuggestions).toHaveLength(2);
    expect(merged.routeWriteSuggestions).toHaveLength(2);
  });

  it('replaces a diagnosed same-id location instead of preserving its rejected fields', () => {
    const original = makeWriteback({
      locationWriteSuggestions: [{
        locationId: 'place_repair_target',
        name: '错误地点',
        kind: 'scene',
        mapLayer: 'scene',
        parentId: 'missing_parent',
        summary: '原始失败候选。',
        permanence: 'permanent',
      }],
    });
    const repaired = makeWriteback({
      locationWriteSuggestions: [{
        locationId: 'place_repair_target',
        name: '河畔哨所',
        kind: 'outpost',
        mapLayer: 'place',
        parentId: 'region_root',
        summary: '修复后的稳定地点。',
        permanence: 'permanent',
      }],
    });

    const merged = mergeRepairWritebackProtocol(original, repaired, {
      replaceLocationIds: new Set(['place_repair_target']),
    });

    expect(merged.locationWriteSuggestions).toEqual([
      expect.objectContaining({
        locationId: 'place_repair_target',
        name: '河畔哨所',
        mapLayer: 'place',
        parentId: 'region_root',
      }),
    ]);
  });

  it('does not remove duplicate facts that were already present in the original response', () => {
    const original = makeWriteback({
      debugNotes: ['Repeated original note.', ' repeated original note! '],
      npcMemorySuggestions: [
        { eventId: 'event_same', npcId: 'npc_a', source: 'witnessed', content: 'First original.' },
        { eventId: 'event_same', npcId: 'npc_a', source: 'witnessed', content: 'Second original.' },
      ],
    });
    const repaired = makeWriteback({
      debugNotes: ['repeated original note'],
      npcMemorySuggestions: [
        { eventId: ' event_same ', npcId: 'npc_a', source: 'witnessed', content: 'Repair duplicate.' },
      ],
    });

    const merged = mergeRepairWritebackProtocol(original, repaired);

    expect(merged.debugNotes).toEqual(['Repeated original note.', ' repeated original note! ']);
    expect(merged.npcMemorySuggestions).toHaveLength(2);
    expect(merged.npcMemorySuggestions[0].content).toBe('First original.');
    expect(merged.npcMemorySuggestions[1].content).toBe('Second original.');
  });

  it('merges distinct faction actions while deduplicating the same structured suggestion', () => {
    const original = makeWriteback({
      factionRecentActionSuggestions: [{
        factionId: 'faction_command',
        summary: '主角代表军府完成军粮交割',
        knownLevel: '亲历',
      }],
    });
    const repaired = makeWriteback({
      factionRecentActionSuggestions: [
        {
          factionId: ' faction_command ',
          summary: ' 主角代表军府完成军粮交割 ',
          knownLevel: '亲历',
          sourceNote: '重复复核',
        },
        {
          factionId: 'faction_rebels',
          summary: '黄巾余部烧毁东郊驿站',
          knownLevel: '听闻',
        },
      ],
    });

    const merged = mergeRepairWritebackProtocol(original, repaired);

    expect(merged.factionRecentActionSuggestions).toEqual([
      expect.objectContaining({
        factionId: 'faction_command',
        summary: '主角代表军府完成军粮交割',
        knownLevel: '亲历',
      }),
      expect.objectContaining({
        factionId: 'faction_rebels',
        summary: '黄巾余部烧毁东郊驿站',
        knownLevel: '听闻',
      }),
    ]);
  });

  it('does not attach an id-less repair item to one of several stable-id candidates', () => {
    const original = makeWriteback({
      questChanges: [
        { action: 'add', questId: 'quest_a', title: 'Shared title', summary: 'First stable quest.' },
        { action: 'add', questId: 'quest_b', title: 'Shared title', summary: 'Second stable quest.' },
      ],
    });
    const repaired = makeWriteback({
      questChanges: [{
        action: 'add',
        title: ' shared title! ',
        summary: 'An id-less repair cannot choose between two stable quests.',
        priority: 'high',
      }],
    });

    const merged = mergeRepairWritebackProtocol(original, repaired);

    expect(merged.questChanges).toHaveLength(3);
    expect(merged.questChanges[0].priority).toBeUndefined();
    expect(merged.questChanges[1].priority).toBeUndefined();
    expect(merged.questChanges[2].priority).toBe('high');
  });

  it('does not attach an id-less signal repair to one of several rumor ids', () => {
    const original = makeWriteback({
      signalChanges: [
        {
          action: 'add', rumorId: 'rumor_a', title: 'Shared signal',
          content: 'The same report reached camp.', source: 'scouts',
        },
        {
          action: 'add', rumorId: 'rumor_b', title: 'Shared signal',
          content: 'The same report reached camp.', source: 'scouts',
        },
      ],
    });
    const repaired = makeWriteback({
      signalChanges: [{
        action: 'add', title: ' shared signal! ',
        content: ' the same report reached camp! ', source: ' scouts ', confidence: 'high',
      }],
    });

    const merged = mergeRepairWritebackProtocol(original, repaired);

    expect(merged.signalChanges).toHaveLength(3);
    expect(merged.signalChanges?.[0].confidence).toBeUndefined();
    expect(merged.signalChanges?.[1].confidence).toBeUndefined();
    expect(merged.signalChanges?.[2].confidence).toBe('high');
  });

  it('keeps memories for different npcs even when they share the same event id', () => {
    const original = makeWriteback({
      npcMemorySuggestions: [{
        eventId: 'event_shared_battle',
        npcId: 'npc_liu',
        source: 'witnessed',
        content: 'Liu remembered the retreat.',
      }],
    });
    const repaired = makeWriteback({
      npcMemorySuggestions: [{
        eventId: ' event_shared_battle ',
        npcId: 'npc_zhang',
        source: 'witnessed',
        content: 'Zhang remembered holding the bridge.',
      }],
    });

    const merged = mergeRepairWritebackProtocol(original, repaired);

    expect(merged.npcMemorySuggestions).toHaveLength(2);
    expect(merged.npcMemorySuggestions.map((memory) => memory.npcId)).toEqual([
      'npc_liu',
      'npc_zhang',
    ]);
  });

  it('keeps id-less quests whose consequence tags or follow-up hooks differ', () => {
    const original = makeWriteback({
      questChanges: [{
        action: 'add',
        title: 'Secure the ford',
        consequenceTags: ['river-control'],
        followUpHooks: ['negotiate-with-ferrymen'],
      }],
    });
    const repaired = makeWriteback({
      questChanges: [{
        action: 'add',
        title: ' secure the ford! ',
        consequenceTags: ['supply-shortage'],
        followUpHooks: ['repair-the-pontoon'],
      }],
    });

    const merged = mergeRepairWritebackProtocol(original, repaired);

    expect(merged.questChanges).toHaveLength(2);
    expect(merged.questChanges[0].consequenceTags).toEqual(['river-control']);
    expect(merged.questChanges[1].followUpHooks).toEqual(['repair-the-pontoon']);
  });

  it('does not collide signal text fields that contain the semantic key separator', () => {
    const original = makeWriteback({
      signalChanges: [{
        action: 'add',
        title: '甲|乙',
        content: '丙',
        source: '斥候',
      }],
    });
    const repaired = makeWriteback({
      signalChanges: [{
        action: 'add',
        title: '甲',
        content: '乙|丙',
        source: '斥候',
      }],
    });

    const merged = mergeRepairWritebackProtocol(original, repaired);

    expect(merged.signalChanges).toHaveLength(2);
  });

  it('does not collide different signal arrays whose values contain separators', () => {
    const original = makeWriteback({
      signalChanges: [{
        action: 'add',
        title: '渡口风闻',
        content: '同一条核心消息',
        consequenceTags: ['a|b', 'c'],
      }],
    });
    const repaired = makeWriteback({
      signalChanges: [{
        action: 'add',
        title: '渡口风闻',
        content: '同一条核心消息',
        consequenceTags: ['a', 'b|c'],
      }],
    });

    const merged = mergeRepairWritebackProtocol(original, repaired);

    expect(merged.signalChanges).toHaveLength(2);
  });

  it('trims ids without applying text punctuation normalization to targets', () => {
    const original = makeWriteback({
      questChanges: [{
        action: 'add', title: 'Check target', summary: 'Check the first target.',
        affectedNpcIds: ['npc-a'],
      }],
      signalChanges: [{
        action: 'add', title: 'Target signal', content: 'A target was reported.', source: 'scouts',
        relatedLocationIds: ['place-a'],
      }],
      worldEventUpdates: [{
        eventId: 'event_targets', summary: 'The original event.', affectedNpcIds: ['npc-a'],
      }],
    });
    const repaired = makeWriteback({
      questChanges: [{
        action: 'add', title: 'check target!', summary: 'Check the second target.',
        affectedNpcIds: ['npca'],
      }],
      signalChanges: [{
        action: 'add', title: 'target signal!', content: 'a target was reported!', source: 'scouts',
        relatedLocationIds: ['placea'],
      }],
      worldEventUpdates: [{
        eventId: ' event_targets ', summary: 'Repair must not overwrite.', affectedNpcIds: ['npca'],
      }],
    });

    const merged = mergeRepairWritebackProtocol(original, repaired);

    expect(merged.questChanges).toHaveLength(2);
    expect(merged.signalChanges).toHaveLength(2);
    expect(merged.worldEventUpdates).toEqual([
      expect.objectContaining({ affectedNpcIds: ['npc-a', 'npca'] }),
    ]);
  });

  it('preserves main-narrator encounter authority while accepting repaired semantic profiles', () => {
    const originalIntent = makeCombatIntent();
    const repairIntent = {
      ...makeCombatIntent(),
      encounterId: 'combat_auxiliary_must_not_replace',
      seed: 'seed_auxiliary_must_not_replace',
    };
    const original = makeWriteback({
      encounterStartIntent: originalIntent,
      semanticProjections: [makeTraitProfile('trait_original')],
    });
    const repaired = makeWriteback({
      encounterStartIntent: repairIntent,
      semanticProjections: [makeTraitProfile('trait_repaired')],
    });

    const merged = mergeRepairWritebackProtocol(original, repaired);

    expect(merged.encounterStartIntent).toEqual(originalIntent);
    expect(merged.semanticProjections?.map((profile) => profile.sourceId)).toEqual([
      'trait_original',
      'trait_repaired',
    ]);
  });

  it('preserves main-narrator recovery authority during auxiliary writeback repair', () => {
    const original = makeWriteback({ playerRecoveryKind: 'rest' });
    const repaired = makeWriteback({ playerRecoveryKind: 'none' });

    const merged = mergeRepairWritebackProtocol(original, repaired);

    expect(merged.playerRecoveryKind).toBe('rest');
  });
});

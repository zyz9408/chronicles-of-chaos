import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import { selectRemoteNpcPresenceBeats } from './RemoteNpcPresence';

function makeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'test-world',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: 'day 1',
    currentDate: 'day 20',
    player: {
      id: 'player',
      name: 'Player',
      roleType: 'traveler',
      summary: 'A traveler with growing local influence.',
    },
    currentLocationId: 'place_yingchuan',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    ...overrides,
  });
}

describe('selectRemoteNpcPresenceBeats', () => {
  it('does not wake an NPC from historical importance alone', () => {
    const beats = selectRemoteNpcPresenceBeats(makeState({
      npcAwarenessIndex: [
        {
          awarenessId: 'aware_famous',
          name: 'Famous Person',
          sourceType: 'worldTrend',
          sourceIds: ['trend_history'],
          contactLevel: 0,
          historicalImportance: 100,
          playerRelevance: [],
          knownToPlayer: true,
          archiveVisible: false,
          updatedAt: 'day 20',
        },
      ],
    }));

    expect(beats).toEqual([]);
  });

  it('selects a same-location awareness entry as an invitation-style beat', () => {
    const beats = selectRemoteNpcPresenceBeats(makeState({
      npcAwarenessIndex: [
        {
          awarenessId: 'aware_zhang_miao',
          name: 'Zhang Miao',
          sourceType: 'rumor',
          sourceIds: ['rumor_recruit'],
          contactLevel: 0,
          playerRelevance: ['same-location'],
          unresolvedHooks: ['may recruit capable locals'],
          knownToPlayer: true,
          archiveVisible: false,
          updatedAt: 'day 20',
        },
      ],
    }));

    expect(beats[0]).toMatchObject({
      name: 'Zhang Miao',
      beatType: 'invitation',
      sourceIds: ['rumor_recruit'],
    });
  });

  it('selects a known off-stage NPC when a world trend makes the old relationship relevant', () => {
    const beats = selectRemoteNpcPresenceBeats(makeState({
      npcs: [
        {
          npcId: 'npc_cao_cao',
          name: 'Cao Cao',
          sex: '男',
          age: 34,
          role: 'off-stage official',
          locationId: 'place_chenliu',
          isPresent: false,
          isFocused: false,
          summary: 'An old acquaintance now raising troops.',
          appearance: 'stern',
          personality: 'decisive',
          motivation: 'build influence',
          relationToPlayer: 'old acquaintance',
          contactLevel: 35,
          recentAttitude: 'watching the player',
          memories: [],
        },
      ],
      npcAwarenessIndex: [
        {
          awarenessId: 'aware_cao_cao',
          npcId: 'npc_cao_cao',
          name: 'Cao Cao',
          sourceType: 'worldTrend',
          sourceIds: ['trend_raise_troops'],
          contactLevel: 35,
          historicalImportance: 90,
          playerRelevance: ['old-relationship', 'world-event'],
          knownToPlayer: true,
          archiveVisible: false,
          updatedAt: 'day 20',
        },
      ],
      worldTrends: [
        {
          trendId: 'trend_raise_troops',
          title: 'Troops are being raised',
          severity: 'high',
          summary: 'Cao Cao is gathering men and seeking capable allies.',
          knownToPlayer: true,
          npcAwarenessRefs: [{ npcId: 'npc_cao_cao', name: 'Cao Cao', playerRelevance: ['world-event'] }],
          updatedAt: 'day 20',
        },
      ],
    } as any));

    expect(beats[0].name).toBe('Cao Cao');
    expect(beats[0].beatType).toBe('letter');
  });

  it('promotes a materially urgent remote relationship and world-event convergence to high urgency', () => {
    const beats = selectRemoteNpcPresenceBeats(makeState({
      npcs: [
        {
          npcId: 'npc_urgent_ally',
          name: 'Urgent Ally',
          sex: '男',
          age: 38,
          role: 'off-stage ally',
          locationId: 'place_remote',
          isPresent: false,
          isFocused: false,
          summary: 'An established ally facing an unresolved crisis.',
          appearance: 'travel-worn',
          personality: 'decisive',
          motivation: 'warn the player before the route closes',
          relationToPlayer: 'old acquaintance with unresolved risk',
          contactLevel: 65,
          recentAttitude: 'seeking urgent contact',
          memories: [],
        },
      ],
      npcAwarenessIndex: [
        {
          awarenessId: 'aware_urgent_ally',
          npcId: 'npc_urgent_ally',
          name: 'Urgent Ally',
          sourceType: 'worldTrend',
          sourceIds: ['trend_route_closing'],
          contactLevel: 65,
          historicalImportance: 20,
          playerRelevance: ['old-relationship', 'direct-warning'],
          unresolvedHooks: ['route may close', 'warning still undelivered'],
          knownToPlayer: true,
          archiveVisible: false,
          updatedAt: 'day 20',
        },
      ],
      worldTrends: [
        {
          trendId: 'trend_route_closing',
          title: 'Route closing',
          severity: '极高',
          summary: 'The only messenger route is about to close.',
          knownToPlayer: true,
          status: 'active',
          nextCheckAt: 'day 20',
          npcAwarenessRefs: [{ npcId: 'npc_urgent_ally', name: 'Urgent Ally' }],
          updatedAt: 'day 20',
        },
      ],
    }));

    expect(beats[0]).toMatchObject({
      npcId: 'npc_urgent_ally',
      urgency: 'high',
    });
  });

  it('selects a non-historical relationship NPC when unresolved personal hooks exist', () => {
    const beats = selectRemoteNpcPresenceBeats(makeState({
      npcs: [
        {
          npcId: 'npc_zou',
          name: 'Zou Shi',
          sex: '女',
          age: 28,
          role: 'private relationship NPC',
          locationId: 'place_wan',
          isPresent: false,
          isFocused: false,
          summary: 'A non-historical relationship thread.',
          appearance: 'quiet',
          personality: 'guarded',
          motivation: 'avoid exposure',
          relationToPlayer: 'secret lover with unresolved risk',
          contactLevel: 60,
          recentAttitude: 'anxious',
          memories: [],
        },
      ],
    }));

    expect(beats[0]).toMatchObject({
      npcId: 'npc_zou',
      name: 'Zou Shi',
      beatType: 'letter',
    });
  });

  it('does not repeatedly reactivate a remote NPC from a completed historical chronicle', () => {
    const beats = selectRemoteNpcPresenceBeats(makeState({
      npcAwarenessIndex: [{
        awarenessId: 'aware_old_envoy',
        npcId: 'npc_old_envoy',
        name: 'Old Envoy',
        sourceType: 'worldTrend',
        sourceIds: ['trend_old_treaty'],
        contactLevel: 0,
        historicalImportance: 90,
        playerRelevance: [],
        unresolvedHooks: [],
        knownToPlayer: true,
        archiveVisible: false,
        updatedAt: 'day 20',
      }],
      worldTrends: [{
        trendId: 'trend_old_treaty',
        title: 'Old treaty concluded',
        severity: 'high',
        summary: 'Two factions concluded a treaty long ago.',
        knownToPlayer: true,
        status: 'historical',
        scope: 'regional',
        affectedFactionIds: ['faction_a', 'faction_b'],
        happenedAt: 'day 10',
        updatedAt: 'day 10',
      }],
    } as any));

    expect(beats).toEqual([]);
  });

  it('does not select a remote NPC whose presence beat is still cooling down', () => {
    const beats = selectRemoteNpcPresenceBeats(makeState({
      currentDate: '公元189年09月01日 08:30（辰时）',
      npcAwarenessIndex: [
        {
          awarenessId: 'aware_old_ally',
          name: 'Old Ally',
          sourceType: 'rumor',
          sourceIds: ['rumor_old_ally'],
          contactLevel: 45,
          playerRelevance: ['old-relationship'],
          unresolvedHooks: ['may send a letter'],
          lastPresenceBeatAt: '公元189年09月01日 08:00（辰时）',
          cooldownUntil: '公元189年09月02日 08:00（辰时）',
          knownToPlayer: true,
          archiveVisible: false,
          updatedAt: '公元189年09月01日 08:00（辰时）',
        },
      ],
    }));

    expect(beats).toEqual([]);
  });

  it('selects a remote NPC again after the presence cooldown expires', () => {
    const beats = selectRemoteNpcPresenceBeats(makeState({
      currentDate: '公元189年09月03日 08:30（辰时）',
      npcAwarenessIndex: [
        {
          awarenessId: 'aware_old_ally',
          name: 'Old Ally',
          sourceType: 'rumor',
          sourceIds: ['rumor_old_ally'],
          contactLevel: 45,
          playerRelevance: ['old-relationship'],
          unresolvedHooks: ['may send a letter'],
          lastPresenceBeatAt: '公元189年09月01日 08:00（辰时）',
          cooldownUntil: '公元189年09月02日 08:00（辰时）',
          knownToPlayer: true,
          archiveVisible: false,
          updatedAt: '公元189年09月01日 08:00（辰时）',
        },
      ],
    }));

    expect(beats[0]).toMatchObject({
      name: 'Old Ally',
      beatType: 'letter',
    });
  });
});

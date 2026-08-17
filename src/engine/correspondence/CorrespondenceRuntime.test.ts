import { describe, expect, it } from 'vitest';
import type { CorrespondenceCommitment, RuntimeState } from '../types';
import {
  addGameMinutes,
  advanceCorrespondenceState,
  buildCorrespondencePromptProjection,
  createCorrespondenceDraft,
  isCorrespondenceCommitmentKnownToPlayer,
  markCorrespondenceRead,
  normalizeCorrespondenceEntries,
  queueCorrespondence,
  repairRapidRepeatedNpcFollowups,
  upsertCorrespondenceEntry,
} from './CorrespondenceRuntime';

function createState(): RuntimeState {
  return {
    engineVersion: 'test',
    worldBookId: 'test',
    worldBookVersion: '1',
    worldBookSource: 'official',
    startDate: '公元184年03月01日 08:00（辰时）',
    currentDate: '公元184年03月01日 08:00（辰时）',
    currentLocationId: 'place_a',
    currentPlaceId: 'place_a',
    player: {
      id: 'player_1',
      name: '林砚',
      roleType: 'player',
      summary: '',
      inventory: [],
      equipment: [],
      effects: [],
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
    npcs: [
      {
        npcId: 'npc_caiyan',
        name: '蔡琰',
        sex: '女',
        age: 18,
        role: '友人',
        locationId: 'place_b',
        isPresent: false,
        isFocused: true,
        summary: '',
        appearance: '',
        personality: '',
        motivation: '',
        relationToPlayer: '友人',
        contactLevel: 40,
        recentAttitude: '关切',
        memories: [],
      },
    ],
    routeEdges: [
      {
        routeId: 'route_ab',
        fromPlaceId: 'place_a',
        toPlaceId: 'place_b',
        name: '驿道',
        status: '可通行',
        source: 'worldbook',
        knownLevel: '亲历',
        standardTravelMinutes: 1440,
      },
    ],
  } as unknown as RuntimeState;
}

describe('CorrespondenceRuntime', () => {
  it('rejects player-to-player and npc-to-npc ledger entries', () => {
    const state = createState();
    expect(() => createCorrespondenceDraft({
      sender: { kind: 'npc', npcId: 'npc_a', name: '甲' },
      recipient: { kind: 'npc', npcId: 'npc_b', name: '乙' },
      body: '代为转告。',
      createdAt: state.currentDate,
    })).toThrow('玩家与人物志 NPC');
  });

  it('queues a player letter with a deterministic game-time ETA and delivers it once', () => {
    let state = createState();
    const draft = createCorrespondenceDraft({
      letterId: 'letter_test_1',
      sender: { kind: 'player', playerId: 'player_1', name: '林砚' },
      recipient: { kind: 'npc', npcId: 'npc_caiyan', name: '蔡琰' },
      subject: '问安',
      body: '近来可安？盼复。',
      createdAt: state.currentDate,
    });
    state = upsertCorrespondenceEntry(state, draft);
    state = queueCorrespondence(state, draft.letterId);

    const queued = state.correspondence?.[0];
    expect(queued?.status).toBe('inTransit');
    expect(queued?.deliveryDueAt).toContain('03月02日 08:00');

    const delivered = advanceCorrespondenceState(state, queued!.deliveryDueAt!);
    expect(delivered.deliveredLetterIds).toEqual(['letter_test_1']);
    expect(delivered.state.correspondence?.[0].status).toBe('deliveredPendingProcessing');
    expect(delivered.state.npcs?.[0].memories).toHaveLength(1);
    expect(delivered.state.npcs?.[0].memories[0].eventId).toBe('letter_test_1');
    expect(delivered.state.npcs?.[0].memories[0].content).toBe(
      '收到林砚来信；详细内容已归入书信账本，待处理后形成摘要。',
    );
    expect(delivered.state.npcs?.[0].memories[0].content).not.toContain('letter_test_1');
    expect(delivered.state.npcs?.[0].memories[0].content).not.toContain('近来可安');

    const repeated = advanceCorrespondenceState(delivered.state, addGameMinutes(queued!.deliveryDueAt!, 60));
    expect(repeated.state.npcs?.[0].memories).toHaveLength(1);
  });

  it('delivers an incoming NPC reply as unread correspondence and marks it read locally', () => {
    let state = createState();
    const reply = createCorrespondenceDraft({
      letterId: 'letter_reply_1',
      sender: { kind: 'npc', npcId: 'npc_caiyan', name: '蔡琰' },
      recipient: { kind: 'player', playerId: 'player_1', name: '林砚' },
      subject: '复书',
      body: '一切安好，勿念。',
      source: 'narrative',
      createdAt: state.currentDate,
    });
    reply.summary = '向林砚报平安，请其勿念';
    state = upsertCorrespondenceEntry(state, reply);
    state = queueCorrespondence(state, reply.letterId);
    state.correspondenceCommitments = [{
      commitmentId: 'commitment_hidden_until_delivery',
      sourceCorrespondenceId: reply.letterId,
      promisorNpcId: 'npc_caiyan',
      promisorName: '蔡琰',
      promisee: { kind: 'player', playerId: 'player_1', name: '林砚' },
      summary: '送来书卷',
      status: 'accepted',
      acceptedAt: state.currentDate,
      targetLocationId: 'place_a',
      expectedAt: addGameMinutes(state.currentDate, 3 * 24 * 60),
      deliverables: [{ kind: 'other', summary: '书卷一册' }],
      lastUpdatedAt: state.currentDate,
    }];
    expect(isCorrespondenceCommitmentKnownToPlayer(state, state.correspondenceCommitments[0])).toBe(false);
    const dueAt = state.correspondence?.[0].deliveryDueAt;
    state = advanceCorrespondenceState(state, dueAt).state;

    expect(state.correspondence?.[0].status).toBe('delivered');
    expect(isCorrespondenceCommitmentKnownToPlayer(state, state.correspondenceCommitments![0])).toBe(true);
    expect(state.npcs?.[0].presenceUpdates?.[0].readByPlayer).toBe(false);
    expect(state.npcs?.[0].presenceUpdates?.[0]).toMatchObject({
      summary: '向林砚报平安，请其勿念',
      source: '蔡琰来信',
    });
    expect(`${state.npcs?.[0].presenceUpdates?.[0].source} ${state.npcs?.[0].presenceUpdates?.[0].summary}`)
      .not.toContain('letter_reply_1');

    state = markCorrespondenceRead(state, reply.letterId, dueAt);
    expect(state.correspondence?.[0].status).toBe('read');
    expect(state.npcs?.[0].presenceUpdates?.[0].readByPlayer).toBe(true);
  });

  it('promotes an accepted promise to due and exposes both due work queues to the normal turn', () => {
    const state = createState();
    const commitment: CorrespondenceCommitment = {
      commitmentId: 'commitment_1',
      sourceCorrespondenceId: 'letter_reply_1',
      promisorNpcId: 'npc_caiyan',
      promisorName: '蔡琰',
      promisee: { kind: 'player', playerId: 'player_1', name: '林砚' },
      summary: '三日后送来粮草二百石',
      status: 'accepted',
      acceptedAt: state.currentDate,
      targetLocationId: 'place_a',
      expectedAt: addGameMinutes(state.currentDate, 3 * 24 * 60),
      deliverables: [{ kind: 'resources', resources: { grain: 200 } }],
      lastUpdatedAt: state.currentDate,
    };
    state.correspondenceCommitments = [commitment];
    state.correspondence = [{
      ...createCorrespondenceDraft({
        letterId: 'letter_pending_1',
        sender: { kind: 'player', playerId: 'player_1', name: '林砚' },
        recipient: { kind: 'npc', npcId: 'npc_caiyan', name: '蔡琰' },
        subject: '请求',
        body: '请援粮草。',
        createdAt: state.currentDate,
      }),
      status: 'deliveredPendingProcessing',
      deliveredAt: state.currentDate,
    }];

    const advanced = advanceCorrespondenceState(state, commitment.expectedAt);
    expect(advanced.state.correspondenceCommitments?.[0].status).toBe('due');
    const projection = buildCorrespondencePromptProjection(advanced.state);
    expect(projection.pendingLetterIds).toEqual(['letter_pending_1']);
    expect(projection.dueCommitmentIds).toEqual(['commitment_1']);
    expect(projection.text).toContain('普通问候也应回信问候');
    expect(projection.text).toContain('不得把读信或回信强塞进本回合 narrativeText');
    expect(projection.text).not.toContain('稍后回复');
    expect(projection.text).toContain('不得静默跳过');
    expect(projection.text).toContain('grain');
  });

  it('exposes a delivered but not-yet-due commitment only as optional early-settlement context', () => {
    const state = createState();
    const source = {
      ...createCorrespondenceDraft({
        letterId: 'letter_commitment_known',
        sender: { kind: 'npc', npcId: 'npc_caiyan', name: '蔡琰' },
        recipient: { kind: 'player', playerId: 'player_1', name: '林砚' },
        body: '三日后前来拜访。',
        createdAt: state.currentDate,
      }),
      status: 'delivered' as const,
      deliveredAt: state.currentDate,
    };
    state.correspondence = [source];
    state.correspondenceCommitments = [{
      commitmentId: 'commitment_early_visible',
      sourceCorrespondenceId: source.letterId,
      promisorNpcId: 'npc_caiyan',
      promisorName: '蔡琰',
      promisee: { kind: 'player', playerId: 'player_1', name: '林砚' },
      summary: '三日后前来拜访',
      status: 'preparing',
      acceptedAt: state.currentDate,
      targetLocationId: 'place_a',
      expectedAt: addGameMinutes(state.currentDate, 3 * 24 * 60),
      deliverables: [{ kind: 'visit', npcId: 'npc_caiyan' }],
      lastUpdatedAt: state.currentDate,
    }];

    const projection = buildCorrespondencePromptProjection(state);

    expect(projection.dueCommitmentIds).toEqual([]);
    expect(projection.activeCommitmentIds).toEqual(['commitment_early_visible']);
    expect(projection.text).toContain('不要求每回合推进');
    expect(projection.text).toContain('不得凭空提前履约');
  });

  it('preserves distinct legacy letters that share one letterId and repairs the collision deterministically', () => {
    const first = {
      ...createCorrespondenceDraft({
        letterId: 'letter_reused',
        sender: { kind: 'npc' as const, npcId: 'npc_caiyan', name: '蔡琰' },
        recipient: { kind: 'player' as const, playerId: 'player_1', name: '林砚' },
        body: '第一封回信正文。',
        source: 'narrative' as const,
        sourceRefId: 'reply_action_reused',
        createdAt: '公元184年03月02日 08:00（辰时）',
      }),
      status: 'delivered' as const,
    };
    const second = {
      ...createCorrespondenceDraft({
        letterId: 'letter_reused',
        sender: { kind: 'npc' as const, npcId: 'npc_caiyan', name: '蔡琰' },
        recipient: { kind: 'player' as const, playerId: 'player_1', name: '林砚' },
        body: '第二封回信正文。',
        source: 'narrative' as const,
        sourceRefId: 'reply_action_reused',
        createdAt: '公元184年03月04日 08:00（辰时）',
      }),
      status: 'delivered' as const,
    };

    const normalized = normalizeCorrespondenceEntries([first, second]);
    expect(normalized).toHaveLength(2);
    expect(normalized.map((entry) => entry.body)).toEqual(['第一封回信正文。', '第二封回信正文。']);
    expect(new Set(normalized.map((entry) => entry.letterId)).size).toBe(2);
    expect(normalizeCorrespondenceEntries(normalized)).toEqual(normalized);
  });

  it('repairs a rapid unsolicited duplicate after a completed reply but keeps later new intelligence', () => {
    const state = createState();
    const playerLetter = {
      ...createCorrespondenceDraft({
        letterId: 'letter_player_request',
        sender: { kind: 'player' as const, playerId: 'player_1', name: '林砚' },
        recipient: { kind: 'npc' as const, npcId: 'npc_caiyan', name: '蔡琰' },
        body: '请查问胡商。',
        createdAt: '公元184年03月01日 07:00（辰时）',
      }),
      status: 'processed' as const,
    };
    const reply = {
      ...createCorrespondenceDraft({
        letterId: 'letter_reply_once',
        sender: { kind: 'npc' as const, npcId: 'npc_caiyan', name: '蔡琰' },
        recipient: { kind: 'player' as const, playerId: 'player_1', name: '林砚' },
        body: '已命人寻访胡商。',
        source: 'narrative' as const,
        sourceRefId: 'reply_once',
        replyToLetterId: playerLetter.letterId,
        createdAt: '公元184年03月01日 08:00（辰时）',
      }),
      status: 'read' as const,
    };
    const repeated = {
      ...createCorrespondenceDraft({
        letterId: 'letter_repeated_followup',
        sender: { kind: 'npc' as const, npcId: 'npc_caiyan', name: '蔡琰' },
        recipient: { kind: 'player' as const, playerId: 'player_1', name: '林砚' },
        body: '再次说明已命人寻访胡商。',
        source: 'narrative' as const,
        sourceRefId: 'repeated_followup',
        createdAt: '公元184年03月01日 14:10（未时）',
      }),
      status: 'read' as const,
    };
    const laterNews = {
      ...createCorrespondenceDraft({
        letterId: 'letter_later_news',
        sender: { kind: 'npc' as const, npcId: 'npc_caiyan', name: '蔡琰' },
        recipient: { kind: 'player' as const, playerId: 'player_1', name: '林砚' },
        body: '两日后传来新的紧急情报。',
        source: 'narrative' as const,
        sourceRefId: 'later_news',
        createdAt: '公元184年03月03日 14:10（未时）',
      }),
      status: 'delivered' as const,
    };
    state.correspondence = [playerLetter, reply, repeated, laterNews];
    state.npcs![0].memories = [{
      memoryId: `memory_correspondence_sent:${repeated.letterId}`,
      eventId: repeated.letterId,
      source: '亲历',
      content: '重复信件。',
      createdAt: repeated.createdAt,
    }];
    state.npcs![0].presenceUpdates = [{
      id: `correspondence:${repeated.letterId}`,
      createdAt: repeated.createdAt,
      kind: 'letter',
      summary: '重复信件',
      source: '蔡琰来信',
      certainty: 'confirmed',
      readByPlayer: false,
    }];

    expect(repairRapidRepeatedNpcFollowups(state)).toEqual(['letter_repeated_followup']);
    expect(state.correspondence?.map((entry) => entry.letterId)).toEqual([
      'letter_player_request',
      'letter_reply_once',
      'letter_later_news',
    ]);
    expect(state.npcs?.[0].memories).toEqual([]);
    expect(state.npcs?.[0].presenceUpdates).toEqual([]);
  });
});

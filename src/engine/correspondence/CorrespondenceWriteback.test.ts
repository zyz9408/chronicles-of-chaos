import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../types';
import { advanceCorrespondenceState, createCorrespondenceDraft } from './CorrespondenceRuntime';
import { applyCorrespondenceWriteback } from './CorrespondenceWriteback';

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
      id: 'player_1', name: '林砚', roleType: 'player', summary: '', inventory: [], equipment: [], effects: [],
    },
    knownActors: [], knownFactions: [], relationships: [], knownRumors: [], activeQuests: [],
    playerResources: {}, worldStateDelta: {}, turnLog: [], localSituationNotes: [],
    npcs: [{
      npcId: 'npc_caiyan', name: '蔡琰', sex: '女', age: 18, role: '友人',
      locationId: 'place_b', isPresent: false, isFocused: true, summary: '', appearance: '',
      personality: '', motivation: '', relationToPlayer: '友人', contactLevel: 40,
      recentAttitude: '关切', memories: [],
    }],
    routeEdges: [{
      routeId: 'route_ab', fromPlaceId: 'place_a', toPlaceId: 'place_b', name: '驿道',
      status: '可通行', source: 'worldbook', knownLevel: '亲历', standardTravelMinutes: 1440,
    }],
  } as unknown as RuntimeState;
}

describe('CorrespondenceWriteback', () => {
  it('keeps legacy acknowledge actions pending so a later normal turn still produces a reply', () => {
    const state = createState();
    state.correspondence = [{
      ...createCorrespondenceDraft({
        letterId: 'letter_pending',
        sender: { kind: 'player', playerId: 'player_1', name: '林砚' },
        recipient: { kind: 'npc', npcId: 'npc_caiyan', name: '蔡琰' },
        body: '近来可安？',
        createdAt: state.currentDate,
      }),
      status: 'deliveredPendingProcessing',
      deliveredAt: state.currentDate,
    }];
    const turnSummary = {
      brief: '蔡琰收到了书信，暂缓作答。',
      correspondenceActions: [{
        sourceRefId: 'letter_action_ack_1',
        action: 'acknowledge' as const,
        sourceLetterId: 'letter_pending',
        sourceLetterSummary: '林砚来信问候近况',
      }],
    };

    const first = applyCorrespondenceWriteback(state, state, turnSummary);
    expect(first.ignoredSummaries).toEqual([]);
    expect(first.state.correspondence?.[0]).toMatchObject({
      status: 'deliveredPendingProcessing',
      summary: '林砚来信问候近况',
    });
    expect(first.state.npcs?.[0].memories[0].content).toBe('收到林砚来信：林砚来信问候近况');
    expect(first.state.npcs?.[0].memories[0].content).not.toContain('letter_pending');
    const repeated = applyCorrespondenceWriteback(first.state, state, turnSummary);
    expect(repeated.ignoredSummaries).toEqual([]);
    expect(repeated.appliedSummaries).toContain('书信动作x1');
    expect(repeated.state.correspondence?.[0].status).toBe('deliveredPendingProcessing');
  });

  it('does not overwrite unrelated NPC activity and hides a promised action until its reply arrives', () => {
    const state = createState();
    state.npcs![0].backgroundActivity = {
      activityId: 'existing_activity',
      summary: '在颍川访求旧友',
      status: 'active',
      sourceType: 'worldTrend',
      sourceIds: ['existing'],
      visibility: 'playerKnown',
    };
    const result = applyCorrespondenceWriteback(state, state, {
      brief: '蔡琰寄出回信，答应日后前来。',
      correspondenceActions: [{
        sourceRefId: 'letter_action_reply_1',
        action: 'send',
        letterId: 'letter_reply_commitment',
        direction: 'npc_to_player',
        senderNpcId: 'npc_caiyan',
        subject: '复书',
        body: '三日后我会前来。',
        summary: '答应三日后前来拜访',
        commitments: [{
          commitmentId: 'commitment_visit_1',
          summary: '三日后前来拜访',
          targetLocationId: 'place_a',
          expectedAt: '公元184年03月04日 08:00（辰时）',
          deliverables: [{ kind: 'visit', npcId: 'npc_caiyan' }],
        }],
      }],
    });
    expect(result.ignoredSummaries).toEqual([]);
    expect(result.state.npcs?.[0].backgroundActivity?.activityId).toBe('existing_activity');
    expect(result.state.npcs?.[0].memories[0].content).toBe('已向林砚寄出书信：答应三日后前来拜访');
    expect(result.state.npcs?.[0].memories[0].content).not.toContain('letter_reply_commitment');
    const reply = result.state.correspondence?.find((entry) => entry.letterId === 'letter_reply_commitment');
    expect(reply?.status).toBe('inTransit');
    const delivered = advanceCorrespondenceState(result.state, reply!.deliveryDueAt!).state;
    expect(delivered.correspondence?.find((entry) => entry.letterId === reply!.letterId)?.status).toBe('delivered');
    expect(delivered.npcs?.[0].backgroundActivity?.activityId).toBe('existing_activity');
  });

  it('records an NPC letter already read in the narrative as immediately delivered and visible', () => {
    const state = createState();
    state.correspondence = [{
      ...createCorrespondenceDraft({
        letterId: 'letter_player_to_caiyan',
        sender: { kind: 'player', playerId: 'player_1', name: '林砚' },
        recipient: { kind: 'npc', npcId: 'npc_caiyan', name: '蔡琰' },
        body: '请告知近日动向。',
        createdAt: state.currentDate,
      }),
      status: 'deliveredPendingProcessing',
      deliveredAt: state.currentDate,
    }];

    const turnSummary = {
      brief: '林砚拆阅了蔡琰送到营中的回信。',
      correspondenceActions: [{
        sourceRefId: 'reply_caiyan_received_turn_1',
        action: 'reply' as const,
        sourceLetterId: 'letter_player_to_caiyan',
        sourceLetterSummary: '林砚来信询问蔡琰近日动向',
        letterId: 'letter_caiyan_received_turn_1',
        direction: 'npc_to_player' as const,
        deliveryState: 'received' as const,
        senderNpcId: 'npc_caiyan',
        body: '妾已安然抵达颍川，近日会继续打探消息。',
        summary: '蔡琰告知已经抵达颍川并会继续打探消息',
      }],
    };

    const first = applyCorrespondenceWriteback(state, state, turnSummary);
    expect(first.ignoredSummaries).toEqual([]);
    expect(first.appliedSummaries).toContain('书信动作x1');
    expect(first.state.correspondence).toHaveLength(2);
    expect(first.state.correspondence?.find((entry) => entry.letterId === 'letter_caiyan_received_turn_1'))
      .toMatchObject({
        status: 'delivered',
        deliveredAt: state.currentDate,
        deliveryDueAt: state.currentDate,
      });
    expect(first.state.correspondence?.find((entry) => entry.letterId === 'letter_player_to_caiyan')?.status)
      .toBe('processed');
    expect(first.state.npcs?.[0].presenceUpdates).toEqual([
      expect.objectContaining({
        id: 'correspondence:letter_caiyan_received_turn_1',
        kind: 'letter',
        readByPlayer: false,
      }),
    ]);

    const replayed = applyCorrespondenceWriteback(first.state, state, turnSummary);
    expect(replayed.state.correspondence).toHaveLength(2);
    expect(replayed.state.correspondence?.filter((entry) => entry.letterId === 'letter_caiyan_received_turn_1'))
      .toHaveLength(1);
  });

  it('requires a future date for a partial commitment resolution', () => {
    const state = createState();
    state.resources = { grain: 100 } as RuntimeState['resources'];
    state.correspondenceCommitments = [{
      commitmentId: 'commitment_grain', sourceCorrespondenceId: 'letter_reply',
      promisorNpcId: 'npc_caiyan', promisorName: '蔡琰',
      promisee: { kind: 'player', playerId: 'player_1', name: '林砚' },
      summary: '送粮二百石', status: 'due', acceptedAt: state.currentDate,
      targetLocationId: 'place_a', expectedAt: state.currentDate,
      deliverables: [{ kind: 'resources', resources: { grain: 200 } }], lastUpdatedAt: state.currentDate,
    }];
    const nextState = JSON.parse(JSON.stringify(state)) as RuntimeState;
    nextState.resources = { grain: 200 } as RuntimeState['resources'];
    const result = applyCorrespondenceWriteback(nextState, state, {
      brief: '先送到一百石。',
      commitmentResolutions: [{
        sourceRefId: 'resolution_partial_1', commitmentId: 'commitment_grain',
        status: 'partial', summary: '先送到一百石。',
      }],
    });
    expect(result.ignoredSummaries.join('')).toContain('缺少未来的新日期');
    expect(result.state.correspondenceCommitments?.[0].status).toBe('due');
  });

  it('settles promised resources locally exactly once without a separate state patch', () => {
    const state = createState();
    state.player.personalMoney = 50;
    state.resources = {
      money: 10, grain: 100, horses: 0, arms: 0, recruits: 0,
      weapons: [], documents: [], tokens: [], importantSupplies: [],
    };
    state.correspondenceCommitments = [{
      commitmentId: 'commitment_resources', sourceCorrespondenceId: 'letter_reply',
      promisorNpcId: 'npc_caiyan', promisorName: '蔡琰',
      promisee: { kind: 'player', playerId: 'player_1', name: '林砚' },
      summary: '送来钱粮', status: 'due', acceptedAt: state.currentDate,
      targetLocationId: 'place_a', expectedAt: state.currentDate,
      deliverables: [{ kind: 'resources', resources: { playerMoneyQian: 300, moneyGuan: 20, grain: 200 } }],
      lastUpdatedAt: state.currentDate,
    }];
    const turnSummary = {
      brief: '钱粮如约送到。',
      commitmentResolutions: [{
        sourceRefId: 'resolution_resources_1', commitmentId: 'commitment_resources',
        status: 'fulfilled' as const, summary: '钱粮如约送到。',
      }],
    };

    const first = applyCorrespondenceWriteback(state, state, turnSummary);
    expect(first.ignoredSummaries).toEqual([]);
    expect(first.state.player.personalMoney).toBe(350);
    expect(first.state.resources).toMatchObject({ money: 30, grain: 300 });
    expect(first.state.correspondenceCommitments?.[0].status).toBe('fulfilled');

    const replayed = applyCorrespondenceWriteback(first.state, state, turnSummary);
    expect(replayed.state.player.personalMoney).toBe(350);
    expect(replayed.state.resources).toMatchObject({ money: 30, grain: 300 });
  });

  it('records a partial resource delivery and settles only the remaining balance later', () => {
    const state = createState();
    state.resources = {
      money: 0, grain: 100, horses: 0, arms: 0, recruits: 0,
      weapons: [], documents: [], tokens: [], importantSupplies: [],
    };
    state.correspondenceCommitments = [{
      commitmentId: 'commitment_grain_balance', sourceCorrespondenceId: 'letter_reply',
      promisorNpcId: 'npc_caiyan', promisorName: '蔡琰',
      promisee: { kind: 'player', playerId: 'player_1', name: '林砚' },
      summary: '送粮二百石', status: 'due', acceptedAt: state.currentDate,
      targetLocationId: 'place_a', expectedAt: state.currentDate,
      deliverables: [{ kind: 'resources', resources: { grain: 200 } }],
      lastUpdatedAt: state.currentDate,
    }];

    const partial = applyCorrespondenceWriteback(state, state, {
      brief: '先送到八十石。',
      commitmentResolutions: [{
        sourceRefId: 'resolution_grain_partial', commitmentId: 'commitment_grain_balance',
        status: 'partial', summary: '先送到八十石。',
        nextExpectedAt: '公元184年03月04日 08:00（辰时）',
        deliveredDeliverables: [{ kind: 'resources', resources: { grain: 80 } }],
      }],
    });
    expect(partial.ignoredSummaries).toEqual([]);
    expect(partial.state.resources?.grain).toBe(180);
    expect(partial.state.correspondenceCommitments?.[0].remainingDeliverables).toEqual([
      { kind: 'resources', resources: { grain: 120 } },
    ]);

    const dueAgain = advanceCorrespondenceState(
      partial.state,
      '公元184年03月04日 08:00（辰时）',
    ).state;
    const completed = applyCorrespondenceWriteback(dueAgain, partial.state, {
      brief: '余下粮草送到。',
      commitmentResolutions: [{
        sourceRefId: 'resolution_grain_final', commitmentId: 'commitment_grain_balance',
        status: 'fulfilled', summary: '余下粮草送到。',
      }],
    });
    expect(completed.ignoredSummaries).toEqual([]);
    expect(completed.state.resources?.grain).toBe(300);
    expect(completed.state.correspondenceCommitments?.[0].status).toBe('fulfilled');
    expect(completed.state.correspondenceCommitments?.[0].resolutionHistory).toHaveLength(2);
  });

  it('moves a promised visitor to the fixed destination without following the player', () => {
    const state = createState();
    state.currentPlaceId = 'place_b';
    state.currentLocationId = 'place_b';
    state.correspondenceCommitments = [{
      commitmentId: 'commitment_visit_fixed', sourceCorrespondenceId: 'letter_reply',
      promisorNpcId: 'npc_caiyan', promisorName: '蔡琰',
      promisee: { kind: 'player', playerId: 'player_1', name: '林砚' },
      summary: '前往旧宅会面', status: 'due', acceptedAt: state.currentDate,
      targetLocationId: 'place_a', expectedAt: state.currentDate,
      deliverables: [{ kind: 'visit', npcId: 'npc_caiyan' }], lastUpdatedAt: state.currentDate,
    }];

    const result = applyCorrespondenceWriteback(state, state, {
      brief: '蔡琰依约抵达旧宅。',
      commitmentResolutions: [{
        sourceRefId: 'resolution_visit_fixed', commitmentId: 'commitment_visit_fixed',
        status: 'fulfilled', summary: '蔡琰依约抵达旧宅。',
      }],
    });

    expect(result.ignoredSummaries).toEqual([]);
    expect(result.state.npcs?.[0]).toMatchObject({ locationId: 'place_a', isPresent: false });
  });

  it('moves an existing promised troop and records one stable movement event', () => {
    const state = createState();
    state.troops = [{
      troopId: 'troop_guard', name: '蔡氏部曲', size: 120, troopType: '步卒',
      morale: 70, training: 65, supplies: 80, task: '守卫庄园', relationToPlayer: '友军',
      lifecycleStatus: 'active', locationId: 'place_b', changeHistory: [],
    }];
    state.correspondenceCommitments = [{
      commitmentId: 'commitment_troop_fixed', sourceCorrespondenceId: 'letter_reply',
      promisorNpcId: 'npc_caiyan', promisorName: '蔡琰',
      promisee: { kind: 'player', playerId: 'player_1', name: '林砚' },
      summary: '调一百二十部曲赴营', status: 'due', acceptedAt: state.currentDate,
      targetLocationId: 'place_a', expectedAt: state.currentDate,
      deliverables: [{ kind: 'troop', troopIds: ['troop_guard'], expectedCount: 120 }],
      lastUpdatedAt: state.currentDate,
    }];
    const turnSummary = {
      brief: '蔡氏部曲抵营。',
      commitmentResolutions: [{
        sourceRefId: 'resolution_troop_fixed', commitmentId: 'commitment_troop_fixed',
        status: 'fulfilled' as const, summary: '蔡氏部曲抵营。',
      }],
    };

    const first = applyCorrespondenceWriteback(state, state, turnSummary);
    expect(first.ignoredSummaries).toEqual([]);
    expect(first.state.troops?.[0]).toMatchObject({
      locationId: 'place_a', lastKnownLocationId: 'place_a',
      destinationLocationId: 'place_a', movementStatus: 'arrived',
    });
    expect(first.state.troops?.[0].changeHistory).toHaveLength(1);
    const replayed = applyCorrespondenceWriteback(first.state, state, turnSummary);
    expect(replayed.state.troops?.[0].changeHistory).toHaveLength(1);
  });

  it('rejects a mixed settlement atomically when a promised new item was not legally written', () => {
    const state = createState();
    state.resources = {
      money: 0, grain: 100, horses: 0, arms: 0, recruits: 0,
      weapons: [], documents: [], tokens: [], importantSupplies: [],
    };
    state.correspondenceCommitments = [{
      commitmentId: 'commitment_mixed_invalid', sourceCorrespondenceId: 'letter_reply',
      promisorNpcId: 'npc_caiyan', promisorName: '蔡琰',
      promisee: { kind: 'player', playerId: 'player_1', name: '林砚' },
      summary: '送粮并附书卷', status: 'due', acceptedAt: state.currentDate,
      targetLocationId: 'place_a', expectedAt: state.currentDate,
      deliverables: [
        { kind: 'resources', resources: { grain: 200 } },
        { kind: 'items', itemIds: ['item_promised_book'] },
      ],
      lastUpdatedAt: state.currentDate,
    }];

    const result = applyCorrespondenceWriteback(state, state, {
      brief: '粮与书卷送到。',
      commitmentResolutions: [{
        sourceRefId: 'resolution_mixed_invalid', commitmentId: 'commitment_mixed_invalid',
        status: 'fulfilled', summary: '粮与书卷送到。',
      }],
    });

    expect(result.ignoredSummaries.join('')).toContain('尚未通过合法物品写回新增');
    expect(result.state.resources?.grain).toBe(100);
    expect(result.state.correspondenceCommitments?.[0].status).toBe('due');
  });

  it('does not apply the same partial delivery twice', () => {
    const state = createState();
    state.resources = {
      money: 0, grain: 100, horses: 0, arms: 0, recruits: 0,
      weapons: [], documents: [], tokens: [], importantSupplies: [],
    };
    state.correspondenceCommitments = [{
      commitmentId: 'commitment_partial_replay', sourceCorrespondenceId: 'letter_reply',
      promisorNpcId: 'npc_caiyan', promisorName: '蔡琰',
      promisee: { kind: 'player', playerId: 'player_1', name: '林砚' },
      summary: '分批送粮', status: 'due', acceptedAt: state.currentDate,
      targetLocationId: 'place_a', expectedAt: state.currentDate,
      deliverables: [{ kind: 'resources', resources: { grain: 200 } }],
      lastUpdatedAt: state.currentDate,
    }];
    const turnSummary = {
      brief: '首批送到八十石。',
      commitmentResolutions: [{
        sourceRefId: 'resolution_partial_replay', commitmentId: 'commitment_partial_replay',
        status: 'partial' as const, summary: '首批送到八十石。',
        nextExpectedAt: '公元184年03月04日 08:00（辰时）',
        deliveredDeliverables: [{ kind: 'resources' as const, resources: { grain: 80 } }],
      }],
    };

    const first = applyCorrespondenceWriteback(state, state, turnSummary);
    const replayed = applyCorrespondenceWriteback(first.state, state, turnSummary);
    expect(replayed.state.resources?.grain).toBe(180);
    expect(replayed.state.correspondenceCommitments?.[0].remainingDeliverables).toEqual([
      { kind: 'resources', resources: { grain: 120 } },
    ]);
  });

  it('keeps both replies when a later model response reuses an earlier reply letterId', () => {
    const state = createState();
    state.correspondence = [
      {
        ...createCorrespondenceDraft({
          letterId: 'letter_reply_reused',
          sender: { kind: 'npc', npcId: 'npc_caiyan', name: '蔡琰' },
          recipient: { kind: 'player', playerId: 'player_1', name: '林砚' },
          body: '第一封回信正文。',
          source: 'narrative',
          sourceRefId: 'reply_action_reused',
          replyToLetterId: 'letter_pending_first',
          createdAt: '公元184年03月01日 07:00（辰时）',
        }),
        status: 'read',
      },
      {
        ...createCorrespondenceDraft({
          letterId: 'letter_pending_second',
          sender: { kind: 'player', playerId: 'player_1', name: '林砚' },
          recipient: { kind: 'npc', npcId: 'npc_caiyan', name: '蔡琰' },
          body: '第二封去信正文。',
          source: 'ui',
          createdAt: state.currentDate,
        }),
        status: 'deliveredPendingProcessing',
        deliveredAt: state.currentDate,
      },
    ];
    const turnSummary = {
      brief: '蔡琰寄出了第二封回信。',
      correspondenceActions: [{
        sourceRefId: 'reply_action_reused',
        action: 'reply' as const,
        letterId: 'letter_reply_reused',
        sourceLetterId: 'letter_pending_second',
        sourceLetterSummary: '林砚第二次来信询问近况',
        direction: 'npc_to_player' as const,
        senderNpcId: 'npc_caiyan',
        body: '第二封回信正文。',
        summary: '答复第二封来信',
      }],
    };

    const first = applyCorrespondenceWriteback(state, state, turnSummary);
    expect(first.ignoredSummaries).toEqual([]);
    expect(first.state.correspondence).toHaveLength(3);
    const replies = first.state.correspondence?.filter((entry) => entry.direction === 'incoming') ?? [];
    expect(replies.map((entry) => entry.body)).toEqual(['第一封回信正文。', '第二封回信正文。']);
    expect(new Set(replies.map((entry) => entry.letterId)).size).toBe(2);
    expect(first.state.correspondence?.find((entry) => entry.letterId === 'letter_pending_second')?.status)
      .toBe('processed');

    const replayed = applyCorrespondenceWriteback(first.state, state, turnSummary);
    expect(replayed.state.correspondence).toHaveLength(3);
    expect(replayed.state.correspondence?.filter((entry) => entry.direction === 'incoming'))
      .toHaveLength(2);
  });

  it('silently rejects a rapid unsolicited duplicate after the NPC already replied', () => {
    const state = createState();
    state.currentDate = '公元184年03月01日 14:10（未时）';
    state.correspondence = [{
      ...createCorrespondenceDraft({
        letterId: 'letter_reply_once',
        sender: { kind: 'npc', npcId: 'npc_caiyan', name: '蔡琰' },
        recipient: { kind: 'player', playerId: 'player_1', name: '林砚' },
        body: '已命人寻访胡商。',
        source: 'narrative',
        sourceRefId: 'reply_once',
        replyToLetterId: 'letter_player_request',
        createdAt: '公元184年03月01日 08:00（辰时）',
      }),
      status: 'read',
      sentAt: '公元184年03月01日 08:00（辰时）',
    }];

    const result = applyCorrespondenceWriteback(state, state, {
      brief: '没有新的书信事件。',
      correspondenceActions: [{
        sourceRefId: 'repeated_followup',
        action: 'send',
        letterId: 'letter_repeated_followup',
        direction: 'npc_to_player',
        senderNpcId: 'npc_caiyan',
        body: '再次说明已命人寻访胡商。',
        summary: '重复上一封回信',
      }],
    });

    expect(result.ignoredSummaries).toEqual([]);
    expect(result.appliedSummaries).toEqual([]);
    expect(result.state.correspondence).toHaveLength(1);
  });

  it('treats one stable ordinary-send source as one immutable message across repair retries', () => {
    const state = createState();
    const first = applyCorrespondenceWriteback(state, state, {
      brief: '蔡琰寄出一封近况信。',
      correspondenceActions: [{
        sourceRefId: 'npc_event_caiyan_news_1',
        action: 'send',
        letterId: 'letter_news_first',
        direction: 'npc_to_player',
        senderNpcId: 'npc_caiyan',
        body: '我已抵达颍川。',
        summary: '蔡琰告知已经抵达颍川',
      }],
    });
    const repairedState = JSON.parse(JSON.stringify(first.state)) as RuntimeState;
    repairedState.currentDate = '公元184年03月01日 10:00（巳时）';
    const replayed = applyCorrespondenceWriteback(repairedState, first.state, {
      brief: '状态写回修复再次返回同一寄信事件。',
      correspondenceActions: [{
        sourceRefId: 'npc_event_caiyan_news_1',
        action: 'send',
        letterId: 'letter_news_rewritten',
        direction: 'npc_to_player',
        senderNpcId: 'npc_caiyan',
        body: '我已平安抵达颍川，勿念。',
        summary: '蔡琰告知已经平安抵达颍川',
      }],
    });

    expect(replayed.state.correspondence).toHaveLength(1);
    expect(replayed.state.correspondence?.[0]).toMatchObject({
      letterId: 'letter_news_first',
      body: '我已抵达颍川。',
    });
    expect(replayed.state.npcs?.[0].memories).toHaveLength(1);
  });

  it('allows an explicitly completed commitment to settle before its expected date', () => {
    const state = createState();
    state.correspondenceCommitments = [{
      commitmentId: 'commitment_early_visit',
      sourceCorrespondenceId: 'letter_visit_promise',
      promisorNpcId: 'npc_caiyan',
      promisorName: '蔡琰',
      promisee: { kind: 'player', playerId: 'player_1', name: '林砚' },
      summary: '三日后前来会面',
      status: 'preparing',
      acceptedAt: state.currentDate,
      targetLocationId: 'place_a',
      expectedAt: '公元184年03月04日 08:00（辰时）',
      deliverables: [{ kind: 'visit', npcId: 'npc_caiyan' }],
      lastUpdatedAt: state.currentDate,
    }];

    const result = applyCorrespondenceWriteback(state, state, {
      brief: '蔡琰提前抵达，双方已经会面。',
      commitmentResolutions: [{
        sourceRefId: 'resolution_early_visit',
        commitmentId: 'commitment_early_visit',
        status: 'fulfilled',
        summary: '蔡琰提前抵达，双方已经会面。',
      }],
    });

    expect(result.ignoredSummaries).toEqual([]);
    expect(result.state.correspondenceCommitments?.[0].status).toBe('fulfilled');
    expect(result.state.npcs?.[0].locationId).toBe('place_a');
  });

  it('cancels only undelivered reminders linked to a closed commitment', () => {
    const state = createState();
    state.correspondenceCommitments = [{
      commitmentId: 'commitment_meeting',
      sourceCorrespondenceId: 'letter_promise',
      promisorNpcId: 'npc_caiyan',
      promisorName: '蔡琰',
      promisee: { kind: 'player', playerId: 'player_1', name: '林砚' },
      summary: '次日前来会面',
      status: 'preparing',
      acceptedAt: state.currentDate,
      targetLocationId: 'place_a',
      expectedAt: '公元184年03月02日 08:00（辰时）',
      deliverables: [{ kind: 'visit', npcId: 'npc_caiyan' }],
      lastUpdatedAt: state.currentDate,
    }];
    state.correspondence = [
      {
        ...createCorrespondenceDraft({
          letterId: 'letter_linked_reminder',
          sender: { kind: 'npc', npcId: 'npc_caiyan', name: '蔡琰' },
          recipient: { kind: 'player', playerId: 'player_1', name: '林砚' },
          body: '我正按约前来。',
          relatedCommitmentIds: ['commitment_meeting'],
          createdAt: state.currentDate,
        }),
        status: 'inTransit' as const,
        sentAt: state.currentDate,
        deliveryDueAt: '公元184年03月01日 20:00（戌时）',
      },
      {
        ...createCorrespondenceDraft({
          letterId: 'letter_unrelated',
          sender: { kind: 'npc', npcId: 'npc_caiyan', name: '蔡琰' },
          recipient: { kind: 'player', playerId: 'player_1', name: '林砚' },
          body: '另有一事相告。',
          createdAt: state.currentDate,
        }),
        status: 'inTransit' as const,
        sentAt: state.currentDate,
        deliveryDueAt: '公元184年03月01日 20:00（戌时）',
      },
    ];

    const result = applyCorrespondenceWriteback(state, state, {
      brief: '双方已经提前会面。',
      commitmentResolutions: [{
        sourceRefId: 'resolution_meeting_closed',
        commitmentId: 'commitment_meeting',
        status: 'fulfilled',
        summary: '双方已经提前会面。',
      }],
    });

    expect(result.state.correspondence?.find((entry) => entry.letterId === 'letter_linked_reminder'))
      .toMatchObject({ status: 'cancelled', cancelledAt: state.currentDate });
    expect(result.state.correspondence?.find((entry) => entry.letterId === 'letter_unrelated')?.status)
      .toBe('inTransit');
  });
});

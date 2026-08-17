import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import {
  buildLetterPolishContext,
  buildCorrespondenceConversations,
  countUnreadCorrespondence,
  getCorrespondenceEntryDisplayTime,
  getCorrespondenceEntryTimeLabel,
  getCorrespondenceEntryPreview,
  isCorrespondenceEntryVisibleToPlayer,
  markCorrespondenceConversationRead,
} from './CorrespondencePanel';

const state = {
  correspondence: [
    {
      letterId: 'incoming_1',
      direction: 'incoming',
      sender: { kind: 'npc', npcId: 'npc_cao', name: '曹操' },
      recipient: { kind: 'player', playerId: 'player_1', name: '林砚' },
      subject: '颍川近况',
      body: '近日正在招募青壮。',
      source: 'npcEvolution',
      channel: 'letter',
      status: 'delivered',
      createdAt: '公元187年04月01日 08:00',
      deliveredAt: '公元187年04月12日 08:00',
    },
    {
      letterId: 'draft_1',
      direction: 'outgoing',
      sender: { kind: 'player', playerId: 'player_1', name: '林砚' },
      recipient: { kind: 'npc', npcId: 'npc_cao', name: '曹操' },
      subject: '复函',
      body: '已知。',
      source: 'ui',
      channel: 'letter',
      status: 'draft',
      createdAt: '公元187年04月12日 08:00',
    },
  ],
} as unknown as RuntimeState;

describe('CorrespondencePanel model', () => {
  it('groups only sent or received letters under one correspondent and ignores drafts', () => {
    expect(countUnreadCorrespondence(state)).toBe(1);
    const conversations = buildCorrespondenceConversations(state);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      npcId: 'npc_cao',
      npcName: '曹操',
      unreadCount: 1,
    });
    expect(conversations[0].entries.map((entry) => entry.letterId)).toEqual(['incoming_1']);
    expect('draft' in conversations[0]).toBe(false);
    expect(getCorrespondenceEntryDisplayTime(conversations[0].entries[0])).toBe('公元187年04月12日 08:00');
  });

  it('does not list known NPCs or draft-only recipients as existing correspondents', () => {
    const noHistoryState = {
      ...state,
      npcs: [
        { npcId: 'npc_cai', name: '蔡琰', role: '名士之女' },
        { npcId: 'npc_draft', name: '荀彧', role: '名士' },
      ],
      correspondence: [{
        ...state.correspondence![1],
        letterId: 'draft_only',
        recipient: { kind: 'npc', npcId: 'npc_draft', name: '荀彧' },
      }],
    } as unknown as RuntimeState;

    expect(buildCorrespondenceConversations(noHistoryState)).toEqual([]);
  });

  it('marks every unread letter in the selected conversation without clearing another person', () => {
    const multiNpcState = {
      ...state,
      correspondence: [
        ...state.correspondence!,
        {
          ...state.correspondence![0],
          letterId: 'incoming_2',
          sender: { kind: 'npc', npcId: 'npc_cai', name: '蔡琰' },
        },
      ],
    } as unknown as RuntimeState;
    const marked = markCorrespondenceConversationRead(multiNpcState, 'npc_cao');
    expect(marked.correspondence?.find((entry) => entry.letterId === 'incoming_1')?.status).toBe('read');
    expect(marked.correspondence?.find((entry) => entry.letterId === 'incoming_2')?.status).toBe('delivered');
    expect(countUnreadCorrespondence(marked)).toBe(1);
  });

  it('uses the body excerpt as the list label instead of exposing a subject field', () => {
    expect(getCorrespondenceEntryPreview(state.correspondence![0])).toBe('近日正在招募青壮。');
  });

  it('keeps incoming letters private while in transit and reveals them only after delivery', () => {
    const inTransitIncoming = {
      letterId: 'incoming_in_transit',
      direction: 'incoming' as const,
      sender: { kind: 'npc' as const, npcId: 'npc_cao', name: '曹操' },
      recipient: { kind: 'player' as const, playerId: 'player_1', name: '林砚' },
      subject: '回信',
      body: '第一封回信正文。',
      source: 'narrative' as const,
      channel: 'letter' as const,
      status: 'inTransit' as const,
      createdAt: '公元187年04月02日 08:00',
      sentAt: '公元187年04月02日 08:00',
      deliveryDueAt: '公元187年04月03日 08:00',
    };
    const laterOutgoing = {
      letterId: 'outgoing_later',
      direction: 'outgoing' as const,
      sender: { kind: 'player' as const, playerId: 'player_1', name: '林砚' },
      recipient: { kind: 'npc' as const, npcId: 'npc_cao', name: '曹操' },
      subject: '书信',
      body: '第二封玩家去信。',
      source: 'ui' as const,
      channel: 'letter' as const,
      status: 'inTransit' as const,
      createdAt: '公元187年04月02日 09:00',
      sentAt: '公元187年04月02日 09:00',
      deliveryDueAt: '公元187年04月03日 09:00',
    };
    const beforeDelivery = {
      ...state,
      correspondence: [state.correspondence![0], inTransitIncoming, laterOutgoing],
    } as unknown as RuntimeState;

    expect(isCorrespondenceEntryVisibleToPlayer(inTransitIncoming)).toBe(false);
    expect(isCorrespondenceEntryVisibleToPlayer(laterOutgoing)).toBe(true);
    expect(buildCorrespondenceConversations(beforeDelivery)[0].entries.map((entry) => entry.letterId))
      .toEqual(['outgoing_later', 'incoming_1']);

    const afterDelivery = {
      ...beforeDelivery,
      correspondence: [
        state.correspondence![0],
        {
          ...inTransitIncoming,
          status: 'delivered' as const,
          deliveredAt: '公元187年04月04日 08:00',
        },
        laterOutgoing,
      ],
    } as unknown as RuntimeState;
    const deliveredEntries = buildCorrespondenceConversations(afterDelivery)[0].entries;

    expect(deliveredEntries.map((entry) => entry.letterId))
      .toEqual(['outgoing_later', 'incoming_in_transit', 'incoming_1']);
    expect(getCorrespondenceEntryDisplayTime(deliveredEntries[1])).toBe('公元187年04月04日 08:00');
    expect(getCorrespondenceEntryTimeLabel(deliveredEntries[1]))
      .toBe('寄出 公元187年04月02日 08:00 · 收到 公元187年04月04日 08:00');
  });

  it('builds a compact structured context without feeding memories or full profiles', () => {
    const contextState = {
      ...state,
      worldBookId: 'threeKingdoms',
      startBookmarkId: 'bookmark_184_yellow_turban',
      currentDate: '公元184年03月09日 18:20',
      player: {
        id: 'player_1',
        name: '林砚',
        courtesyName: '子衡',
        sex: '男',
        birthDate: '公元164年02月01日',
        roleType: 'officer',
        currentIdentity: '羽林郎',
        factionName: '大汉朝廷',
        summary: '不应投喂的玩家完整摘要',
      },
      npcs: [{
        npcId: 'npc_cai',
        name: '蔡琰',
        courtesyName: '文姬',
        sex: '女',
        age: 10,
        birthDate: '公元174年04月18日',
        role: '名士之女',
        currentIdentity: '蔡邕之女',
        factionName: '蔡氏',
        isPresent: false,
        isFocused: true,
        summary: '不应投喂的 NPC 完整人物志摘要',
        appearance: '不应投喂的外貌',
        personality: '不应投喂的性格',
        motivation: '不应投喂的动机',
        relationToPlayer: '互相信任的友人',
        contactLevel: 42,
        recentAttitude: '亲近而谨慎',
        memories: [{ memoryId: 'secret', source: 'narrative', content: '不应投喂的记忆', createdAt: '公元184年03月01日' }],
      }],
      relationships: [{
        id: 'rel_cai',
        actorId: 'player_1',
        targetId: 'npc_cai',
        targetType: 'actor',
        type: 'friend',
        value: 55,
        description: '彼此已经多次互助',
      }],
      heroineThreads: [{
        heroineThreadId: 'heroine_cai',
        npcId: 'npc_cai',
        npcName: '蔡琰',
        status: 'active',
        stage: '知己',
        relationshipRole: '红颜知己',
        summary: '不应投喂的完整红颜摘要',
        lastUpdatedAt: '公元184年03月08日',
      }],
    } as unknown as RuntimeState;

    const context = buildLetterPolishContext(contextState, contextState.npcs![0]);

    expect(context.worldSummary).toContain('184 黄巾初起');
    expect(context.senderProfile).toContain('林砚（字子衡）');
    expect(context.senderProfile).toContain('20岁');
    expect(context.recipientProfile).toContain('蔡琰（字文姬）');
    expect(context.recipientProfile).toContain('9岁');
    expect(context.relationshipSummary).toContain('互相信任的友人');
    expect(context.relationshipSummary).toContain('往来度 42');
    expect(context.relationshipSummary).toContain('红颜知己/知己');
    expect(JSON.stringify(context)).not.toContain('不应投喂');
  });
});

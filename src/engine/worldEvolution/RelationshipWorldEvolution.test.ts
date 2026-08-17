import { beforeAll, describe, expect, it } from 'vitest';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState, WorldBook } from '../types';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import { initWorldBookRegistry } from '../worldbook/WorldBookLoader';
import { advanceGameClock, formatGameClock, setRuntimeClock } from '../time/gameClock';
import { advanceCorrespondenceState } from '../correspondence';
import {
  applyRelationshipWorldEvolutionPackage,
  executeRelationshipWorldEvolution,
  parseRelationshipWorldEvolutionResponse,
  selectRelationshipWorldEvolutionCandidates,
  type RelationshipWorldEvolutionPackage,
} from './RelationshipWorldEvolution';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '1.4.2',
    worldBookId: 'threeKingdoms',
    worldBookVersion: '1',
    worldBookSource: 'official',
    startDate: '公元184年03月01日 08:00（辰时）',
    currentDate: '公元184年04月20日 08:00（辰时）',
    currentTime: { year: 184, month: 4, day: 20, hour: 8, minute: 0 },
    worldlineSettings: {
      knowledgeMode: 'default',
      knowledgeBaseId: 'threeKingdoms.coreKnowledge.v1',
      storyPackIds: [],
    },
    player: { id: 'player', name: '刘兴', roleType: '游侠', summary: '' },
    currentLocationId: 'place_xiangyang',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    locations: [{
      locationId: 'place_yingchuan',
      name: '颍川',
      type: '郡治',
      summary: '颍川郡治所在。',
      knownLevel: '听闻',
      recentEvents: [],
    }],
    factions: [{
      factionId: 'faction_caocao',
      name: '曹操部',
      type: '军阀',
      summary: '',
      stanceToPlayer: '中立',
      knownLevel: '听闻',
      recentActions: [],
    }],
    npcs: [{
      npcId: 'npc_caocao',
      name: '曹操',
      sex: '男',
      age: 30,
      role: '骑都尉',
      factionId: 'faction_caocao',
      locationId: 'place_yingchuan',
      isPresent: false,
      isFocused: false,
      summary: '正在形成自己的政治与军事班底。',
      appearance: '',
      personality: '果断多疑',
      motivation: '在乱局中建立力量',
      relationToPlayer: '旧识',
      contactLevel: 4,
      recentAttitude: '重视',
      memories: [],
      backgroundActivity: {
        activityId: 'activity_recruit',
        summary: '在颍川招募青壮并延揽人才',
        status: 'active',
        locationId: 'place_yingchuan',
        dueAt: '公元184年04月20日 08:00（辰时）',
        visibility: 'playerKnown',
      },
    }, {
      npcId: 'npc_paused',
      name: '暂停者',
      sex: '男',
      age: 30,
      role: '士人',
      isPresent: false,
      isFocused: false,
      summary: '', appearance: '', personality: '', motivation: '', relationToPlayer: '', contactLevel: 1, recentAttitude: '', memories: [],
    }],
    heroineThreads: [],
    bondThreads: [{
      bondThreadId: 'bond_caocao',
      targetNpcIds: ['npc_caocao'],
      targetNames: ['曹操'],
      bondType: 'ally',
      status: 'active',
      summary: '旧识',
      lastUpdatedAt: '公元184年04月01日 08:00（辰时）',
    }, {
      bondThreadId: 'bond_paused',
      targetNpcIds: ['npc_paused'],
      targetNames: ['暂停者'],
      bondType: 'ally',
      status: 'paused',
      summary: '暂停',
      lastUpdatedAt: '公元184年04月01日 08:00（辰时）',
    }],
  } as RuntimeState);
}

describe('RelationshipWorldEvolution', () => {
  beforeAll(() => {
    initWorldBookRegistry();
  });

  it('只选择活跃关系中到期且不在实际前台的人物，关注标记不再永久阻断', () => {
    const state = makeState();
    const candidates = selectRelationshipWorldEvolutionCandidates(state, '我在襄阳休整');
    expect(candidates.map((item) => item.npcId)).toEqual(['npc_caocao']);
    expect(candidates[0].historicalDirection).toContain('曹操 184-190 阶段惯性');
    expect(selectRelationshipWorldEvolutionCandidates(state, '我写信询问曹操近况')).toEqual([]);
    state.npcs![0].isFocused = true;
    expect(selectRelationshipWorldEvolutionCandidates(state, '继续赶路').map((item) => item.npcId))
      .toEqual(['npc_caocao']);
    expect(selectRelationshipWorldEvolutionCandidates(state, '继续赶路', 3, ['npc_caocao']))
      .toEqual([]);
  });

  it('拒绝未知人物、未知地点和超过30日的下一阶段', () => {
    const state = makeState();
    const candidates = selectRelationshipWorldEvolutionCandidates(state, '我在襄阳休整');
    const parsed = parseRelationshipWorldEvolutionResponse(JSON.stringify({ decisions: [{
      npcId: 'npc_unknown',
      result: 'continue',
      confirmedProgress: '无效',
      nextActivity: { summary: '无效', dueAt: '公元184年04月21日 08:00', visibility: 'hidden' },
    }, {
      npcId: 'npc_caocao',
      result: 'continue',
      confirmedProgress: '完成招募',
      nextActivity: { summary: '前往未知地点', locationId: 'place_unknown', dueAt: '公元184年04月21日 08:00', visibility: 'hidden' },
    }, {
      npcId: 'npc_caocao',
      result: 'continue',
      confirmedProgress: '完成招募',
      nextActivity: { summary: '长期停滞', locationId: 'place_yingchuan', dueAt: '公元184年06月21日 08:00', visibility: 'hidden' },
    }] }), state, candidates);
    expect(parsed.decisions).toEqual([]);
  });

  it('接受世界书种子中的既有地点而不要求先进入运行态地点表', () => {
    const state = makeState();
    const candidates = selectRelationshipWorldEvolutionCandidates(state, '我在襄阳休整');
    const parsed = parseRelationshipWorldEvolutionResponse(JSON.stringify({ decisions: [{
      npcId: 'npc_caocao',
      result: 'continue',
      confirmedProgress: '已完成一轮招募。',
      nextActivity: {
        summary: '转赴陈留联络故旧',
        locationId: 'place_chenliu',
        dueAt: '公元184年04月27日 08:00',
        visibility: 'hidden',
      },
    }] }), state, candidates, {
      manifest: { name: '测试世界' },
      mapSeed: [{ id: 'place_chenliu', name: '陈留', type: 'city', summary: '' }],
    } as unknown as WorldBook);
    expect(parsed.decisions[0]?.nextActivity.locationId).toBe('place_chenliu');
  });

  it('原子写入既有账本且重复应用同一 evaluationId 不会重复', () => {
    const state = makeState();
    const candidates = selectRelationshipWorldEvolutionCandidates(state, '我在襄阳休整');
    const packageValue: RelationshipWorldEvolutionPackage = {
      protocolVersion: 'coc.v2.relationshipWorldEvolution.v1',
      decisions: [{
        npcId: 'npc_caocao',
        result: 'completed',
        confirmedProgress: '已经招募一批青壮。',
        nextActivity: {
          summary: '整编新募青壮并寻访可用士人',
          locationId: 'place_yingchuan',
          dueAt: '公元184年04月27日 08:00（辰时）',
          visibility: 'playerKnown',
        },
        completedMemory: '四月在颍川完成一轮青壮招募。',
        knowledgeDelivery: {
          kind: 'letter',
          summary: '曹操来信说新募青壮正在整编。',
          source: '曹操来信',
          certainty: 'confirmed',
          subject: '颍川募兵近况',
          body: '新募青壮已经入营，眼下正在整队训练。待诸事稍定，再与你详叙。',
        },
        relationshipProgress: { summary: '书信保持联系', milestone: '曹操主动通报募兵进展。' },
        factionAction: { factionId: 'faction_caocao', summary: '在颍川整编新募青壮。', knownLevel: '听闻' },
      }],
    };

    const first = applyRelationshipWorldEvolutionPackage(state, packageValue, candidates);
    const second = applyRelationshipWorldEvolutionPackage(first.state, packageValue, candidates);
    const npc = second.state.npcs!.find((item) => item.npcId === 'npc_caocao')!;
    expect(first.appliedNpcIds).toEqual(['npc_caocao']);
    expect(second.appliedNpcIds).toEqual([]);
    expect(npc.memories).toHaveLength(2);
    expect(npc.presenceUpdates ?? []).toHaveLength(0);
    const letter = second.state.correspondence?.[0];
    expect(letter).toMatchObject({
      direction: 'incoming',
      status: 'inTransit',
      subject: '颍川募兵近况',
    });
    const delivered = advanceCorrespondenceState(second.state, letter!.deliveryDueAt!).state;
    expect(delivered.correspondence?.[0].status).toBe('delivered');
    expect(delivered.npcs?.find((item) => item.npcId === 'npc_caocao')?.presenceUpdates).toHaveLength(1);
    expect(second.state.bondThreads![0].milestones).toHaveLength(1);
    expect(second.state.factions![0].recentActionRecords).toHaveLength(1);
    expect(npc.backgroundActivity?.dueAt).toContain('184年04月27日');
  });

  it('玩家可知的进展即使未显式返回投递字段也会形成可见近况与关系进展', () => {
    const state = makeState();
    const candidates = selectRelationshipWorldEvolutionCandidates(state, '我在襄阳休整');
    const applied = applyRelationshipWorldEvolutionPackage(state, {
      protocolVersion: 'coc.v2.relationshipWorldEvolution.v1',
      decisions: [{
        npcId: 'npc_caocao',
        result: 'continue',
        confirmedProgress: '曹操已完成第一批青壮的编组。',
        nextActivity: {
          summary: '继续训练新募青壮',
          locationId: 'place_yingchuan',
          dueAt: '公元184年04月27日 08:00（辰时）',
          visibility: 'playerKnown',
        },
      }],
    }, candidates);

    const npc = applied.state.npcs!.find((item) => item.npcId === 'npc_caocao')!;
    expect(npc.presenceUpdates?.[0]).toMatchObject({
      summary: '曹操已完成第一批青壮的编组。',
      source: '关系人物近况',
    });
    expect(applied.state.bondThreads![0].recentProgress).toBe('曹操已完成第一批青壮的编组。');
  });

  it('连续替换活动时保持固定长度 ID，且后续评估不会因截断碰撞而停滞', () => {
    let state = makeState();
    const evaluationIds = new Set<string>();

    for (let turn = 0; turn < 60; turn += 1) {
      const candidates = selectRelationshipWorldEvolutionCandidates(state, '我在襄阳休整');
      expect(candidates).toHaveLength(1);
      const candidate = candidates[0];
      expect(evaluationIds.has(candidate.evaluationId)).toBe(false);
      expect(candidate.evaluationId.length).toBeLessThanOrEqual(72);
      evaluationIds.add(candidate.evaluationId);

      const nextClock = advanceGameClock(state.currentTime!, { daysAdvanced: 1 });
      const applied = applyRelationshipWorldEvolutionPackage(state, {
        protocolVersion: 'coc.v2.relationshipWorldEvolution.v1',
        decisions: [{
          npcId: 'npc_caocao',
          result: 'replace',
          confirmedProgress: `完成第${turn + 1}阶段。`,
          nextActivity: {
            summary: `筹备第${turn + 2}阶段事务。`,
            locationId: 'place_yingchuan',
            dueAt: formatGameClock(nextClock),
            visibility: 'playerKnown',
          },
        }],
      }, candidates);
      expect(applied.appliedNpcIds).toEqual(['npc_caocao']);
      state = applied.state;
      const activityId = state.npcs![0].backgroundActivity?.activityId ?? '';
      expect(activityId.length).toBeLessThanOrEqual(80);
      setRuntimeClock(state, nextClock);
    }

    expect(evaluationIds.size).toBe(60);
  });

  it('API 失败时保留主状态事实并按游戏时间退避', async () => {
    const state = makeState();
    const result = await executeRelationshipWorldEvolution({ manifest: { name: '测试世界' } } as WorldBook, state, '我在襄阳休整', {
      apiConfig: {
        id: 'world-evolution-test',
        name: 'test',
        provider: 'openai_compatible',
        baseUrl: 'https://example.com/v1',
        apiKey: 'test',
        model: 'test',
        createdAt: '',
        updatedAt: '',
      } as ApiConfigArchive,
      llmClient: { generate: async () => { throw new Error('timeout'); } },
    });

    expect(result.status).toBe('failed');
    expect(result.state.npcs![0].backgroundActivity?.activityId).toBe('activity_recruit');
    expect(result.state.npcs![0].backgroundEvolutionMeta).toMatchObject({
      consecutiveFailures: 1,
      lastAttemptAt: state.currentDate,
    });
    expect(result.state.npcs![0].backgroundEvolutionMeta?.nextRetryAt).toContain('184年04月21日');
  });
});

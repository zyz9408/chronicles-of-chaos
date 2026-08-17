import { describe, expect, it } from 'vitest';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState } from '../types';
import {
  clearMemorySummaryMaintenance,
  failMemorySummaryMaintenance,
  hasPendingMemorySummaryMaintenance,
  queueMemorySummaryMaintenance,
  shouldRunAutomaticMemorySummaryMaintenance,
  toPlayerSafeMemorySummaryFailureReason,
} from './MemorySummaryMaintenance';

function makeState(): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'memory-maintenance-test',
    worldBookVersion: '1.0.0',
    worldBookSource: 'official',
    startDate: '190-01-01',
    currentDate: '190-01-01',
    player: {
      id: 'player',
      name: 'Tester',
      roleType: 'commoner',
      summary: 'Test',
    },
    currentLocationId: 'loc_test',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
  });
}

describe('MemorySummaryMaintenance', () => {
  it('queues a stable pending task without mutating the source state', () => {
    const source = makeState();
    const queued = queueMemorySummaryMaintenance(source, {
      queuedAt: '2026-07-27T00:00:00.000Z',
      triggerTurnNumber: 20,
    });

    expect(hasPendingMemorySummaryMaintenance(source)).toBe(false);
    expect(queued.memoryArchive?.memorySummaryMaintenance).toEqual({
      status: 'pending',
      queuedAt: '2026-07-27T00:00:00.000Z',
      triggerTurnNumber: 20,
    });

    const queuedAgain = queueMemorySummaryMaintenance(queued, {
      queuedAt: '2026-07-27T01:00:00.000Z',
      triggerTurnNumber: 21,
    });
    expect(queuedAgain.memoryArchive?.memorySummaryMaintenance?.queuedAt)
      .toBe('2026-07-27T00:00:00.000Z');
  });

  it('records only a player-safe failure and clears after success', () => {
    const queued = queueMemorySummaryMaintenance(makeState(), {
      queuedAt: '2026-07-27T00:00:00.000Z',
      triggerTurnNumber: 20,
    });
    const failed = failMemorySummaryMaintenance(queued, {
      attemptedAt: '2026-07-27T00:02:00.000Z',
      reason: 'LLM budget exceeded: auxiliary after 120s at https://secret.example/v1?key=hidden',
    });

    expect(failed.memoryArchive?.memorySummaryMaintenance).toEqual({
      status: 'pending',
      queuedAt: '2026-07-27T00:00:00.000Z',
      triggerTurnNumber: 20,
      lastAttemptAt: '2026-07-27T00:02:00.000Z',
      lastFailureReason: '记忆压缩 API 请求超时，请更换可用 API 或稍后重试。',
    });
    expect(JSON.stringify(failed)).not.toContain('secret.example');
    expect(hasPendingMemorySummaryMaintenance(clearMemorySummaryMaintenance(failed))).toBe(false);
  });

  it('classifies common configuration failures without exposing raw errors', () => {
    expect(toPlayerSafeMemorySummaryFailureReason('429 rate limit exceeded')).toContain('请求受限');
    expect(toPlayerSafeMemorySummaryFailureReason('401 invalid API key')).toContain('鉴权失败');
    expect(toPlayerSafeMemorySummaryFailureReason('memory summary api not configured')).toContain('尚未配置');
    expect(toPlayerSafeMemorySummaryFailureReason('TypeError: Failed to fetch')).toContain('网络连接失败');
    expect(toPlayerSafeMemorySummaryFailureReason('API 请求失败（400）：response_format is unsupported'))
      .toContain('接口或模型不兼容');
    expect(toPlayerSafeMemorySummaryFailureReason('summary result had no valid entries'))
      .toContain('返回格式不符合要求');
    expect(toPlayerSafeMemorySummaryFailureReason('API 请求失败（503）：service unavailable'))
      .toContain('上游服务暂时不可用');
    expect(toPlayerSafeMemorySummaryFailureReason('provider exploded at /private/path')).toBe(
      '记忆压缩 API 请求失败，请检查 API 设置后重试。',
    );
  });

  it('does not automatically retry on the next turn once maintenance is pending', () => {
    const thresholdState = makeState();
    thresholdState.memoryArchive!.recentTurnSummaries = Array.from({ length: 20 }, (_, index) => ({
      id: `recent_${index + 1}`,
      turnNumber: index + 1,
      createdAt: `day ${index + 1}`,
      brief: `brief ${index + 1}`,
      importance: 'medium',
    }));

    expect(shouldRunAutomaticMemorySummaryMaintenance(thresholdState)).toBe(true);
    const pending = queueMemorySummaryMaintenance(thresholdState, {
      queuedAt: '2026-07-27T00:00:00.000Z',
      triggerTurnNumber: 20,
    });
    pending.memoryArchive!.recentTurnSummaries.push({
      id: 'recent_21',
      turnNumber: 21,
      createdAt: 'day 21',
      brief: 'next turn',
      importance: 'medium',
    });

    expect(shouldRunAutomaticMemorySummaryMaintenance(pending)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { buildFailedTurnProcessingAttempt } from './turnProcessingAttempt';

describe('turnProcessingAttempt', () => {
  it('closes the active stage when an uncommitted turn fails', () => {
    const attempt = buildFailedTurnProcessingAttempt({
      actionText: '继续查问粮仓',
      error: new Error('写回 API 超时'),
      events: [{
        stage: 'repairingStateWriteback',
        label: '整理状态写回',
        status: 'started',
        startedAt: '2026-08-02T00:00:00.000Z',
        model: 'flash',
      }],
      fallbackStage: 'generatingNarrative',
      fallbackLabel: '准备回合上下文',
      failedAt: '2026-08-02T00:00:12.000Z',
    });

    expect(attempt.processingStages).toHaveLength(2);
    expect(attempt.processingStages[1]).toMatchObject({
      stage: 'repairingStateWriteback',
      label: '整理状态写回',
      status: 'failed',
      elapsedMs: 12_000,
      detail: '写回 API 超时',
      model: 'flash',
    });
  });

  it('keeps an existing provider failure without inventing a duplicate stage', () => {
    const attempt = buildFailedTurnProcessingAttempt({
      actionText: '向前赶路',
      error: new Error('API 返回 503'),
      events: [{
        stage: 'generatingNarrative',
        label: '生成正文',
        status: 'failed',
        elapsedMs: 8_000,
        detail: 'API 返回 503',
      }],
      fallbackStage: 'generatingNarrative',
      fallbackLabel: '准备回合上下文',
      failedAt: '2026-08-02T00:00:08.000Z',
    });

    expect(attempt.processingStages).toHaveLength(1);
    expect(attempt.error).toBe('API 返回 503');
  });

  it('creates a visible preparation failure when the API fails before stage callbacks begin', () => {
    const attempt = buildFailedTurnProcessingAttempt({
      actionText: '出城巡查',
      error: '主剧情 API 未配置',
      events: [],
      fallbackStage: 'generatingNarrative',
      fallbackLabel: '准备回合上下文',
      failedAt: '2026-08-02T00:00:00.000Z',
    });

    expect(attempt.processingStages).toEqual([expect.objectContaining({
      stage: 'generatingNarrative',
      label: '准备回合上下文',
      status: 'failed',
      detail: '主剧情 API 未配置',
    })]);
  });
});

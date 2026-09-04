import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  collapseProcessingStageEvents,
  sanitizeProcessingStageDetail,
  TurnProcessingTrace,
} from './TurnProcessingTrace';

describe('TurnProcessingTrace', () => {
  it('collapses paired start and finish events while preserving repeated attempts', () => {
    const rows = collapseProcessingStageEvents([
      {
        stage: 'repairingStateWriteback',
        label: '整理状态写回',
        status: 'started',
        startedAt: '2026-08-01T00:00:00.000Z',
        model: 'flash',
      },
      {
        stage: 'repairingStateWriteback',
        label: '整理状态写回',
        status: 'failed',
        startedAt: '2026-08-01T00:00:00.000Z',
        elapsedMs: 4_000,
        detail: 'API 返回缺少正文内容',
        model: 'flash',
      },
      {
        stage: 'repairingStateWriteback',
        label: '整理状态写回（空输出重试）',
        status: 'started',
        startedAt: '2026-08-01T00:00:04.000Z',
        model: 'flash',
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: 'failed', elapsedMs: 4_000 });
    expect(rows[1]).toMatchObject({ status: 'started', label: '整理状态写回（空输出重试）' });
  });

  it('shows stage duration, model and the safe failing detail', () => {
    const html = renderToStaticMarkup(
      <TurnProcessingTrace
        events={[
          {
            stage: 'generatingNarrative',
            label: '生成正文',
            status: 'finished',
            startedAt: '2026-08-01T00:00:00.000Z',
            elapsedMs: 8_500,
            provider: 'deepseek',
            model: 'deepseek-v4-pro',
            usage: {
              promptTokens: 10_000,
              completionTokens: 1_200,
              cacheReadTokens: 8_000,
              cacheMissTokens: 2_000,
            },
          },
          {
            stage: 'repairingStateWriteback',
            label: '整理状态写回',
            status: 'failed',
            elapsedMs: 1_500,
            detail: 'API 返回缺少正文内容',
            model: 'deepseek-v4-flash',
          },
        ]}
      />,
    );

    expect(html).toContain('8s');
    expect(html).toContain('deepseek-v4-pro');
    expect(html).toContain('输入 10,000 tokens');
    expect(html).toContain('缓存命中 8,000');
    expect(html).toContain('命中率 80.0%');
    expect(html).toContain('API 返回缺少正文内容');
    expect(html).toContain('不展示完整提示词、密钥或模型隐藏思维链');
  });

  it('shows retrieval-specific usage without a misleading zero output count', () => {
    const html = renderToStaticMarkup(<TurnProcessingTrace events={[{
      stage: 'retrievingMemory', label: '检索相关记忆', status: 'finished',
      usage: { promptTokens: 12, completionTokens: 0 },
      memoryRetrieval: {
        status: 'vector', totalHitCount: 3, vectorHitCount: 2, localHitCount: 1,
        candidateCount: 9, indexDeltaCount: 2, indexEmbeddedCount: 2,
      },
    }]} />);
    expect(html).toContain('向量输入 12 tokens');
    expect(html).toContain('向量召回 · 总命中 3 · 向量命中 2 · 本地召回 1');
    expect(html).toContain('候选 9 · 索引新增/更新 2');
    expect(html).not.toContain('输出 0 tokens');
  });

  it('redacts credentials from provider errors before rendering them', () => {
    const safe = sanitizeProcessingStageDetail(
      '401 Authorization: Bearer sk-secret-value apiKey: "tp-secret-value"',
    );

    expect(safe).not.toContain('sk-secret-value');
    expect(safe).not.toContain('tp-secret-value');
    expect(safe).toContain('已隐藏');
  });

  it('can open a retained failed-attempt trace immediately', () => {
    const html = renderToStaticMarkup(
      <TurnProcessingTrace
        compact
        defaultOpen
        title="最近失败的 AI 处理轨迹"
        currentLabel="未写入存档 · 可随诊断导出一并复制"
        events={[{
          stage: 'saving',
          label: '保存回合与快照',
          status: 'failed',
          detail: '存档提交失败',
        }]}
      />,
    );

    expect(html).toContain('<details');
    expect(html).toContain('open=""');
    expect(html).toContain('最近失败的 AI 处理轨迹');
    expect(html).toContain('未写入存档');
  });
});

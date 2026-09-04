import { useEffect, useMemo, useState } from 'react';
import type { TurnProcessingStageEvent } from '../engine/types';
import {
  formatElapsedTime,
  formatTokenCount,
  getPromptCacheHitRate,
} from '../engine/turn/turnDisplay';

export interface TurnProcessingTraceRow extends TurnProcessingStageEvent {
  rowKey: string;
}

export function collapseProcessingStageEvents(
  events: TurnProcessingStageEvent[],
): TurnProcessingTraceRow[] {
  const rows: TurnProcessingTraceRow[] = [];

  for (const [eventIndex, event] of events.entries()) {
    if (event.status === 'started') {
      rows.push({ ...event, rowKey: buildRowKey(event, eventIndex) });
      continue;
    }

    const startedIndex = findMatchingStartedRow(rows, event);
    if (startedIndex >= 0) {
      rows[startedIndex] = {
        ...rows[startedIndex],
        ...event,
      };
    } else {
      rows.push({ ...event, rowKey: buildRowKey(event, eventIndex) });
    }
  }

  return rows;
}

export function TurnProcessingTrace({
  events,
  currentLabel,
  compact = false,
  title = 'AI 处理轨迹',
  defaultOpen = false,
}: {
  events: TurnProcessingStageEvent[];
  currentLabel?: string;
  compact?: boolean;
  title?: string;
  defaultOpen?: boolean;
}) {
  const [clock, setClock] = useState(() => Date.now());
  const rows = useMemo(() => collapseProcessingStageEvents(events), [events]);
  const hasRunningStage = rows.some((row) => row.status === 'started');

  useEffect(() => {
    if (!hasRunningStage) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasRunningStage]);

  const content = rows.length ? (
    <ol className="turn-processing-trace-list" data-testid="turn-processing-trace-list">
      {rows.map((row) => {
        const elapsedMs = resolveElapsedMs(row, clock);
        const usageSummary = formatStageUsage(row);
        return (
          <li key={row.rowKey} data-status={row.status}>
            <span className="turn-processing-trace-dot" aria-hidden="true" />
            <div>
              <strong>{row.label}</strong>
              <small>
                {formatStageStatus(row.status)}
                {typeof elapsedMs === 'number' ? ` · ${formatElapsedTime(elapsedMs)}` : ''}
                {row.model ? ` · ${row.model}` : ''}
              </small>
              {usageSummary ? <small>{usageSummary}</small> : null}
              {row.detail ? <p>{sanitizeProcessingStageDetail(row.detail)}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  ) : (
    <p className="turn-processing-trace-empty">尚无可展示的处理阶段。</p>
  );

  if (!compact) {
    return (
      <section className="turn-processing-trace" aria-label="AI 处理轨迹">
        <p className="turn-processing-trace-note">
          这里显示真实处理阶段、耗时与安全错误信息；不展示完整提示词、密钥或模型隐藏思维链。
        </p>
        {content}
      </section>
    );
  }

  return (
    <details
      className="processing-stage-box turn-processing-trace-compact"
      data-testid="processing-stage-box"
      open={defaultOpen}
    >
      <summary>
        <span>{title}</span>
        <small>{currentLabel || '查看各阶段耗时与状态'}</small>
      </summary>
      {content}
    </details>
  );
}

function findMatchingStartedRow(
  rows: TurnProcessingTraceRow[],
  event: TurnProcessingStageEvent,
): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const candidate = rows[index];
    if (candidate.status !== 'started') continue;
    if (candidate.stage !== event.stage || candidate.label !== event.label) continue;
    if (event.startedAt && candidate.startedAt && event.startedAt !== candidate.startedAt) continue;
    if (candidate.model !== event.model || candidate.provider !== event.provider) continue;
    return index;
  }
  return -1;
}

function buildRowKey(event: TurnProcessingStageEvent, eventIndex: number): string {
  return [event.stage, event.label, event.startedAt ?? 'legacy', event.model ?? '', eventIndex].join(':');
}

function resolveElapsedMs(row: TurnProcessingTraceRow, now: number): number | undefined {
  if (typeof row.elapsedMs === 'number') return row.elapsedMs;
  if (row.status !== 'started' || !row.startedAt) return undefined;
  const startedAt = Date.parse(row.startedAt);
  if (!Number.isFinite(startedAt)) return undefined;
  return Math.max(0, now - startedAt);
}

function formatStageStatus(status: TurnProcessingStageEvent['status']): string {
  if (status === 'started') return '正在执行';
  if (status === 'finished') return '已完成';
  if (status === 'failed') return '失败';
  return '已跳过';
}

function formatStageUsage(event: TurnProcessingStageEvent): string | undefined {
  if (event.stage === 'retrievingMemory') return formatMemoryRetrievalUsage(event);
  const usage = event.usage;
  if (!usage) return undefined;

  const parts: string[] = [];
  if (typeof usage.promptTokens === 'number') {
    parts.push(`输入 ${formatTokenCount(usage.promptTokens)} tokens`);
  }
  if (typeof usage.completionTokens === 'number') {
    parts.push(`输出 ${formatTokenCount(usage.completionTokens)} tokens`);
  }
  if (typeof usage.cacheReadTokens === 'number') {
    parts.push(`缓存命中 ${formatTokenCount(usage.cacheReadTokens)}`);
  }
  if (typeof usage.cacheWriteTokens === 'number') {
    parts.push(`缓存写入 ${formatTokenCount(usage.cacheWriteTokens)}`);
  }
  if (typeof usage.cacheMissTokens === 'number') {
    parts.push(`缓存未命中 ${formatTokenCount(usage.cacheMissTokens)}`);
  }

  const hitRate = getPromptCacheHitRate({
    provider: event.provider,
    ...usage,
  });
  if (typeof hitRate === 'number') {
    parts.push(`命中率 ${(hitRate * 100).toFixed(1)}%`);
  }

  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function formatMemoryRetrievalUsage(event: TurnProcessingStageEvent): string | undefined {
  const parts: string[] = [];
  if (typeof event.usage?.promptTokens === 'number') {
    parts.push(`向量输入 ${formatTokenCount(event.usage.promptTokens)} tokens`);
  }
  const retrieval = event.memoryRetrieval;
  if (retrieval) {
    parts.push(retrieval.status === 'vector' ? '向量召回' : retrieval.status === 'localFallback' ? '本地召回' : '本地回退');
    parts.push(`总命中 ${retrieval.totalHitCount}`);
    if (retrieval.vectorHitCount > 0) parts.push(`向量命中 ${retrieval.vectorHitCount}`);
    if (retrieval.localHitCount > 0) parts.push(`本地召回 ${retrieval.localHitCount}`);
    if (typeof retrieval.candidateCount === 'number') parts.push(`候选 ${retrieval.candidateCount}`);
    if (retrieval.indexDeltaCount === 0) parts.push('索引无更新');
    else if (typeof retrieval.indexEmbeddedCount === 'number' && retrieval.indexEmbeddedCount > 0) {
      parts.push(`索引新增/更新 ${retrieval.indexEmbeddedCount}`);
    } else if (typeof retrieval.indexDeltaCount === 'number') parts.push(`待索引 ${retrieval.indexDeltaCount}`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function sanitizeProcessingStageDetail(detail: string): string {
  return detail
    .replace(/\bAuthorization\s*:\s*Bearer\s+[^"',\s}]+/gi, '[已隐藏鉴权信息]')
    .replace(/\bBearer\s+[^"',\s}]+/gi, '[已隐藏鉴权信息]')
    .replace(/\b(?:sk|tp)-[A-Za-z0-9._-]+/gi, '[已隐藏密钥]')
    .replace(/"?(?:x-api-key|apiKey)"?\s*:\s*"[^"]*"/gi, '[已隐藏密钥字段]')
    .slice(0, 500);
}

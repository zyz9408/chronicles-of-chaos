import type { RuntimeState, TurnLogEntry } from '../types';

export type StoryExportRange = 'latestTurn' | 'all';
export type StoryExportFormat = 'markdown' | 'text' | 'html';

export interface StoryExportOptions {
  range: StoryExportRange;
  format: StoryExportFormat;
  includeDates: boolean;
  includePlayerActions: boolean;
}

export interface StoryExportArtifact {
  content: string;
  fileName: string;
  mimeType: string;
  turnCount: number;
}

const FORMAT_META: Record<StoryExportFormat, { extension: string; mimeType: string }> = {
  markdown: { extension: 'md', mimeType: 'text/markdown;charset=utf-8' },
  text: { extension: 'txt', mimeType: 'text/plain;charset=utf-8' },
  html: { extension: 'html', mimeType: 'text/html;charset=utf-8' },
};

function selectTurns(state: RuntimeState, range: StoryExportRange): TurnLogEntry[] {
  const turns = state.turnLog.filter((turn) => (turn.fullNarrativeText || turn.narrativeText || '').trim().length > 0);
  if (range === 'all' || turns.length === 0) return turns;
  const latestTurnNumber = turns[turns.length - 1].turnNumber;
  return turns.filter((turn) => turn.turnNumber === latestTurnNumber);
}

function displayPlayerInput(playerInput: string): string {
  const value = playerInput.trim();
  return value.startsWith('[true opening generation]') ? '' : value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeFilePart(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim() || '未命名';
}

function formatMarkdown(turns: TurnLogEntry[], state: RuntimeState, options: StoryExportOptions): string {
  const body = turns.map((turn) => {
    const lines = [`## 第 ${turn.turnNumber} 回合`];
    if (options.includeDates && turn.date.trim()) lines.push(`*${turn.date.trim()}*`);
    const action = displayPlayerInput(turn.playerInput);
    if (options.includePlayerActions && action) lines.push(`> 玩家行动：${action}`);
    lines.push((turn.fullNarrativeText || turn.narrativeText).trim());
    return lines.join('\n\n');
  });

  return [`# 乱世风云录 · ${state.player.name}剧情记录`, '', ...body].join('\n\n').trimEnd() + '\n';
}

function formatText(turns: TurnLogEntry[], state: RuntimeState, options: StoryExportOptions): string {
  const body = turns.map((turn) => {
    const lines = [`第 ${turn.turnNumber} 回合`];
    if (options.includeDates && turn.date.trim()) lines.push(turn.date.trim());
    const action = displayPlayerInput(turn.playerInput);
    if (options.includePlayerActions && action) lines.push(`玩家行动：${action}`);
    lines.push((turn.fullNarrativeText || turn.narrativeText).trim());
    return lines.join('\n');
  });

  return [`乱世风云录 · ${state.player.name}剧情记录`, ...body].join('\n\n').trimEnd() + '\n';
}

function formatHtml(turns: TurnLogEntry[], state: RuntimeState, options: StoryExportOptions): string {
  const sections = turns.map((turn) => {
    const action = displayPlayerInput(turn.playerInput);
    const date = options.includeDates && turn.date.trim()
      ? `<p class="story-date">${escapeHtml(turn.date.trim())}</p>`
      : '';
    const playerAction = options.includePlayerActions && action
      ? `<blockquote><strong>玩家行动：</strong>${escapeHtml(action)}</blockquote>`
      : '';
    const narrative = escapeHtml((turn.fullNarrativeText || turn.narrativeText).trim()).replace(/\r?\n/g, '<br>');
    return `<section><h2>第 ${turn.turnNumber} 回合</h2>${date}${playerAction}<div class="narrative">${narrative}</div></section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>乱世风云录 · ${escapeHtml(state.player.name)}剧情记录</title>
<style>
body{max-width:920px;margin:0 auto;padding:40px 28px;background:#0a0c10;color:#e8dfca;font:18px/1.9 "Noto Serif SC","Songti SC",serif}
h1,h2{color:#e5c45d}h1{border-bottom:1px solid #6b5120;padding-bottom:18px}section{margin:36px 0}
.story-date{color:#978b74;font-size:14px}blockquote{margin:18px 0;padding:12px 16px;border-left:3px solid #b88a2a;background:#11151b;color:#cfc5ad}
.narrative{white-space:normal}
</style>
</head>
<body><h1>乱世风云录 · ${escapeHtml(state.player.name)}剧情记录</h1>${sections}</body>
</html>`;
}

export function countStoryExportTurns(state: RuntimeState, range: StoryExportRange): number {
  return selectTurns(state, range).length;
}

export function createStoryExport(state: RuntimeState, options: StoryExportOptions): StoryExportArtifact {
  const turns = selectTurns(state, options.range);
  const formatMeta = FORMAT_META[options.format];
  const content = options.format === 'markdown'
    ? formatMarkdown(turns, state, options)
    : options.format === 'html'
      ? formatHtml(turns, state, options)
      : formatText(turns, state, options);
  const latestTurn = turns[turns.length - 1]?.turnNumber ?? 0;
  const rangeLabel = options.range === 'latestTurn' ? `第${latestTurn}回合` : `全${turns.length}回合`;

  return {
    content,
    fileName: `${safeFilePart(state.player.name)}-乱世风云录-${rangeLabel}.${formatMeta.extension}`,
    mimeType: formatMeta.mimeType,
    turnCount: turns.length,
  };
}

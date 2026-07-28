import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { StoryExportPanel } from './StoryExportPanel';

const runtimeState = {
  player: { name: '刘平' },
  turnLog: [{
    turnNumber: 1,
    date: '公元194年05月01日 08:30',
    playerInput: '巡视营寨',
    narrativeText: '营门肃静。',
    fullNarrativeText: '营门肃静，军士列队。',
    statePatchSummary: '',
    timestamp: '2026-07-25T00:00:00.000Z',
  }],
} as RuntimeState;

describe('StoryExportPanel', () => {
  it('presents player-visible story export independently from diagnostics', () => {
    const onDownload = vi.fn();
    const markup = renderToStaticMarkup(
      <StoryExportPanel runtimeState={runtimeState} onClose={vi.fn()} onDownload={onDownload} />,
    );

    expect(markup).toContain('aria-label="导出剧情"');
    expect(markup).toContain('只导出玩家已经看到的正文与行动');
    expect(markup).toContain('生成并下载');
    expect(onDownload).not.toHaveBeenCalled();
  });
});

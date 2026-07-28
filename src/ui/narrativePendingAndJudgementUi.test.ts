import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  NarrativeLiveLoader,
  formatProcessingStageText,
  isNarrativeScrollNearBottom,
} from './GameScreen';
import { appendSuggestedActionToInput } from './suggestedActionInput';

describe('narrative pending and judgement UI behavior', () => {
  it('renders an accessible pending narrative loader', () => {
    const markup = renderToStaticMarkup(createElement(NarrativeLiveLoader));

    expect(markup).toContain('data-testid="narrative-live-loader"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="正在生成正文"');
    expect(markup).toContain('class="scroll-loader"');
  });

  it('formats processing stage outcomes with elapsed time and diagnostic detail', () => {
    expect(formatProcessingStageText({
      stage: 'generatingNarrative',
      label: '生成正文',
      status: 'started',
    })).toBe('生成正文');
    expect(formatProcessingStageText({
      stage: 'generatingNarrative',
      label: '生成正文',
      status: 'failed',
      elapsedMs: 1500,
      detail: '连接中断',
    })).toBe('生成正文失败，耗时 1s：连接中断');
  });

  it('appends the full suggested action description to existing input', () => {
    expect(appendSuggestedActionToInput('先观察四周', {
      label: '上前询问',
      description: '向守门人询问城中近况',
    })).toBe('先观察四周；向守门人询问城中近况');
  });

  it('keeps narrative auto-follow behind the near-bottom threshold', () => {
    expect(isNarrativeScrollNearBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 552 })).toBe(true);
    expect(isNarrativeScrollNearBottom({ scrollHeight: 1000, clientHeight: 400, scrollTop: 551 })).toBe(false);
  });
});

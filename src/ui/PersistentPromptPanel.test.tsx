import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PersistentPromptPanel } from './PersistentPromptPanel';

describe('PersistentPromptPanel', () => {
  it('renders a stable manager with per-entry enable controls', () => {
    const markup = renderToStaticMarkup(
      <PersistentPromptPanel
        entries={[
          { id: 'one', content: '减少八股套话', enabled: true },
          { id: 'two', content: '人物说话更有个性', enabled: false },
        ]}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="永久提示词"');
    expect(markup).toContain('已启用 1/2 条');
    expect(markup).toContain('减少八股套话');
    expect(markup).toContain('人物说话更有个性');
    expect(markup).toContain('新增并启用');
    expect(markup).toContain('删除永久提示词 1');
  });
});

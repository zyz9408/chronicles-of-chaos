import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MobileActionEditor } from './MobileActionEditor';

describe('MobileActionEditor', () => {
  it('renders a compact accessible trigger without opening the editor eagerly', () => {
    const markup = renderToStaticMarkup(
      <MobileActionEditor value="" onConfirm={vi.fn()} />,
    );

    expect(markup).toContain('aria-label="打开行动编辑器"');
    expect(markup).toContain('点击打开大输入框编辑行动');
    expect(markup).toContain('输入你的行动……');
    expect(markup).not.toContain('role="dialog"');
  });

  it('shows the current draft and respects disabled processing state', () => {
    const markup = renderToStaticMarkup(
      <MobileActionEditor value="前往官署查问军粮" disabled onConfirm={vi.fn()} />,
    );

    expect(markup).toContain('前往官署查问军粮');
    expect(markup).toContain('disabled=""');
  });
});

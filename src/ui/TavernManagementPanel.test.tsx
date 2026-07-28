import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TavernManagementPanel } from './TavernManagementPanel';

describe('TavernManagementPanel', () => {
  it('renders the required library, editor, CoT and preview tabs', () => {
    const markup = renderToStaticMarkup(<TavernManagementPanel />);
    expect(markup).toContain('酒馆预设与 CoT');
    expect(markup).toContain('预设库');
    expect(markup).toContain('条目管理');
    expect(markup).toContain('自定义 CoT');
    expect(markup).toContain('注入预览');
    expect(markup).toContain('启用当前酒馆预设');
  });
});

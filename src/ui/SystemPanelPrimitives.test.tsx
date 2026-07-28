import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  PanelEmptyState,
  PanelListDetailLayout,
  PanelMetricGrid,
  PanelNotice,
  SystemModalFrame,
} from './SystemPanelPrimitives';

describe('SystemPanelPrimitives', () => {
  it('renders the shared modal shell without changing the established class contract', () => {
    const html = renderToStaticMarkup(
      <SystemModalFrame
        title="人物志"
        subtitle="人物档案"
        ariaLabel="人物志"
        onClose={() => undefined}
        className="npc-panel-modal"
        workspace
        testId="npc-panel"
      >
        <PanelNotice>说明</PanelNotice>
      </SystemModalFrame>,
    );

    expect(html).toContain('class="system-modal-backdrop"');
    expect(html).toContain('class="system-modal ui-system-modal ui-system-workspace npc-panel-modal"');
    expect(html).toContain('class="system-modal-head ui-modal-header"');
    expect(html).toContain('class="system-modal-close ui-panel-close"');
    expect(html).toContain('data-testid="npc-panel"');
  });

  it('renders list/detail, metric, notice and empty-state primitives with scoped hooks', () => {
    const html = renderToStaticMarkup(
      <PanelListDetailLayout aria-label="势力布局">
        <PanelMetricGrid rows={[{ key: 'count', label: '已知势力', value: '3' }]} />
        <PanelEmptyState>暂无记录</PanelEmptyState>
      </PanelListDetailLayout>,
    );

    expect(html).toContain('strategic-archive-layout ui-list-detail');
    expect(html).toContain('strategic-metric-grid ui-metric-grid');
    expect(html).toContain('<span>已知势力</span><strong>3</strong>');
    expect(html).toContain('muted ui-panel-empty');
  });
});

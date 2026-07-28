import { describe, expect, it } from 'vitest';
import gameScreenSource from './GameScreen.tsx?raw';
import progressiveVisualSource from './ProgressivePanelVisual.tsx?raw';
import { readUiStyleSource } from './readUiStyleSource.test-helper';

describe('Batch 5 strategic panel layout contracts', () => {
  it('keeps faction, holding, and troop panels inside the stable workspace shell', async () => {
    const css = await readUiStyleSource();

    expect(gameScreenSource).toContain('strategic-modal strategic-modal--factions');
    expect(gameScreenSource).toContain('strategic-modal strategic-modal--holdings');
    expect(gameScreenSource).toContain('strategic-modal strategic-modal--troops');
    expect((gameScreenSource.match(/system-modal ui-system-workspace strategic-modal/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(css).toContain('.system-modal.ui-system-workspace {');
    expect(css).toContain('height: min(820px, calc(100dvh - 7.4rem));');
    expect(css).toContain('overflow: hidden;');
    expect(css).toContain('.faction-command-card {');
    expect(css).toContain('height: 6.25rem;');
  });

  it('keeps strategic images in reserved 16:9 slots with an in-place retry', async () => {
    const css = await readUiStyleSource();

    expect(css).toContain('.holding-scenic-panel {');
    expect(css).toContain('.troop-visual-panel {');
    expect((css.match(/aspect-ratio: 16 \/ 9;/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(progressiveVisualSource).toContain('data-visual-state={state.status}');
    expect(progressiveVisualSource).toContain('className="panel-visual-retry"');
    expect(progressiveVisualSource).toContain('重试载入');
  });

  it('prioritizes collection gaps and siege supply without restoring retired fake stores', () => {
    expect(gameScreenSource).toContain('理论产出、实征与差额');
    expect(gameScreenSource).toContain('围城与补给');
    expect(gameScreenSource).toContain('管辖与行政');
    expect(gameScreenSource).not.toContain('管辖与府库');
    expect(gameScreenSource).not.toContain('本地府库');
    expect(gameScreenSource).not.toContain('本地粮仓');
  });
});

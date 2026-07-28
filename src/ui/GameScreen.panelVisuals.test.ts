import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProgressivePanelVisual } from './ProgressivePanelVisual';
import progressiveVisualSource from './ProgressivePanelVisual.tsx?raw';
import {
  shouldLoadHoldingVisualAsset,
  shouldLoadTroopVisualAsset,
} from './panelVisualAssetLoader';

describe('GameScreen panel visual loading behavior', () => {
  it('loads visuals only for the visible eligible panel candidate', () => {
    expect(shouldLoadHoldingVisualAsset(null, 'controlledHoldings', 'holding_key')).toBe(false);
    expect(shouldLoadHoldingVisualAsset('holdings', 'overview', 'holding_key')).toBe(false);
    expect(shouldLoadHoldingVisualAsset('holdings', 'controlledHoldings', 'holding_key')).toBe(true);
    expect(shouldLoadTroopVisualAsset(null, 'troop_key')).toBe(false);
    expect(shouldLoadTroopVisualAsset('troops', 'troop_key')).toBe(true);
  });

  it('renders the shared loader with a stable idle placeholder and preserved labels', () => {
    const loadManifest = vi.fn(async () => ({}));
    const holdingMarkup = renderToStaticMarkup(createElement(ProgressivePanelVisual, {
      variant: 'holding',
      eligible: false,
      assetKey: 'holding_key',
      loadManifest,
      alt: '',
      'aria-label': '许昌领地示意',
      'data-testid': 'holding-visual-state',
    }));
    const troopMarkup = renderToStaticMarkup(createElement(ProgressivePanelVisual, {
      variant: 'troop',
      eligible: false,
      assetKey: 'troop_key',
      loadManifest,
      alt: '精锐步兵',
      caption: '中型精锐步兵',
      'aria-label': '部队示意',
      'data-testid': 'troop-visual-state',
    }));

    expect(holdingMarkup).toContain('data-testid="holding-visual-state"');
    expect(holdingMarkup).toContain('data-visual-state="idle"');
    expect(holdingMarkup).toContain('aria-label="许昌领地示意"');
    expect(holdingMarkup).toContain('图像载入中');
    expect(troopMarkup).toContain('data-testid="troop-visual-state"');
    expect(troopMarkup).toContain('data-visual-state="idle"');
    expect(troopMarkup).toContain('aria-label="部队示意"');
    expect(troopMarkup).toContain('中型精锐步兵');
    expect(loadManifest).not.toHaveBeenCalled();
  });

  it('keeps an in-place retry control for visual load failures', () => {
    expect(progressiveVisualSource).toContain("state.status === 'load-error'");
    expect(progressiveVisualSource).toContain('className="panel-visual-retry"');
    expect(progressiveVisualSource).toContain('重试载入');
    expect(progressiveVisualSource).toContain('controllerRef.current?.request(assetKey, loadManifest)');
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  createPanelVisualAssetController,
  shouldLoadHoldingVisualAsset,
  shouldLoadTroopVisualAsset,
  type PanelVisualAssetEntry,
  type PanelVisualAssetLoadState,
  type PanelVisualAssetManifest,
} from './panelVisualAssetLoader';

const holdingKey = 'holding_scene_region_central_normal_medium_v01.png';
const troopKey = 'troop_force_infantry_medium_elite_v01.png';

function makeEntry(key: string): PanelVisualAssetEntry {
  return {
    sourceKey: key,
    thumbnail: { url: `/generated/${key}.thumbnail.webp`, width: 320, height: 180 },
    display: { url: `/generated/${key}.display.webp`, width: 1280, height: 720 },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('panel visual asset gates', () => {
  it('keeps closed panels and the holdings overview from importing manifests', () => {
    expect(shouldLoadHoldingVisualAsset(null, 'controlledHoldings', holdingKey)).toBe(false);
    expect(shouldLoadHoldingVisualAsset('holdings', 'overview', holdingKey)).toBe(false);
    expect(shouldLoadHoldingVisualAsset('holdings', 'controlledHoldings', null)).toBe(false);
    expect(shouldLoadTroopVisualAsset(null, troopKey)).toBe(false);
    expect(shouldLoadTroopVisualAsset('holdings', troopKey)).toBe(false);
  });

  it('opens only for the visible panel and a selected candidate', () => {
    expect(shouldLoadHoldingVisualAsset('holdings', 'controlledHoldings', holdingKey)).toBe(true);
    expect(shouldLoadTroopVisualAsset('troops', troopKey)).toBe(true);
  });
});

describe('panel visual asset controller', () => {
  it('loads only the selected manifest entry and reaches display-ready', async () => {
    const states: PanelVisualAssetLoadState[] = [];
    const selected = makeEntry(holdingKey);
    const unrelated = makeEntry('holding_scene_region_north_normal_medium_v01.png');
    const loadManifest = vi.fn(async (): Promise<PanelVisualAssetManifest> => ({
      [holdingKey]: selected,
      [unrelated.sourceKey]: unrelated,
    }));
    const controller = createPanelVisualAssetController((state) => states.push(state));

    await controller.request(holdingKey, loadManifest);
    controller.handleImageEvent(holdingKey, 'thumbnail-ready');
    controller.handleImageEvent(holdingKey, 'display-ready');

    expect(loadManifest).toHaveBeenCalledTimes(1);
    expect(states[states.length - 1]).toEqual({ status: 'display-ready', assetKey: holdingKey, asset: selected });
    expect(states.some((state) => 'asset' in state && state.asset?.sourceKey === unrelated.sourceKey)).toBe(false);
  });

  it('ignores stale manifest completion after the candidate changes', async () => {
    const states: PanelVisualAssetLoadState[] = [];
    const first = deferred<PanelVisualAssetManifest>();
    const second = deferred<PanelVisualAssetManifest>();
    const firstKey = holdingKey;
    const secondKey = 'holding_scene_region_north_normal_medium_v01.png';
    const controller = createPanelVisualAssetController((state) => states.push(state));

    const firstRequest = controller.request(firstKey, () => first.promise);
    const secondRequest = controller.request(secondKey, () => second.promise);
    second.resolve({ [secondKey]: makeEntry(secondKey) });
    await secondRequest;
    first.resolve({ [firstKey]: makeEntry(firstKey) });
    await firstRequest;

    expect(states[states.length - 1]).toMatchObject({ status: 'loading', assetKey: secondKey });
    expect(states[states.length - 1]).not.toMatchObject({ assetKey: firstKey });
  });

  it('separates missing entries from manifest rejection and supports retry', async () => {
    const states: PanelVisualAssetLoadState[] = [];
    const controller = createPanelVisualAssetController((state) => states.push(state));

    await controller.request(holdingKey, async () => ({}));
    expect(states[states.length - 1]).toEqual({ status: 'missing', assetKey: holdingKey });

    await controller.request(holdingKey, async () => { throw new Error('chunk unavailable'); });
    expect(states[states.length - 1]).toMatchObject({ status: 'load-error', assetKey: holdingKey, source: 'manifest' });

    await controller.request(holdingKey, async () => ({ [holdingKey]: makeEntry(holdingKey) }));
    expect(states[states.length - 1]).toMatchObject({ status: 'loading', assetKey: holdingKey });
  });

  it('distinguishes thumbnail and display load failures and clears to idle', async () => {
    const states: PanelVisualAssetLoadState[] = [];
    const controller = createPanelVisualAssetController((state) => states.push(state));
    const manifest = { [holdingKey]: makeEntry(holdingKey) };

    await controller.request(holdingKey, async () => manifest);
    controller.handleImageEvent(holdingKey, 'thumbnail-error');
    expect(states[states.length - 1]).toMatchObject({ status: 'load-error', source: 'thumbnail' });

    await controller.request(holdingKey, async () => manifest);
    controller.handleImageEvent(holdingKey, 'display-error');
    expect(states[states.length - 1]).toMatchObject({ status: 'load-error', source: 'display' });

    controller.reset();
    expect(states[states.length - 1]).toEqual({ status: 'idle' });
  });
});

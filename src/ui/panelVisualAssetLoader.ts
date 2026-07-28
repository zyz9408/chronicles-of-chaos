export interface PanelVisualAssetImage {
  url: string;
  width: number;
  height: number;
}

export interface PanelVisualAssetEntry {
  sourceKey: string;
  thumbnail: PanelVisualAssetImage;
  display: PanelVisualAssetImage;
}

export type PanelVisualAssetManifest = Record<string, PanelVisualAssetEntry>;

export interface ResponsiveVisualAssetEntry {
  sourceKey: string;
  mobile: PanelVisualAssetImage;
  display: PanelVisualAssetImage;
}

export type ResponsiveVisualAssetManifest = Record<string, ResponsiveVisualAssetEntry>;

export type PanelVisualAssetLoadState =
  | { status: 'idle' }
  | { status: 'loading'; assetKey: string; asset?: PanelVisualAssetEntry; thumbnailReady?: boolean }
  | { status: 'missing'; assetKey: string }
  | { status: 'display-ready'; assetKey: string; asset: PanelVisualAssetEntry }
  | { status: 'load-error'; assetKey: string; source: 'manifest' | 'thumbnail' | 'display'; error?: unknown };

export type PanelVisualImageEvent = 'thumbnail-ready' | 'thumbnail-error' | 'display-ready' | 'display-error';
export type PanelVisualManifestLoader = () => Promise<PanelVisualAssetManifest>;

export interface PanelVisualAssetController {
  request(assetKey: string, loadManifest: PanelVisualManifestLoader): Promise<void>;
  handleImageEvent(assetKey: string, event: PanelVisualImageEvent): void;
  cancel(): void;
  reset(): void;
}

export function shouldLoadHoldingVisualAsset(
  activeSystemPanel: string | null,
  activeHoldingTab: string,
  assetKey: string | null | undefined,
): boolean {
  return activeSystemPanel === 'holdings'
    && activeHoldingTab === 'controlledHoldings'
    && Boolean(assetKey);
}

export function shouldLoadTroopVisualAsset(
  activeSystemPanel: string | null,
  assetKey: string | null | undefined,
): boolean {
  return activeSystemPanel === 'troops' && Boolean(assetKey);
}

export function createPanelVisualAssetController(
  onStateChange: (state: PanelVisualAssetLoadState) => void,
): PanelVisualAssetController {
  let requestVersion = 0;
  let currentState: PanelVisualAssetLoadState = { status: 'idle' };

  const publish = (state: PanelVisualAssetLoadState) => {
    currentState = state;
    onStateChange(state);
  };

  return {
    async request(assetKey, loadManifest) {
      const version = ++requestVersion;
      publish({ status: 'loading', assetKey });
      try {
        const manifest = await loadManifest();
        if (version !== requestVersion) return;
        const asset = manifest[assetKey];
        if (!asset) {
          publish({ status: 'missing', assetKey });
          return;
        }
        publish({ status: 'loading', assetKey, asset, thumbnailReady: false });
      } catch (error) {
        if (version !== requestVersion) return;
        publish({ status: 'load-error', assetKey, source: 'manifest', error });
      }
    },

    handleImageEvent(assetKey, event) {
      if (currentState.status !== 'loading' || currentState.assetKey !== assetKey || !currentState.asset) return;
      if (event === 'thumbnail-ready') {
        publish({ ...currentState, thumbnailReady: true });
        return;
      }
      if (event === 'display-ready') {
        publish({ status: 'display-ready', assetKey, asset: currentState.asset });
        return;
      }
      publish({
        status: 'load-error',
        assetKey,
        source: event === 'thumbnail-error' ? 'thumbnail' : 'display',
      });
    },

    cancel() {
      requestVersion += 1;
    },

    reset() {
      requestVersion += 1;
      publish({ status: 'idle' });
    },
  };
}

import { useEffect, useRef, useState } from 'react';
import {
  createPanelVisualAssetController,
  type PanelVisualAssetController,
  type PanelVisualAssetLoadState,
  type PanelVisualManifestLoader,
} from './panelVisualAssetLoader';

interface ProgressivePanelVisualProps {
  variant: 'holding' | 'troop';
  eligible: boolean;
  assetKey: string | null | undefined;
  loadManifest: PanelVisualManifestLoader;
  alt: string;
  caption?: string;
  'aria-label': string;
  'data-testid': string;
}

const initialState: PanelVisualAssetLoadState = { status: 'idle' };

function resolveStateLabel(state: PanelVisualAssetLoadState): string {
  if (state.status === 'missing') return '暂无对应图像';
  if (state.status === 'load-error') return '图像载入失败';
  return '图像载入中';
}

export function ProgressivePanelVisual({
  variant,
  eligible,
  assetKey,
  loadManifest,
  alt,
  caption,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: ProgressivePanelVisualProps) {
  const [state, setState] = useState<PanelVisualAssetLoadState>(initialState);
  const controllerRef = useRef<PanelVisualAssetController | null>(null);
  if (!controllerRef.current) controllerRef.current = createPanelVisualAssetController(setState);

  useEffect(() => {
    const controller = controllerRef.current!;
    if (!eligible || !assetKey) {
      controller.reset();
      return undefined;
    }
    void controller.request(assetKey, loadManifest);
    return () => controller.cancel();
  }, [assetKey, eligible, loadManifest]);

  const asset = state.status === 'loading' || state.status === 'display-ready' ? state.asset : undefined;
  const isReady = state.status === 'display-ready';
  const rootClassName = variant === 'holding' ? 'holding-scenic-panel' : 'troop-visual-panel';
  const imageClassName = variant === 'holding' ? 'holding-scenic-image' : 'troop-force-image';
  const placeholderClassName = variant === 'holding' ? 'holding-scenic-placeholder' : 'troop-visual-placeholder';
  const stateClassName = `panel-visual-state panel-visual-state--${state.status}`;
  const retryLoad = () => {
    if (!eligible || !assetKey) return;
    void controllerRef.current?.request(assetKey, loadManifest);
  };

  const content = (
    <>
      {state.status === 'loading' && asset && (
        <img
          key="thumbnail"
          className={`${imageClassName} panel-visual-image panel-visual-image--thumbnail`}
          src={asset.thumbnail.url}
          width={asset.thumbnail.width}
          height={asset.thumbnail.height}
          alt=""
          aria-hidden="true"
          onLoad={() => controllerRef.current?.handleImageEvent(asset.sourceKey, 'thumbnail-ready')}
          onError={() => controllerRef.current?.handleImageEvent(asset.sourceKey, 'thumbnail-error')}
        />
      )}
      {asset && (
        <img
          key="display"
          className={`${imageClassName} panel-visual-image panel-visual-image--display ${isReady ? 'is-ready' : ''}`}
          src={asset.display.url}
          width={asset.display.width}
          height={asset.display.height}
          alt={variant === 'troop' ? alt : ''}
          aria-hidden={variant === 'holding' ? 'true' : undefined}
          onLoad={() => controllerRef.current?.handleImageEvent(asset.sourceKey, 'display-ready')}
          onError={() => controllerRef.current?.handleImageEvent(asset.sourceKey, 'display-error')}
        />
      )}
      {!isReady && (
        <div className={`${placeholderClassName} ${stateClassName}`} role="status" aria-live="polite">
          <span className="panel-visual-state-label">{resolveStateLabel(state)}</span>
          {state.status === 'load-error' && (
            <button type="button" className="panel-visual-retry" onClick={retryLoad}>
              重试载入
            </button>
          )}
        </div>
      )}
    </>
  );

  if (variant === 'holding') {
    return (
      <figure
        className={`${rootClassName} ${stateClassName} ${isReady ? 'has-image' : 'is-empty'}`}
        aria-label={ariaLabel}
        data-testid={testId}
        data-visual-state={state.status}
        data-asset-key={assetKey ?? undefined}
        aria-busy={state.status === 'loading'}
      >
        {content}
      </figure>
    );
  }

  return (
    <aside
      className={`${rootClassName} ${stateClassName}`}
      aria-label={ariaLabel}
      data-testid={testId}
      data-visual-state={state.status}
      data-asset-key={assetKey ?? undefined}
      aria-busy={state.status === 'loading'}
    >
      <div className="troop-visual-image-slot">{content}</div>
      {caption && <small>{caption}</small>}
    </aside>
  );
}

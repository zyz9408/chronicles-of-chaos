import React from 'react';
import type { RuntimeState, StatePatch, PatchValidationResult } from '../engine/types';

interface Props {
  runtimeState: RuntimeState;
  lastPatch: StatePatch | null;
  patchValidation: PatchValidationResult | null;
}

export const StateDebugPanel: React.FC<Props> = ({
  runtimeState,
  lastPatch,
  patchValidation,
}) => {
  const [showFullState, setShowFullState] = React.useState(false);
  const [showPatch, setShowPatch] = React.useState(false);

  return (
    <div className="debug-panel">
      <h3>调试面板</h3>

      <div className="debug-section">
        <p><strong>引擎版本：</strong>{runtimeState.engineVersion}</p>
        <p><strong>世界书：</strong>{runtimeState.worldBookId} v{runtimeState.worldBookVersion} ({runtimeState.worldBookSource})</p>
        <p><strong>开局书签：</strong>{runtimeState.startBookmarkId ?? '无'}</p>
        <p><strong>回合数：</strong>{runtimeState.turnLog.length}</p>
      </div>

      <div className="debug-section">
        <button onClick={() => setShowFullState(!showFullState)} className="debug-toggle">
          {showFullState ? '隐藏' : '显示'} RuntimeState JSON
        </button>
        {showFullState && (
          <pre className="debug-json">{JSON.stringify(runtimeState, null, 2)}</pre>
        )}
      </div>

      <div className="debug-section">
        <button onClick={() => setShowPatch(!showPatch)} className="debug-toggle">
          {showPatch ? '隐藏' : '显示'} 最近 StatePatch
        </button>
        {showPatch && (
          <>
            <h4>StatePatch</h4>
            <pre className="debug-json">
              {lastPatch ? JSON.stringify(lastPatch, null, 2) : '暂无 patch'}
            </pre>
            <h4>校验结果</h4>
            <pre className="debug-json">
              {patchValidation
                ? JSON.stringify(patchValidation, null, 2)
                : '暂无校验结果'}
            </pre>
          </>
        )}
      </div>
    </div>
  );
};

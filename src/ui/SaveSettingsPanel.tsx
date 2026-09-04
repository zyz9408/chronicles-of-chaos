import { useState } from 'react';
import { pruneAutoSavesWithVisuals } from '../engine/avg/AvgVisualSaveIntegration';
import {
  MAX_AUTO_SAVE_INTERVAL_TURNS,
  MAX_AUTO_SAVE_LIMIT,
  MIN_AUTO_SAVE_INTERVAL_TURNS,
  MIN_AUTO_SAVE_LIMIT,
  loadAutoSaveIntervalTurnsFromStorage,
  loadAutoSaveLimitFromStorage,
  saveAutoSaveIntervalTurnsToStorage,
  saveAutoSaveLimitToStorage,
} from '../engine/settings/SaveSettings';
import { CloudSaveAccountPanel } from './CloudSaveAccountPanel';

export function SaveSettingsPanel({ currentSaveId }: { currentSaveId?: string | null }) {
  const [autoSaveLimit, setAutoSaveLimit] = useState(
    () => String(loadAutoSaveLimitFromStorage()),
  );
  const [autoSaveIntervalTurns, setAutoSaveIntervalTurns] = useState(
    () => String(loadAutoSaveIntervalTurnsFromStorage()),
  );
  const [status, setStatus] = useState('');

  const updateAutoSaveLimit = async (value: string) => {
    const nextLimit = saveAutoSaveLimitToStorage(value);
    setAutoSaveLimit(String(nextLimit));
    try {
      await pruneAutoSavesWithVisuals(nextLimit, currentSaveId ?? undefined);
      setStatus(`已保留最近 ${nextLimit} 个自动存档。`);
    } catch (error) {
      setStatus(`自动存档清理失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  return (
    <div className="game-settings-section save-settings-section">
      <div className="game-settings-heading">
        <h2>存档管理</h2>
        <p className="game-settings-subtitle">
          设置自动存档轮转。每回合仍会安全提交当前进度，达到间隔时另存一个可回看的自动检查点。
        </p>
      </div>
      <div className="gs-divider-thick" />

      <div className="gs-setting-row">
        <div className="gs-setting-left">
          <label className="gs-setting-label" htmlFor="auto-save-interval-turns">
            每隔多少回合自动存档
          </label>
          <input
            id="auto-save-interval-turns"
            aria-label="每隔多少回合自动存档"
            type="number"
            min={MIN_AUTO_SAVE_INTERVAL_TURNS}
            max={MAX_AUTO_SAVE_INTERVAL_TURNS}
            value={autoSaveIntervalTurns}
            onChange={(event) => setAutoSaveIntervalTurns(event.target.value)}
            onBlur={(event) => {
              const nextValue = saveAutoSaveIntervalTurnsToStorage(event.target.value);
              setAutoSaveIntervalTurns(String(nextValue));
              setStatus(`已改为每 ${nextValue} 回合生成自动检查点。`);
            }}
          />
        </div>
        <p className="gs-setting-desc">
          范围 {MIN_AUTO_SAVE_INTERVAL_TURNS}–{MAX_AUTO_SAVE_INTERVAL_TURNS}。默认每 1 回合生成一次；修改后从后续成功回合开始生效。
        </p>
      </div>

      <div className="gs-divider-thin" />

      <CloudSaveAccountPanel currentSaveId={currentSaveId} />

      <div className="gs-divider-thin" />

      <div className="gs-setting-row">
        <div className="gs-setting-left">
          <label className="gs-setting-label" htmlFor="auto-save-limit">
            自动存档保留数量
          </label>
          <input
            id="auto-save-limit"
            aria-label="自动存档保留数量"
            type="number"
            min={MIN_AUTO_SAVE_LIMIT}
            max={MAX_AUTO_SAVE_LIMIT}
            value={autoSaveLimit}
            onChange={(event) => setAutoSaveLimit(event.target.value)}
            onBlur={(event) => void updateAutoSaveLimit(event.target.value)}
          />
        </div>
        <p className="gs-setting-desc">
          范围 {MIN_AUTO_SAVE_LIMIT}–{MAX_AUTO_SAVE_LIMIT}，包含当前活动进度；超出后只删除最旧自动档及其回溯快照，手动存档永不受影响。
        </p>
      </div>

      <div className="gs-divider-thin" />

      <div className="gs-setting-row">
        <div className="gs-setting-left">
          <span className="gs-setting-label">ZIP 导入导出</span>
        </div>
        <p className="gs-setting-desc">
          请在“兵戈再起”或游戏内“读取/保存进度”中操作。ZIP 会按手动档、自动档和回溯快照分文件保存，并预留文生图目录；旧版 JSON 仍可导入。
        </p>
      </div>

      {status && <p className="save-modal-status" role="status">{status}</p>}
    </div>
  );
}

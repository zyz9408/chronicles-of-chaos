import React, { useState } from 'react';
import {
  clearLocalData,
  type LocalDataClearScope,
} from '../engine/storage/LocalDataManagement';

interface DataManagementPanelProps {
  runtimeActive: boolean;
  onCleared?: () => void | Promise<void>;
}

interface DataAction {
  scope: LocalDataClearScope;
  title: string;
  description: string;
  buttonLabel: string;
  danger?: boolean;
  requiresNoActiveGame?: boolean;
}

const DATA_ACTIONS: DataAction[] = [
  {
    scope: 'saves',
    title: '全部存档',
    description: '删除手动存档、自动存档和回溯快照；不会删除 API 配置。',
    buttonLabel: '清除存档',
    danger: true,
    requiresNoActiveGame: true,
  },
  {
    scope: 'cache',
    title: '本地检索缓存',
    description: '删除可以重建的记忆向量索引；不删除正文、人物记忆或存档。',
    buttonLabel: '清除缓存',
  },
  {
    scope: 'preferences',
    title: '偏好与自定义项',
    description: '重置显示、自动存档、NPC 模拟、提示词覆盖和自定义开局选项。',
    buttonLabel: '重置偏好',
  },
  {
    scope: 'allExceptApi',
    title: '全部本地数据（保留 API）',
    description: '清除存档、缓存与本地偏好，但完整保留接口、密钥、模型和任务路由。',
    buttonLabel: '保留 API 并清除',
    danger: true,
    requiresNoActiveGame: true,
  },
  {
    scope: 'all',
    title: '全部本地数据',
    description: '清除存档、缓存、偏好以及全部 API 接口和任务路由。',
    buttonLabel: '全部清除',
    danger: true,
    requiresNoActiveGame: true,
  },
];

export const DataManagementPanel: React.FC<DataManagementPanelProps> = ({
  runtimeActive,
  onCleared,
}) => {
  const [pendingScope, setPendingScope] = useState<LocalDataClearScope | null>(null);
  const [status, setStatus] = useState('');
  const [isClearing, setIsClearing] = useState(false);
  const pendingAction = DATA_ACTIONS.find((action) => action.scope === pendingScope);

  const executeClear = async () => {
    if (!pendingAction) return;
    setIsClearing(true);
    setStatus('');
    try {
      await clearLocalData(pendingAction.scope);
      await onCleared?.();
      setStatus(`${pendingAction.title}已处理完成。`);
      setPendingScope(null);
    } catch (error) {
      setStatus(`清理失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="game-settings-section data-management-section" data-testid="data-management-panel">
      <div className="game-settings-heading">
        <h2>数据管理</h2>
        <p className="game-settings-subtitle">按类别清理本机数据。每项都需要再次确认，不会清除其他网站或程序的数据。</p>
      </div>
      <div className="gs-divider-thick" />

      {runtimeActive && (
        <p className="settings-status">
          当前仍在游戏中。为防止内存中的进度再次自动写回，涉及存档的清理需先返回首页。
        </p>
      )}

      <div className="data-management-grid">
        {DATA_ACTIONS.map((action) => {
          const disabled = isClearing || Boolean(action.requiresNoActiveGame && runtimeActive);
          return (
            <article key={action.scope} className={`data-management-card ${action.danger ? 'danger' : ''}`}>
              <div>
                <h3>{action.title}</h3>
                <p>{action.description}</p>
              </div>
              <button
                type="button"
                className={`nav-btn ${action.danger ? 'danger' : ''}`}
                disabled={disabled}
                onClick={() => {
                  setStatus('');
                  setPendingScope(action.scope);
                }}
              >
                {action.buttonLabel}
              </button>
            </article>
          );
        })}
      </div>

      {pendingAction && (
        <div className="data-management-confirm" role="alertdialog" aria-label={`确认${pendingAction.title}`}>
          <strong>再次确认：{pendingAction.title}</strong>
          <p>{pendingAction.description} 此操作无法撤销。</p>
          <div>
            <button type="button" className="nav-btn" disabled={isClearing} onClick={() => setPendingScope(null)}>
              取消
            </button>
            <button type="button" className="nav-btn danger" disabled={isClearing} onClick={() => void executeClear()}>
              {isClearing ? '正在处理…' : '确认执行'}
            </button>
          </div>
        </div>
      )}

      {status && <p className="settings-status" role="status">{status}</p>}
    </div>
  );
};

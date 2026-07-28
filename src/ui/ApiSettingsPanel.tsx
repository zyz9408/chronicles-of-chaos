import React, { useEffect, useMemo, useState } from 'react';
import type { RuntimeState } from '../engine/types';
import {
  API_PROVIDER_OPTIONS,
  API_TASKS,
  createApiConfigDraft,
  deleteApiConfigAsync,
  exportApiSettings,
  getApiConfigModels,
  getProviderLabel,
  maskApiKey,
  prepareApiConfigForSave,
  getApiTaskRoutesAsync,
  importApiSettings,
  listApiConfigsAsync,
  setApiTaskRouteAsync,
  upsertApiConfigAsync,
  type ApiConfigArchive,
  type ApiProviderId,
  type ApiTaskId,
  type ApiTaskRoute,
  type ApiTaskRoutes,
} from '../engine/settings/ApiConfigManager';
import {
  loadAdultIntimacyStyleFromStorage,
  loadMotionPreferenceFromStorage,
  loadNarrativeFontSizeFromStorage,
  loadNarrativeLineHeightFromStorage,
  loadNarrativeLengthFromStorage,
  loadRenderDepthFromStorage,
  loadNpcPresenceHintsEnabledFromStorage,
  loadPregnancyModeFromStorage,
  loadSnapshotDepthFromStorage,
  saveAdultIntimacyStyleToStorage,
  saveMotionPreferenceToStorage,
  saveNarrativeFontSizeToStorage,
  saveNarrativeLineHeightToStorage,
  saveNarrativeLengthToStorage,
  saveNpcPresenceHintsEnabledToStorage,
  savePregnancyModeToStorage,
  saveRenderDepthToStorage,
  saveSnapshotDepthToStorage,
} from '../engine/settings/DisplaySettings';
import {
  FUNCTION_CONFIG_PANELS,
  getApiConfigRouteTaskIds,
  getFunctionConfigPanel,
  getGameSettingsControls,
  getInlineApiCancelState,
  getInlineApiSaveState,
  isFunctionConfigTab,
  type SettingsFunctionTab,
  type SettingsTab,
} from './settingsPanelModel';
import { MemorySettingsPanel } from './MemorySettingsPanel';
import { NpcSimulationSettingsPanel } from './NpcSimulationSettingsPanel';
import { SaveSettingsPanel } from './SaveSettingsPanel';
import { DataManagementPanel } from './DataManagementPanel';

const PromptRegistryPanel = React.lazy(async () => {
  const module = await import('./PromptRegistryPanel');
  return { default: module.PromptRegistryPanel };
});

const PromptTokenEstimatePanel = React.lazy(async () => {
  const module = await import('./PromptTokenEstimatePanel');
  return { default: module.PromptTokenEstimatePanel };
});

const TavernManagementPanel = React.lazy(async () => {
  const module = await import('./TavernManagementPanel');
  return { default: module.TavernManagementPanel };
});

const cloneConfig = (config: ApiConfigArchive): ApiConfigArchive => ({
  ...config,
  models: [...getApiConfigModels(config)],
});
const emptyRoutes = (): ApiTaskRoutes => Object.fromEntries(API_TASKS.map((task) => [task.id, null])) as ApiTaskRoutes;

export function parseApiModelNames(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[\n,，;；]+/)
      .map((model) => model.trim())
      .filter(Boolean),
  ));
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function downloadJsonFile(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function getRemoteHttpBaseUrlWarning(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) return '';

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return '';
  }

  if (parsed.protocol !== 'http:') return '';

  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return '';
  }

  return '远程 HTTP 接口不会加密传输请求与密钥；建议改用 HTTPS，或确认这是可信内网地址。';
}

function pickJsonFile(): Promise<any | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      try {
        resolve(JSON.parse(await file.text()));
      } catch (error) {
        reject(error);
      }
    };
    input.click();
  });
}

interface ApiSettingsPanelProps {
  onClose: () => void;
  initialTab?: SettingsTab;
  runtimeState?: RuntimeState | null;
  saveId?: string | null;
  onRuntimeStateChange?: (runtimeState: RuntimeState) => void;
}

export const ApiSettingsPanel: React.FC<ApiSettingsPanelProps> = ({
  onClose,
  initialTab = 'game',
  runtimeState,
  saveId,
  onRuntimeStateChange,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [functionConfigOpen, setFunctionConfigOpen] = useState(isFunctionConfigTab(initialTab));
  const [inlineApiEditorFor, setInlineApiEditorFor] = useState<SettingsFunctionTab | null>(null);
  const [featureNotice, setFeatureNotice] = useState('');
  const [configs, setConfigs] = useState<ApiConfigArchive[]>([]);
  const [routes, setRoutes] = useState<ApiTaskRoutes>(() => emptyRoutes());
  const [editing, setEditing] = useState<ApiConfigArchive>(() => createApiConfigDraft());
  const [modelsText, setModelsText] = useState('');
  const [modelStatus, setModelStatus] = useState('');
  const [renderDepth, setRenderDepth] = useState(loadRenderDepthFromStorage);
  const [snapshotDepth, setSnapshotDepth] = useState(loadSnapshotDepthFromStorage);
  const [narrativeLength, setNarrativeLength] = useState(loadNarrativeLengthFromStorage);
  const [adultIntimacyStyle, setAdultIntimacyStyle] = useState(loadAdultIntimacyStyleFromStorage);
  const [pregnancyMode, setPregnancyMode] = useState(loadPregnancyModeFromStorage);
  const [npcPresenceHintsEnabled, setNpcPresenceHintsEnabled] = useState(loadNpcPresenceHintsEnabledFromStorage);
  const [narrativeFontSize, setNarrativeFontSize] = useState(loadNarrativeFontSizeFromStorage);
  const [narrativeLineHeight, setNarrativeLineHeight] = useState(loadNarrativeLineHeightFromStorage);
  const [motionPreference, setMotionPreference] = useState(loadMotionPreferenceFromStorage);

  const configOptions = useMemo(
    () => configs.map((config) => ({
      id: config.id,
      label: `${config.name} · ${getProviderLabel(config.provider)}`,
    })),
    [configs],
  );
  const gameSettingsControls = useMemo(() => getGameSettingsControls(), []);
  const narrativeLengthControl = gameSettingsControls.find((control) => control.id === 'narrativeLength');
  const selectedNarrativeLengthOption = narrativeLengthControl?.id === 'narrativeLength'
    ? narrativeLengthControl.options.find((option) => option.value === narrativeLength)
    : undefined;
  const adultIntimacyStyleControl = gameSettingsControls.find((control) => control.id === 'adultIntimacyStyle');
  const pregnancyModeControl = gameSettingsControls.find((control) => control.id === 'pregnancyMode');
  const npcPresenceHintsControl = gameSettingsControls.find((control) => control.id === 'npcPresenceHints');
  const taskById = useMemo(() => new Map(API_TASKS.map((task) => [task.id, task])), []);
  const remoteHttpWarning = getRemoteHttpBaseUrlWarning(editing.baseUrl);

  const selectEditingConfig = (config: ApiConfigArchive) => {
    const next = cloneConfig(config);
    setEditing(next);
    setModelsText(getApiConfigModels(next).join('\n'));
  };

  const refresh = async (nextEditing?: ApiConfigArchive) => {
    const nextConfigs = await listApiConfigsAsync();
    setConfigs(nextConfigs);
    setRoutes(await getApiTaskRoutesAsync());
    if (nextEditing) {
      selectEditingConfig(nextEditing);
      return;
    }
    const stillExists = nextConfigs.find((config) => config.id === editing.id);
    selectEditingConfig(stillExists ?? createApiConfigDraft());
  };

  useEffect(() => {
    void refresh();
    // 初次加载一次；refresh 依赖 editing，放进依赖会造成不必要刷新。
  }, []);

  useEffect(() => {
    if (!featureNotice) return undefined;
    const timer = window.setTimeout(() => setFeatureNotice(''), 2800);
    return () => window.clearTimeout(timer);
  }, [featureNotice]);

  const handleProviderChange = (providerId: ApiProviderId) => {
    const provider = API_PROVIDER_OPTIONS.find((option) => option.id === providerId);
    setEditing((current) => ({
      ...current,
      provider: providerId,
      baseUrl: provider?.defaultBaseUrl ?? current.baseUrl,
      name: current.name.trim() ? current.name : `${provider?.label ?? 'API'} 配置`,
    }));
  };

  const handleSave = async () => {
    const models = parseApiModelNames(modelsText);
    const saved = await upsertApiConfigAsync(prepareApiConfigForSave({
      ...editing,
      model: models[0] ?? '',
      models,
    }));
    await refresh(saved);
    if (inlineApiEditorFor) {
      const nextState = getInlineApiSaveState();
      setInlineApiEditorFor(nextState.inlineApiEditorFor);
      setFeatureNotice(nextState.notice);
      setModelStatus('');
      return;
    }
    setModelStatus('配置已保存。');
  };

  const handleNew = () => {
    const draft = createApiConfigDraft('openai_compatible');
    selectEditingConfig(draft);
    setModelStatus('');
  };

  const switchTab = (tab: SettingsTab) => {
    setActiveTab(tab);
    if (isFunctionConfigTab(tab)) {
      setFunctionConfigOpen(true);
    }
    setInlineApiEditorFor(null);
    setModelStatus('');
  };

  const handleInlineNew = (tab: SettingsFunctionTab) => {
    const draft = createApiConfigDraft('openai_compatible');
    selectEditingConfig(draft);
    setModelStatus('');
    setInlineApiEditorFor(tab);
    setFeatureNotice('');
  };

  const handleInlineCancel = () => {
    const nextState = getInlineApiCancelState();
    setInlineApiEditorFor(nextState.inlineApiEditorFor);
    setFeatureNotice(nextState.notice);
    setModelStatus('');
  };

  const handleDelete = async (configId: string) => {
    if (!window.confirm('确定删除这份 API 配置吗？')) return;
    await deleteApiConfigAsync(configId);
    await refresh();
  };

  const handleRouteChange = async (taskId: keyof ApiTaskRoutes, route: ApiTaskRoute | null) => {
    await setApiTaskRouteAsync(taskId, route);
    setRoutes(await getApiTaskRoutesAsync());
  };

  const handleExportSettings = async () => {
    try {
      downloadJsonFile(`coc-v2-api-settings-${dateStamp()}.json`, await exportApiSettings());
      setModelStatus('API 设置已导出。导出文件包含密钥，请妥善保管。');
    } catch (error) {
      setModelStatus(`导出失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleImportSettings = async () => {
    try {
      const json = await pickJsonFile();
      if (!json) return;
      if (!window.confirm('导入 API 设置会替换当前 API 配置和任务路由，确定继续吗？')) return;
      await importApiSettings(json, { mode: 'replace' });
      await refresh();
      setModelStatus('API 设置已导入。');
    } catch (error) {
      setModelStatus(`导入失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleFetchModels = async () => {
    if (!editing.baseUrl.trim()) {
      setModelStatus('请先填写接口地址。');
      return;
    }

    setModelStatus('正在获取模型列表...');

    try {
      const url = `${editing.baseUrl.replace(/\/$/, '')}/models`;
      const response = await fetch(url, {
        headers: editing.apiKey
          ? {
              Authorization: `Bearer ${editing.apiKey}`,
            }
          : undefined,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      const ids: string[] = Array.isArray(data?.data)
        ? (data.data as Array<{ id?: unknown }>)
            .map((item: { id?: unknown }) => item.id)
            .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
        : [];
      if (ids.length === 0) {
        setModelStatus('接口返回成功，但没有识别到模型列表。');
        return;
      }
      const modelIds = Array.from(new Set(ids.map((id) => id.trim())));
      setModelsText(modelIds.join('\n'));
      setEditing((current) => ({
        ...current,
        model: modelIds[0] ?? '',
        models: modelIds,
      }));
      setModelStatus(`已获取 ${modelIds.length} 个模型。`);
    } catch (error) {
      setModelStatus(`获取失败：${error instanceof Error ? error.message : '未知错误'}。可以先手动填写模型名。`);
    }
  };

  const renderRouteRows = (taskIds: ApiTaskId[]) => (
    taskIds.map((taskId) => {
      const task = taskById.get(taskId);
      if (!task) return null;
      const route = routes[task.id];
      const selectedConfig = route
        ? configs.find((config) => config.id === route.configId)
        : undefined;
      const routeModels = selectedConfig
        ? getApiConfigModels(selectedConfig)
        : [];

      return (
        <div className="route-row" key={task.id}>
          <div>
            <strong>{task.label}{task.required ? ' [必选]' : ''}</strong>
            <p>{task.description}</p>
          </div>
          <div className="route-selectors">
            <label>
              API 档案
              <select
                aria-label={`${task.label} API 档案`}
                value={route?.configId ?? ''}
                onChange={(event) => {
                  const config = configs.find((item) => item.id === event.target.value);
                  const model = config ? getApiConfigModels(config)[0] ?? '' : '';
                  void handleRouteChange(task.id, config ? { configId: config.id, model } : null);
                }}
              >
                <option value="">{task.id === 'npcSimulation' ? '未启用' : '自动回退'}</option>
                {configOptions.map((config) => (
                  <option key={config.id} value={config.id}>{config.label}</option>
                ))}
              </select>
            </label>
            <label>
              模型
              <select
                aria-label={`${task.label} 模型`}
                value={route?.model ?? ''}
                disabled={!selectedConfig || routeModels.length === 0}
                onChange={(event) => {
                  if (!route) return;
                  void handleRouteChange(task.id, { ...route, model: event.target.value });
                }}
              >
                {routeModels.length === 0 ? (
                  <option value="">请先在档案中填写模型</option>
                ) : routeModels.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      );
    })
  );

  const renderApiEditor = (onCancel?: () => void) => (
    <div className="api-editor">
      <div className="form-grid two">
        <label>
          配置名称
          <input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
        </label>
        <label>
          接口类型
          <select value={editing.provider} onChange={(event) => handleProviderChange(event.target.value as ApiProviderId)}>
            {API_PROVIDER_OPTIONS.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.label}</option>
            ))}
          </select>
        </label>
      </div>

      <label>
        接口地址 Base URL
        <input value={editing.baseUrl} onChange={(event) => setEditing({ ...editing, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
      </label>
      {remoteHttpWarning && <p className="settings-status api-http-warning">{remoteHttpWarning}</p>}

      <label>
        密钥 API Key
        <input type="password" value={editing.apiKey} onChange={(event) => setEditing({ ...editing, apiKey: event.target.value })} placeholder="sk-..." />
      </label>

      <div className="form-grid model-row">
        <label>
          模型列表
          <textarea
            className="api-model-list"
            value={modelsText}
            onChange={(event) => setModelsText(event.target.value)}
            placeholder={'每行一个模型，也可用逗号分隔\n例如：gemini-3.1-pro-preview\ngemini-3-flash-preview'}
          />
        </label>
        <button className="nav-btn" onClick={handleFetchModels}>获取模型</button>
      </div>

      {modelStatus && <p className="settings-status">{modelStatus}</p>}

      <div className="form-grid two">
        <label>
          最大输出 Token
          <input
            type="number"
            min={1}
            value={editing.maxOutputTokens ?? ''}
            onChange={(event) => setEditing({ ...editing, maxOutputTokens: event.target.value === '' ? undefined : Number(event.target.value) })}
            placeholder="留空则默认"
          />
        </label>
        <label>
          模型温度（可选）
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={editing.temperature ?? ''}
            onChange={(event) => setEditing({ ...editing, temperature: event.target.value === '' ? undefined : Number(event.target.value) })}
            placeholder="留空则默认"
          />
        </label>
      </div>
      <div className="form-grid actions-row">
        <div className="editor-actions">
          <button className="nav-btn primary" onClick={handleSave}>保存 API 配置</button>
          {onCancel && (
            <button className="nav-btn" onClick={onCancel}>取消</button>
          )}
          {configs.some((config) => config.id === editing.id) && (
            <button className="nav-btn danger" onClick={() => handleDelete(editing.id)}>删除</button>
          )}
        </div>
      </div>
    </div>
  );
  const activeFunctionPanel = getFunctionConfigPanel(activeTab);

  return (
    <div className="settings-modal" role="dialog" aria-modal="true" aria-label="设置" onClick={(event) => event.stopPropagation()}>
      <div className="settings-layout">
        <aside className="settings-nav">
          <div className="settings-nav-main">
            <h2>设置</h2>
            <p className="settings-nav-intro">常用功能在前，高级工具按需展开。</p>
            <span className="settings-nav-section-label">常用设置</span>
            <button
              className={`settings-nav-item ${activeTab === 'game' ? 'active' : ''}`}
              onClick={() => switchTab('game')}
            >
              游戏设定
            </button>
            <button
              className={`settings-nav-item ${activeTab === 'display' ? 'active' : ''}`}
              onClick={() => switchTab('display')}
            >
              阅读与动效
            </button>
            <button
              className={`settings-nav-item ${activeTab === 'save' ? 'active' : ''}`}
              onClick={() => switchTab('save')}
            >
              存档管理
            </button>
            <button
              className={`settings-nav-item ${activeTab === 'data' ? 'active' : ''}`}
              onClick={() => switchTab('data')}
            >
              数据管理
            </button>

            <span className="settings-nav-section-label">AI 与内容</span>
            <button
              className={`settings-nav-item ${activeTab === 'api' ? 'active' : ''}`}
              onClick={() => switchTab('api')}
            >
              API 配置
            </button>
            <button
              className={`settings-nav-item settings-nav-group-toggle ${functionConfigOpen || isFunctionConfigTab(activeTab) ? 'active' : ''}`}
              onClick={() => setFunctionConfigOpen((open) => !open)}
              aria-expanded={functionConfigOpen || isFunctionConfigTab(activeTab)}
            >
              功能配置
            </button>
            {(functionConfigOpen || isFunctionConfigTab(activeTab)) && (
              <div className="settings-nav-subitems">
                {FUNCTION_CONFIG_PANELS.map((panel) => (
                  <button
                    key={panel.tab}
                    className={`settings-nav-item settings-nav-subitem ${activeTab === panel.tab ? 'active' : ''}`}
                    onClick={() => switchTab(panel.tab)}
                  >
                    {panel.label}
                  </button>
                ))}
              </div>
            )}
            <button
              className={`settings-nav-item ${activeTab === 'tavern' ? 'active' : ''}`}
              onClick={() => switchTab('tavern')}
            >
              酒馆预设与 CoT
            </button>
            <span className="settings-nav-section-label">高级工具</span>
            <button
              className={`settings-nav-item ${activeTab === 'promptRegistry' ? 'active' : ''}`}
              onClick={() => switchTab('promptRegistry')}
            >
              提示词管理
            </button>
            <button
              className={`settings-nav-item ${activeTab === 'promptTokenEstimate' ? 'active' : ''}`}
              onClick={() => switchTab('promptTokenEstimate')}
            >
              Token 估算
            </button>
          </div>
          <button className="settings-nav-close" onClick={onClose}>关闭设置</button>
        </aside>

        <section className="settings-content">
          {activeTab === 'game' && (
            <div className="game-settings-section">
              <div className="game-settings-heading">
                <h2>游戏设定</h2>
                <p className="game-settings-subtitle">调整游戏显示和交互偏好，不影响世界状态和 AI 行为。</p>
              </div>
              <div className="gs-divider-thick" />

              <div className="gs-setting-row">
                <div className="gs-setting-left">
                  <span className="gs-setting-label">渲染层数</span>
                  <input
                    aria-label="渲染层数"
                    type="number"
                    min={1}
                    max={100}
                    value={renderDepth}
                    onChange={(event) => {
                      const nextValue = saveRenderDepthToStorage(event.target.value);
                      setRenderDepth(nextValue);
                    }}
                  />
                </div>
                <p className="gs-setting-desc">控制主游戏页正文区最多显示最近多少回合。仅影响前端显示，不影响 AI 上下文和世界状态。</p>
              </div>

              <div className="gs-divider-thin" />

              <div className="gs-setting-row">
                <div className="gs-setting-left">
                  <span className="gs-setting-label">回溯快照数量</span>
                  <input
                    aria-label="回溯快照数量"
                    type="number"
                    min={0}
                    max={50}
                    value={snapshotDepth}
                    onChange={(event) => {
                      const nextValue = saveSnapshotDepthToStorage(event.target.value);
                      setSnapshotDepth(nextValue);
                    }}
                  />
                </div>
                <p className="gs-setting-desc">用于重 ROLL 和修改最近回合输入。数值越大，占用 IndexedDB 和导出存档空间越多；设为 0 会关闭回溯快照。</p>
              </div>

              <div className="gs-divider-thin" />

              {narrativeLengthControl?.id === 'narrativeLength' && (
                <>
                  <div className="gs-setting-row">
                    <div className="gs-setting-left">
                      <label className="gs-setting-label" htmlFor="narrative-length-setting">
                        {narrativeLengthControl.label}
                      </label>
                      <select
                        id="narrative-length-setting"
                        aria-label={narrativeLengthControl.label}
                        value={narrativeLength}
                        onChange={(event) => {
                          const nextValue = saveNarrativeLengthToStorage(event.target.value);
                          setNarrativeLength(nextValue);
                        }}
                      >
                        {narrativeLengthControl.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}（{option.wordCountHint}）
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="gs-setting-desc">
                      当前目标：{selectedNarrativeLengthOption?.wordCountHint}
                      {'。'}
                      {narrativeLengthControl.description}
                      {' '}
                      {selectedNarrativeLengthOption?.description}
                    </p>
                  </div>

                  <div className="gs-divider-thin" />
                </>
              )}

              {adultIntimacyStyleControl?.id === 'adultIntimacyStyle' && (
                <>
                  <div className="gs-setting-row">
                    <div className="gs-setting-left">
                      <label className="gs-setting-label" htmlFor="adult-intimacy-style-setting">
                        {adultIntimacyStyleControl.label}
                      </label>
                      <select
                        id="adult-intimacy-style-setting"
                        aria-label={adultIntimacyStyleControl.label}
                        value={adultIntimacyStyle}
                        onChange={(event) => {
                          const nextValue = saveAdultIntimacyStyleToStorage(event.target.value);
                          setAdultIntimacyStyle(nextValue);
                        }}
                      >
                        {adultIntimacyStyleControl.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="gs-setting-desc">
                      {adultIntimacyStyleControl.description}
                      {' '}
                      {adultIntimacyStyleControl.options.find((option) => option.value === adultIntimacyStyle)?.description}
                    </p>
                  </div>

                  <div className="gs-divider-thin" />
                </>
              )}

              {pregnancyModeControl?.id === 'pregnancyMode' && (
                <>
                  <div className="gs-setting-row">
                    <div className="gs-setting-left">
                      <label className="gs-setting-label" htmlFor="pregnancy-mode-setting">
                        {pregnancyModeControl.label}
                      </label>
                      <select
                        id="pregnancy-mode-setting"
                        aria-label={pregnancyModeControl.label}
                        value={pregnancyMode}
                        onChange={(event) => {
                          const nextValue = savePregnancyModeToStorage(event.target.value);
                          setPregnancyMode(nextValue);
                        }}
                      >
                        {pregnancyModeControl.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="gs-setting-desc">
                      {pregnancyModeControl.description}
                      {' '}
                      {pregnancyModeControl.options.find((option) => option.value === pregnancyMode)?.description}
                    </p>
                  </div>

                  <div className="gs-divider-thin" />
                </>
              )}

              <div className="gs-setting-row">
                <div className="gs-setting-left">
                  <label className="gs-checkbox-control">
                    <input
                      aria-label={npcPresenceHintsControl?.label ?? '人物志近况提示'}
                      type="checkbox"
                      checked={npcPresenceHintsEnabled}
                      onChange={(event) => {
                        const nextValue = saveNpcPresenceHintsEnabledToStorage(event.target.checked);
                        setNpcPresenceHintsEnabled(nextValue);
                      }}
                    />
                    <span className="gs-setting-label">{npcPresenceHintsControl?.label ?? '人物志近况提示'}</span>
                  </label>
                </div>
                <p className="gs-setting-desc">
                  {npcPresenceHintsControl?.description ?? 'NPC 有新的远场近况时，在人物志列表显示红点并临时置顶；关闭后只隐藏提示，不删除近况记录。'}
                </p>
              </div>
            </div>
          )}

          {activeTab === 'api' && (
            <>
              <div className="settings-heading">
                <div>
                  <h2>API 配置中心</h2>
                  <p>同一接口只需保存一次：在档案中维护模型列表，再为主剧情、记忆、补全等任务分别选择模型。</p>
                </div>
                <div className="settings-heading-actions">
                  <button className="nav-btn" onClick={handleExportSettings}>导出设置</button>
                  <button className="nav-btn" onClick={handleImportSettings}>导入设置</button>
                  <button className="nav-btn primary" onClick={handleNew}>新建 API</button>
                </div>
              </div>
              <p className="settings-status api-export-warning">
                API 设置导出文件包含密钥，请只在备份或迁移 API 配置时使用，并妥善保管。
              </p>

              <div className="api-settings-grid">
                <div className="api-archive-list">
                  {configs.length === 0 ? (
                    <p className="empty-hint">暂无 API 配置，先新建一份。</p>
                  ) : (
                    configs.map((config) => (
                      <button
                        type="button"
                        key={config.id}
                        className={`api-archive-card ${editing.id === config.id ? 'selected' : ''}`}
                        onClick={() => {
                          selectEditingConfig(config);
                          setModelStatus('');
                        }}
                      >
                        <strong>{config.name}</strong>
                        <span>{getProviderLabel(config.provider)} · {getApiConfigModels(config).length} 个模型</span>
                        <span className="api-model-preview">
                          {getApiConfigModels(config).slice(0, 3).join(' / ') || '未填写模型'}
                        </span>
                        <span>{config.baseUrl || '未填写地址'}</span>
                        <span>{maskApiKey(config.apiKey)}</span>
                      </button>
                    ))
                  )}
                </div>

                {renderApiEditor()}
              </div>

              <div className="task-routing">
                <h3>主剧情 API</h3>
                <p>主回合叙事生成使用的模型。未选择时自动回退到第一份可用 API 配置。</p>
                {renderRouteRows(getApiConfigRouteTaskIds())}
              </div>
            </>
          )}

          {activeTab === 'promptRegistry' && (
            <React.Suspense fallback={<div className="settings-section-loading" role="status">正在载入提示词管理…</div>}>
              <PromptRegistryPanel />
            </React.Suspense>
          )}

          {activeTab === 'tavern' && (
            <React.Suspense fallback={<div className="settings-section-loading" role="status">正在载入酒馆预设管理…</div>}>
              <TavernManagementPanel />
            </React.Suspense>
          )}

          {activeTab === 'display' && (
            <div className="game-settings-section" data-testid="display-settings-panel">
              <div className="game-settings-heading">
                <h2>阅读与动效</h2>
                <p className="game-settings-subtitle">只调整本机显示，不改变正文内容、AI 上下文或存档数据。</p>
              </div>
              <div className="gs-divider-thick" />

              <div className="gs-setting-row">
                <div className="gs-setting-left">
                  <label className="gs-setting-label" htmlFor="narrative-font-size-setting">正文字号</label>
                  <input
                    id="narrative-font-size-setting"
                    aria-label="正文字号"
                    type="range"
                    min={14}
                    max={24}
                    step={1}
                    value={narrativeFontSize}
                    onChange={(event) => {
                      const nextValue = saveNarrativeFontSizeToStorage(event.target.value);
                      setNarrativeFontSize(nextValue);
                    }}
                  />
                  <output htmlFor="narrative-font-size-setting">{narrativeFontSize}px</output>
                </div>
                <p className="gs-setting-desc">调整主剧情叙述和人物对白的字号。面板标题、按钮与状态栏保持原尺寸。</p>
              </div>

              <div className="gs-divider-thin" />

              <div className="gs-setting-row">
                <div className="gs-setting-left">
                  <label className="gs-setting-label" htmlFor="narrative-line-height-setting">正文行距</label>
                  <input
                    id="narrative-line-height-setting"
                    aria-label="正文行距"
                    type="range"
                    min={1.5}
                    max={2.2}
                    step={0.05}
                    value={narrativeLineHeight}
                    onChange={(event) => {
                      const nextValue = saveNarrativeLineHeightToStorage(event.target.value);
                      setNarrativeLineHeight(nextValue);
                    }}
                  />
                  <output htmlFor="narrative-line-height-setting">{narrativeLineHeight.toFixed(2)}</output>
                </div>
                <p className="gs-setting-desc">调整叙事正文的纵向阅读密度；默认 1.85，设置按 0.05 级保存。</p>
              </div>

              <div className="gs-divider-thin" />

              <div className="gs-setting-row">
                <div className="gs-setting-left">
                  <label className="gs-setting-label" htmlFor="motion-preference-setting">动态效果</label>
                  <select
                    id="motion-preference-setting"
                    aria-label="动态效果"
                    value={motionPreference}
                    onChange={(event) => {
                      const nextValue = saveMotionPreferenceToStorage(event.target.value);
                      setMotionPreference(nextValue);
                    }}
                  >
                    <option value="system">跟随系统</option>
                    <option value="reduced">减少动态</option>
                  </select>
                </div>
                <p className="gs-setting-desc">“减少动态”会压缩首页、天气、面板与战斗界面的过渡动画；不隐藏状态信息。</p>
              </div>

              <div className="gs-divider-thin" />

              <div className="gs-reading-preview" aria-label="正文阅读预览">
                <span>阅读预览</span>
                <p style={{ fontSize: narrativeFontSize, lineHeight: narrativeLineHeight }}>
                  风从江面掠过营旗，远处战鼓只响了一声。斥候勒马停在帐前，低声报出刚刚探明的军情。
                </p>
              </div>
            </div>
          )}

          {activeTab === 'promptTokenEstimate' && (
            <React.Suspense fallback={<div className="settings-section-loading" role="status">正在载入 Token 估算…</div>}>
              <PromptTokenEstimatePanel />
            </React.Suspense>
          )}

          {activeTab === 'save' && (
            <SaveSettingsPanel currentSaveId={saveId} />
          )}

          {activeTab === 'data' && (
            <DataManagementPanel
              runtimeActive={Boolean(runtimeState)}
              onCleared={async () => {
                await refresh();
                setFeatureNotice('本地数据已按所选范围处理。');
              }}
            />
          )}

          {activeFunctionPanel && (
            <div className="feature-config-section">
              <div className="settings-heading">
                <div>
                  <h2>{activeFunctionPanel.label}</h2>
                  <p>{activeFunctionPanel.description}</p>
                </div>
                {activeFunctionPanel.status === 'active' && (
                  <div className="settings-heading-actions">
                    <button className="nav-btn primary" onClick={() => handleInlineNew(activeFunctionPanel.tab)}>
                      新建 API 配置
                    </button>
                  </div>
                )}
              </div>

              {featureNotice && <p className="settings-status feature-notice">{featureNotice}</p>}

              {activeFunctionPanel.routeTaskIds.length > 0 ? (
                <div className="task-routing feature-task-routing">
                  <h3>功能 API 路由</h3>
                  <p>这里只选择该功能使用的 API 档案与模型；接口地址和密钥统一保存在 API 配置中。</p>
                  {renderRouteRows(activeFunctionPanel.routeTaskIds)}
                </div>
              ) : (
                <div className="feature-config-empty">
                  <strong>规划中</strong>
                  <p>该功能尚未进入施工阶段，因此暂不提供 API 路由和参数开关。</p>
                </div>
              )}

              {activeFunctionPanel.tab === 'memory' && (
                <MemorySettingsPanel
                  runtimeState={runtimeState}
                  saveId={saveId}
                  onRuntimeStateChange={onRuntimeStateChange}
                />
              )}

              {activeFunctionPanel.tab === 'npcSimulation' && (
                <NpcSimulationSettingsPanel />
              )}

              {inlineApiEditorFor === activeFunctionPanel.tab && (
                <div className="api-inline-editor">
                  <div className="settings-heading compact">
                    <div>
                      <h3>新建 API 配置</h3>
                      <p>保存后会进入统一 API 配置库，并出现在本页选择框中。</p>
                    </div>
                  </div>
                  {renderApiEditor(handleInlineCancel)}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

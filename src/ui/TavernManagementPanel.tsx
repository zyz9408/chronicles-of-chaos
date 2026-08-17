import React, { useMemo, useState } from 'react';
import { compileCreativePromptMessages } from '../engine/prompts/CreativePromptCompiler';
import {
  DEFAULT_CUSTOM_COT_TEMPLATE,
  MAX_TAVERN_PRESETS,
  TAVERN_INJECTION_CHARACTER_LIMIT,
  exportManagedTavernPreset,
  getActiveTavernPreset,
  getSelectedTavernPresetOrder,
  getTavernSlotKey,
  importTavernPreset,
  loadTavernManagementSettings,
  resolveEffectiveTavernPreset,
  saveTavernManagementSettings,
  type CreativeNarrativeScope,
  type ManagedTavernPresetEntry,
  type TavernAssistantHandling,
  type TavernManagementSettings,
  type TavernPresetItemOverride,
  type TavernPresetScope,
  type TavernResolutionStatus,
} from '../engine/prompts/TavernPresetStore';

type TavernTab = 'library' | 'items' | 'cot' | 'preview';

const scopeLabels: Record<TavernPresetScope, string> = {
  all: '全部正文',
  opening: '仅开局',
  turn: '仅普通回合',
  encounter: '仅战斗/战争',
};

const statusLabels: Record<TavernResolutionStatus, string> = {
  included: '已注入',
  disabled: '已关闭',
  out_of_scope: '作用域不符',
  reserved_runtime_slot: '由游戏运行时接管',
  missing_prompt: '缺少正文',
  empty_content: '空内容',
  assistant_incompatible: 'Assistant 未启用或不兼容',
  over_budget: '超出预算',
};

function downloadJson(fileName: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '-').trim() || '酒馆预设';
}

async function readTavernPresetFile(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    try {
      return await file.text();
    } catch {
      // Some mobile document providers expose File.text() but reject its stream.
      // FileReader remains the broadest fallback for those WebViews.
    }
  }
  if (typeof FileReader === 'undefined') {
    throw new Error('当前浏览器无法读取所选文件，请换用系统文件管理器后重试。');
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取文件失败，请确认文件已完整下载到本机。'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsText(file, 'utf-8');
  });
}

export const TavernManagementPanel: React.FC = () => {
  const [settings, setSettings] = useState<TavernManagementSettings>(
    () => loadTavernManagementSettings(),
  );
  const [tab, setTab] = useState<TavernTab>('library');
  const [feedback, setFeedback] = useState('');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'system' | 'user' | 'assistant'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | TavernResolutionStatus>('all');
  const [expandedSlotKey, setExpandedSlotKey] = useState<string | null>(null);
  const [previewScope, setPreviewScope] = useState<CreativeNarrativeScope>('turn');
  const activeEntry = getActiveTavernPreset(settings);

  const persist = (next: TavernManagementSettings): boolean => {
    try {
      setSettings(saveTavernManagementSettings(next));
      return true;
    } catch (error) {
      setFeedback(
        `设置未保存：${error instanceof Error ? error.message : '浏览器本地存储不可用'}。`
        + ' 请检查手机浏览器是否处于无痕模式，或删除不再使用的预设后重试。',
      );
      return false;
    }
  };

  const updateActiveEntry = (
    transform: (entry: ManagedTavernPresetEntry) => ManagedTavernPresetEntry,
  ): void => {
    if (!activeEntry) return;
    persist({
      ...settings,
      entries: settings.entries.map((entry) => (
        entry.id === activeEntry.id ? transform(entry) : entry
      )),
    });
  };

  const order = activeEntry ? getSelectedTavernPresetOrder(activeEntry) : null;
  const promptMap = useMemo(
    () => new Map(activeEntry?.preset.prompts.map((prompt) => [prompt.identifier, prompt]) ?? []),
    [activeEntry],
  );
  const managementResolution = useMemo(
    () => resolveEffectiveTavernPreset(
      activeEntry ? { ...settings, enabled: true } : settings,
      { scope: previewScope, playerName: '主角' },
    ),
    [activeEntry, settings, previewScope],
  );
  const managementStatusMap = useMemo(
    () => new Map(managementResolution.items.map((item) => [item.slotKey, item])),
    [managementResolution],
  );
  const visibleItems = useMemo(() => {
    if (!activeEntry || !order) return [];
    const normalizedQuery = query.trim().toLowerCase();
    return order.order.map((slot, orderIndex) => {
      const slotKey = getTavernSlotKey(orderIndex, slot.identifier);
      const prompt = promptMap.get(slot.identifier);
      return {
        slot,
        slotKey,
        orderIndex,
        prompt,
        override: activeEntry.customization.itemOverrides[slotKey] ?? {},
        resolution: managementStatusMap.get(slotKey),
      };
    }).filter(({ slot, prompt, resolution }) => {
      if (roleFilter !== 'all' && prompt?.role !== roleFilter) return false;
      if (statusFilter !== 'all' && resolution?.status !== statusFilter) return false;
      if (!normalizedQuery) return true;
      return [
        slot.identifier,
        prompt?.name ?? '',
        prompt?.content ?? '',
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [
    activeEntry,
    managementStatusMap,
    order,
    promptMap,
    query,
    roleFilter,
    statusFilter,
  ]);

  const preview = useMemo(
    () => resolveEffectiveTavernPreset(settings, { scope: previewScope, playerName: '主角' }),
    [settings, previewScope],
  );
  const compilation = useMemo(
    () => compileCreativePromptMessages({
      systemPrompt: '【游戏核心协议、当前事实与结构化写回合同】',
      runtimeUserMessage: '【当前回合运行态上下文与玩家行动】',
      scope: previewScope,
      playerName: '主角',
      settings,
    }),
    [settings, previewScope],
  );

  const updateOverride = (slotKey: string, patch: Partial<TavernPresetItemOverride>): void => {
    updateActiveEntry((entry) => ({
      ...entry,
      customization: {
        ...entry.customization,
        itemOverrides: {
          ...entry.customization.itemOverrides,
          [slotKey]: {
            ...entry.customization.itemOverrides[slotKey],
            ...patch,
          },
        },
      },
    }));
  };

  const clearContentOverride = (slotKey: string): void => {
    updateActiveEntry((entry) => {
      const current = entry.customization.itemOverrides[slotKey] ?? {};
      const rest = { ...current };
      delete rest.contentOverride;
      return {
        ...entry,
        customization: {
          ...entry.customization,
          itemOverrides: {
            ...entry.customization.itemOverrides,
            [slotKey]: rest,
          },
        },
      };
    });
  };

  const setVisibleItemsEnabled = (enabled: boolean): void => {
    if (!activeEntry || visibleItems.length === 0) return;
    const visibleKeys = new Set(visibleItems.map((item) => item.slotKey));
    updateActiveEntry((entry) => {
      const itemOverrides = { ...entry.customization.itemOverrides };
      for (const slotKey of visibleKeys) {
        itemOverrides[slotKey] = {
          ...itemOverrides[slotKey],
          enabled,
        };
      }
      return {
        ...entry,
        customization: {
          ...entry.customization,
          itemOverrides,
        },
      };
    });
    setFeedback(`已${enabled ? '启用' : '关闭'}当前筛选结果中的 ${visibleItems.length} 个条目。`);
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setFeedback(`正在读取“${file.name}”…`);
    try {
      const imported = importTavernPreset(await readTavernPresetFile(file), file.name);
      const duplicate = settings.entries.find(
        (entry) => entry.sourceHash === imported.entry.sourceHash,
      );
      if (duplicate) {
        if (!persist({
          ...settings,
          activePresetId: duplicate.id,
        })) return;
        setFeedback('该预设已经导入，已切换到现有条目。');
        return;
      }
      if (settings.entries.length >= MAX_TAVERN_PRESETS) {
        setFeedback(`最多保存 ${MAX_TAVERN_PRESETS} 份酒馆预设，请先删除不再使用的条目。`);
        return;
      }
      if (!persist({
        ...settings,
        enabled: imported.exceedsInjectionBudget ? settings.enabled : true,
        activePresetId: imported.entry.id,
        entries: [...settings.entries, imported.entry],
      })) return;
      setFeedback([
        `已导入“${imported.entry.name}”。`,
        imported.repaired ? '文件包含常见 JSON 格式问题，已自动修复。' : '',
        imported.exceedsInjectionBudget
          ? '部分条目超过注入预算；预设已保存，请在预览中检查后手动启用。'
          : '',
      ].filter(Boolean).join(' '));
    } catch (error) {
      setFeedback(`导入失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const deleteActive = (): void => {
    if (!activeEntry) return;
    if (typeof window !== 'undefined' && !window.confirm(`确定删除酒馆预设“${activeEntry.name}”吗？`)) {
      return;
    }
    const entries = settings.entries.filter((entry) => entry.id !== activeEntry.id);
    if (!persist({
      ...settings,
      enabled: entries.length > 0 && settings.enabled,
      activePresetId: entries[0]?.id ?? null,
      entries,
    })) return;
    setFeedback('酒馆预设已删除。');
  };

  return (
    <div className="tavern-settings-panel" data-testid="tavern-settings-panel">
      <div className="game-settings-heading">
        <div>
          <h2>酒馆预设与 CoT</h2>
          <p className="game-settings-subtitle">
            启用后，酒馆预设会在硬协议之下主导正文创作风格；不会覆盖本局事实、玩家行动、成人门禁或封存战果。
          </p>
        </div>
        <label className="gs-checkbox-control tavern-master-toggle">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={!activeEntry}
            onChange={(event) => persist({ ...settings, enabled: event.target.checked })}
          />
          <span className="gs-setting-label">启用当前酒馆预设</span>
        </label>
      </div>

      <div className="tavern-tab-list" role="tablist" aria-label="酒馆预设管理">
        {([
          ['library', '预设库'],
          ['items', '提示词开关'],
          ['cot', '自定义 CoT'],
          ['preview', '注入预览'],
        ] as Array<[TavernTab, string]>).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {feedback && (
        <p className="settings-status tavern-feedback" role="status" aria-live="polite">
          {feedback}
        </p>
      )}

      <div className="tavern-tab-workspace">
        {tab === 'library' && (
          <section className={`tavern-library-layout ${settings.entries.length === 0 ? 'has-no-presets' : ''}`}>
            <div className="tavern-library-list">
              {settings.entries.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className={entry.id === activeEntry?.id ? 'active' : ''}
                  onClick={() => persist({ ...settings, activePresetId: entry.id })}
                >
                  <strong>{entry.name}</strong>
                  <span>{entry.preset.prompts.length} 条原始提示词</span>
                  <small>{entry.sourceHash}</small>
                </button>
              ))}
              {settings.entries.length === 0 && (
                <p className="empty-hint">尚未导入酒馆预设。</p>
              )}
            </div>
            <div className="tavern-library-editor">
              <div className="settings-heading-actions">
                <label className="nav-btn primary tavern-import-trigger">
                  导入酒馆预设
                  <input
                    className="tavern-import-input"
                    type="file"
                    accept=".json,application/json,text/json,text/plain,application/octet-stream"
                    aria-label="选择酒馆预设文件"
                    onChange={handleImport}
                  />
                </label>
                <button
                  type="button"
                  className="nav-btn"
                  disabled={!activeEntry}
                  onClick={() => {
                    if (!activeEntry) return;
                    downloadJson(
                      `${safeFileName(activeEntry.name)}-COC-V2.json`,
                      exportManagedTavernPreset(activeEntry),
                    );
                    setFeedback('当前预设已导出；不包含 API、模型、存档或运行态。');
                  }}
                >
                  导出当前预设
                </button>
                <button type="button" className="nav-btn danger" disabled={!activeEntry} onClick={deleteActive}>
                  删除当前预设
                </button>
              </div>
              {activeEntry ? (
                <div className="tavern-profile-grid">
                  <label>
                    预设名称
                    <input
                      value={activeEntry.name}
                      maxLength={80}
                      onChange={(event) => updateActiveEntry((entry) => ({
                        ...entry,
                        name: event.target.value,
                      }))}
                    />
                  </label>
                  <label>
                    当前顺序表
                    <select
                      value={activeEntry.selectedCharacterId}
                      onChange={(event) => updateActiveEntry((entry) => ({
                        ...entry,
                        selectedCharacterId: Number(event.target.value),
                      }))}
                    >
                      {activeEntry.preset.promptOrder.map((item) => (
                        <option key={item.characterId} value={item.characterId}>
                          {item.characterId} · {item.order.length} 项
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>
                    <span>原始提示词</span>
                    <strong>{activeEntry.preset.prompts.length}</strong>
                  </div>
                  <div>
                    <span>当前顺序项</span>
                    <strong>{order?.order.length ?? 0}</strong>
                  </div>
                  <div className="tavern-profile-actions span-2">
                    <button
                      type="button"
                      className="nav-btn primary"
                      onClick={() => setTab('items')}
                    >
                      管理 {order?.order.length ?? 0} 项提示词开关
                    </button>
                    <span>可逐项启用、关闭并设置开局、普通回合或战斗适用范围。</span>
                  </div>
                  <p className="span-2">
                    导入只读取 prompts 与 prompt_order；温度、模型、API 地址、密钥、工具调用和网页搜索配置全部忽略。
                  </p>
                </div>
              ) : (
                <p className="empty-hint">导入 SillyTavern 聊天补全预设 JSON 后可在这里管理。</p>
              )}
            </div>
          </section>
        )}

        {tab === 'items' && (
          <section className="tavern-items-layout">
            {activeEntry ? (
              <>
                <div className="tavern-item-filters">
                  <input
                    aria-label="搜索酒馆条目"
                    placeholder="搜索名称、标识或正文"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <select
                    aria-label="筛选酒馆条目角色"
                    value={roleFilter}
                    onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}
                  >
                    <option value="all">全部角色</option>
                    <option value="system">System</option>
                    <option value="user">User</option>
                    <option value="assistant">Assistant</option>
                  </select>
                  <select
                    aria-label="选择酒馆条目状态范围"
                    value={previewScope}
                    onChange={(event) => setPreviewScope(event.target.value as CreativeNarrativeScope)}
                  >
                    <option value="opening">开局状态</option>
                    <option value="turn">普通回合状态</option>
                    <option value="encounter">战斗/战争状态</option>
                  </select>
                  <select
                    aria-label="筛选酒馆条目状态"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(
                      event.target.value as 'all' | TavernResolutionStatus,
                    )}
                  >
                    <option value="all">全部状态</option>
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <span>显示 {visibleItems.length}/{order?.order.length ?? 0}</span>
                  <div className="tavern-filter-actions">
                    <button
                      type="button"
                      disabled={visibleItems.length === 0}
                      onClick={() => setVisibleItemsEnabled(true)}
                    >
                      启用筛选结果
                    </button>
                    <button
                      type="button"
                      disabled={visibleItems.length === 0}
                      onClick={() => setVisibleItemsEnabled(false)}
                    >
                      关闭筛选结果
                    </button>
                  </div>
                </div>
                <div className="tavern-item-scroll">
                  {visibleItems.map(({
                    slot,
                    slotKey,
                    orderIndex,
                    prompt,
                    override,
                    resolution,
                  }) => {
                    const expanded = expandedSlotKey === slotKey;
                    const enabled = override.enabled ?? slot.enabled;
                    const effectiveContent = override.contentOverride ?? prompt?.content ?? '';
                    return (
                      <article className={`tavern-item-card${expanded ? ' expanded' : ''}`} key={slotKey}>
                        <div className="tavern-item-summary">
                          <label className="gs-checkbox-control">
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={(event) => updateOverride(slotKey, { enabled: event.target.checked })}
                            />
                            <span>{orderIndex + 1}. {prompt?.name || slot.identifier}</span>
                          </label>
                          <span className={`tavern-role role-${prompt?.role ?? 'missing'}`}>
                            {prompt?.role ?? 'missing'}
                          </span>
                          <span className={`tavern-status status-${resolution?.status ?? 'missing_prompt'}`}>
                            {statusLabels[resolution?.status ?? 'missing_prompt']}
                          </span>
                          <span>{effectiveContent.length.toLocaleString()} 字</span>
                          <button
                            type="button"
                            onClick={() => setExpandedSlotKey(expanded ? null : slotKey)}
                          >
                            {expanded ? '收起' : '编辑'}
                          </button>
                        </div>
                        {expanded && (
                          <div className="tavern-item-editor">
                            <label>
                              适用范围
                              <select
                                value={override.scope ?? 'all'}
                                onChange={(event) => updateOverride(slotKey, {
                                  scope: event.target.value as TavernPresetScope,
                                })}
                              >
                                {Object.entries(scopeLabels).map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            </label>
                            {prompt?.role === 'assistant' && (
                              <label>
                                Assistant 处理
                                <select
                                  value={override.assistantHandling ?? 'disabled'}
                                  onChange={(event) => updateOverride(slotKey, {
                                    assistantHandling: event.target.value as TavernAssistantHandling,
                                  })}
                                >
                                  <option value="disabled">不注入</option>
                                  <option value="few_shot">与前一条 User 组成示例</option>
                                  <option value="creative_rule">转为创作规则</option>
                                </select>
                              </label>
                            )}
                            <label className="tavern-item-content">
                              当前有效正文
                              <textarea
                                value={effectiveContent}
                                onChange={(event) => updateOverride(slotKey, {
                                  contentOverride: event.target.value,
                                })}
                              />
                            </label>
                            <div className="tavern-item-editor-actions">
                              <span>{override.contentOverride !== undefined ? '已本地编辑，原件保持不变' : '当前使用导入原文'}</span>
                              <button
                                type="button"
                                disabled={override.contentOverride === undefined}
                                onClick={() => clearContentOverride(slotKey)}
                              >
                                恢复导入原文
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="empty-hint">请先在“预设库”导入一份酒馆预设。</p>
            )}
          </section>
        )}

        {tab === 'cot' && (
          <section className="tavern-cot-layout">
            <label className="gs-checkbox-control">
              <input
                type="checkbox"
                checked={settings.customCot.enabled}
                onChange={(event) => persist({
                  ...settings,
                  customCot: { ...settings.customCot, enabled: event.target.checked },
                })}
              />
              <span className="gs-setting-label">启用自定义 CoT / 创作规划</span>
            </label>
            <label>
              适用范围
              <select
                value={settings.customCot.scope}
                onChange={(event) => persist({
                  ...settings,
                  customCot: {
                    ...settings.customCot,
                    scope: event.target.value as TavernPresetScope,
                  },
                })}
              >
                {Object.entries(scopeLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              规划模板
              <select
                value={settings.customCot.templateId}
                onChange={(event) => persist({
                  ...settings,
                  customCot: {
                    ...settings.customCot,
                    templateId: event.target.value === 'custom' ? 'custom' : 'natural-planning',
                  },
                })}
              >
                <option value="natural-planning">自然规划（推荐）</option>
                <option value="custom">完全自定义</option>
              </select>
            </label>
            <label className="tavern-cot-content">
              CoT / 创作规划正文
              <textarea
                readOnly={settings.customCot.templateId !== 'custom'}
                value={settings.customCot.templateId === 'custom'
                  ? settings.customCot.content
                  : DEFAULT_CUSTOM_COT_TEMPLATE}
                onChange={(event) => persist({
                  ...settings,
                  customCot: { ...settings.customCot, content: event.target.value },
                })}
              />
            </label>
            <p>
              该内容与正文在同一次请求中执行，不会新增一次 API 调用；只约束创作过程，不会写入正文、人物记忆、存档或结构化状态。
            </p>
          </section>
        )}

        {tab === 'preview' && (
          <section className="tavern-preview-layout">
            <div className="tavern-preview-summary">
              <label>
                预览范围
                <select
                  value={previewScope}
                  onChange={(event) => setPreviewScope(event.target.value as CreativeNarrativeScope)}
                >
                  <option value="opening">开局</option>
                  <option value="turn">普通回合</option>
                  <option value="encounter">战斗/战争</option>
                </select>
              </label>
              <strong>
                已注入 {preview.includedCharacters.toLocaleString()} / {TAVERN_INJECTION_CHARACTER_LIMIT.toLocaleString()} 字符
              </strong>
              <span>自定义 CoT：{compilation.customCotIncluded ? '已注入' : '未注入'}</span>
              <span>最终消息：{compilation.messages.length} 条</span>
            </div>
            <ol className="tavern-message-preview">
              {compilation.messages.map((message, index) => (
                <li key={`${message.role}-${index}`}>
                  <strong>{index + 1}. {message.role}</strong>
                  <span>{message.content.length.toLocaleString()} 字符</span>
                  <p>{message.content.slice(0, 180)}{message.content.length > 180 ? '…' : ''}</p>
                </li>
              ))}
            </ol>
            <details className="tavern-exclusion-preview">
              <summary>查看全部条目状态</summary>
              <ul>
                {preview.items.map((item) => (
                  <li key={item.slotKey}>
                    <span>{item.orderIndex + 1}. {item.name}</span>
                    <strong>{statusLabels[item.status]}</strong>
                    <small>{item.characters.toLocaleString()} 字</small>
                  </li>
                ))}
              </ul>
            </details>
          </section>
        )}
      </div>
    </div>
  );
};

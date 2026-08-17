import React, { useEffect, useMemo, useState } from 'react';
import type { RuntimeState } from '../engine/types';
import {
  RUNTIME_VARIABLE_SECTIONS,
  createRuntimeVariableDraft,
  getRuntimeVariableEditor,
  listRuntimeVariableEntities,
  previewRuntimeVariableEdit,
  type RuntimeVariableDraft,
  type RuntimeVariableFieldDefinition,
  type RuntimeVariablePreviewResult,
  type RuntimeVariableSection,
  type RuntimeVariableValue,
} from '../engine/state/RuntimeVariableManager';
import {
  commitRuntimeVariableEdit,
  hasRestorableRuntimeVariableCheckpoint,
  restoreRuntimeVariableCheckpoint,
} from '../engine/save/SaveManager';

interface RuntimeVariableManagerPanelProps {
  runtimeState?: RuntimeState | null;
  saveId?: string | null;
  onRuntimeStateChange?: (runtimeState: RuntimeState) => void;
}

function describeCommit(section: RuntimeVariableSection, target: string, changeCount: number): string {
  const label = RUNTIME_VARIABLE_SECTIONS.find((entry) => entry.id === section)?.label ?? section;
  return `${label} · ${target} · ${changeCount} 项`;
}

export const RuntimeVariableManagerPanel: React.FC<RuntimeVariableManagerPanelProps> = ({
  runtimeState,
  saveId,
  onRuntimeStateChange,
}) => {
  const [section, setSection] = useState<RuntimeVariableSection>('player');
  const [entityId, setEntityId] = useState('');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<RuntimeVariableDraft>({});
  const [preview, setPreview] = useState<RuntimeVariablePreviewResult | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  const sectionDefinition = RUNTIME_VARIABLE_SECTIONS.find((entry) => entry.id === section)!;
  const entities = useMemo(
    () => runtimeState ? listRuntimeVariableEntities(runtimeState, section) : [],
    [runtimeState, section],
  );
  const filteredEntities = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return entities;
    return entities.filter((entry) => `${entry.label} ${entry.detail ?? ''} ${entry.id}`.toLowerCase().includes(keyword));
  }, [entities, search]);
  const selectedEntityId = sectionDefinition.requiresEntity ? entityId : undefined;
  const editor = useMemo(
    () => runtimeState ? getRuntimeVariableEditor(runtimeState, section, selectedEntityId) : null,
    [runtimeState, section, selectedEntityId],
  );

  useEffect(() => {
    setSearch('');
    setEntityId(sectionDefinition.requiresEntity ? (entities[0]?.id ?? '') : '');
    setPreview(null);
    setNotice('');
  }, [section, sectionDefinition.requiresEntity, entities]);

  useEffect(() => {
    setDraft(editor ? createRuntimeVariableDraft(editor) : {});
    setPreview(null);
  }, [editor]);

  useEffect(() => {
    let cancelled = false;
    if (!saveId) {
      setCanUndo(false);
      return () => { cancelled = true; };
    }
    void hasRestorableRuntimeVariableCheckpoint(saveId)
      .then((result) => {
        if (!cancelled) setCanUndo(result);
      })
      .catch(() => {
        if (!cancelled) setCanUndo(false);
      });
    return () => { cancelled = true; };
  }, [saveId, runtimeState]);

  if (!runtimeState || !saveId || !onRuntimeStateChange) {
    return (
      <section className="runtime-variable-manager empty-state">
        <div className="settings-heading">
          <div>
            <h2>变量管理</h2>
            <p>请先读取或开始一个存档，再从设置中进入变量管理。</p>
          </div>
        </div>
        <div className="runtime-variable-safety-note">
          此工具只修改当前存档，不创建新回合，也不会调用 API。
        </div>
      </section>
    );
  }

  const updateField = (key: string, value: RuntimeVariableValue) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setPreview(null);
    setNotice('');
  };

  const handlePreview = () => {
    const result = previewRuntimeVariableEdit(runtimeState, section, selectedEntityId, draft);
    setPreview(result);
    setNotice(result.ok ? '预览已生成。确认前请核对每一项变化。' : '预览未通过，请先修正下列问题。');
  };

  const handleCommit = async () => {
    if (!preview?.ok || busy) return;
    setBusy(true);
    setNotice('正在原子保存变量修改…');
    try {
      const target = editor?.title ?? sectionDefinition.label;
      const result = await commitRuntimeVariableEdit({
        saveId,
        previousRuntimeState: runtimeState,
        runtimeState: preview.state,
        summary: describeCommit(section, target, preview.changes.length),
      });
      if (!result) throw new Error('当前存档不存在，变量修改没有保存。');
      onRuntimeStateChange(result.save.runtimeState);
      setPreview(null);
      setCanUndo(true);
      setNotice('变量修改已保存；可在下一次变量修改前撤销本次操作。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleUndo = async () => {
    if (!canUndo || busy) return;
    setBusy(true);
    setNotice('正在恢复变量修改前的检查点…');
    try {
      const restored = await restoreRuntimeVariableCheckpoint(saveId);
      if (!restored) throw new Error('撤销检查点已失效；当前存档可能在修改后继续发生了变化。');
      onRuntimeStateChange(restored.runtimeState);
      setCanUndo(false);
      setPreview(null);
      setNotice('最近一次变量修改已撤销。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="runtime-variable-manager">
      <div className="settings-heading runtime-variable-heading">
        <div>
          <h2>变量管理</h2>
          <p>用受控表单修正当前存档。稳定 ID、历史记忆、战斗快照和引擎字段不会开放修改。</p>
        </div>
        <button className="nav-btn" type="button" disabled={!canUndo || busy} onClick={handleUndo}>
          撤销最近修改
        </button>
      </div>

      <div className="runtime-variable-safety-note">
        修改会立即成为当前存档的真实状态，但不会自动补写剧情或 NPC 记忆。每次确认前都会先做领域校验并建立独立撤销点。
      </div>

      <div className="runtime-variable-layout">
        <nav className="runtime-variable-sections" aria-label="变量分类">
          {RUNTIME_VARIABLE_SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === section ? 'active' : ''}
              onClick={() => setSection(entry.id)}
            >
              <strong>{entry.label}</strong>
              <span>{entry.description}</span>
            </button>
          ))}
        </nav>

        <div className="runtime-variable-workspace">
          {sectionDefinition.requiresEntity && (
            <div className="runtime-variable-entity-picker">
              <label>
                <span>选择{sectionDefinition.label}条目</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="按名称、说明或稳定 ID 搜索"
                />
              </label>
              <div className="runtime-variable-entities" role="listbox" aria-label={`${sectionDefinition.label}条目`}>
                {filteredEntities.map((entity) => (
                  <button
                    key={entity.id}
                    type="button"
                    role="option"
                    aria-selected={entity.id === entityId}
                    className={entity.id === entityId ? 'active' : ''}
                    onClick={() => setEntityId(entity.id)}
                  >
                    <strong>{entity.label}</strong>
                    <span>{entity.detail || entity.id}</span>
                  </button>
                ))}
                {filteredEntities.length === 0 && <p>当前分类没有可编辑条目。</p>}
              </div>
            </div>
          )}

          {editor ? (
            <div className="runtime-variable-editor">
              <header>
                <h3>{editor.title}</h3>
                <p>{editor.subtitle}</p>
              </header>
              <div className="runtime-variable-field-grid">
                {editor.fields.map((field) => (
                  <VariableField
                    key={field.key}
                    field={field}
                    value={field.type === 'readonly' ? field.value : (draft[field.key] ?? field.value)}
                    disabled={busy}
                    onChange={(value) => updateField(field.key, value)}
                  />
                ))}
              </div>
              <div className="runtime-variable-actions">
                <button className="nav-btn primary" type="button" disabled={busy} onClick={handlePreview}>
                  预览修改
                </button>
                <button
                  className="nav-btn"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDraft(createRuntimeVariableDraft(editor));
                    setPreview(null);
                    setNotice('已恢复为当前存档值，尚未写入任何内容。');
                  }}
                >
                  放弃填写
                </button>
              </div>
            </div>
          ) : (
            <div className="runtime-variable-empty">请选择一个已有条目。</div>
          )}
        </div>
      </div>

      {notice && <div className="runtime-variable-notice" role="status">{notice}</div>}

      {preview && (
        <div className={`runtime-variable-preview ${preview.ok ? 'valid' : 'invalid'}`}>
          <h3>{preview.ok ? '待确认的修改' : '无法应用修改'}</h3>
          {preview.ok ? (
            <>
              <ul>
                {preview.changes.map((change) => (
                  <li key={change.key}>
                    <strong>{change.label}</strong>
                    <span>{change.before}</span>
                    <b>→</b>
                    <span>{change.after}</span>
                  </li>
                ))}
              </ul>
              {preview.warnings.map((warning) => <p className="warning" key={warning}>{warning}</p>)}
              <div className="runtime-variable-actions">
                <button className="nav-btn primary" type="button" disabled={busy} onClick={handleCommit}>
                  确认写入当前存档
                </button>
                <button className="nav-btn" type="button" disabled={busy} onClick={() => setPreview(null)}>
                  返回修改
                </button>
              </div>
            </>
          ) : (
            <ul>{preview.errors.map((error) => <li key={error}>{error}</li>)}</ul>
          )}
        </div>
      )}
    </section>
  );
};

interface VariableFieldProps {
  field: RuntimeVariableFieldDefinition;
  value: RuntimeVariableValue;
  disabled: boolean;
  onChange: (value: RuntimeVariableValue) => void;
}

const VariableField: React.FC<VariableFieldProps> = ({ field, value, disabled, onChange }) => {
  const className = `runtime-variable-field ${field.wide ? 'wide' : ''} ${field.type === 'checkbox' ? 'checkbox' : ''}`;
  if (field.type === 'readonly') {
    return (
      <div className={className}>
        <span>{field.label}</span>
        <output>{String(value)}</output>
        {field.description && <small>{field.description}</small>}
      </div>
    );
  }
  if (field.type === 'checkbox') {
    return (
      <label className={className}>
        <input type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        <span>{field.label}</span>
        {field.description && <small>{field.description}</small>}
      </label>
    );
  }
  if (field.type === 'select') {
    return (
      <label className={className}>
        <span>{field.label}</span>
        <select value={String(value)} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {field.description && <small>{field.description}</small>}
      </label>
    );
  }
  if (field.type === 'textarea') {
    return (
      <label className={className}>
        <span>{field.label}</span>
        <textarea value={String(value)} disabled={disabled} onChange={(event) => onChange(event.target.value)} rows={3} />
        {field.description && <small>{field.description}</small>}
      </label>
    );
  }
  return (
    <label className={className}>
      <span>{field.label}</span>
      <input
        type={field.type === 'number' ? 'number' : 'text'}
        value={value as string | number}
        min={field.min}
        max={field.max}
        step={field.step}
        disabled={disabled}
        onChange={(event) => onChange(
          field.type === 'number'
            ? (event.target.value === '' ? '' : Number(event.target.value))
            : event.target.value,
        )}
      />
      {field.description && <small>{field.description}</small>}
    </label>
  );
};

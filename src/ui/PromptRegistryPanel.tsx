import React, { useMemo, useRef, useState } from 'react';
import { getPromptRegistry, type PromptRegistryCategory, type PromptRegistryEntry } from '../engine/prompts/PromptRegistry';
import {
  buildPromptOverridesExport,
  importPromptOverridesFromJson,
  makePromptOverridesExportFilename,
} from '../engine/prompts/PromptImportExport';
import {
  clearPromptOverrides,
  deletePromptOverride,
  listPromptOverrides,
  savePromptOverride,
  validatePromptOverrideContent,
} from '../engine/prompts/PromptOverrideStore';
import {
  getEditLevelLabel,
  getPromptEntryDisplayModel,
  getPromptRegistryCategorySummaries,
  getPromptRegistryEntriesByCategory,
  getRiskLevelLabel,
  type PromptCategorySummary,
} from './promptRegistryPanelModel';

function boolLabel(value?: boolean): string {
  return value ? '是' : '否';
}

function renderMetaRow(label: string, value?: React.ReactNode): React.ReactNode {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="prompt-entry-meta-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

interface PromptEntryCardProps {
  entry: PromptRegistryEntry;
  storage?: Storage;
  allowHighRiskEditing: boolean;
  onRevision: () => void;
}

const restoreConfirmText = '恢复默认会删除当前条目的用户自定义提示词，并重新使用游戏内置默认提示词。是否继续？';
const highRiskSaveConfirmText = '这是高风险或协议锁定提示词，修改错误可能导致状态写回、JSON 输出或记忆压缩异常。是否保存？';

const PromptEntryCard: React.FC<PromptEntryCardProps> = ({ entry, storage, allowHighRiskEditing, onRevision }) => {
  const riskLabel = getRiskLevelLabel(entry.riskLevel);
  const editLabel = getEditLevelLabel(entry.editLevel);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState('');
  const [revision, setRevision] = useState(0);
  const model = getPromptEntryDisplayModel(entry, { storage, allowHighRiskEditing });

  void revision;

  const beginEdit = () => {
    setDraft(model.contentText);
    setFeedback('');
    setIsEditing(true);
  };

  const saveDraft = () => {
    const needsHighRiskConfirm = entry.riskLevel === 'high' || entry.editLevel === 'locked' || entry.protocolBound;
    if (needsHighRiskConfirm && typeof window !== 'undefined' && !window.confirm(highRiskSaveConfirmText)) {
      return;
    }

    try {
      savePromptOverride(entry.id, draft, storage);
      setIsEditing(false);
      setFeedback('配置已保存。当前使用用户自定义版本。');
      setRevision((value) => value + 1);
      onRevision();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '保存失败。');
    }
  };

  const restoreDefault = () => {
    const confirmed = typeof window === 'undefined' || window.confirm(restoreConfirmText);
    if (!confirmed) return;

    try {
      deletePromptOverride(entry.id, storage);
      setDraft(entry.defaultContent ?? entry.defaultContentTemplate ?? entry.defaultContentPreview ?? '');
      setIsEditing(false);
      setFeedback('已恢复默认版本。');
      setRevision((value) => value + 1);
      onRevision();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '恢复默认失败。');
    }
  };

  const validation = isEditing ? validatePromptOverrideContent(draft) : { ok: true };

  return (
    <details
      className={`prompt-entry-card risk-${entry.riskLevel} edit-${entry.editLevel}`}
      data-prompt-id={entry.id}
      data-prompt-editable={model.isEditable ? 'true' : 'false'}
      data-prompt-customized={model.isCustomized ? 'true' : 'false'}
    >
      <summary>
        <div className="prompt-entry-summary-main">
          <div className="prompt-entry-badges">
            <span className={`prompt-risk-badge risk-${entry.riskLevel}`}>{riskLabel}</span>
            <span className={`prompt-edit-badge edit-${entry.editLevel}`}>{editLabel}</span>
            {model.isEditable && <span className="prompt-editable-badge">可编辑</span>}
            {model.isCustomized && <span className="prompt-customized-badge">已自定义</span>}
            {!entry.runtimeUsed && <span className="prompt-readonly-badge">非运行时提示词</span>}
          </div>
          <strong>{model.displayTitle}</strong>
          <p>{model.userDescription}</p>
          <pre className="prompt-content-preview">{model.contentPreview}</pre>
        </div>
      </summary>

      <div className="prompt-entry-detail-body">
        <section className="prompt-content-block">
          <h4>提示词正文 / 模板正文</h4>
          {model.isEditable && (
            <div className="prompt-override-toolbar">
              <p>
                此条保存后会作为 prompt override 存入本地，并在对应运行时提示词下一次组装时生效。
              </p>
              {!isEditing && (
                <button
                  type="button"
                  className="nav-btn"
                  data-prompt-action="edit"
                  onClick={beginEdit}
                >
                  编辑
                </button>
              )}
            </div>
          )}
          {!model.isEditable && model.readonlyReason && (
            <p className="prompt-content-notes">{model.readonlyReason}</p>
          )}

          {isEditing ? (
            <div className="prompt-override-editor">
              <textarea
                className="prompt-override-textarea"
                value={draft}
                onChange={(event) => {
                  setDraft(event.currentTarget.value);
                  setFeedback('');
                }}
              />
              {!validation.ok && <p className="prompt-override-error">{validation.error}</p>}
              <div className="prompt-override-actions">
                <button
                  type="button"
                  className="primary-btn"
                  data-prompt-action="save"
                  disabled={!validation.ok}
                  onClick={saveDraft}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="nav-btn"
                  data-prompt-action="cancel"
                  onClick={() => {
                    setIsEditing(false);
                    setFeedback('');
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="nav-btn danger"
                  data-prompt-action="restore-default"
                  onClick={restoreDefault}
                >
                  恢复默认
                </button>
              </div>
            </div>
          ) : (
            <pre className={`prompt-content-text view-${model.contentViewType}`}>{model.contentText}</pre>
          )}

          {!model.isEditable && model.isCustomized && (
            <button
              type="button"
              className="nav-btn danger"
              data-prompt-action="restore-default"
              onClick={restoreDefault}
            >
              恢复默认
            </button>
          )}
          {model.isCustomized && !isEditing && <p className="prompt-content-notes">当前使用用户自定义版本。</p>}
          {model.contentNotes && <p className="prompt-content-notes">{model.contentNotes}</p>}
          {feedback && <p className="prompt-override-feedback">{feedback}</p>}
        </section>

        <details className="prompt-advanced-info">
          <summary>高级信息</summary>
          <div className="prompt-entry-meta">
            {renderMetaRow('id', entry.id)}
            {renderMetaRow('category', entry.category)}
            {renderMetaRow('displayCategory', model.displayCategory)}
            {renderMetaRow('sourceFile', entry.sourceFile)}
            {renderMetaRow('sourceSymbol', entry.sourceSymbol)}
            {renderMetaRow('usedBy', entry.usedBy.join(' / '))}
            {renderMetaRow('riskLevel', `${entry.riskLevel} / ${riskLabel}`)}
            {renderMetaRow('editLevel', `${entry.editLevel} / ${editLabel}`)}
            {renderMetaRow('runtimeUsed', boolLabel(entry.runtimeUsed))}
            {renderMetaRow('protocolBound', boolLabel(entry.protocolBound))}
            {renderMetaRow('worldbookBound', boolLabel(entry.worldbookBound))}
            {renderMetaRow('defaultContentPreview', entry.defaultContentPreview)}
            {renderMetaRow('notes', entry.notes)}
          </div>
        </details>
      </div>
    </details>
  );
};

interface PromptCategoryCardProps {
  summary: PromptCategorySummary;
  onSelect: (category: PromptRegistryCategory) => void;
}

const PromptCategoryCard: React.FC<PromptCategoryCardProps> = ({ summary, onSelect }) => (
  <button
    type="button"
    className="prompt-category-card"
    onClick={() => onSelect(summary.category)}
  >
    <div>
      <strong>{summary.label}</strong>
      <span>{summary.category}</span>
    </div>
    <p>{summary.description}</p>
    <div className="prompt-category-stats">
      <span>{summary.totalCount} 条</span>
      <span>{getRiskLevelLabel('high')} {summary.highCount}</span>
      <span>{getEditLevelLabel('locked')} {summary.lockedCount}</span>
    </div>
  </button>
);

interface PromptRegistryPanelProps {
  initialCategory?: PromptRegistryCategory | null;
  storage?: Storage;
  initialHighRiskEditingEnabled?: boolean;
}

const highRiskEnableConfirmText = '高风险提示词与状态写回、JSON 输出、NPC 建档、地图写回、记忆压缩等协议强绑定。修改错误可能导致时间不推进、NPC 不建档、记忆或地图无法写入、AI 输出无法解析。恢复默认只能让后续回合重新使用默认提示词，不会自动修复已经写入存档的错误状态。是否继续开启高风险项编辑？';
const restoreAllConfirmText = '这将删除所有用户自定义提示词，并让后续回合重新使用游戏内置默认提示词。已经发生的回合和已经写入存档的状态不会自动回滚。是否继续？';
const importConfirmText = '导入提示词将替换当前所有用户自定义提示词。导入文件中的高风险项可能影响状态写回或 JSON 输出。是否继续？';
const importHighRiskText = '导入文件包含高风险或协议锁定提示词。修改错误可能导致后续回合无法正常写回状态。恢复默认可让后续回合重新使用默认提示词，但不会回滚已发生的回合状态。';

function downloadJsonFile(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const PromptRegistryPanel: React.FC<PromptRegistryPanelProps> = ({
  initialCategory = null,
  storage,
  initialHighRiskEditingEnabled = false,
}) => {
  const summaries = useMemo(() => getPromptRegistryCategorySummaries(), []);
  const [activeCategory, setActiveCategory] = useState<PromptRegistryCategory | null>(initialCategory);
  const [allowHighRiskEditing, setAllowHighRiskEditing] = useState(initialHighRiskEditingEnabled);
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeSummary = summaries.find((summary) => summary.category === activeCategory);
  const activeEntries = useMemo(
    () => (activeCategory ? getPromptRegistryEntriesByCategory(activeCategory) : []),
    [activeCategory],
  );
  const registry = useMemo(() => getPromptRegistry(), []);
  const customizedHighRiskCount = useMemo(() => {
    const entryById = new Map(registry.map((entry) => [entry.id, entry]));
    return listPromptOverrides(storage).filter((override) => {
      const entry = entryById.get(override.promptId);
      return entry && (entry.riskLevel === 'high' || entry.editLevel === 'locked' || entry.protocolBound);
    }).length;
  }, [registry, revision, storage]);

  const bumpRevision = () => setRevision((value) => value + 1);

  const handleToggleHighRisk = () => {
    if (allowHighRiskEditing) {
      setAllowHighRiskEditing(false);
      return;
    }

    const confirmed = typeof window === 'undefined' || window.confirm(highRiskEnableConfirmText);
    if (!confirmed) return;
    setAllowHighRiskEditing(true);
    setNotice('已开启高风险项编辑。本开关不持久化，重新打开设置页会恢复关闭。');
  };

  const handleRestoreAll = () => {
    const confirmed = typeof window === 'undefined' || window.confirm(restoreAllConfirmText);
    if (!confirmed) return;

    try {
      clearPromptOverrides(storage);
      bumpRevision();
      setNotice('已恢复全部默认提示词。后续回合将重新使用游戏内置默认提示词。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '恢复全部默认失败。');
    }
  };

  const handleExport = () => {
    downloadJsonFile(makePromptOverridesExportFilename(), buildPromptOverridesExport(storage));
    setNotice('已导出当前提示词配置。导出内容包含可运行时覆盖提示词的当前正文，不包含 API Key 或存档。');
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    const text = await file.text();
    const confirmed = typeof window === 'undefined' || window.confirm(importConfirmText);
    if (!confirmed) return;

    const result = importPromptOverridesFromJson(text, storage);
    if (!result.ok) {
      setNotice(result.error ?? '导入失败。');
      return;
    }

    bumpRevision();
    setNotice([
      `已导入 ${result.importedCount} 条自定义提示词，跳过 ${result.skipped.length} 条。`,
      result.hasHighRiskOverrides ? importHighRiskText : '',
    ].filter(Boolean).join(' '));
  };

  return (
    <div className="prompt-registry-panel">
      <div className="settings-heading">
        <div>
          <h2>提示词管理</h2>
          <p>
            查看游戏当前使用的提示词片段。提示词会影响叙事风格、NPC 反应、记忆压缩、地图写回与世界动态。
            低 / 中风险运行时提示词默认可编辑；高风险与协议锁定项需手动开启高风险编辑。
          </p>
        </div>
      </div>

      <div className="prompt-readonly-notice">
        当前页面管理的只是提示词 override，不包含 API Key、API 配置、存档或游戏状态。协议锁定项与状态写回强绑定，默认只读。
      </div>
      <div className="prompt-global-actions">
        <button
          type="button"
          className={`nav-btn ${allowHighRiskEditing ? 'primary' : ''}`}
          data-prompt-global-action="toggle-high-risk"
          onClick={handleToggleHighRisk}
        >
          高风险项编辑：{allowHighRiskEditing ? '开启' : '关闭'}
        </button>
        <button
          type="button"
          className="nav-btn danger"
          data-prompt-global-action="restore-all"
          onClick={handleRestoreAll}
        >
          恢复全部默认
        </button>
        <button
          type="button"
          className="nav-btn"
          data-prompt-global-action="import"
          onClick={handleImportClick}
        >
          导入提示词
        </button>
        <button
          type="button"
          className="nav-btn"
          data-prompt-global-action="export"
          onClick={handleExport}
        >
          导出提示词
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="prompt-import-input"
          onChange={handleImportFile}
        />
      </div>
      <p className="prompt-risk-note">
        高风险与协议锁定提示词涉及 JSON 格式、状态写回和本地校验，默认只读。
      </p>
      {customizedHighRiskCount > 0 && !allowHighRiskEditing && (
        <p className="prompt-content-notes">已自定义高风险项正在生效；如需编辑，请重新开启高风险项编辑。</p>
      )}
      {notice && <p className="prompt-override-feedback">{notice}</p>}

      {!activeCategory && (
        <div className="prompt-category-grid" aria-label="提示词索引">
          {summaries.map((summary) => (
            <PromptCategoryCard key={summary.category} summary={summary} onSelect={setActiveCategory} />
          ))}
        </div>
      )}

      {activeCategory && activeSummary && (
        <div className="prompt-category-detail">
          <div className="prompt-category-detail-head">
            <button type="button" className="nav-btn" onClick={() => setActiveCategory(null)}>
              返回分类
            </button>
            <div>
              <h3>{activeSummary.label}</h3>
              <p>
                {activeSummary.category} · {activeSummary.totalCount} 条 · 高风险 {activeSummary.highCount}
                {' · '}协议锁定 {activeSummary.lockedCount}
              </p>
              <p>
                本分类展示对应模块使用的提示词正文或模板。带有“协议锁定”的条目与状态写回、JSON 格式或本地校验强绑定，当前仅供查看。
              </p>
            </div>
          </div>

          <div className="prompt-entry-list">
            {activeEntries.map((entry) => (
              <PromptEntryCard
                key={`${entry.id}:${revision}:${allowHighRiskEditing ? 'high' : 'default'}`}
                entry={entry}
                storage={storage}
                allowHighRiskEditing={allowHighRiskEditing}
                onRevision={bumpRevision}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

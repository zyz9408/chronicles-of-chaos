import { useMemo, useState } from 'react';
import {
  MAX_PERSISTENT_PROMPTS,
  MAX_PERSISTENT_PROMPT_LENGTH,
  type PersistentPromptEntry,
} from '../engine/prompts/PersistentPromptStore';
import { PanelNotice, SystemModalFrame } from './SystemPanelPrimitives';

function createPersistentPromptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `persistent-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function PersistentPromptPanel({
  entries,
  onChange,
  onClose,
}: {
  entries: readonly PersistentPromptEntry[];
  onChange: (entries: PersistentPromptEntry[]) => void;
  onClose: () => void;
}): React.ReactElement {
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');
  const enabledCount = useMemo(
    () => entries.filter((entry) => entry.enabled).length,
    [entries],
  );
  const trimmedDraft = draft.trim();
  const canAdd = Boolean(trimmedDraft) && entries.length < MAX_PERSISTENT_PROMPTS;

  const addPrompt = () => {
    if (!canAdd) return;
    onChange([
      ...entries,
      {
        id: createPersistentPromptId(),
        content: trimmedDraft.slice(0, MAX_PERSISTENT_PROMPT_LENGTH),
        enabled: true,
      },
    ]);
    setDraft('');
    setStatus('已新增并启用。');
  };

  const togglePrompt = (id: string) => {
    onChange(entries.map((entry) => (
      entry.id === id ? { ...entry, enabled: !entry.enabled } : entry
    )));
    setStatus('');
  };

  const removePrompt = (id: string) => {
    onChange(entries.filter((entry) => entry.id !== id));
    setStatus('已删除。');
  };

  return (
    <SystemModalFrame
      title="永久提示词"
      subtitle="PERSISTENT PROMPTS"
      ariaLabel="永久提示词"
      onClose={onClose}
      className="persistent-prompt-modal"
      testId="persistent-prompt-panel"
    >
      <PanelNotice className="persistent-prompt-notice">
        已启用 {enabledCount}/{entries.length} 条。永久提示词会用于之后的主剧情与战后正文，
        但不会被当作本回合行动，也不会写入人物记忆或游戏状态。
      </PanelNotice>

      <div className="persistent-prompt-compose">
        <textarea
          value={draft}
          maxLength={MAX_PERSISTENT_PROMPT_LENGTH}
          rows={3}
          placeholder="例如：减少八股套话，让历史人物的发言更符合其经历与性格。"
          aria-label="新增永久提示词"
          onChange={(event) => {
            setDraft(event.target.value);
            setStatus('');
          }}
        />
        <div className="persistent-prompt-compose-footer">
          <small>{draft.length}/{MAX_PERSISTENT_PROMPT_LENGTH}</small>
          <button
            type="button"
            className="primary-btn"
            disabled={!canAdd}
            onClick={addPrompt}
          >
            新增并启用
          </button>
        </div>
      </div>

      {entries.length > 0 ? (
        <div className="persistent-prompt-list" aria-label="永久提示词列表">
          {entries.map((entry, index) => (
            <article
              key={entry.id}
              className="persistent-prompt-item"
              data-enabled={entry.enabled ? 'true' : 'false'}
            >
              <label>
                <input
                  type="checkbox"
                  checked={entry.enabled}
                  onChange={() => togglePrompt(entry.id)}
                />
                <span>{entry.enabled ? '启用' : '停用'}</span>
              </label>
              <p><strong>{index + 1}.</strong> {entry.content}</p>
              <button
                type="button"
                className="persistent-prompt-delete"
                aria-label={`删除永久提示词 ${index + 1}`}
                onClick={() => removePrompt(entry.id)}
              >
                删除
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="persistent-prompt-empty">
          暂无永久提示词。新增后默认启用，可随时逐条停用或删除。
        </div>
      )}

      <div className="persistent-prompt-status" role="status" aria-live="polite">
        {entries.length >= MAX_PERSISTENT_PROMPTS
          ? `最多保存 ${MAX_PERSISTENT_PROMPTS} 条永久提示词。`
          : status}
      </div>
    </SystemModalFrame>
  );
}

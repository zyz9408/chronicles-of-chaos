import React, { useCallback, useEffect, useRef, useState } from 'react';

interface MobileActionEditorProps {
  value: string;
  disabled?: boolean;
  onConfirm: (value: string) => void;
}

const ACTION_PLACEHOLDER = '输入你的行动……';

export const MobileActionEditor: React.FC<MobileActionEditorProps> = ({
  value,
  disabled = false,
  onConfirm,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const closeEditor = useCallback(() => {
    setIsOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (disabled && isOpen) closeEditor();
  }, [closeEditor, disabled, isOpen]);

  const openEditor = () => {
    if (disabled) return;
    setDraft(value);
    setIsOpen(true);
  };

  const confirmEditor = () => {
    onConfirm(draft);
    closeEditor();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="mobile-action-draft-trigger"
        aria-label="打开行动编辑器"
        title="点击打开大输入框编辑行动"
        disabled={disabled}
        onClick={openEditor}
      >
        {value.trim() || <span>{ACTION_PLACEHOLDER}</span>}
      </button>

      {isOpen && (
        <div
          className="mobile-action-editor-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor();
          }}
        >
          <section
            className="mobile-action-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-action-editor-title"
          >
            <header>
              <div>
                <h2 id="mobile-action-editor-title">编辑玩家行动</h2>
                <p>确认后回填行动栏，不会立即发送。</p>
              </div>
            </header>
            <textarea
              autoFocus
              aria-label="编辑行动内容"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                closeEditor();
              }}
              placeholder={ACTION_PLACEHOLDER}
            />
            <footer>
              <button type="button" onClick={closeEditor}>
                取消
              </button>
              <button type="button" className="mobile-action-editor-confirm" onClick={confirmEditor}>
                确定
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
};

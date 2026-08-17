import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { NarrativePerspective } from '../engine/types';
import {
  getNarrativePerspectiveProfile,
  narrativePerspectiveProfiles,
} from '../engine/settings/NarrativePerspective';

interface NarrativePerspectiveDialogProps {
  currentPerspective: NarrativePerspective;
  onSelect: (perspective: NarrativePerspective) => void;
  onClose: () => void;
}

export function NarrativePerspectiveDialog({
  currentPerspective,
  onSelect,
  onClose,
}: NarrativePerspectiveDialogProps) {
  const currentProfile = getNarrativePerspectiveProfile(currentPerspective);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="game-difficulty-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="game-difficulty-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="narrative-perspective-dialog-title"
      >
        <header className="game-difficulty-dialog-header">
          <div>
            <h2 id="narrative-perspective-dialog-title">更改本局叙事人称</h2>
            <p>
              当前游戏：<strong>{currentProfile.label}</strong>
            </p>
          </div>
          <button type="button" aria-label="关闭叙事人称更改" onClick={onClose}>×</button>
        </header>

        <p className="game-difficulty-dialog-scope">
          选择后立即保存到当前存档，只影响之后新生成的【旁白】；不会改写历史正文、角色对白或其他存档。
        </p>

        <div
          className="game-difficulty-dialog-grid narrative-perspective-dialog-grid"
          role="radiogroup"
          aria-label="本局正文叙事人称"
        >
          {narrativePerspectiveProfiles.map((profile) => {
            const active = profile.id === currentPerspective;
            return (
              <button
                key={profile.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={active ? 'active' : ''}
                onClick={() => onSelect(profile.id)}
              >
                <span>
                  <strong>{profile.label}</strong>
                  <em>{profile.marker}</em>
                  {active ? <small>当前</small> : null}
                </span>
                <p>{profile.summary}</p>
              </button>
            );
          })}
        </div>

        <footer>
          <button type="button" className="nav-btn" onClick={onClose}>取消</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

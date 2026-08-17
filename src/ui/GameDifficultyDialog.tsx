import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { GameDifficultyLevel } from '../engine/types';
import {
  combatDifficultyProfiles,
  gameDifficultyProfiles,
  getEncounterDifficultyProfile,
  getGameDifficultyProfile,
  warDifficultyProfiles,
  type EncounterDifficultyKind,
} from '../engine/settings/GameDifficulty';

interface GameDifficultyDialogProps {
  currentDifficulty: GameDifficultyLevel;
  difficultyKind?: 'ordinary' | EncounterDifficultyKind;
  onSelect: (difficulty: GameDifficultyLevel) => void;
  onClose: () => void;
}

export function GameDifficultyDialog({
  currentDifficulty,
  difficultyKind = 'ordinary',
  onSelect,
  onClose,
}: GameDifficultyDialogProps) {
  const profiles = difficultyKind === 'ordinary'
    ? gameDifficultyProfiles
    : difficultyKind === 'combat'
      ? combatDifficultyProfiles
      : warDifficultyProfiles;
  const currentProfile = difficultyKind === 'ordinary'
    ? getGameDifficultyProfile(currentDifficulty)
    : getEncounterDifficultyProfile(difficultyKind, currentDifficulty);
  const subject = difficultyKind === 'ordinary'
    ? '普通判定'
    : difficultyKind === 'combat'
      ? '个人战斗'
      : '战争';
  const marker = (profile: (typeof profiles)[number]) => {
    if (difficultyKind === 'ordinary') {
      const ordinaryProfile = getGameDifficultyProfile(profile.id);
      return `Y${ordinaryProfile.difficultyOffset >= 0 ? '+' : ''}${ordinaryProfile.difficultyOffset}`;
    }
    const encounterProfile = getEncounterDifficultyProfile(difficultyKind, profile.id);
    return `我方倍率 ×${encounterProfile.playerPowerMultiplier.toFixed(2)}`;
  };

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
        aria-labelledby="game-difficulty-dialog-title"
      >
        <header className="game-difficulty-dialog-header">
          <div>
            <h2 id="game-difficulty-dialog-title">更改当前{subject}难度</h2>
            <p>
              当前游戏：<strong>{currentProfile.label}</strong>
            </p>
          </div>
          <button type="button" aria-label="关闭游戏难度更改" onClick={onClose}>×</button>
        </header>

        <p className="game-difficulty-dialog-scope">
          选择后立即保存到当前存档，只影响之后新发生的{subject}；不会重算已有结果，也不会改变其他存档。
        </p>

        <div
          className="game-difficulty-dialog-grid"
          role="radiogroup"
          aria-label={`当前${subject}难度`}
        >
          {gameDifficultyProfiles.map((profile) => {
            const active = profile.id === currentDifficulty;
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
                  <em>
                    {marker(profile)}
                  </em>
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

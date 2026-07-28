import React from 'react';
import type { WorldBookManifest, WorldlineKnowledgeMode } from '../engine/types';
import { getWorldlineKnowledgeModeOptions } from './worldlineKnowledgeModeModel';

interface Props {
  worldBooks: WorldBookManifest[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  selectedKnowledgeMode: WorldlineKnowledgeMode;
  onKnowledgeModeChange: (mode: WorldlineKnowledgeMode) => void;
}

export const WorldBookSelect: React.FC<Props> = ({
  worldBooks,
  selectedId,
  onSelect,
  selectedKnowledgeMode,
  onKnowledgeModeChange,
}) => {
  const knowledgeModeOptions = getWorldlineKnowledgeModeOptions();
  const selectedKnowledgeModeOption = knowledgeModeOptions.find((option) => option.mode === selectedKnowledgeMode);

  return (
    <div className="worldbook-select">
      <h2>选择世界书</h2>
      <div className="worldbook-list">
        {worldBooks.length === 0 && (
          <p className="empty-hint">暂无可用的世界书</p>
        )}
        {worldBooks.map((wb) => (
          <div
            key={wb.id}
            className={`worldbook-card-row ${selectedId === wb.id ? 'selected' : ''}`}
          >
            <button
              type="button"
              className={`worldbook-card ${selectedId === wb.id ? 'selected' : ''}`}
              onClick={() => onSelect(wb.id)}
            >
              <div className="wb-header">
                <span className="wb-name">{wb.name}</span>
                <span className={`wb-source ${wb.source}`}>
                  {wb.source === 'official' ? '官方' : '自定义'}
                </span>
              </div>
              <p className="wb-description">{wb.description ?? '暂无描述'}</p>
              <div className="wb-meta">
                <span>v{wb.version}</span>
                <span>{wb.genre}</span>
                <span>{wb.author}</span>
              </div>
            </button>
            {selectedId === wb.id && (
              <aside className="worldline-mode-panel" aria-label="史实资料贴合度">
                <label className="worldline-mode-label" htmlFor={`worldline-mode-${wb.id}`}>
                  <span>史实资料库</span>
                  <select
                    id={`worldline-mode-${wb.id}`}
                    className="worldline-mode-select"
                    value={selectedKnowledgeMode}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      event.stopPropagation();
                      onKnowledgeModeChange(event.target.value as WorldlineKnowledgeMode);
                    }}
                  >
                    {knowledgeModeOptions.map((option) => (
                      <option key={option.mode} value={option.mode}>
                        {option.label} - {option.shortDescription}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedKnowledgeModeOption && (
                  <p className="worldline-mode-description">{selectedKnowledgeModeOption.description}</p>
                )}
              </aside>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

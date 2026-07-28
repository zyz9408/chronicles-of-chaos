import React, { useState } from 'react';
import {
  APP_VERSION_LABEL,
  RELEASE_NOTES,
} from './releaseNotes';

interface ReleaseNotesPanelProps {
  onClose: () => void;
}

export const ReleaseNotesPanel: React.FC<ReleaseNotesPanelProps> = ({ onClose }) => {
  const [entryIndex, setEntryIndex] = useState(0);
  const entry = RELEASE_NOTES[entryIndex];
  if (!entry) return null;

  const hasNewer = entryIndex > 0;
  const hasOlder = entryIndex < RELEASE_NOTES.length - 1;
  const hasMultipleEntries = RELEASE_NOTES.length > 1;

  return (
    <div className="modal-backdrop release-notes-backdrop" onClick={onClose}>
      <section
        className={`confirm-modal release-notes-modal${hasMultipleEntries ? '' : ' release-notes-modal--single'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-notes-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="confirm-modal-head release-notes-head">
          <div>
            <small>RELEASE NOTES</small>
            <span id="release-notes-title">更新日志</span>
          </div>
          <button type="button" className="save-modal-close" onClick={onClose} aria-label="关闭更新日志">✕</button>
        </header>

        <article className="release-notes-entry" aria-live="polite">
          <div className="release-notes-entry-heading">
            <time dateTime={entry.id}>{entry.date}</time>
            <span>{hasMultipleEntries ? `${entryIndex + 1} / ${RELEASE_NOTES.length}` : APP_VERSION_LABEL}</span>
          </div>
          <div className="release-notes-update-list">
            {entry.updates.map((update) => (
              <section
                className="release-notes-update"
                key={update.id}
                aria-labelledby={`${update.id}-title`}
              >
                <div className="release-notes-update-heading">
                  <time dateTime={`${entry.id}T${update.time}:00+08:00`}>{update.time}</time>
                  <span>{update.version}</span>
                </div>
                <h3 id={`${update.id}-title`}>{update.title}</h3>
                <p>{update.summary}</p>
                <ul>
                  {update.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </section>
            ))}
          </div>
        </article>

        {hasMultipleEntries && (
          <footer className="confirm-modal-footer release-notes-footer">
            <button
              type="button"
              className="nav-btn"
              disabled={!hasNewer}
              onClick={() => setEntryIndex((value) => value - 1)}
            >
              ← 较新一日
            </button>
            <div className="release-notes-dots" aria-label="更新日志页码">
              {RELEASE_NOTES.map((note, index) => (
                <button
                  key={note.id}
                  type="button"
                  className={index === entryIndex ? 'active' : ''}
                  aria-label={`查看${note.date}更新，共${note.updates.length}项`}
                  aria-current={index === entryIndex ? 'page' : undefined}
                  onClick={() => setEntryIndex(index)}
                />
              ))}
            </div>
            <button
              type="button"
              className="nav-btn"
              disabled={!hasOlder}
              onClick={() => setEntryIndex((value) => value + 1)}
            >
              较早一日 →
            </button>
          </footer>
        )}
      </section>
    </div>
  );
};

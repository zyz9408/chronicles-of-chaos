import React from 'react';
import type { StartBookmark, WorldBook, MapNode } from '../engine/types';

interface Props {
  bookmarks: StartBookmark[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  worldBook?: WorldBook;
}

function buildRegionNameMap(worldBook?: WorldBook): Record<string, string> {
  const map: Record<string, string> = {};
  if (!worldBook) return map;

  const walk = (nodes: MapNode[] = []) => {
    for (const node of nodes) {
      if (node.id && node.name) {
        map[node.id] = node.name;
      }
      if (node.subLocations?.length) {
        walk(node.subLocations);
      }
    }
  };

  walk(worldBook.openingLocationSeed ?? worldBook.mapSeed);
  walk(worldBook.mapSeed);
  return map;
}

function mapRegionIdsToNames(ids: string[], nameMap: Record<string, string>): string[] {
  const names: string[] = [];
  for (const id of ids) {
    const name = nameMap[id];
    if (name) {
      names.push(name);
    }
  }
  return names;
}

export const StartBookmarkSelect: React.FC<Props> = ({ bookmarks, selectedId, onSelect, worldBook }) => {
  const regionNameMap = React.useMemo(() => buildRegionNameMap(worldBook), [worldBook]);
  const selectedBookmark = bookmarks.find((bookmark) => bookmark.id === selectedId) ?? null;
  const selectedRegionNames = selectedBookmark
    ? mapRegionIdsToNames(selectedBookmark.recommendedRegions, regionNameMap)
    : [];

  return (
    <div className="bookmark-select">
      <h2>选择开局时间</h2>
      <p className="bookmark-select-hint">先在时间轴中选择年代，再查看当时局势与适合的开局方向。</p>
      {bookmarks.length === 0 ? (
        <p className="empty-hint">暂无可用的开局书签</p>
      ) : (
        <div className="bookmark-layout">
          <div className="bookmark-timeline" aria-label="开局年代">
            {bookmarks.map((bookmark) => {
              const selected = selectedId === bookmark.id;
              return (
                <button
                  key={bookmark.id}
                  type="button"
                  className={`bookmark-timeline-item${selected ? ' selected' : ''}`}
                  aria-label={`${bookmark.startDate} ${bookmark.label}`}
                  aria-pressed={selected}
                  onClick={() => onSelect(bookmark.id)}
                >
                  <span className="bookmark-timeline-date">{bookmark.startDate}</span>
                  <span className="bookmark-timeline-label">{bookmark.label}</span>
                  <span className="bookmark-timeline-description">{bookmark.description}</span>
                </button>
              );
            })}
          </div>

          {selectedBookmark ? (
            <article className="bookmark-detail">
              <header className="bookmark-detail-head">
                <div>
                  <span className="bookmark-detail-kicker">当前选择</span>
                  <h3>{selectedBookmark.label}</h3>
                </div>
                <time>{selectedBookmark.startDate}</time>
              </header>
              <p className="bookmark-detail-description">{selectedBookmark.description}</p>
              <section className="bookmark-detail-situation">
                <h4>天下局势</h4>
                <p>{selectedBookmark.situationSummary}</p>
              </section>
              <dl className="bookmark-detail-meta">
                {selectedRegionNames.length > 0 && (
                  <div>
                    <dt>推荐地区</dt>
                    <dd>{selectedRegionNames.join('、')}</dd>
                  </div>
                )}
                {selectedBookmark.recommendedOrigins.length > 0 && (
                  <div>
                    <dt>推荐身份</dt>
                    <dd>{selectedBookmark.recommendedOrigins.join('、')}</dd>
                  </div>
                )}
              </dl>
            </article>
          ) : (
            <div className="bookmark-detail bookmark-detail-empty">
              <span>从左侧时间轴选择一个年代</span>
              <p>这里会展示该年代的天下局势、推荐地区与适合身份。</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

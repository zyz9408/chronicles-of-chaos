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

  return (
    <div className="bookmark-select">
      <h2>选择开局时间</h2>
      {bookmarks.length === 0 ? (
        <p className="empty-hint">暂无可用的开局书签</p>
      ) : (
        <div className="bookmark-list" aria-label="开局年代">
          {bookmarks.map((bookmark) => {
            const selected = selectedId === bookmark.id;
            const regionNames = mapRegionIdsToNames(bookmark.recommendedRegions, regionNameMap);
            return (
              <button
                key={bookmark.id}
                type="button"
                className={`bookmark-card${selected ? ' selected' : ''}`}
                aria-label={`${bookmark.startDate} ${bookmark.label}`}
                aria-pressed={selected}
                onClick={() => onSelect(bookmark.id)}
              >
                <span className="bm-header">
                  <strong className="bm-label">{bookmark.label}</strong>
                  <time className="bm-date">{bookmark.startDate}</time>
                </span>
                <span className="bm-description">{bookmark.description}</span>
                <span className="bm-situation-viewport" aria-label="天下局势">
                  <span className="bm-situation-content">{bookmark.situationSummary}</span>
                </span>
                <span className="bm-meta">
                  {regionNames.length > 0 && (
                    <span>推荐地区：{regionNames.join('、')}</span>
                  )}
                  {bookmark.recommendedOrigins.length > 0 && (
                    <span>推荐身份：{bookmark.recommendedOrigins.join('、')}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

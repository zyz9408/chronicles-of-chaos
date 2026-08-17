import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StartBookmark } from '../engine/types';
import { StartBookmarkSelect } from './StartBookmarkSelect';

const bookmarks: StartBookmark[] = [
  {
    id: 'yellow-turban',
    label: '黄巾前夜',
    startDate: '公元184年',
    relatedTimelineAnchorIds: [],
    description: '天下将乱，州郡尚未全面失序。',
    recommendedRegions: [],
    recommendedOrigins: ['寒门子弟'],
    situationSummary: '第一条完整局势说明，应始终保留在自己的卡片内。',
  },
  {
    id: 'red-cliffs',
    label: '赤壁风云',
    startDate: '公元208年',
    relatedTimelineAnchorIds: [],
    description: '江汉之间，三方兵势汇聚。',
    recommendedRegions: [],
    recommendedOrigins: ['军中吏士'],
    situationSummary: '第二条完整局势说明，应始终保留在自己的卡片内。',
  },
];

describe('StartBookmarkSelect', () => {
  it('renders every opening period as an independent complete card', () => {
    const html = renderToStaticMarkup(
      <StartBookmarkSelect
        bookmarks={bookmarks}
        selectedId="red-cliffs"
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain('class="bookmark-list"');
    expect(html.match(/class="bookmark-card/g)).toHaveLength(2);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('第一条完整局势说明，应始终保留在自己的卡片内。');
    expect(html).toContain('第二条完整局势说明，应始终保留在自己的卡片内。');
    expect(html.match(/class="bm-situation-viewport"/g)).toHaveLength(2);
    expect(html.match(/class="bm-situation-content"/g)).toHaveLength(2);
    expect(html).not.toContain('bookmark-detail');
  });
});

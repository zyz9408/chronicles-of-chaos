import { describe, expect, it } from 'vitest';
import type { FactionPanelRecentAction } from './factionPanelModel';
import { selectFactionRecentActions } from './GameScreen';

function makeActions(count: number): FactionPanelRecentAction[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `action-${index + 1}`,
    summary: `动作${index + 1}`,
    knownLevel: '听闻',
    observedAt: `公元189年09月${String(index + 1).padStart(2, '0')}日`,
  }));
}

describe('势力近期动作显示窗口', () => {
  it('默认窗口取最新十条并按新到旧排列', () => {
    const selected = selectFactionRecentActions(makeActions(35), 10);

    expect(selected).toHaveLength(10);
    expect(selected[0].summary).toBe('动作35');
    expect(selected[9].summary).toBe('动作26');
  });

  it('支持二十、三十和全部历史', () => {
    const actions = makeActions(35);

    expect(selectFactionRecentActions(actions, 20)).toHaveLength(20);
    expect(selectFactionRecentActions(actions, 30)).toHaveLength(30);
    expect(selectFactionRecentActions(actions, 'all')).toHaveLength(35);
    expect(selectFactionRecentActions(actions, 'all')[34].summary).toBe('动作1');
  });
});

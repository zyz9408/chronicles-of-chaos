import { describe, expect, it, vi } from 'vitest';
import type { RuntimeState } from '../engine/types';
import * as gameScreenModule from './GameScreen';

const HEAVY_PANEL_BUILDERS = [
  ['dynamics', 'buildDynamicPanelModel'],
  ['npcs', 'buildNpcPanelModel'],
  ['heroines', 'buildHeroinePanelModel'],
  ['bonds', 'buildBondPanelModel'],
  ['factions', 'buildFactionPanelModel'],
  ['holdings', 'buildHoldingPanelModel'],
  ['troops', 'buildTroopPanelModel'],
  ['battles', 'buildBattlePanelModel'],
  ['combats', 'buildCombatPanelModel'],
  ['uniqueArts', 'buildUniqueArtsPanelModel'],
] as const;

type PanelKey = (typeof HEAVY_PANEL_BUILDERS)[number][0];
type DeriveWhenActive = <T>(
  activePanel: PanelKey | null,
  targetPanel: PanelKey,
  builder: () => T,
) => T | null;

function getDeriveWhenActive(): DeriveWhenActive {
  const candidate = (gameScreenModule as Record<string, unknown>).derivePanelModelWhenActive;
  expect(candidate).toBeTypeOf('function');
  return candidate as DeriveWhenActive;
}

describe('GameScreen Task 5.2 render-performance gates', () => {
  it('treats the configured threshold as near-bottom without accepting a farther scroll position', () => {
    const isNearBottom = (gameScreenModule as Record<string, unknown>).isNarrativeScrollNearBottom;
    const threshold = (gameScreenModule as Record<string, unknown>).NARRATIVE_SCROLL_FOLLOW_THRESHOLD_PX;

    expect(isNearBottom).toBeTypeOf('function');
    expect(threshold).toBe(48);
    const check = isNearBottom as (metrics: { scrollHeight: number; scrollTop: number; clientHeight: number }) => boolean;
    expect(check({ scrollHeight: 1000, clientHeight: 400, scrollTop: 552 })).toBe(true);
    expect(check({ scrollHeight: 1000, clientHeight: 400, scrollTop: 551 })).toBe(false);
  });

  it('does not call any heavy builder while all strategic panels are closed', () => {
    const deriveWhenActive = getDeriveWhenActive();
    const builders = Object.fromEntries(HEAVY_PANEL_BUILDERS.map(([panel]) => [panel, vi.fn(() => panel)]));

    for (const [panel] of HEAVY_PANEL_BUILDERS) {
      expect(deriveWhenActive(null, panel, builders[panel])).toBeNull();
    }
    expect(Object.values(builders).every((builder) => builder.mock.calls.length === 0)).toBe(true);
  });

  it('derives only the open panel and leaves every sibling builder uncalled', () => {
    const deriveWhenActive = getDeriveWhenActive();
    const builders = Object.fromEntries(HEAVY_PANEL_BUILDERS.map(([panel]) => [panel, vi.fn(() => panel)]));

    for (const [panel] of HEAVY_PANEL_BUILDERS) {
      deriveWhenActive('holdings', panel, builders[panel]);
    }

    expect(builders.holdings).toHaveBeenCalledTimes(1);
    for (const [panel] of HEAVY_PANEL_BUILDERS) {
      if (panel !== 'holdings') expect(builders[panel]).not.toHaveBeenCalled();
    }
  });

  it('selects only an open matter for the persistent bottom bar', () => {
    const selectBottomBarCurrentMatter = (gameScreenModule as Record<string, unknown>).selectBottomBarCurrentMatter;
    expect(selectBottomBarCurrentMatter).toBeTypeOf('function');

    const selected = (selectBottomBarCurrentMatter as (state: RuntimeState) => { title: string } | undefined)({
      activeQuests: [
        { id: 'quest_done', title: '招揽单福', status: 'completed' },
        { id: 'quest_open', title: '筹措军粮', status: 'active' },
      ],
    } as RuntimeState);

    expect(selected?.title).toBe('筹措军粮');
  });
});

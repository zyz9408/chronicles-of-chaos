import { describe, expect, it } from 'vitest';
import type { TurnLogEntry } from '../types';
import { buildNarrativeRenderEntries } from './narrativeDisplay';

function makeTurn(turnNumber: number, text = `full ${turnNumber}`): TurnLogEntry {
  return {
    turnNumber,
    date: `184-${turnNumber}`,
    playerInput: `action ${turnNumber}`,
    narrativeText: `summary ${turnNumber}`,
    fullNarrativeText: text,
    statePatchSummary: 'none',
    timestamp: `2026-01-01T00:00:${String(turnNumber).padStart(2, '0')}.000Z`,
    displayMeta: {
      title: `turn ${turnNumber}`,
    },
  };
}

describe('narrativeDisplay', () => {
  it('renders the latest 30 turns by default', () => {
    const entries = buildNarrativeRenderEntries(Array.from({ length: 35 }, (_, index) => makeTurn(index + 1)));

    expect(entries).toHaveLength(30);
    expect(entries[0].turnNumber).toBe(6);
    expect(entries[29].turnNumber).toBe(35);
  });

  it('uses full narrative text before the shortened log summary', () => {
    const [entry] = buildNarrativeRenderEntries([makeTurn(1, 'complete narrative')]);

    expect(entry.narrativeText).toBe('complete narrative');
  });

  it('appends streaming narrative as a temporary newest entry within the render limit', () => {
    const entries = buildNarrativeRenderEntries(Array.from({ length: 30 }, (_, index) => makeTurn(index + 1)), {
      currentNarrativeText: 'streaming turn',
      currentPlayerInput: 'live action',
      currentTitle: 'generating',
      limit: 30,
    });

    expect(entries).toHaveLength(30);
    expect(entries[0].turnNumber).toBe(2);
    expect(entries[29]).toMatchObject({
      narrativeText: 'streaming turn',
      playerInput: 'live action',
      title: 'generating',
      isLive: true,
    });
  });

  it('shows a pending player action even before the first streamed narrative token arrives', () => {
    const entries = buildNarrativeRenderEntries([makeTurn(1, 'complete narrative')], {
      currentNarrativeText: '',
      currentPlayerInput: '步入偏殿，试探门吏口风',
      currentTitle: '生成中',
      limit: 30,
    });

    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      key: 'live-narrative',
      playerInput: '步入偏殿，试探门吏口风',
      narrativeText: '',
      title: '生成中',
      isLive: true,
    });
  });

  it('drops an uncommitted streamed draft after execution settles instead of duplicating the latest turn number', () => {
    const entries = buildNarrativeRenderEntries([makeTurn(238, 'saved turn 238')], {
      currentNarrativeText: 'failed turn draft that was never committed',
      currentPlayerInput: '',
      currentTitle: '第 238 回合',
      includeLiveEntry: false,
      limit: 30,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      turnNumber: 238,
      narrativeText: 'saved turn 238',
      isLive: false,
    });
  });

  it('does not show internal true opening commands as player actions', () => {
    const [entry] = buildNarrativeRenderEntries([{
      ...makeTurn(1, 'opening'),
      playerInput: '[true opening generation]\nplease generate opening',
    }]);

    expect(entry.playerInput).toBe('');
  });
});

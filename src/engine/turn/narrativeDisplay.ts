import type { TurnDisplayMeta, TurnLogEntry } from '../types';
import { DEFAULT_RENDER_DEPTH, normalizeRenderDepth } from '../settings/DisplaySettings';
import { getTurnDisplayTitle } from './turnDisplay';

export interface NarrativeRenderEntry {
  key: string;
  turnNumber?: number;
  title: string;
  date?: string;
  playerInput: string;
  narrativeText: string;
  displayMeta?: TurnDisplayMeta;
  isLive: boolean;
}

export interface BuildNarrativeRenderEntriesOptions {
  limit?: number;
  currentNarrativeText?: string;
  currentPlayerInput?: string;
  currentTitle?: string;
  includeLiveEntry?: boolean;
}

export function buildNarrativeRenderEntries(
  turnLog: TurnLogEntry[],
  options: BuildNarrativeRenderEntriesOptions = {},
): NarrativeRenderEntry[] {
  const limit = normalizeRenderDepth(options.limit ?? DEFAULT_RENDER_DEPTH);
  const persistedEntries = turnLog
    .map((log) => toRenderEntry(log))
    .filter((entry): entry is NarrativeRenderEntry => entry !== null);

  const liveText = options.currentNarrativeText?.trim() ?? '';
  const livePlayerInput = displayPlayerInput(options.currentPlayerInput ?? '');
  const latestPersistedText = persistedEntries[persistedEntries.length - 1]?.narrativeText.trim();
  const entries = persistedEntries.slice(-limit);

  if (options.includeLiveEntry === false) {
    return entries;
  }

  if (!liveText && !livePlayerInput) {
    return entries;
  }

  if (!livePlayerInput && liveText === latestPersistedText) {
    return entries;
  }

  return [
    ...entries,
    {
      key: 'live-narrative',
      title: options.currentTitle?.trim() || '生成中',
      playerInput: livePlayerInput,
      narrativeText: liveText,
      isLive: true,
    },
  ].slice(-limit);
}

function toRenderEntry(log: TurnLogEntry): NarrativeRenderEntry | null {
  const narrativeText = (log.fullNarrativeText || log.narrativeText || '').trim();
  if (!narrativeText) return null;

  return {
    key: `${log.turnNumber}-${log.timestamp}`,
    turnNumber: log.turnNumber,
    title: getTurnDisplayTitle(log),
    date: log.date,
    playerInput: displayPlayerInput(log.playerInput),
    narrativeText,
    displayMeta: log.displayMeta,
    isLive: false,
  };
}

function displayPlayerInput(playerInput: string): string {
  const trimmed = playerInput.trim();
  if (trimmed.startsWith('[true opening generation]')) return '';
  return trimmed;
}

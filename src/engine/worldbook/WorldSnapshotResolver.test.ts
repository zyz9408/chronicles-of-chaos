import { describe, expect, it } from 'vitest';
import type { WorldBook } from '../types';
import { generateWorldSnapshot, getAllMapNodeIds, isMapNodeValid } from './WorldSnapshotResolver';

const worldBook = {
  mapSeed: [
    {
      id: 'region_root',
      name: 'Root Region',
      level: 'region',
      mapLayer: 'region',
      summary: 'Base region summary.',
      connectedRegionIds: [],
      controlHint: '',
      tensionHint: '',
    },
  ],
  openingLocationSeed: [
    {
      id: 'region_root',
      name: 'Root Region',
      level: 'region',
      mapLayer: 'region',
      summary: 'Opening region summary.',
      connectedRegionIds: [],
      controlHint: '',
      tensionHint: '',
      subLocations: [
        {
          id: 'place_opening',
          name: 'Opening Place',
          level: 'place',
          mapLayer: 'place',
          summary: 'Opening place summary.',
          connectedRegionIds: [],
          controlHint: '',
          tensionHint: '',
        },
      ],
    },
  ],
  timelineAnchors: [],
} as unknown as WorldBook;

describe('WorldSnapshotResolver map roots', () => {
  it('resolves map nodes from merged mapSeed and openingLocationSeed', () => {
    expect(getAllMapNodeIds(worldBook)).toContain('place_opening');
    expect(isMapNodeValid(worldBook, 'place_opening')).toBe(true);

    const snapshot = generateWorldSnapshot(worldBook, 'day 1', 'place_opening');

    expect(snapshot.currentRegionSummary).toBe('Opening place summary.');
    expect(snapshot.worldSummary).toContain('Opening place summary.');
  });
});

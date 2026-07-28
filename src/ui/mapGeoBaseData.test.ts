import { describe, expect, it } from 'vitest';

import { MAP_GEO_LAND_PATHS, MAP_GEO_RIVER_PATHS, MAP_GEO_SOURCE_NOTE } from './mapGeoBaseData';

describe('mapGeoBaseData', () => {
  it('provides real geographic coastline and river paths for Map V2', () => {
    expect(MAP_GEO_SOURCE_NOTE).toContain('Natural Earth');
    expect(MAP_GEO_LAND_PATHS.length).toBeGreaterThanOrEqual(3);
    expect(MAP_GEO_RIVER_PATHS.length).toBeGreaterThanOrEqual(8);
    expect(MAP_GEO_LAND_PATHS.join(' ')).toContain('Z');
    expect(MAP_GEO_RIVER_PATHS.every((path) => path.startsWith('M'))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import { MAP_GEOGRAPHY_FEATURES } from './mapGeographyLayer';

describe('MAP_GEOGRAPHY_FEATURES', () => {
  it('provides visible map geography layers for the national map', () => {
    const kinds = new Set(MAP_GEOGRAPHY_FEATURES.map((feature) => feature.kind));

    expect([...kinds]).toEqual(expect.arrayContaining([
      'land',
      'regionBoundary',
      'river',
      'mountain',
    ]));
    expect(MAP_GEOGRAPHY_FEATURES.filter((feature) => feature.kind === 'regionBoundary').length).toBeGreaterThanOrEqual(9);
    expect(MAP_GEOGRAPHY_FEATURES.map((feature) => feature.id)).toEqual(expect.arrayContaining([
      'eastern-han-territory-outline',
      'yellow-river',
      'yangtze-river',
      'han-river',
      'qinling-mountains',
      'taihang-mountains',
    ]));
  });

  it('uses a late Eastern Han outline instead of a closed oval placeholder', () => {
    const landIds = MAP_GEOGRAPHY_FEATURES.filter((feature) => feature.kind === 'land').map((feature) => feature.id);

    expect(landIds).toEqual(['eastern-han-territory-outline']);
    expect(landIds).not.toContain('han-landmass');
    expect(landIds).not.toContain('liangzhou-hexi-corridor');
  });

  it('draws the Han territory as one detailed map-like outline', () => {
    const outline = MAP_GEOGRAPHY_FEATURES.find((feature) => feature.id === 'eastern-han-territory-outline');
    const numbers = outline?.path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const xValues = numbers.filter((_, index) => index % 2 === 0);
    const yValues = numbers.filter((_, index) => index % 2 === 1);

    expect(outline?.kind).toBe('land');
    expect(numbers.length).toBeGreaterThan(70);
    expect(Math.min(...xValues)).toBeLessThanOrEqual(4);
    expect(Math.max(...xValues)).toBeGreaterThanOrEqual(96);
    expect(Math.min(...yValues)).toBeLessThanOrEqual(5);
    expect(Math.max(...yValues)).toBeGreaterThanOrEqual(96);
  });

  it('keeps every geography path inside the shared 0-100 visual coordinate system', () => {
    for (const feature of MAP_GEOGRAPHY_FEATURES) {
      const numbers = feature.path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      expect(numbers.length).toBeGreaterThan(2);
      for (const value of numbers) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });
});

import { describe, expect, test } from 'vitest';

import type { MapNode } from '../../engine/types';
import { buildMapV1Index, isStandableMapNode } from '../../engine/map/mapV1';
import { threeKingdomsMapSeed } from './mapSeed';

function flattenMapNodes(nodes: MapNode[]): MapNode[] {
  return nodes.flatMap((node) => [
    node,
    ...flattenMapNodes(node.subLocations ?? []),
  ]);
}

describe('threeKingdomsMapSeed', () => {
  test('marks every seed node with an explicit Map V1 layer', () => {
    const allNodes = flattenMapNodes(threeKingdomsMapSeed);

    expect(allNodes.length).toBeGreaterThan(0);
    expect(allNodes.filter((node) => !node.mapLayer)).toEqual([]);
  });

  test('keeps province and commandery nodes as regions while county-level nodes are concrete places', () => {
    const index = buildMapV1Index(threeKingdomsMapSeed);

    expect(index.nodeById.region_yuzhou?.mapLayer).toBe('region');
    expect(index.nodeById.loc_yingchuan?.mapLayer).toBe('region');
    expect(index.nodeById.loc_yingchuan_town?.mapLayer).toBe('place');
    expect(isStandableMapNode(index.nodeById.loc_yingchuan_town)).toBe(true);
    expect(isStandableMapNode(index.nodeById.loc_yingchuan)).toBe(false);
  });
});

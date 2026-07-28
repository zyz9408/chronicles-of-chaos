import type { MapNode } from '../engine/types';

export interface OpeningLocationSelection {
  regions: MapNode[];
  commanderies: MapNode[];
  places: MapNode[];
  scenes: MapNode[];
  specificLocations: MapNode[];
  selectedRegion?: MapNode;
  selectedCommandery?: MapNode;
  selectedPlace?: MapNode;
  selectedScene?: MapNode;
  selectedLocation?: MapNode;
  pathLabel: string;
}

export interface CustomOpeningPlaceInput {
  id: string;
  parentId: string;
  name: string;
  summary?: string;
}

export function createCustomOpeningPlace(input: CustomOpeningPlaceInput): MapNode {
  return {
    id: input.id,
    name: input.name.trim(),
    level: '自定义地点',
    mapLayer: 'place',
    summary: input.summary?.trim() || '玩家自定义开局地点，开局时由 LLM 结合世界书自洽生成。',
    connectedRegionIds: [],
    controlHint: '玩家自定义，开局生成时自洽判定',
    tensionHint: '由开局额外要求与时代局势决定',
    parentId: input.parentId,
  };
}

export function attachCustomOpeningPlaces(mapSeed: MapNode[], customPlaces: MapNode[]): MapNode[] {
  if (customPlaces.length === 0) return mapSeed;

  return mapSeed.map((node) => {
    const childCustomPlaces = customPlaces.filter((place) => place.parentId === node.id);
    const childNodes = attachCustomOpeningPlaces(node.subLocations ?? [], customPlaces);
    const mergedChildren = [...childNodes];

    for (const place of childCustomPlaces) {
      if (!mergedChildren.some((child) => child.id === place.id)) {
        mergedChildren.push(place);
      }
    }

    return {
      ...node,
      subLocations: mergedChildren.length > 0 ? mergedChildren : node.subLocations,
    };
  });
}

export function buildOpeningLocationSelection(
  mapSeed: MapNode[],
  selectedRegionId: string,
  selectedCommanderyId: string,
  selectedLocationId: string,
  selectedSceneId = '',
): OpeningLocationSelection {
  const selectedRegion = mapSeed.find((node) => node.id === selectedRegionId);
  const commanderies = selectedRegion?.subLocations ?? [];
  const selectedCommandery = commanderies.find((node) => node.id === selectedCommanderyId) ?? commanderies[0];
  const places = selectedCommandery?.subLocations ?? [];
  const selectedPlace = places.find((node) => node.id === selectedLocationId) ?? places[0];
  const scenes = selectedPlace?.subLocations ?? [];
  const selectedScene = scenes.find((node) => node.id === selectedSceneId) ?? scenes[0];
  const pathLabel = [selectedRegion, selectedCommandery, selectedPlace]
    .filter((node, index, nodes) => node && nodes.findIndex((item) => item?.id === node.id) === index)
    .map((node) => node?.name)
    .join(' - ');

  return {
    regions: mapSeed,
    commanderies,
    places,
    scenes,
    specificLocations: places,
    selectedRegion,
    selectedCommandery,
    selectedPlace,
    selectedScene,
    selectedLocation: selectedPlace,
    pathLabel,
  };
}

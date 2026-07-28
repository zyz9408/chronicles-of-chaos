import type { MapLayerKind } from '../types';

export function normalizeCanonicalToken(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function buildLocationCanonicalScopeKey(input: {
  parentId: string;
  mapLayer: MapLayerKind | undefined;
  kind: string;
}): string {
  return JSON.stringify([
    input.parentId.trim(),
    input.mapLayer ?? '',
    input.kind,
  ]);
}

export function buildLocationCanonicalKeys(input: {
  parentId: string;
  mapLayer: MapLayerKind | undefined;
  kind: string;
  name: string;
  aliases?: string[];
}): string[] {
  const scope = buildLocationCanonicalScopeKey(input);
  return [...new Set([input.name, ...(input.aliases ?? [])]
    .map(normalizeCanonicalToken)
    .filter(Boolean)
    .map((token) => `${scope}:${JSON.stringify(token)}`))];
}

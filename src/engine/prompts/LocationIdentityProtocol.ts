export const CANONICAL_LOCATION_PROTOCOL_CLAUSES = [
  'locationWriteSuggestions must include locationId, name, aliases, kind, mapLayer, parentId, summary, permanence; aliases are optional exact identity tokens.',
  'canonical key = parentId + mapLayer + kind/level + normalized name/aliases.',
  'Normalize name/aliases with NFKC, trim, collapse whitespace, and lowercase only; do not remove suffixes such as 县/郡/城.',
  'Exact locationId reuse is allowed only when parentId + mapLayer + kind/level scope matches.',
  'Worldbook seed identity is authoritative; incoming writeback must not change a seed parentId, mapLayer, or kind/level.',
  'If multiple canonical candidates match, do not guess or publish an alias mapping; return a structured diagnostic.',
] as const;

export function formatCanonicalLocationProtocol(): string {
  return CANONICAL_LOCATION_PROTOCOL_CLAUSES.map((clause) => `- ${clause}`).join('\n');
}

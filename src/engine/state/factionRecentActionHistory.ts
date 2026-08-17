import type { FactionLedgerEntry, FactionRecentActionEntry } from '../types';

export const MAX_FACTION_RECENT_ACTION_RECORDS = 200;

const KNOWN_LEVEL_PREFIX = /^【(亲历|听闻|推测)】\s*/;

export function parseFactionRecentActionText(
  value: string,
  fallbackKnownLevel: FactionLedgerEntry['knownLevel'],
): FactionRecentActionEntry | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  const match = normalized.match(KNOWN_LEVEL_PREFIX);
  const summary = normalized.replace(KNOWN_LEVEL_PREFIX, '').trim();
  if (!summary) return undefined;
  return {
    summary,
    knownLevel: (match?.[1] as FactionRecentActionEntry['knownLevel'] | undefined)
      ?? fallbackKnownLevel,
  };
}

export function formatFactionRecentActionText(record: FactionRecentActionEntry): string {
  return `【${record.knownLevel}】${record.summary}`;
}

export function normalizeFactionRecentActionHistory(
  faction: FactionLedgerEntry,
): FactionLedgerEntry {
  const legacyRecords = faction.recentActions.flatMap((action, index) => {
    const record = parseFactionRecentActionText(action, faction.knownLevel);
    if (!record) return [];
    const isLatest = index === faction.recentActions.length - 1;
    return [{
      ...record,
      ...(isLatest && faction.lastKnownAt?.trim() ? { observedAt: faction.lastKnownAt.trim() } : {}),
      ...(isLatest && faction.sourceNote?.trim() ? { sourceNote: faction.sourceNote.trim() } : {}),
    }];
  });
  const explicitRecords = cleanFactionRecentActionRecords(faction.recentActionRecords);
  const records = mergeFactionRecentActionRecords(legacyRecords, explicitRecords, true);
  return {
    ...faction,
    recentActions: records.map(formatFactionRecentActionText),
    ...(records.length > 0 ? { recentActionRecords: records } : { recentActionRecords: undefined }),
  };
}

export function mergeFactionRecentActionRecords(
  previousRecords: readonly FactionRecentActionEntry[],
  incomingRecords: readonly FactionRecentActionEntry[],
  replaceDuplicate = false,
): FactionRecentActionEntry[] {
  const merged = cleanFactionRecentActionRecords(previousRecords);
  const indexByKey = new Map(merged.map((record, index) => [factionRecentActionKey(record), index]));

  for (const incoming of cleanFactionRecentActionRecords(incomingRecords)) {
    const key = factionRecentActionKey(incoming);
    const existingIndex = indexByKey.get(key);
    if (existingIndex !== undefined) {
      if (replaceDuplicate) merged[existingIndex] = incoming;
      continue;
    }
    indexByKey.set(key, merged.length);
    merged.push(incoming);
  }

  return merged.slice(-MAX_FACTION_RECENT_ACTION_RECORDS);
}

export function factionRecentActionKey(record: FactionRecentActionEntry): string {
  return `${record.knownLevel}|${record.summary.trim().replace(/\s+/g, ' ')}`;
}

function cleanFactionRecentActionRecords(
  records: readonly FactionRecentActionEntry[] | undefined,
): FactionRecentActionEntry[] {
  if (!Array.isArray(records)) return [];
  return records.flatMap((record) => {
    if (!record || typeof record.summary !== 'string') return [];
    const summary = record.summary.trim();
    if (!summary || !['亲历', '听闻', '推测'].includes(record.knownLevel)) return [];
    return [{
      summary,
      knownLevel: record.knownLevel,
      ...(record.observedAt?.trim() ? { observedAt: record.observedAt.trim() } : {}),
      ...(record.sourceNote?.trim() ? { sourceNote: record.sourceNote.trim() } : {}),
    }];
  });
}

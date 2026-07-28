import type { CombatRecord, ConflictRecord, RuntimeState } from '../engine/types';
import type { BattlePanelTabKey } from './battlePanelModel';
import type { CombatPanelTabKey } from './combatPanelModel';

export type BattleBriefingKind = 'battle' | 'combat';

export interface BattleBriefingCard {
  key: string;
  kind: BattleBriefingKind;
  recordId: string;
  title: string;
  eyebrow: string;
  summary: string;
  occurredAt?: string;
  location?: string;
  result?: string;
  imageKey?: string;
  visualTags: string[];
  openPanel: 'battles' | 'combats';
  selectedId: string;
  panelTab: BattlePanelTabKey | CombatPanelTabKey;
}

export function buildBattleBriefingCards(runtimeState: RuntimeState): BattleBriefingCard[] {
  return [
    ...buildConflictBriefingCards(toRecordArray<ConflictRecord>(runtimeState.conflicts)),
    ...buildCombatBriefingCards(toRecordArray<CombatRecord>(runtimeState.combatRecords)),
  ];
}

export function buildCombatBriefingCard(combat: CombatRecord): BattleBriefingCard | null {
  if (!hasCombatId(combat) || !shouldCreateCombatBriefing(combat)) {
    return null;
  }
  return toCombatBriefingCard(combat);
}

export function buildConflictBriefingCard(conflict: ConflictRecord): BattleBriefingCard | null {
  if (!hasConflictId(conflict)) {
    return null;
  }
  return toConflictBriefingCard(conflict);
}

export function diffBattleBriefingCards(
  previousState: RuntimeState,
  nextState: RuntimeState,
): BattleBriefingCard[] {
  const previousKeys = new Set(buildBattleBriefingCards(previousState).map((card) => card.key));
  return buildBattleBriefingCards(nextState).filter((card) => !previousKeys.has(card.key));
}

function buildConflictBriefingCards(conflicts: ConflictRecord[]): BattleBriefingCard[] {
  return conflicts
    .filter(hasConflictId)
    .filter(shouldCreateConflictBriefing)
    .sort(compareUpdatedAtDesc)
    .map(toConflictBriefingCard);
}

function toConflictBriefingCard(conflict: ConflictRecord): BattleBriefingCard {
  const conflictId = textValue(conflict.conflictId) ?? '';
  return {
    key: `battle:${conflictId}`,
    kind: 'battle' as const,
    recordId: conflictId,
    title: textValue(conflict.title) ?? '战事记录',
    eyebrow: '战事简报',
    summary: firstText(conflict.reportText, conflict.summary, conflict.outcome),
    occurredAt: textValue(conflict.occurredAt),
    location: firstText(conflict.locationName, conflict.locationId) || undefined,
    result: textValue(conflict.outcome),
    imageKey: textValue(conflict.imageKey),
    visualTags: [
      ...stringList(conflict.resultTags),
      ...stringList(conflict.decisiveFactors),
    ],
    openPanel: 'battles' as const,
    selectedId: conflictId,
    panelTab: conflict.scope === 'other' && conflict.recordLevel !== 'full' ? 'other' : 'selfRelated',
  };
}

function buildCombatBriefingCards(combats: CombatRecord[]): BattleBriefingCard[] {
  return combats
    .filter(hasCombatId)
    .filter(shouldCreateCombatBriefing)
    .sort(compareUpdatedAtDesc)
    .map(toCombatBriefingCard);
}

function toCombatBriefingCard(combat: CombatRecord): BattleBriefingCard {
  const combatId = textValue(combat.combatId) ?? '';
  return {
    key: `combat:${combatId}`,
    kind: 'combat' as const,
    recordId: combatId,
    title: textValue(combat.title) ?? '战斗记录',
    eyebrow: '战斗简报',
    summary: firstText(combat.reportText, combat.briefText, combat.summary, combat.outcome),
    occurredAt: textValue(combat.occurredAt),
    location: firstText(combat.locationName, combat.locationId) || undefined,
    result: textValue(combat.outcome),
    imageKey: textValue(combat.imageKey),
    visualTags: [
      ...stringList(combat.visualTags),
      ...stringList(combat.outcomeTags),
    ],
    openPanel: 'combats' as const,
    selectedId: combatId,
    panelTab: getCombatPanelTab(combat),
  };
}

function shouldCreateConflictBriefing(conflict: ConflictRecord): boolean {
  return conflict.recordLevel === 'full' || (conflict.scope === 'selfRelated' && hasText(conflict.reportText));
}

function shouldCreateCombatBriefing(combat: CombatRecord): boolean {
  return combat.playerInvolved
    || hasText(combat.reportText)
    || hasText(combat.briefText)
    || combat.chronicleWorthy === true
    || combat.significance === 'major'
    || combat.significance === 'legendary';
}

function getCombatPanelTab(combat: CombatRecord): CombatPanelTabKey {
  if (
    combat.playerInvolved
    || getCombatParticipants(combat).some((participant) => (
      participant.side === 'player' || participant.participantId === 'player'
    ))
  ) {
    return 'playerRelated';
  }
  if (
    combat.chronicleWorthy === true
    || combat.significance === 'notable'
    || combat.significance === 'major'
    || combat.significance === 'legendary'
  ) {
    return 'notable';
  }
  return 'other';
}

function toRecordArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function firstText(...values: unknown[]): string {
  return values.map(textValue).find((value): value is string => Boolean(value)) ?? '';
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(textValue).filter((item): item is string => Boolean(item));
}

function hasConflictId(conflict: ConflictRecord): boolean {
  return Boolean(textValue(conflict.conflictId));
}

function hasCombatId(combat: CombatRecord): boolean {
  return Boolean(textValue(combat.combatId));
}

function getCombatParticipants(combat: CombatRecord): Array<{ side?: unknown; participantId?: unknown }> {
  const participants = (combat as { participants?: unknown }).participants;
  if (!Array.isArray(participants)) {
    return [];
  }
  return participants.filter((participant): participant is { side?: unknown; participantId?: unknown } => (
    typeof participant === 'object' && participant !== null
  ));
}

function compareUpdatedAtDesc<T extends { updatedAt?: unknown; occurredAt?: unknown }>(a: T, b: T): number {
  const aTime = textValue(a.updatedAt) ?? textValue(a.occurredAt) ?? '';
  const bTime = textValue(b.updatedAt) ?? textValue(b.occurredAt) ?? '';
  return bTime.localeCompare(aTime, 'zh-Hans-CN');
}

import type {
  CombatRecord,
  ConflictRecord,
  RuntimeState,
  TurnJudgementCard,
  TurnJudgementDetail,
  TurnOrdinaryCheck,
} from '../types';

export function buildOrdinaryJudgementCards(checks: TurnOrdinaryCheck[] = []): TurnJudgementCard[] {
  return checks
    .filter((check) => check.checkId.trim() && check.label.trim() && check.result.trim())
    .map((check) => ({
      cardId: `ordinary:${check.checkId.trim()}`,
      kind: 'ordinary' as const,
      eyebrow: '判定',
      title: check.label.trim(),
      target: textValue(check.target),
      result: check.result.trim(),
      summary: textValue(check.summary),
      difficulty: normalizeNumber(check.difficulty),
      total: normalizeNumber(check.total),
      margin: calculateMargin(check.total, check.difficulty),
      details: normalizeDetails(check.details),
      tags: stringList(check.tags),
    }));
}

export function buildBattleJudgementCards(
  previousState: RuntimeState,
  nextState: RuntimeState,
): TurnJudgementCard[] {
  const previousKeys = new Set([
    ...toRecordArray<ConflictRecord>(previousState.conflicts).map((record) => `battle:${record.conflictId}`),
    ...toRecordArray<CombatRecord>(previousState.combatRecords).map((record) => `combat:${record.combatId}`),
  ]);

  return [
    ...toRecordArray<ConflictRecord>(nextState.conflicts)
      .filter((record) => textValue(record.conflictId))
      .filter((record) => !previousKeys.has(`battle:${record.conflictId}`))
      .filter(shouldShowConflictJudgement)
      .map(conflictToCard),
    ...toRecordArray<CombatRecord>(nextState.combatRecords)
      .filter((record) => textValue(record.combatId))
      .filter((record) => !previousKeys.has(`combat:${record.combatId}`))
      .filter(shouldShowCombatJudgement)
      .map(combatToCard),
  ];
}

function conflictToCard(conflict: ConflictRecord): TurnJudgementCard {
  const conflictId = conflict.conflictId.trim();
  const score = conflict.judgement?.scoreBreakdown;
  return {
    cardId: `battle:${conflictId}`,
    kind: 'battle',
    eyebrow: '战事判定',
    title: textValue(conflict.title) ?? '战事判定',
    target: textValue(conflict.locationName) ?? textValue(conflict.locationId),
    result: firstText(conflict.result, conflict.outcome, conflict.resultLevel),
    summary: firstText(conflict.reportText, conflict.summary, conflict.outcome),
    total: normalizeNumber(score?.total),
    details: normalizeDetails([
      scoreDetail('基础', score?.troopBase, '兵力、军势与阵面'),
      scoreDetail('主帅', score?.commander, conflict.judgement?.commanderAssessment),
      scoreDetail('战术', score?.tactical, conflict.judgement?.tacticalAssessment),
      scoreDetail('绝艺', score?.uniqueArts),
      scoreDetail('转折', score?.turningPoint),
      scoreDetail('行动', score?.playerAction),
      ...stringList(score?.notes).map((note) => ({ label: '依据', text: note })),
    ]),
    tags: [
      ...stringList(conflict.resultTags),
      ...stringList(conflict.decisiveFactors),
    ],
    panel: {
      type: 'battles',
      selectedId: conflictId,
      tab: conflict.scope === 'other' && conflict.recordLevel !== 'full' ? 'other' : 'selfRelated',
    },
  };
}

function combatToCard(combat: CombatRecord): TurnJudgementCard {
  const combatId = combat.combatId.trim();
  const score = combat.judgement?.scoreBreakdown;
  return {
    cardId: `combat:${combatId}`,
    kind: 'combat',
    eyebrow: '战斗判定',
    title: textValue(combat.title) ?? '战斗判定',
    target: textValue(combat.locationName) ?? textValue(combat.locationId),
    result: firstText(combat.outcome, combat.resultLevel),
    summary: firstText(combat.briefText, combat.summary, combat.outcome),
    total: normalizeNumber(score?.total),
    details: normalizeDetails([
      scoreDetail('基础', score?.personalBase, '武力、身手与临场能力'),
      scoreDetail('装备', score?.equipment),
      scoreDetail('状态', score?.status),
      scoreDetail('环境', score?.environment),
      scoreDetail('战法', score?.combatMethod, combat.judgement?.decisiveMoment),
      scoreDetail('绝艺', score?.uniqueArts),
      scoreDetail('转折', score?.turningPoint),
      scoreDetail('行动', score?.playerAction),
      ...stringList(score?.notes).map((note) => ({ label: '依据', text: note })),
    ]),
    tags: [
      ...stringList(combat.visualTags),
      ...stringList(combat.outcomeTags),
    ],
    panel: {
      type: 'combats',
      selectedId: combatId,
      tab: getCombatPanelTab(combat),
    },
  };
}

function shouldShowConflictJudgement(conflict: ConflictRecord): boolean {
  return Boolean(conflict.judgement)
    || conflict.recordLevel === 'full'
    || (conflict.scope === 'selfRelated' && hasText(conflict.reportText));
}

function shouldShowCombatJudgement(combat: CombatRecord): boolean {
  return Boolean(combat.judgement)
    || combat.playerInvolved
    || hasText(combat.briefText)
    || combat.chronicleWorthy === true
    || combat.significance === 'major'
    || combat.significance === 'legendary';
}

function getCombatPanelTab(combat: CombatRecord): string {
  if (
    combat.playerInvolved
    || (combat.participants ?? []).some((participant) => (
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

function scoreDetail(label: string, value?: number, text?: string): TurnJudgementDetail | null {
  const normalizedValue = normalizeNumber(value);
  const normalizedText = textValue(text);
  if (normalizedValue === undefined && !normalizedText) return null;
  return {
    label,
    value: normalizedValue,
    text: normalizedText,
  };
}

function calculateMargin(total?: number, difficulty?: number): number | undefined {
  const normalizedTotal = normalizeNumber(total);
  const normalizedDifficulty = normalizeNumber(difficulty);
  if (normalizedTotal === undefined || normalizedDifficulty === undefined) return undefined;
  return normalizedTotal - normalizedDifficulty;
}

function normalizeDetails(value: Array<TurnJudgementDetail | null | undefined> | undefined): TurnJudgementDetail[] | undefined {
  const details = (value ?? [])
    .filter((item): item is TurnJudgementDetail => Boolean(item))
    .map((item) => ({
      label: item.label.trim(),
      value: normalizeNumber(item.value),
      text: textValue(item.text),
    }))
    .filter((item) => item.label && (item.value !== undefined || item.text));
  return details.length > 0 ? details : undefined;
}

function toRecordArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function firstText(...values: unknown[]): string | undefined {
  return values.map(textValue).find((value): value is string => Boolean(value));
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(textValue).filter((item): item is string => Boolean(item));
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.round(value);
}

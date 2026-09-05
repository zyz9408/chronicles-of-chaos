import type { RuntimeState, TurnDisplayMeta } from '../types';

const PERSISTED_FULL_TURN_DIAGNOSTIC_LIMIT = 5;

function compactTurnDisplayMeta(displayMeta: TurnDisplayMeta): TurnDisplayMeta {
  const {
    rawResponse: _rawResponse,
    reasoningSummary: _reasoningSummary,
    promptTokenEstimate: _promptTokenEstimate,
    processingStages: _processingStages,
    memoryRecall: _memoryRecall,
    npcIntentSimulation,
    ...retained
  } = displayMeta;
  const compactedNpcIntentSimulation = npcIntentSimulation
    ? (() => {
        const { package: _package, ...summary } = npcIntentSimulation;
        return summary;
      })()
    : undefined;
  const changed = displayMeta.rawResponse !== undefined
    || displayMeta.reasoningSummary !== undefined
    || displayMeta.promptTokenEstimate !== undefined
    || displayMeta.processingStages !== undefined
    || displayMeta.memoryRecall !== undefined
    || npcIntentSimulation?.package !== undefined;
  if (!changed) return displayMeta;
  return {
    ...retained,
    ...(compactedNpcIntentSimulation ? { npcIntentSimulation: compactedNpcIntentSimulation } : {}),
  };
}

/** Keep gameplay facts and full narrative while trimming old derived diagnostics. */
export function compactRuntimeStateForPersistence(runtimeState: RuntimeState): RuntimeState {
  const compactBeforeIndex = Math.max(0, runtimeState.turnLog.length - PERSISTED_FULL_TURN_DIAGNOSTIC_LIMIT);
  let changed = false;
  const turnLog = runtimeState.turnLog.map((entry, index) => {
    if (index >= compactBeforeIndex || !entry.displayMeta) return entry;
    const displayMeta = compactTurnDisplayMeta(entry.displayMeta);
    if (displayMeta === entry.displayMeta) return entry;
    changed = true;
    return { ...entry, displayMeta };
  });
  return changed ? { ...runtimeState, turnLog } : runtimeState;
}

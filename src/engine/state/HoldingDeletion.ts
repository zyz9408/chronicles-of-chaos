import type { RuntimeState } from '../types';
import type { EncounterStartIntent } from '../encounterV2/EncounterContracts';

export type HoldingDeletionBlockerKind =
  | 'holding_governance_project'
  | 'heavy_cavalry_project'
  | 'active_quest'
  | 'active_encounter';

export interface HoldingDeletionBlocker {
  kind: HoldingDeletionBlockerKind;
  label: string;
  sourceId: string;
}

export interface HoldingDeletionAnalysis {
  holdingId: string;
  holdingName: string;
  exists: boolean;
  canDelete: boolean;
  blockers: HoldingDeletionBlocker[];
  removableGovernanceProjectCount: number;
  preservedGarrisonTroopCount: number;
}

export interface HoldingDeletionResult {
  state: RuntimeState;
  deleted: boolean;
  analysis: HoldingDeletionAnalysis;
}

function addBlocker(
  blockers: HoldingDeletionBlocker[],
  blocker: HoldingDeletionBlocker,
): void {
  if (blockers.some((item) => item.kind === blocker.kind && item.sourceId === blocker.sourceId)) return;
  blockers.push(blocker);
}

function encounterIntentReferencesHolding(intent: EncounterStartIntent, holdingId: string): boolean {
  return intent.kind === 'war' && intent.targetHoldingId === holdingId;
}

/**
 * 删除只处理当前领地账本。历史正文、纪事、报告、地图地点、驻军部队、人物与势力均保留；
 * 仍在运行的系统引用必须先解除，避免制造悬空引用。
 */
export function analyzeHoldingDeletion(
  state: RuntimeState,
  holdingId: string,
): HoldingDeletionAnalysis {
  const holding = (state.holdings ?? []).find((candidate) => candidate.holdingId === holdingId);
  if (!holding) {
    return {
      holdingId,
      holdingName: '',
      exists: false,
      canDelete: false,
      blockers: [],
      removableGovernanceProjectCount: 0,
      preservedGarrisonTroopCount: 0,
    };
  }

  const blockers: HoldingDeletionBlocker[] = [];
  const governanceProjects = (state.holdingGovernanceProjects ?? []).filter(
    (project) => project.holdingId === holdingId,
  );

  for (const project of governanceProjects) {
    if (project.status === 'active' || project.status === 'blocked') {
      addBlocker(blockers, {
        kind: 'holding_governance_project',
        label: `治理项目仍处于${project.status === 'active' ? '进行中' : '阻塞待处理'}状态`,
        sourceId: project.projectId,
      });
    }
  }

  for (const project of state.heavyCavalryFormationProjects ?? []) {
    if (project.holdingId === holdingId && project.status === 'active') {
      addBlocker(blockers, {
        kind: 'heavy_cavalry_project',
        label: `重骑组建项目“${project.troopName}”仍在进行`,
        sourceId: project.projectId,
      });
    }
  }

  for (const quest of state.activeQuests ?? []) {
    if (quest.status === 'active' && quest.affectedHoldingIds?.includes(holdingId)) {
      addBlocker(blockers, {
        kind: 'active_quest',
        label: `仍被进行中事项“${quest.title}”引用`,
        sourceId: quest.id,
      });
    }
  }

  const activeIntent = state.encounterV2?.active?.session.intent;
  const pendingIntent = state.encounterV2?.pendingOffer?.intent;
  if (
    (activeIntent && encounterIntentReferencesHolding(activeIntent, holdingId))
    || (pendingIntent && encounterIntentReferencesHolding(pendingIntent, holdingId))
  ) {
    addBlocker(blockers, {
      kind: 'active_encounter',
      label: '仍是尚未完成战争的目标领地',
      sourceId: state.encounterV2?.active?.session.sessionId
        ?? state.encounterV2?.pendingOffer?.offerId
        ?? holdingId,
    });
  }

  return {
    holdingId,
    holdingName: holding.name,
    exists: true,
    canDelete: blockers.length === 0,
    blockers,
    removableGovernanceProjectCount: governanceProjects.length,
    preservedGarrisonTroopCount: holding.garrisonTroopIds?.length ?? 0,
  };
}

export function deleteHoldingSafely(
  state: RuntimeState,
  holdingId: string,
): HoldingDeletionResult {
  const analysis = analyzeHoldingDeletion(state, holdingId);
  if (!analysis.canDelete) {
    return { state, deleted: false, analysis };
  }

  const nextState: RuntimeState = {
    ...state,
    holdings: (state.holdings ?? []).filter((holding) => holding.holdingId !== holdingId),
    holdingGovernanceProjects: (state.holdingGovernanceProjects ?? []).filter(
      (project) => project.holdingId !== holdingId,
    ),
  };

  return {
    state: nextState,
    deleted: true,
    analysis,
  };
}

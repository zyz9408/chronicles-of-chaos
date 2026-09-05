import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type {
  CharacterEquipmentItem,
  EquipmentSlot,
  OpeningCrisisTemplate,
  CombatRecord,
  ConflictRecord,
  HoldingGovernanceProjectType,
  PrivateAssetProjectType,
  RuntimeState,
  SuggestedAction,
  StartBookmark,
  TurnProcessingStage,
  TurnProcessingStageEvent,
  TurnJudgementCard,
  WorldBook,
} from '../engine/types';
import type { TurnResult } from '../engine/turn/TurnOrchestrator';
import { executeTurn } from '../engine/turn/TurnOrchestrator';
import { generateTrueOpening } from '../engine/opening/TrueOpeningGenerator';
import {
  formatElapsedTime,
  formatTokenCount,
  getPromptCacheHitRate,
  getTurnDisplayTitle,
} from '../engine/turn/turnDisplay';
import { buildNarrativeDiagnosticExport } from '../engine/turn/narrativeDiagnostics';
import { buildCurrentLocationDisplayPath, buildRuntimeMapIndex } from '../engine/map/runtimeMap';
import { isOpenCurrentMatter } from '../engine/state/currentMatterLifecycle';
import {
  analyzeNpcProfileDeletion,
  deleteNpcProfileSafely,
  type NpcProfileDeletionAnalysis,
} from '../engine/state/NpcProfileDeletion';
import {
  analyzeHoldingDeletion,
  deleteHoldingSafely,
  type HoldingDeletionAnalysis,
} from '../engine/state/HoldingDeletion';
import {
  commitPreparedStateWritebackRecovery,
  createStateWritebackRecoveryVerification,
  prepareStateWritebackRecovery,
  type StateWritebackRecoveryPreparationResult,
} from '../engine/state/StateWritebackRecoveryService';
import { finalizePendingStateWritebackRecoveryHead } from '../engine/state/StateWritebackRecovery';
import { formatNarrativeWordCountLabel } from './narrativeWordCount';
import { NarrativeTextView } from './NarrativeTextView';
import { AvgNarrativeStage } from './AvgNarrativeStage';
import { StateWritebackRecoveryPanel } from './StateWritebackRecoveryPanel';
import {
  AVG_RESOURCE_PACK_CHANGED_EVENT,
  AvgResourcePackManager,
} from '../engine/avg/AvgResourcePackManager';
import { materializeAvgPresentation } from '../engine/avg/AvgPresentationMaterializer';
import { preflightAvgPlayback } from '../engine/avg/AvgPlaybackPreflight';
import { AVG_VISUAL_OVERRIDES_CHANGED_EVENT } from '../engine/avg/AvgVisualOverrideRepository';
import { MobileActionEditor } from './MobileActionEditor';
import { DesktopWeatherAtmosphere } from './DesktopWeatherAtmosphere';
import { StoryExportPanel } from './StoryExportPanel';
import { PersistentPromptPanel } from './PersistentPromptPanel';
import { sanitizeProcessingStageDetail, TurnProcessingTrace } from './TurnProcessingTrace';
import {
  buildFailedTurnProcessingAttempt,
  type FailedTurnProcessingAttempt,
} from './turnProcessingAttempt';
import {
  composePersistentPromptGuide,
  loadPersistentPromptsFromStorage,
  savePersistentPromptsToStorage,
  type PersistentPromptEntry,
} from '../engine/prompts/PersistentPromptStore';
import {
  commitDeveloperOverride,
  commitSuccessfulTurn,
  commitTurnRestore,
  hasRestorableDeveloperOverrideCheckpoint,
  restoreDeveloperOverrideCheckpoint,
  saveCurrentState,
} from '../engine/save/SaveManager';
import { getStartBookmark } from '../engine/worldbook/StartBookmarkResolver';
import { getCrisisTemplate } from '../engine/worldbook/OpeningCrisisResolver';
import {
  getApiFeatureExecutionModesAsync,
  resolveApiConfigForTaskAsync,
  resolveExplicitApiConfigForTaskAsync,
} from '../engine/settings/ApiConfigManager';
import { BrowserLlmClient } from '../engine/llm/LlmClient';
import {
  appendMemorySummaryExecutionSummary,
  clearMemorySummaryMaintenance,
  executeMemorySummaryCompression,
  failMemorySummaryMaintenance,
  getConfiguredEmbeddingApiConfig,
  getConfiguredMemorySummaryApiConfig,
  getMemorySummaryMaintenance,
  hasPendingMemorySummaryMaintenance,
  queueMemorySummaryMaintenance,
  reapplyMemorySummaryExecutionResult,
  shouldCreateRecentTurnSummaryTask,
  shouldRunAutomaticMemorySummaryMaintenance,
  toPlayerSafeMemorySummaryFailureReason,
} from '../engine/memory';
import { getConfiguredNpcSimulationApiConfig } from '../engine/npc/NpcIntentSimulation';
import { loadNpcSimulationSettings } from '../engine/npc/NpcSimulationSettings';
import { formatCurrency } from '../engine/character/currency';
import { equipInventoryItem, removePlayerItem, unequipInventoryItem } from '../engine/character/playerLoadout';
import { projectEquippedItems } from '../engine/character/loadoutIdentity';
import { applyPlayerRestorativeItemUse } from '../engine/character/PlayerRestorativeItemRuntime';
import {
  allocatePlayerGrowthPoint,
  CORE_PLAYER_ATTRIBUTE_KEYS,
  experienceForNextLevel,
  growthPointsForReachedLevel,
} from '../engine/character/progression';
import { ensureGameClock, formatGameDateLabelForStatusBar } from '../engine/time/gameClock';
import { deriveActorCurrentAge } from '../engine/time/npcAge';
import { deriveCurrentWeather } from '../engine/time/weather';
import {
  AVG_PLAYER_PORTRAIT_MODE_CHANGED_EVENT,
  NARRATIVE_PRESENTATION_CHANGED_EVENT,
  loadAvgPlayerPortraitModeFromStorage,
  loadNarrativePresentationFromStorage,
  loadNpcPresenceHintsEnabledFromStorage,
  loadRenderDepthFromStorage,
  loadSnapshotDepthFromStorage,
  saveNarrativePresentationToStorage,
  type AvgPlayerPortraitMode,
  type NarrativePresentationPreference,
} from '../engine/settings/DisplaySettings';
import {
  loadAutoSaveIntervalTurnsFromStorage,
  loadAutoSaveLimitFromStorage,
} from '../engine/settings/SaveSettings';
import { buildNarrativeRenderEntries, type NarrativeRenderEntry } from '../engine/turn/narrativeDisplay';
import { sanitizeCombatReportText } from '../engine/combat/combatReportText';
import { sidePanelIconMap } from './SidePanelIcons';
import { narrativeTurnDisplayLabels } from './narrativeTurnDisplayLabels';
import { MemoryPanel } from './MemoryPanel';
import { CorrespondencePanel, countUnreadCorrespondence } from './CorrespondencePanel';
import {
  PanelEmptyState,
  PanelListDetailLayout,
  PanelNotice,
  SystemModalFrame,
  SystemModalHeader,
} from './SystemPanelPrimitives';
import { buildPlayerProfilePanelModel } from './playerProfilePanelModel';
import {
  buildNpcPanelModel,
  selectNpcPrivateRecords,
  type NpcMemoryLayerKey,
  type NpcPrivateRecordDisplayLimit,
} from './npcPanelModel';
import { buildHeroinePanelModel } from './heroinePanelModel';
import { buildBondPanelModel } from './bondPanelModel';
import { buildDynamicPanelModel, type DynamicPanelStageKey, type DynamicPanelTabKey } from './dynamicPanelModel';
import {
  buildFactionPanelModel,
  type FactionPanelRecentAction,
} from './factionPanelModel';
import { buildHoldingPanelModel, type HoldingPanelTabKey } from './holdingPanelModel';
import { buildHoldingGovernancePanelModel } from './holdingGovernancePanelModel';
import { buildPrivateAssetManagementPanelModel } from './privateAssetManagementPanelModel';
import {
  cancelHoldingGovernanceProject,
  startHoldingGovernanceProject,
} from '../engine/holdings/HoldingGovernanceProjects';
import {
  cancelPrivateAssetManagementProject,
  startPrivateAssetManagementProject,
} from '../engine/holdings/PrivateAssetManagementProjects';
import { resolveHoldingCivilAdministrationScope } from '../engine/holdings/HoldingCivilAdministration';
import { loadHoldingVisualManifest, resolveHoldingVisualAsset } from './holdingVisualAssets';
import { buildTroopPanelModel, type TroopPanelDetailRow } from './troopPanelModel';
import {
  buildBattlePanelModel,
  formatConflictResultLevel,
  formatConflictType,
  type BattlePanelTabKey,
} from './battlePanelModel';
import {
  buildCombatPanelModel,
  formatCombatKind,
  formatCombatResult,
  formatCombatSignificance,
  type CombatPanelTabKey,
} from './combatPanelModel';
import {
  buildBackpackPanelModel,
  type BackpackCategoryKey,
  type BackpackItemModel,
} from './backpackPanelModel';
import { buildUniqueArtsPanelModel } from './uniqueArtsPanelModel';
import { buildCombatBriefingCard, buildConflictBriefingCard, diffBattleBriefingCards, type BattleBriefingCard } from './battleBriefingQueueModel';
import { loadTroopVisualManifest, resolveTroopVisualAsset } from './troopVisualAssets';
import { ProgressivePanelVisual } from './ProgressivePanelVisual';
import { BattleBriefingVisual } from './BattleBriefingVisual';
import { shouldLoadHoldingVisualAsset, shouldLoadTroopVisualAsset } from './panelVisualAssetLoader';
import { decideTurnActionContextMenu } from './turnActionContextMenu';
import { shouldShowTrueOpeningRetryButton } from './openingRetryModel';
import { persistResolvedCustomOpeningTraitRarities } from './openingCustomOptions';
import { appendSuggestedActionToInput, summarizeSuggestedAction } from './suggestedActionInput';
import { useModalAccessibility } from './modalAccessibility';
import type { SettingsTab } from './settingsPanelModel';
import { TRAIT_RARITY_LEGEND_TITLE, buildEquipmentTooltipTitle, buildTraitTooltipTitle, buildUniqueArtTooltipTitle, formatEquipmentQualityLabel, formatKnownSourceLabel, normalizeTraitRarity, normalizeUniqueArtRarity } from './gameTooltipText';
import {
  createTurnRollbackSnapshot,
  restoreTurnRollbackSnapshot,
} from '../engine/turn/TurnRollback';
import {
  listTurnSnapshots,
  loadTurnSnapshot,
} from '../engine/turn/TurnSnapshotStore';
import {
  TurnExecutionOwner,
  isTurnExecutionCancelled,
  type TurnExecutionContext,
} from '../engine/turn/TurnExecutionContext';
import {
  DEVELOPER_COMMAND_PREFIX,
  executeDeveloperFactOverride,
  parseDeveloperCommandInput,
} from '../engine/turn/DeveloperFactOverride';
import {
  acceptCombatEncounterOffer,
  commitCombatResultToRuntime,
  commitWarResultToRuntime,
  completeCombatNarrativeTurn,
  completeWarNarrativeTurn,
  declineCombatEncounterOffer,
  generateCombatNarrative,
  generateWarNarrative,
  mergeEncounterSemanticProjections,
  stageCombatEncounter,
  stageCombatEncounterOffer,
  stageWarEncounter,
} from '../engine/encounterV2';
import {
  CombatEncounterScreen,
  type CombatResolvedPayload,
} from './CombatEncounterScreen';
import {
  WarEncounterScreen,
  type WarResolvedPayload,
} from './WarEncounterScreen';

const HOLDING_SIEGE_ROW_LABELS = new Set(['围城态势', '补给线', '备战储备', '守城补给']);
const HOLDING_MILITARY_SITE_TYPES = new Set(['camp', 'fort', 'pass']);

const LazyMapPanel = React.lazy(async () => {
  const module = await import('./MapPanel');
  return { default: module.MapPanel };
});

const DYNAMIC_STAGE_DESCRIPTIONS: Record<DynamicPanelStageKey, string> = {
  urgent: '先看有期限、重大风险或高优先级的玩家责任。',
  developing: '追踪仍在变化的事项、风声、纪事与当地暗流。',
  verified: '集中查阅已核实的情报和已确认的局势事实。',
  history: '回看已经结束、失效或沉淀为历史的记录。',
};

export function buildTurnCompletionMessage(
  result: Pick<
    TurnResult,
    | 'locationWritebackErrors'
    | 'routeWritebackErrors'
    | 'locationWritebackDiagnostics'
    | 'stateWritebackWarnings'
  >,
): string {
  const hasLocationWritebackWarning = result.locationWritebackErrors.length > 0
    || result.routeWritebackErrors.length > 0
    || result.locationWritebackDiagnostics.length > 0;
  if (hasLocationWritebackWarning) {
    return '本回合已自动保存，但地图写回存在警告；部分地点或路线建议未写入。';
  }
  if (result.stateWritebackWarnings.length > 0) {
    return '本回合已自动保存，但部分状态写回未通过校验；相关变更已隔离，地图与其余合法状态已保留。';
  }
  return '';
}

export function isDismissibleTurnCompletionMessage(message: string): boolean {
  return message.startsWith('本回合已自动保存，但');
}

export function getLatestSuggestedActions(
  state: Pick<RuntimeState, 'turnLog'>,
): SuggestedAction[] {
  const latest = state.turnLog[state.turnLog.length - 1];
  return (latest?.suggestedActions ?? []).map((action) => ({ ...action }));
}

interface ActionSubmitKeyboardEvent {
  key: string;
  code: string;
  location: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  isComposing?: boolean;
}

export function isRightControlKey(event: Pick<ActionSubmitKeyboardEvent, 'key' | 'code' | 'location'>): boolean {
  return event.code === 'ControlRight'
    || (event.key === 'Control' && event.location === 2);
}

export function shouldSubmitActionFromKeyboard(
  event: ActionSubmitKeyboardEvent,
  isRightControlPressed: boolean,
): boolean {
  return event.key === 'Enter'
    && isRightControlPressed
    && event.ctrlKey
    && !event.shiftKey
    && !event.altKey
    && !event.metaKey
    && !event.repeat
    && !event.isComposing;
}

export function buildTurnSubmitButtonModel({
  hasInput,
  isProcessing,
  isCancelling,
  onSubmit,
  onCancel,
}: {
  hasInput: boolean;
  isProcessing: boolean;
  isCancelling: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}): {
  label: string;
  shortcutHint?: string;
  disabled: boolean;
  className: string;
  onClick: () => void;
} {
  if (isProcessing) {
    return {
      label: isCancelling ? '正在中止…' : '中止生成',
      disabled: isCancelling,
      className: 'submit-btn submit-btn-cancel',
      onClick: onCancel,
    };
  }

  return {
    label: '执行行动',
    shortcutHint: '右 Ctrl + Enter',
    disabled: !hasInput,
    className: 'submit-btn',
    onClick: onSubmit,
  };
}

interface Props {
  worldBook: WorldBook;
  runtimeState: RuntimeState;
  saveId: string;
  sessionGeneration: number;
  executionOwner: TurnExecutionOwner;
  autoGenerateOpening?: boolean;
  onAutoOpeningStarted?: () => void;
  onRuntimeStateChange?: (runtimeState: RuntimeState) => void;
  onOpenSaveProgress: () => void;
  onOpenLoadProgress: () => void;
  onOpenSettings: (tab?: SettingsTab) => void;
  onBackToStart: () => void;
}

const mainNarrativeLlmClient = new BrowserLlmClient();

export function getWeatherGlyph(label: string, tags: string[] = []): string {
  const weatherText = `${label} ${tags.join(' ')}`;
  if (/雪|霜|冰|严寒/.test(weatherText)) return '❄';
  if (/雨|湿|泥泞|水汽/.test(weatherText)) return '☂';
  if (/雾|烟|低能见度/.test(weatherText)) return '≋';
  if (/风|沙/.test(weatherText)) return '風';
  if (/夜|暮/.test(weatherText)) return '☾';
  return '☀';
}

export function formatMobileTopBarDateLabel(label: string): string {
  return label
    .replace(/（\d+年）/, '')
    .replace(/(\d{2})月(\d{2})日/, '$1/$2')
    .replace(/年(?=\d{2}\/)/, '年 · ')
    .replace(/\s*（([^）]+)）$/, ' · $1');
}

export function formatProcessingStageText(event: TurnProcessingStageEvent): string {
  if (event.status === 'started') return event.label;

  const elapsed = typeof event.elapsedMs === 'number' ? `，耗时 ${formatElapsedTime(event.elapsedMs)}` : '';
  const detail = event.detail ? `：${sanitizeProcessingStageDetail(event.detail)}` : '';
  if (event.status === 'failed') return `${event.label}失败${elapsed}${detail}`;
  if (event.status === 'skipped') return `${event.label}跳过${elapsed}${detail}`;
  return `${event.label}完成${elapsed}`;
}

export const FULL_DIAGNOSTIC_EXPORT_WARNING =
  '完整诊断导出可能包含正文、原始模型响应和私密资料。请只在需要排查问题并确认可分享时继续。是否生成完整诊断？';

export function confirmFullDiagnosticExport(confirm: (message: string) => boolean): boolean {
  return confirm(FULL_DIAGNOSTIC_EXPORT_WARNING);
}

export type GameMessageTone = 'info' | 'success' | 'error';

export function classifyGameMessageTone(message: string): GameMessageTone {
  if (/(?:错误|失败|超时|警告|未能|中断)/.test(message)) return 'error';
  if (/(?:自动保存|已保存|成功|完成)/.test(message)) return 'success';
  return 'info';
}

type ActiveTurnPanelMode = 'trace' | 'edit' | 'raw';

interface ActiveTurnPanelState {
  mode: ActiveTurnPanelMode;
  entryKey: string;
}

export function NarrativeLiveLoader(): React.ReactElement {
  return (
    <div className="narrative-live-loader" data-testid="narrative-live-loader" role="status" aria-label="正在生成正文">
      <div className="scroll-loader" aria-hidden="true">
        <span className="scroll-roller left" />
        <span className="scroll-sheet">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="scroll-roller right" />
      </div>
    </div>
  );
}

export type ActiveSystemPanel =
  | 'backpack'
  | 'factions'
  | 'holdings'
  | 'troops'
  | 'battles'
  | 'combats'
  | 'uniqueArts'
  | 'map'
  | 'playerProfile'
  | 'npcs'
  | 'heroines'
  | 'bonds'
  | 'correspondence'
  | 'dynamics'
  | 'memories';

export type MobileGameRegion = 'profile' | 'narrative' | 'systems';

export const sidePanelButtons: Array<{
  panel: ActiveSystemPanel;
  label: string;
  icon: React.ReactElement;
  tone: 'world' | 'social' | 'self' | 'faction' | 'war';
}> = [
  { panel: 'dynamics', label: '局势', icon: sidePanelIconMap.dynamics, tone: 'world' },
  { panel: 'map', label: '地图', icon: sidePanelIconMap.map, tone: 'world' },
  { panel: 'npcs', label: '人物志', icon: sidePanelIconMap.npcs, tone: 'social' },
  { panel: 'bonds', label: '羁绊', icon: sidePanelIconMap.bonds, tone: 'social' },
  { panel: 'heroines', label: '红颜', icon: sidePanelIconMap.heroines, tone: 'social' },
  { panel: 'correspondence', label: '书信', icon: sidePanelIconMap.correspondence, tone: 'social' },
  { panel: 'backpack', label: '背包', icon: sidePanelIconMap.backpack, tone: 'self' },
  { panel: 'uniqueArts', label: '绝艺', icon: sidePanelIconMap.uniqueArts, tone: 'self' },
  { panel: 'factions', label: '势力', icon: sidePanelIconMap.factions, tone: 'faction' },
  { panel: 'holdings', label: '领地', icon: sidePanelIconMap.holdings, tone: 'faction' },
  { panel: 'troops', label: '部队', icon: sidePanelIconMap.troops, tone: 'faction' },
  { panel: 'battles', label: '战事', icon: sidePanelIconMap.battles, tone: 'war' },
  { panel: 'combats', label: '战斗', icon: sidePanelIconMap.combats, tone: 'war' },
  { panel: 'memories', label: '回忆', icon: sidePanelIconMap.memories, tone: 'self' },
];

export function MobileRegionSwitcher({
  activeRegion,
  onSelect,
}: {
  activeRegion: MobileGameRegion;
  onSelect: (region: MobileGameRegion) => void;
}): React.ReactElement {
  const regions: Array<{ key: MobileGameRegion; label: string }> = [
    { key: 'profile', label: '角色' },
    { key: 'narrative', label: '正文' },
    { key: 'systems', label: '系统' },
  ];

  return (
    <nav className="mobile-region-switcher" data-testid="mobile-region-switcher" aria-label="主界面区域">
      {regions.map((region) => (
        <button
          key={region.key}
          type="button"
          data-testid={`mobile-region-${region.key}`}
          aria-pressed={activeRegion === region.key}
          className={activeRegion === region.key ? 'active' : ''}
          onClick={() => onSelect(region.key)}
        >
          {region.label}
        </button>
      ))}
    </nav>
  );
}

export async function commitBeforePublish<T>(
  commit: () => Promise<T>,
  publish: (committed: T) => void | Promise<void>,
): Promise<T> {
  const committed = await commit();
  await publish(committed);
  return committed;
}

export const NARRATIVE_SCROLL_FOLLOW_THRESHOLD_PX = 48;

export function derivePlayerSidebarAge(
  player: RuntimeState['player'],
  currentDate: string,
): number | undefined {
  return deriveActorCurrentAge(player, currentDate);
}

export function sanitizeAvgPreparingStageText(value: string): string {
  return value
    .replace(/\bAuthorization\s*:\s*Bearer\s+[^"',\s}]+/giu, '[已隐藏鉴权信息]')
    .replace(/\bBearer\s+[^"',\s}]+/giu, '[已隐藏鉴权信息]')
    .replace(/\b(?:sk|tp)-[A-Za-z0-9._-]+/giu, '[已隐藏密钥]')
    .replace(/"?(?:x-api-key|apiKey)"?\s*:\s*"[^"]*"/giu, '[已隐藏密钥字段]')
    .slice(0, 500);
}

export type FactionRecentActionDisplayLimit = 10 | 20 | 30 | 'all';

export function selectFactionRecentActions(
  actions: readonly FactionPanelRecentAction[],
  limit: FactionRecentActionDisplayLimit,
): FactionPanelRecentAction[] {
  const selected = limit === 'all' ? [...actions] : actions.slice(-limit);
  return selected.reverse();
}

export function isNarrativeScrollNearBottom(
  metrics: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>,
): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= NARRATIVE_SCROLL_FOLLOW_THRESHOLD_PX;
}

export function derivePanelModelWhenActive<T>(
  activePanel: ActiveSystemPanel | null,
  targetPanel: ActiveSystemPanel,
  builder: () => T,
): T | null {
  return activePanel === targetPanel ? builder() : null;
}

export function selectBottomBarCurrentMatter(
  state: RuntimeState,
): RuntimeState['activeQuests'][number] | undefined {
  return state.activeQuests.find(isOpenCurrentMatter);
}

const relationshipStatusLabels = {
  active: '进行中',
  paused: '暂缓',
  resolved: '已完成',
  archived: '归档',
} as const;

const bondTypeLabels = {
  sworn: '结义',
  kinship: '亲族',
  mentor: '师徒',
  lordVassal: '君臣',
  ally: '盟友',
  debt: '恩债',
  rival: '竞争',
  enemy: '仇敌',
  other: '其他',
} as const;

const combatParticipantSideLabels: Record<string, string> = {
  player: '玩家',
  ally: '友方',
  enemy: '敌方',
  neutral: '中立',
};

const combatAdvantageLabels: Record<string, string> = {
  overwhelmingAdvantage: '压倒优势',
  clearAdvantage: '明显优势',
  slightAdvantage: '略占优势',
  even: '势均力敌',
  slightDisadvantage: '略处劣势',
  clearDisadvantage: '明显劣势',
  overwhelmingDisadvantage: '压倒劣势',
};

const combatScoreFieldLabels: Record<string, string> = {
  personalBase: '个人基础',
  equipment: '装备',
  status: '状态',
  environment: '环境',
  combatMethod: '战法',
  uniqueArts: '绝艺',
  playerAction: '行动',
  turningPoint: '转折',
  total: '合计',
};

const conflictScoreFieldLabels: Record<string, string> = {
  troopBase: '兵力基础',
  commander: '主帅',
  tactical: '战术',
  uniqueArts: '绝艺',
  turningPoint: '转折',
  playerAction: '玩家行动',
  total: '合计',
};

const conflictTurningPointTypeLabels: Record<string, string> = {
  duelVictory: '单挑取胜',
  duelDefeat: '单挑失利',
  commanderSlain: '主帅被斩',
  commanderCaptured: '主帅被俘',
  commanderWounded: '主帅负伤',
  commanderFled: '主帅逃走',
  ambush: '伏击',
  fireAttack: '火攻',
  supplyDestroyed: '粮道受损',
  gateBreached: '城门突破',
  reinforcementArrived: '援军抵达',
  moraleCollapse: '士气崩溃',
  terrainBreakthrough: '地势突破',
  playerAction: '玩家行动',
  other: '其他',
};

const conflictTurningPointImpactLabels: Record<string, string> = {
  minor: '轻微',
  moderate: '中等',
  major: '重大',
  critical: '关键',
};

const combatOutcomeTagLabels: Record<string, string> = {
  kill: '击杀',
  wound: '受伤',
  seriousWound: '重伤',
  capture: '擒获',
  forceRetreat: '逼退',
  escape: '脱身',
  woundedRetreat: '负伤退走',
  disarm: '缴械',
  rout: '击溃',
};

const formatCombatParticipantSide = (value?: string) => (
  value ? combatParticipantSideLabels[value] ?? value : undefined
);

const formatCombatAdvantage = (value?: string) => (
  value ? combatAdvantageLabels[value] ?? value : undefined
);

const formatCombatOutcomeTag = (value: string) => combatOutcomeTagLabels[value] ?? value;

const formatCombatScoreBreakdown = (scoreBreakdown: Record<string, unknown>) => (
  Object.entries(scoreBreakdown)
    .filter(([key, value]) => key !== 'notes' && typeof value === 'number')
    .map(([key, value]) => `${combatScoreFieldLabels[key] ?? key} ${value}`)
    .join(' / ')
);

const formatConflictScoreBreakdown = (scoreBreakdown: Record<string, unknown>) => (
  Object.entries(scoreBreakdown)
    .filter(([key, value]) => key !== 'notes' && typeof value === 'number')
    .map(([key, value]) => `${conflictScoreFieldLabels[key] ?? key} ${value}`)
    .join(' / ')
);

const formatConflictTurningPointType = (value: string) => conflictTurningPointTypeLabels[value] ?? value;

const formatConflictTurningPointImpact = (value: string) => conflictTurningPointImpactLabels[value] ?? value;

const equipmentSlotLabels: Record<CharacterEquipmentItem['slot'], string> = {
  weapon: '武器',
  armor: '防具',
  mount: '坐骑',
  treasure: '宝物',
};

const equipmentTitle = (item?: CharacterEquipmentItem) => buildEquipmentTooltipTitle(item);

const equipmentDisplay = (item?: CharacterEquipmentItem) =>
  item ? `${item.name}·${formatEquipmentQualityLabel(item.quality)}` : '无';

const renderBackpackItemIcon = (iconLabel: string) => {
  switch (iconLabel) {
    case '刃':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path d="M22.5 4.5 27 9 12.5 23.5 8 25l1.5-4.5L22.5 4.5Z" />
          <path d="m10 20 2 2M6 26l6-6" />
        </svg>
      );
    case '甲':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path d="M16 4 25 8v7c0 6-3.8 10.4-9 13-5.2-2.6-9-7-9-13V8l9-4Z" />
          <path d="M16 7v17" />
        </svg>
      );
    case '马':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path d="M8 22v-7l5-5h8l4 5v7" />
          <path d="M11 22v4M22 22v4M13 10l-2-4M21 10l3-4" />
          <path d="M14 16h6" />
        </svg>
      );
    case '佩':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path d="M16 5c3.2 0 5.8 2.6 5.8 5.8S19.2 16.6 16 16.6s-5.8-2.6-5.8-5.8S12.8 5 16 5Z" />
          <path d="M12 15.5 8 27l8-4 8 4-4-11.5" />
        </svg>
      );
    case '令':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path d="M9 5h14v22H9z" />
          <path d="M12 10h8M12 15h8M12 20h5" />
        </svg>
      );
    case '药':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path d="M12 4h8v5l4 5v11a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V14l4-5V4Z" />
          <path d="M12 15h8M16 11v8" />
        </svg>
      );
    case '粮':
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path d="M10 9c0-3 12-3 12 0v16c0 3-12 3-12 0V9Z" />
          <path d="M10 9c0 3 12 3 12 0M12 17h8" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <path d="M8 10h16v14H8z" />
          <path d="M12 10V7h8v3M11 15h10M11 20h7" />
        </svg>
      );
  }
};

const profileRowTitle = (row: { value?: string; detail?: string; tooltip?: string }) =>
  [row.value, row.detail, row.tooltip].filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join('\n') || undefined;

const profileLongRowLabels = new Set(['外貌', '性格']);

const profileRowClassName = (row: { label?: string }) =>
  `player-profile-row ${profileLongRowLabels.has(row.label ?? '') ? 'player-profile-row--long' : 'player-profile-row--compact'}`;

const percentOf = (current: number, max: number) => {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (current / max) * 100));
};

const summarizeNarrativeForLog = (text: string) =>
  text.slice(0, 200) + (text.length > 200 ? '...' : '');

const extractNarrativePreview = (streamedContent: string) => {
  const marker = '"narrativeText"';
  const markerIndex = streamedContent.indexOf(marker);
  if (markerIndex < 0) return streamedContent;

  const colonIndex = streamedContent.indexOf(':', markerIndex + marker.length);
  if (colonIndex < 0) return '';

  let valueStart = streamedContent.indexOf('"', colonIndex + 1);
  if (valueStart < 0) return '';
  valueStart += 1;

  let value = '';
  let escaping = false;
  for (let index = valueStart; index < streamedContent.length; index += 1) {
    const char = streamedContent[index];
    if (escaping) {
      value += char === 'n' ? '\n' : char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      escaping = true;
      continue;
    }
    if (char === '"') break;
    value += char;
  }
  return value;
};

function buildEquipmentRows(equipment: CharacterEquipmentItem[] = []) {
  const projectedEquipment = projectEquippedItems(equipment);
  const treasures = projectedEquipment.filter((item) => item.slot === 'treasure').slice(0, 3);
  return [
    { label: equipmentSlotLabels.weapon, slot: 'weapon' as const, item: projectedEquipment.find((item) => item.slot === 'weapon') },
    { label: equipmentSlotLabels.armor, slot: 'armor' as const, item: projectedEquipment.find((item) => item.slot === 'armor') },
    { label: equipmentSlotLabels.mount, slot: 'mount' as const, item: projectedEquipment.find((item) => item.slot === 'mount') },
    { label: '宝物一', slot: 'treasure' as const, item: treasures[0], treasureIndex: 0 },
    { label: '宝物二', slot: 'treasure' as const, item: treasures[1], treasureIndex: 1 },
    { label: '宝物三', slot: 'treasure' as const, item: treasures[2], treasureIndex: 2 },
  ];
}

export const GameScreen: React.FC<Props> = ({
  worldBook,
  runtimeState: initial,
  saveId,
  sessionGeneration,
  executionOwner,
  autoGenerateOpening = false,
  onAutoOpeningStarted,
  onRuntimeStateChange,
  onOpenSaveProgress,
  onOpenLoadProgress,
  onOpenSettings,
  onBackToStart,
}) => {
  const [runtimeState, setRuntimeState] = useState<RuntimeState>(initial);
  const [isResolvingEncounterOffer, setIsResolvingEncounterOffer] = useState(false);
  const [playerInput, setPlayerInput] = useState('');
  const isRightControlPressedRef = useRef(false);
  const [narrativeText, setNarrativeText] = useState('');
  const [pendingActionText, setPendingActionText] = useState('');
  const [suggestedActions, setSuggestedActions] = useState<SuggestedAction[]>(
    () => getLatestSuggestedActions(initial),
  );
  const [lastPatch, setLastPatch] = useState<any>(null);
  const [patchValidation, setPatchValidation] = useState<any>(null);
  const [promptContext, setPromptContext] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [processingStageText, setProcessingStageText] = useState('');
  const [processingStageEvents, setProcessingStageEvents] = useState<TurnProcessingStageEvent[]>([]);
  const [failedProcessingAttempt, setFailedProcessingAttempt] = useState<FailedTurnProcessingAttempt | null>(null);
  const [message, setMessage] = useState('');
  const [stateWritebackRecoveryPreview, setStateWritebackRecoveryPreview] = useState<
    Extract<StateWritebackRecoveryPreparationResult, { status: 'ready' }> | null
  >(null);
  const [isPreparingStateWritebackRecovery, setIsPreparingStateWritebackRecovery] = useState(false);
  const [isApplyingStateWritebackRecovery, setIsApplyingStateWritebackRecovery] = useState(false);
  const [isMemorySummaryProcessing, setIsMemorySummaryProcessing] = useState(false);
  const [isMemorySummaryRecoveryOpen, setIsMemorySummaryRecoveryOpen] = useState(false);
  const [activeSystemPanel, setActiveSystemPanel] = useState<ActiveSystemPanel | null>(null);
  const [mobileGameRegion, setMobileGameRegion] = useState<MobileGameRegion>('narrative');
  const [narrativePresentation, setNarrativePresentation] = useState<NarrativePresentationPreference>(
    loadNarrativePresentationFromStorage,
  );
  const [avgPlayerPortraitMode, setAvgPlayerPortraitMode] = useState<AvgPlayerPortraitMode>(
    loadAvgPlayerPortraitModeFromStorage,
  );
  const avgResourcePackManager = useMemo(() => new AvgResourcePackManager(), []);
  const [avgResourcePackStatus, setAvgResourcePackStatus] = useState<'loading' | 'empty' | 'ready' | 'warning'>('loading');
  const avgResourcePackReady = avgResourcePackStatus === 'ready';
  const [avgVisualRevision, setAvgVisualRevision] = useState(0);
  const [isAvgImmersive, setIsAvgImmersive] = useState(false);
  const [isAvgImmersiveChoiceOpen, setIsAvgImmersiveChoiceOpen] = useState(false);
  const [avgImmersiveNotice, setAvgImmersiveNotice] = useState('');
  const [avgImmersiveHoveredRail, setAvgImmersiveHoveredRail] = useState<'left' | 'right' | null>(null);
  const [avgImmersivePinnedRail, setAvgImmersivePinnedRail] = useState<'left' | 'right' | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      setAvgResourcePackStatus('loading');
      void avgResourcePackManager.getActive(runtimeState.worldBookId)
        .then((pack) => { if (active) setAvgResourcePackStatus(pack ? 'ready' : 'empty'); })
        .catch(() => { if (active) setAvgResourcePackStatus('warning'); });
    };
    refresh();
    window.addEventListener(AVG_RESOURCE_PACK_CHANGED_EVENT, refresh);
    return () => { active = false; window.removeEventListener(AVG_RESOURCE_PACK_CHANGED_EVENT, refresh); };
  }, [avgResourcePackManager, runtimeState.worldBookId]);
  useEffect(() => {
    const refresh = () => setAvgVisualRevision((value) => value + 1);
    window.addEventListener(AVG_VISUAL_OVERRIDES_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(AVG_VISUAL_OVERRIDES_CHANGED_EVENT, refresh);
  }, []);

  const [activeBackpackCategory, setActiveBackpackCategory] = useState<BackpackCategoryKey>('all');
  const [selectedBackpackItemId, setSelectedBackpackItemId] = useState<string | null>(null);
  const [pendingInventoryRemoval, setPendingInventoryRemoval] = useState<BackpackItemModel | null>(null);
  const [usingBackpackItemId, setUsingBackpackItemId] = useState<string | null>(null);
  const [equipmentChooserSlot, setEquipmentChooserSlot] = useState<{ slot: EquipmentSlot; label: string; treasureIndex?: number } | null>(null);
  const [activeTurnPanel, setActiveTurnPanel] = useState<ActiveTurnPanelState | null>(null);
  const [editingNarrative, setEditingNarrative] = useState('');
  const [snapshotTurns, setSnapshotTurns] = useState<Set<number>>(() => new Set());
  const [editingActionKey, setEditingActionKey] = useState<string | null>(null);
  const [editingActionText, setEditingActionText] = useState('');
  const [canUndoDeveloperOverride, setCanUndoDeveloperOverride] = useState(false);
  const [diagnosticExportText, setDiagnosticExportText] = useState('');
  const [isDiagnosticExportOpen, setIsDiagnosticExportOpen] = useState(false);
  const [isStoryExportOpen, setIsStoryExportOpen] = useState(false);
  const [isPersistentPromptOpen, setIsPersistentPromptOpen] = useState(false);
  const [isMobileActionToolsOpen, setIsMobileActionToolsOpen] = useState(false);
  const [persistentPrompts, setPersistentPrompts] = useState<PersistentPromptEntry[]>(
    loadPersistentPromptsFromStorage,
  );
  const [diagnosticCopyStatus, setDiagnosticCopyStatus] = useState('');
  const [npcSearchText, setNpcSearchText] = useState('');
  const [npcOnlyFocused, setNpcOnlyFocused] = useState(false);
  const [npcGroupByLocation, setNpcGroupByLocation] = useState(false);
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(null);
  const [activeNpcMemoryLayer, setActiveNpcMemoryLayer] = useState<NpcMemoryLayerKey>('recent');
  const [pendingNpcDeletion, setPendingNpcDeletion] = useState<NpcProfileDeletionAnalysis | null>(null);
  const [isDeletingNpc, setIsDeletingNpc] = useState(false);
  const [npcPrivateRecordDisplayLimit, setNpcPrivateRecordDisplayLimit] = useState<NpcPrivateRecordDisplayLimit>(10);
  const [selectedHeroineThreadId, setSelectedHeroineThreadId] = useState<string | null>(null);
  const [selectedBondThreadId, setSelectedBondThreadId] = useState<string | null>(null);
  const [selectedFactionId, setSelectedFactionId] = useState<string | null>(null);
  const [factionRecentActionDisplayLimit, setFactionRecentActionDisplayLimit]
    = useState<FactionRecentActionDisplayLimit>(10);
  const [selectedHoldingId, setSelectedHoldingId] = useState<string | null>(null);
  const [pendingHoldingDeletion, setPendingHoldingDeletion] = useState<{
    analysis: HoldingDeletionAnalysis;
    step: 1 | 2;
  } | null>(null);
  const [isDeletingHolding, setIsDeletingHolding] = useState(false);
  const [selectedPrivateAssetId, setSelectedPrivateAssetId] = useState<string | null>(null);
  const [activeHoldingTab, setActiveHoldingTab] = useState<HoldingPanelTabKey>('overview');
  const [selectedTroopId, setSelectedTroopId] = useState<string | null>(null);
  const [selectedBattleId, setSelectedBattleId] = useState<string | null>(null);
  const [activeBattleTab, setActiveBattleTab] = useState<BattlePanelTabKey>('selfRelated');
  const [activeBattleReportId, setActiveBattleReportId] = useState<string | null>(null);
  const [selectedCombatId, setSelectedCombatId] = useState<string | null>(null);
  const [activeCombatTab, setActiveCombatTab] = useState<CombatPanelTabKey>('playerRelated');
  const [activeCombatReportId, setActiveCombatReportId] = useState<string | null>(null);
  const [selectedUniqueArtId, setSelectedUniqueArtId] = useState<string | null>(null);
  const [selectedGovernanceProjectType, setSelectedGovernanceProjectType] = useState<HoldingGovernanceProjectType>('land_survey');
  const [selectedGovernanceHostKey, setSelectedGovernanceHostKey] = useState('');
  const [selectedGovernanceAssistantKey, setSelectedGovernanceAssistantKey] = useState('');
  const [isMutatingHoldingGovernance, setIsMutatingHoldingGovernance] = useState(false);
  const [selectedPrivateAssetProjectType, setSelectedPrivateAssetProjectType] = useState<PrivateAssetProjectType>('recruit_tenants');
  const [selectedPrivateAssetHostKey, setSelectedPrivateAssetHostKey] = useState('');
  const [selectedPrivateAssetAssistantKey, setSelectedPrivateAssetAssistantKey] = useState('');
  const [isMutatingPrivateAsset, setIsMutatingPrivateAsset] = useState(false);
  const [battleBriefingQueue, setBattleBriefingQueue] = useState<BattleBriefingCard[]>([]);
  const [activeDynamicStage, setActiveDynamicStage] = useState<DynamicPanelStageKey>('urgent');
  const [activeDynamicTab, setActiveDynamicTab] = useState<DynamicPanelTabKey>('currentMatters');
  const [npcPresenceHintsEnabled, setNpcPresenceHintsEnabled] = useState(loadNpcPresenceHintsEnabledFromStorage);
  const autoOpeningStartedRef = useRef(false);
  const modalScopeRef = useRef<HTMLDivElement>(null);
  const narrativeScrollRef = useRef<HTMLDivElement>(null);
  const shouldFollowNarrativeBottomRef = useRef(true);
  const mountedRef = useRef(false);
  const activeExecutionRef = useRef<TurnExecutionContext | null>(null);
  const processingStageEventsRef = useRef<TurnProcessingStageEvent[]>([]);
  const runtimeStateRef = useRef(runtimeState);
  const avgMaterializationKeysRef = useRef(new Set<string>());
  const sessionIdentityRef = useRef(`${saveId}:${sessionGeneration}`);
  runtimeStateRef.current = runtimeState;
  sessionIdentityRef.current = `${saveId}:${sessionGeneration}`;
  const pendingEncounterOffer = runtimeState.encounterV2?.pendingOffer;

  const beginExecution = useCallback(() => {
    const execution = executionOwner.begin(saveId, sessionGeneration);
    activeExecutionRef.current = execution;
    setIsCancelling(false);
    setIsMemorySummaryProcessing(false);
    return execution;
  }, [executionOwner, saveId, sessionGeneration]);
  const assertExecutionCurrent = useCallback(
    (execution: TurnExecutionContext) => executionOwner.assertCurrent(execution, saveId, sessionGeneration),
    [executionOwner, saveId, sessionGeneration],
  );
  const isExecutionCurrent = useCallback(
    (execution: TurnExecutionContext) => executionOwner.isCurrent(execution, saveId, sessionGeneration),
    [executionOwner, saveId, sessionGeneration],
  );
  const resetProcessingTrace = useCallback((label: string) => {
    processingStageEventsRef.current = [];
    setProcessingStageEvents([]);
    setFailedProcessingAttempt(null);
    setProcessingStageText(label);
  }, []);
  const recordProcessingStage = useCallback((event: TurnProcessingStageEvent) => {
    const nextEvents = [...processingStageEventsRef.current, event];
    processingStageEventsRef.current = nextEvents;
    setProcessingStageEvents(nextEvents);
    setProcessingStageText(formatProcessingStageText(event));
  }, []);
  const startUiProcessingStage = useCallback((
    stage: TurnProcessingStage,
    label: string,
    model?: { provider?: string; model?: string },
  ): TurnProcessingStageEvent => {
    const event: TurnProcessingStageEvent = {
      stage,
      label,
      status: 'started',
      startedAt: new Date().toISOString(),
      provider: model?.provider,
      model: model?.model,
    };
    recordProcessingStage(event);
    return event;
  }, [recordProcessingStage]);
  const finishUiProcessingStage = useCallback((started: TurnProcessingStageEvent) => {
    const startedAtMs = started.startedAt ? Date.parse(started.startedAt) : Number.NaN;
    recordProcessingStage({
      ...started,
      status: 'finished',
      elapsedMs: Number.isFinite(startedAtMs) ? Math.max(0, Date.now() - startedAtMs) : undefined,
    });
  }, [recordProcessingStage]);
  const retainFailedProcessingAttempt = useCallback(({
    actionText,
    error,
    fallbackStage,
    fallbackLabel,
  }: {
    actionText: string;
    error: unknown;
    fallbackStage: TurnProcessingStage;
    fallbackLabel: string;
  }) => {
    const failedAttempt = buildFailedTurnProcessingAttempt({
      actionText,
      error,
      events: processingStageEventsRef.current,
      fallbackStage,
      fallbackLabel,
    });
    processingStageEventsRef.current = failedAttempt.processingStages;
    setProcessingStageEvents(failedAttempt.processingStages);
    setFailedProcessingAttempt(failedAttempt);
    const failedEvent = [...failedAttempt.processingStages]
      .reverse()
      .find((event) => event.status === 'failed');
    setProcessingStageText(failedEvent ? formatProcessingStageText(failedEvent) : `${fallbackLabel}失败`);
  }, []);
  const settleExecutionUi = useCallback((
    execution: TurnExecutionContext,
    options: { clearPendingAction?: boolean; preserveProcessingTrace?: boolean } = {},
  ): boolean => {
    const executionSessionIdentity = `${execution.saveId}:${execution.sessionGeneration}`;
    if (
      !mountedRef.current
      || activeExecutionRef.current !== execution
      || sessionIdentityRef.current !== executionSessionIdentity
    ) {
      return false;
    }

    activeExecutionRef.current = null;
    setIsProcessing(false);
    setIsCancelling(false);
    if (!options.preserveProcessingTrace) setProcessingStageText('');
    if (options.clearPendingAction) setPendingActionText('');
    return true;
  }, []);

  const handleNarrativeScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    shouldFollowNarrativeBottomRef.current = isNarrativeScrollNearBottom(event.currentTarget);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // StrictMode probes effects with cleanup/setup; real session exits are invalidated synchronously by StartScreen.
      queueMicrotask(() => {
        const execution = activeExecutionRef.current;
        if (!mountedRef.current && execution && executionOwner.isCurrent(execution, saveId, sessionGeneration)) {
          executionOwner.abort();
        }
      });
    };
  }, [executionOwner, saveId, sessionGeneration]);

  useEffect(() => {
    onRuntimeStateChange?.(runtimeState);
  }, [runtimeState, onRuntimeStateChange]);

  useEffect(() => {
    setRuntimeState(initial);
    runtimeStateRef.current = initial;
    setSuggestedActions(getLatestSuggestedActions(initial));
    setStateWritebackRecoveryPreview(null);
  }, [initial]);

  useEffect(() => {
    setIsResolvingEncounterOffer(false);
    setIsMemorySummaryProcessing(false);
    setIsMemorySummaryRecoveryOpen(false);
    setIsPreparingStateWritebackRecovery(false);
    setIsApplyingStateWritebackRecovery(false);
    setStateWritebackRecoveryPreview(null);
    setPendingNpcDeletion(null);
    setIsDeletingNpc(false);
    setPendingHoldingDeletion(null);
    setIsDeletingHolding(false);
    let cancelled = false;
    void hasRestorableDeveloperOverrideCheckpoint(saveId)
      .then((restorable) => {
        if (!cancelled) setCanUndoDeveloperOverride(restorable);
      })
      .catch(() => {
        if (!cancelled) setCanUndoDeveloperOverride(false);
      });
    return () => {
      cancelled = true;
    };
  }, [saveId, sessionGeneration]);

  useEffect(() => {
    if (activeSystemPanel === 'npcs') {
      setNpcPresenceHintsEnabled(loadNpcPresenceHintsEnabledFromStorage());
    }
  }, [activeSystemPanel]);

  const enqueueBattleBriefings = useCallback((previousState: RuntimeState, nextState: RuntimeState) => {
    const newCards = diffBattleBriefingCards(previousState, nextState);
    if (newCards.length === 0) return;

    setBattleBriefingQueue((queue) => {
      const queuedKeys = new Set(queue.map((card) => card.key));
      return [...queue, ...newCards.filter((card) => !queuedKeys.has(card.key))];
    });
  }, []);

  const bookmark: StartBookmark | undefined = runtimeState.startBookmarkId
    ? getStartBookmark(worldBook, runtimeState.startBookmarkId)
    : undefined;

  const crisis: OpeningCrisisTemplate | undefined = runtimeState.currentCrisisId
    ? getCrisisTemplate(worldBook, runtimeState.currentCrisisId)
    : undefined;

  const topBarDateLabel = formatGameDateLabelForStatusBar(
    runtimeState.currentDate,
    runtimeState.currentTime,
    runtimeState.calendarEras,
  );
  const currentWeather = deriveCurrentWeather(runtimeState);
  const currentGameHour = ensureGameClock(runtimeState).hour;
  const currentWeatherGlyph = getWeatherGlyph(currentWeather.label, currentWeather.tags);
  const runtimeMapIndex = useMemo(
    () => buildRuntimeMapIndex(worldBook, runtimeState),
    [runtimeState, worldBook],
  );
  const mobileTopBarDateLabel = formatMobileTopBarDateLabel(topBarDateLabel);
  const currentLocationDisplayPath = useMemo(
    () => buildCurrentLocationDisplayPath(worldBook, runtimeState),
    [runtimeState, worldBook],
  );
  const unreadCorrespondenceCount = useMemo(
    () => countUnreadCorrespondence(runtimeState),
    [runtimeState],
  );
  const persistentPromptGuide = useMemo(
    () => composePersistentPromptGuide(persistentPrompts),
    [persistentPrompts],
  );
  const enabledPersistentPromptCount = useMemo(
    () => persistentPrompts.filter((entry) => entry.enabled).length,
    [persistentPrompts],
  );
  const updatePersistentPrompts = useCallback((entries: PersistentPromptEntry[]) => {
    setPersistentPrompts(savePersistentPromptsToStorage(entries));
  }, []);
  const openPersistentPrompts = useCallback(() => {
    setIsMobileActionToolsOpen(false);
    setIsPersistentPromptOpen(true);
  }, []);

  const getLocationName = (locId: string): string => {
    const mapNode = runtimeMapIndex.nodeById[locId];
    if (mapNode) return mapNode.name;

    const runtimeLocation = runtimeState.locations?.find((location) => location.locationId === locId);
    if (runtimeLocation) return runtimeLocation.name;
    return locId;
  };

  const runTrueOpening = useCallback(async () => {
    const execution = beginExecution();
    let preserveProcessingTrace = false;
    let generatedNarrativeRecovery = '';
    setIsProcessing(true);
    setMessage('正在生成开场剧情...');
    resetProcessingTrace('准备开场上下文');
    setNarrativeText('');
    setSuggestedActions([]);

    try {
      const apiConfig = await resolveApiConfigForTaskAsync('mainNarrative');
      assertExecutionCurrent(execution);
      const featureExecutionModes = await getApiFeatureExecutionModesAsync();
      assertExecutionCurrent(execution);
      const stateWritebackApiConfig = featureExecutionModes.stateWriteback === 'dedicated'
        ? await resolveExplicitApiConfigForTaskAsync('stateWriteback')
        : null;
      assertExecutionCurrent(execution);
      const stateWritebackFallbackApiConfig = featureExecutionModes.stateWriteback === 'dedicated'
        ? await resolveExplicitApiConfigForTaskAsync('stateWritebackFallback')
        : null;
      assertExecutionCurrent(execution);
      const npcCompletionApiConfig = featureExecutionModes.npcCompletion === 'dedicated'
        ? await resolveExplicitApiConfigForTaskAsync('npcCompletion')
        : null;
      assertExecutionCurrent(execution);
      const npcCompletionFallbackApiConfig = featureExecutionModes.npcCompletion === 'dedicated'
        ? await resolveExplicitApiConfigForTaskAsync('npcCompletionFallback')
        : null;
      assertExecutionCurrent(execution);
      if (!apiConfig) {
        throw new Error('开局前请先配置主剧情 API。');
      }

      let streamedContent = '';
      const result = await generateTrueOpening(worldBook, runtimeState, {
        apiConfig,
        featureExecutionModes,
        stateWritebackApiConfig,
        stateWritebackFallbackApiConfig,
        npcCompletionApiConfig,
        npcCompletionFallbackApiConfig,
        llmClient: mainNarrativeLlmClient,
        stateWritebackLlmClient: stateWritebackApiConfig ? mainNarrativeLlmClient : undefined,
        stateWritebackFallbackLlmClient: stateWritebackFallbackApiConfig ? mainNarrativeLlmClient : undefined,
        npcCompletionLlmClient: npcCompletionApiConfig ? mainNarrativeLlmClient : undefined,
        npcCompletionFallbackLlmClient: npcCompletionFallbackApiConfig ? mainNarrativeLlmClient : undefined,
        persistentPromptGuide,
        signal: execution.signal,
        onContentDelta: (delta) => {
          if (!isExecutionCurrent(execution)) return;
          streamedContent += delta;
          setNarrativeText(extractNarrativePreview(streamedContent));
        },
        onContentReset: () => {
          if (!isExecutionCurrent(execution)) return;
          streamedContent = '';
          setNarrativeText('');
        },
        onStageChange: (event) => {
          if (isExecutionCurrent(execution)) {
            recordProcessingStage(event);
          }
        },
      });
      assertExecutionCurrent(execution);

      generatedNarrativeRecovery = result.narrativeText;
      // Do not keep a completed opening hidden while IndexedDB commits the save.
      setNarrativeText(result.narrativeText);

      const saveStage = startUiProcessingStage('saving', '保存开场存档');
      assertExecutionCurrent(execution);
      const saved = await saveCurrentState(saveId, result.newRuntimeState, { signal: execution.signal });
      assertExecutionCurrent(execution);
      if (!saved) throw new Error('当前存档不存在，无法保存开场剧情。');
      persistResolvedCustomOpeningTraitRarities(worldBook.manifest.id, result.newRuntimeState.player.traits ?? []);
      finishUiProcessingStage(saveStage);

      setNarrativeText(result.narrativeText);
      setSuggestedActions(result.suggestedActions);
      setLastPatch(result.statePatch);
      setPatchValidation(result.patchValidation);
      setPromptContext(result.promptContext);
      enqueueBattleBriefings(runtimeState, result.newRuntimeState);
      setRuntimeState(result.newRuntimeState);
      setMessage('');
    } catch (error: unknown) {
      if (!isTurnExecutionCancelled(error) && isExecutionCurrent(execution)) {
        preserveProcessingTrace = true;
        retainFailedProcessingAttempt({
          actionText: '生成开场剧情',
          error,
          fallbackStage: 'generatingNarrative',
          fallbackLabel: '准备开场上下文',
        });
        setNarrativeText(generatedNarrativeRecovery);
        setSuggestedActions(getLatestSuggestedActions(runtimeState));
        setMessage(generatedNarrativeRecovery
          ? `开场正文已生成但存档提交失败，正文已保留：${error instanceof Error ? error.message : '请稍后重试'}`
          : `开场剧情生成失败：${error instanceof Error ? error.message : '请稍后重试'}`);
      }
    } finally {
      settleExecutionUi(execution, { preserveProcessingTrace });
      executionOwner.finish(execution);
    }
  }, [
    assertExecutionCurrent,
    beginExecution,
    enqueueBattleBriefings,
    executionOwner,
    isExecutionCurrent,
    persistentPromptGuide,
    recordProcessingStage,
    resetProcessingTrace,
    retainFailedProcessingAttempt,
    runtimeState,
    saveId,
    settleExecutionUi,
    finishUiProcessingStage,
    startUiProcessingStage,
    worldBook,
  ]);

  const refreshSnapshotTurns = useCallback(async (parentExecution?: TurnExecutionContext) => {
    const requestedSessionIdentity = `${saveId}:${sessionGeneration}`;
    try {
      const snapshots = await listTurnSnapshots(saveId);
      if (parentExecution) {
        assertExecutionCurrent(parentExecution);
      } else if (!mountedRef.current || sessionIdentityRef.current !== requestedSessionIdentity) {
        return;
      }
      setSnapshotTurns(new Set(snapshots.map((snapshot) => snapshot.turnNumber)));
    } catch (error) {
      if (!isTurnExecutionCancelled(error)) throw error;
    }
  }, [assertExecutionCurrent, saveId, sessionGeneration]);

  useEffect(() => {
    void refreshSnapshotTurns();
  }, [refreshSnapshotTurns]);

  useEffect(() => {
    if (!autoGenerateOpening || autoOpeningStartedRef.current) return;
    if (runtimeState.worldStateDelta.trueOpeningGenerated) return;

    autoOpeningStartedRef.current = true;
    onAutoOpeningStarted?.();
    void runTrueOpening();
  }, [autoGenerateOpening, onAutoOpeningStarted, runTrueOpening, runtimeState.worldStateDelta.trueOpeningGenerated]);

  const runMemorySummaryMaintenance = useCallback(async (
    sourceState: RuntimeState,
    execution: TurnExecutionContext,
  ): Promise<'applied' | 'failed' | 'cancelled'> => {
    setIsMemorySummaryProcessing(true);
    setIsMemorySummaryRecoveryOpen(false);

    try {
      assertExecutionCurrent(execution);
      if (!shouldCreateRecentTurnSummaryTask(sourceState)) {
        const clearedState = clearMemorySummaryMaintenance(runtimeStateRef.current);
        const saved = await saveCurrentState(saveId, clearedState, { signal: execution.signal });
        assertExecutionCurrent(execution);
        if (!saved) throw new Error('当前存档不存在，无法更新记忆整理状态。');
        runtimeStateRef.current = clearedState;
        setRuntimeState(clearedState);
        return 'applied';
      }

      const memorySummaryApi = await getConfiguredMemorySummaryApiConfig(sourceState);
      assertExecutionCurrent(execution);
      const generated = await executeMemorySummaryCompression(sourceState, {
        apiConfig: memorySummaryApi.config,
        llmClient: memorySummaryApi.config ? mainNarrativeLlmClient : undefined,
        signal: execution.signal,
        timeoutMs: 120_000,
      }, memorySummaryApi.apiTaskId);
      assertExecutionCurrent(execution);
      if (generated.status !== 'applied') {
        throw new Error(generated.reason ?? 'memory summary api failed');
      }

      const rebased = reapplyMemorySummaryExecutionResult(runtimeStateRef.current, generated);
      if (rebased.status !== 'applied') {
        throw new Error(rebased.reason ?? 'summary result had no valid entries');
      }
      appendMemorySummaryExecutionSummary(rebased.newState, rebased);
      const completedState = clearMemorySummaryMaintenance(rebased.newState);
      const saved = await saveCurrentState(saveId, completedState, { signal: execution.signal });
      assertExecutionCurrent(execution);
      if (!saved) throw new Error('当前存档不存在，无法保存记忆整理结果。');

      runtimeStateRef.current = completedState;
      setRuntimeState(completedState);
      setMessage('本回合已保存，记忆整理完成。');
      return 'applied';
    } catch (error: unknown) {
      if (isTurnExecutionCancelled(error) || !isExecutionCurrent(execution)) {
        return 'cancelled';
      }

      const rawReason = error instanceof Error ? error.message : 'memory summary api failed';
      const playerSafeReason = toPlayerSafeMemorySummaryFailureReason(rawReason);
      const failedState = failMemorySummaryMaintenance(runtimeStateRef.current, {
        attemptedAt: new Date().toISOString(),
        reason: rawReason,
      });

      try {
        const saved = await saveCurrentState(saveId, failedState, { signal: execution.signal });
        assertExecutionCurrent(execution);
        if (saved) {
          runtimeStateRef.current = failedState;
          setRuntimeState(failedState);
        }
      } catch (persistenceError: unknown) {
        if (isTurnExecutionCancelled(persistenceError) || !isExecutionCurrent(execution)) {
          return 'cancelled';
        }
      }

      setMessage(`本回合已保存，记忆整理未完成。${playerSafeReason}`);
      setIsMemorySummaryRecoveryOpen(true);
      return 'failed';
    } finally {
      if (isExecutionCurrent(execution)) {
        setIsMemorySummaryProcessing(false);
      }
    }
  }, [
    assertExecutionCurrent,
    isExecutionCurrent,
    saveId,
  ]);

  const executeActionFromState = useCallback(async (
    baseState: RuntimeState,
    actionText: string,
    parentExecution?: TurnExecutionContext,
  ): Promise<'success' | 'failed' | 'cancelled'> => {
    const execution = parentExecution ?? beginExecution();
    const ownsExecution = !parentExecution;
    let preserveProcessingTrace = false;
    assertExecutionCurrent(execution);
    const snapshotTurnNumber = baseState.turnLog.length + 1;
    const rollbackCandidate = createTurnRollbackSnapshot({
      beforeState: baseState,
      actionText,
      createdAt: new Date().toISOString(),
    });
    setIsProcessing(true);
    setMessage('');
    resetProcessingTrace('准备回合上下文');
    setNarrativeText('');
    setPendingActionText(actionText);
    setSuggestedActions([]);

    try {
      const apiConfig = await resolveApiConfigForTaskAsync('mainNarrative');
      assertExecutionCurrent(execution);
      const featureExecutionModes = await getApiFeatureExecutionModesAsync();
      assertExecutionCurrent(execution);
      const stateWritebackApiConfig = featureExecutionModes.stateWriteback === 'dedicated'
        ? await resolveExplicitApiConfigForTaskAsync('stateWriteback')
        : null;
      assertExecutionCurrent(execution);
      const stateWritebackFallbackApiConfig = featureExecutionModes.stateWriteback === 'dedicated'
        ? await resolveExplicitApiConfigForTaskAsync('stateWritebackFallback')
        : null;
      assertExecutionCurrent(execution);
      const npcCompletionApiConfig = featureExecutionModes.npcCompletion === 'dedicated'
        ? await resolveExplicitApiConfigForTaskAsync('npcCompletion')
        : null;
      assertExecutionCurrent(execution);
      const npcCompletionFallbackApiConfig = featureExecutionModes.npcCompletion === 'dedicated'
        ? await resolveExplicitApiConfigForTaskAsync('npcCompletionFallback')
        : null;
      assertExecutionCurrent(execution);
      const memorySummaryApi = featureExecutionModes.memorySummary === 'dedicated'
        ? await getConfiguredMemorySummaryApiConfig(baseState)
        : { config: null, apiTaskId: undefined };
      assertExecutionCurrent(execution);
      const embeddingApiConfig = await getConfiguredEmbeddingApiConfig();
      assertExecutionCurrent(execution);
      const npcSimulationSettings = loadNpcSimulationSettings();
      const npcSimulationApiConfig = npcSimulationSettings.enabled
        && featureExecutionModes.npcSimulation === 'dedicated'
        ? await getConfiguredNpcSimulationApiConfig()
        : null;
      assertExecutionCurrent(execution);
      const worldEvolutionApiConfig = featureExecutionModes.worldEvolution === 'dedicated'
        ? await resolveApiConfigForTaskAsync('worldEvolution')
        : null;
      assertExecutionCurrent(execution);
      let streamedContent = '';
      const result: TurnResult = await executeTurn(worldBook, baseState, actionText, {
        apiConfig,
        featureExecutionModes,
        stateWritebackApiConfig,
        stateWritebackFallbackApiConfig,
        npcCompletionApiConfig,
        npcCompletionFallbackApiConfig,
        memorySummaryApiConfig: memorySummaryApi.config,
        memorySummaryApiTaskId: memorySummaryApi.apiTaskId,
        embeddingApiConfig,
        npcSimulationApiConfig,
        worldEvolutionApiConfig,
        npcSimulationMaxNpcCount: npcSimulationSettings.maxNpcCount,
        llmClient: apiConfig ? mainNarrativeLlmClient : undefined,
        stateWritebackLlmClient: stateWritebackApiConfig ? mainNarrativeLlmClient : undefined,
        stateWritebackFallbackLlmClient: stateWritebackFallbackApiConfig ? mainNarrativeLlmClient : undefined,
        npcCompletionLlmClient: npcCompletionApiConfig ? mainNarrativeLlmClient : undefined,
        npcCompletionFallbackLlmClient: npcCompletionFallbackApiConfig ? mainNarrativeLlmClient : undefined,
        memorySummaryLlmClient: memorySummaryApi.config ? mainNarrativeLlmClient : undefined,
        embeddingClient: embeddingApiConfig ? mainNarrativeLlmClient : undefined,
        npcSimulationLlmClient: npcSimulationApiConfig ? mainNarrativeLlmClient : undefined,
        worldEvolutionLlmClient: worldEvolutionApiConfig ? mainNarrativeLlmClient : undefined,
        persistentPromptGuide,
        deferMemorySummaryCompression: true,
        signal: execution.signal,
        onContentDelta: apiConfig
          ? (delta) => {
              if (!isExecutionCurrent(execution)) return;
              streamedContent += delta;
              setNarrativeText(extractNarrativePreview(streamedContent));
            }
          : undefined,
        onContentReset: apiConfig
          ? () => {
              if (!isExecutionCurrent(execution)) return;
              streamedContent = '';
              setNarrativeText('');
            }
          : undefined,
        onStageChange: (event) => {
          if (isExecutionCurrent(execution)) {
            recordProcessingStage(event);
          }
        },
      });
      assertExecutionCurrent(execution);

      let committedRuntimeState = result.newRuntimeState;
      let encounterStageWarning = '';
      try {
        if (
          result.encounterStartIntent?.kind === 'personal_combat'
          && result.encounterTransitionDecision?.mode === 'offer'
        ) {
          committedRuntimeState = stageCombatEncounterOffer(committedRuntimeState, {
            saveId,
            intent: result.encounterStartIntent,
            projections: result.semanticProjections ?? [],
            createdAt: new Date().toISOString(),
          });
        } else if (result.encounterStartIntent) {
          committedRuntimeState = result.encounterStartIntent.kind === 'war'
            ? stageWarEncounter(committedRuntimeState, {
                saveId,
                intent: result.encounterStartIntent,
                projections: result.semanticProjections ?? [],
                createdAt: new Date().toISOString(),
              })
            : stageCombatEncounter(committedRuntimeState, {
                saveId,
                intent: result.encounterStartIntent,
                projections: result.semanticProjections ?? [],
                createdAt: new Date().toISOString(),
              });
        } else {
          committedRuntimeState = mergeEncounterSemanticProjections(
            committedRuntimeState,
            result.semanticProjections ?? [],
          );
        }
      } catch (error) {
        committedRuntimeState = mergeEncounterSemanticProjections(
          result.newRuntimeState,
          result.semanticProjections ?? [],
        );
        encounterStageWarning = `Encounter V2 触发被拒绝：${error instanceof Error ? error.message : '冲突意图无效'}`;
        const latestTurn = committedRuntimeState.turnLog[committedRuntimeState.turnLog.length - 1];
        if (latestTurn) {
          latestTurn.statePatchSummary = [latestTurn.statePatchSummary, encounterStageWarning]
            .filter(Boolean)
            .join('；');
        }
      }

      const shouldRunAutomaticMemorySummary =
        featureExecutionModes.memorySummary === 'dedicated'
        && shouldRunAutomaticMemorySummaryMaintenance(committedRuntimeState);
      if (shouldRunAutomaticMemorySummary) {
        committedRuntimeState = queueMemorySummaryMaintenance(committedRuntimeState, {
          queuedAt: new Date().toISOString(),
          triggerTurnNumber: snapshotTurnNumber,
        });
      }

      committedRuntimeState = finalizePendingStateWritebackRecoveryHead(
        committedRuntimeState,
        createStateWritebackRecoveryVerification(worldBook),
      );

      const saveStage = startUiProcessingStage('saving', '保存回合与快照');
      assertExecutionCurrent(execution);
      await commitBeforePublish(
        () => commitSuccessfulTurn({
          saveId,
          runtimeState: committedRuntimeState,
          turnNumber: snapshotTurnNumber,
          snapshot: rollbackCandidate,
          maxDepth: loadSnapshotDepthFromStorage(),
          autoSave: {
            intervalTurns: loadAutoSaveIntervalTurnsFromStorage(),
            limit: loadAutoSaveLimitFromStorage(),
          },
          signal: execution.signal,
        }),
        (committed) => {
          assertExecutionCurrent(execution);
          if (!committed) throw new Error('当前存档不存在，无法提交回合。');

          setNarrativeText(result.narrativeText);
          setSuggestedActions(result.suggestedActions);
          setLastPatch(result.statePatch);
          setPatchValidation(result.patchValidation);
          setPromptContext(result.promptContext);
          enqueueBattleBriefings(baseState, committedRuntimeState);
          setPendingActionText('');
          runtimeStateRef.current = committedRuntimeState;
          setRuntimeState(committedRuntimeState);
          setCanUndoDeveloperOverride(false);
          setSnapshotTurns(new Set(committed.snapshotTurnNumbers));
          setMessage([buildTurnCompletionMessage(result), encounterStageWarning].filter(Boolean).join(' '));
        },
      );
      finishUiProcessingStage(saveStage);

      if (shouldRunAutomaticMemorySummary) {
        setIsProcessing(false);
        setProcessingStageText('');
        await runMemorySummaryMaintenance(committedRuntimeState, execution);
      }

      return 'success';
    } catch (error: unknown) {
      if (isTurnExecutionCancelled(error) || !isExecutionCurrent(execution)) {
        return 'cancelled';
      }
      preserveProcessingTrace = true;
      retainFailedProcessingAttempt({
        actionText,
        error,
        fallbackStage: 'generatingNarrative',
        fallbackLabel: '准备回合上下文',
      });
      setNarrativeText('');
      setSuggestedActions(getLatestSuggestedActions(baseState));
      setMessage(`错误：${error instanceof Error ? error.message : '回合生成失败'}`);
      return 'failed';
    } finally {
      settleExecutionUi(execution, { clearPendingAction: true, preserveProcessingTrace });
      if (ownsExecution) executionOwner.finish(execution);
    }
  }, [
    assertExecutionCurrent,
    beginExecution,
    enqueueBattleBriefings,
    executionOwner,
    isExecutionCurrent,
    persistentPromptGuide,
    recordProcessingStage,
    resetProcessingTrace,
    retainFailedProcessingAttempt,
    runMemorySummaryMaintenance,
    saveId,
    settleExecutionUi,
    finishUiProcessingStage,
    startUiProcessingStage,
    worldBook,
  ]);

  const acceptPendingEncounterOffer = useCallback(async (): Promise<void> => {
    if (isProcessing || isResolvingEncounterOffer) return;
    const sourceState = runtimeStateRef.current;
    if (!sourceState.encounterV2?.pendingOffer) return;
    setIsResolvingEncounterOffer(true);
    setMessage('');
    try {
      const nextState = acceptCombatEncounterOffer(sourceState, {
        saveId,
        acceptedAt: new Date().toISOString(),
      });
      const saved = await saveCurrentState(saveId, nextState);
      if (!saved) throw new Error('当前存档不存在，无法进入战斗。');
      runtimeStateRef.current = nextState;
      setRuntimeState(nextState);
    } catch (error) {
      setMessage(`战斗切入失败：${error instanceof Error ? error.message : '无法保存开战状态'}`);
    } finally {
      setIsResolvingEncounterOffer(false);
    }
  }, [isProcessing, isResolvingEncounterOffer, saveId]);

  const declinePendingEncounterOffer = useCallback(async (): Promise<void> => {
    if (isProcessing || isResolvingEncounterOffer) return;
    const sourceState = runtimeStateRef.current;
    if (!sourceState.encounterV2?.pendingOffer) return;
    setIsResolvingEncounterOffer(true);
    setMessage('');
    try {
      const nextState = declineCombatEncounterOffer(sourceState);
      const saved = await saveCurrentState(saveId, nextState);
      if (!saved) throw new Error('当前存档不存在，无法保存选择。');
      runtimeStateRef.current = nextState;
      setRuntimeState(nextState);
      setMessage('你暂时没有让冲突升级为正式交战。');
    } catch (error) {
      setMessage(`保存避战选择失败：${error instanceof Error ? error.message : '无法更新存档'}`);
    } finally {
      setIsResolvingEncounterOffer(false);
    }
  }, [isProcessing, isResolvingEncounterOffer, saveId]);

  const retryPendingMemorySummary = useCallback(async (): Promise<void> => {
    if (isProcessing || isMemorySummaryProcessing) return;
    const sourceState = runtimeStateRef.current;
    if (!hasPendingMemorySummaryMaintenance(sourceState)) return;

    const execution = beginExecution();
    try {
      await runMemorySummaryMaintenance(sourceState, execution);
    } finally {
      settleExecutionUi(execution);
      executionOwner.finish(execution);
    }
  }, [
    beginExecution,
    executionOwner,
    isMemorySummaryProcessing,
    isProcessing,
    runMemorySummaryMaintenance,
    settleExecutionUi,
  ]);

  const runCombatNarrativeFromState = useCallback(async (
    baseState: RuntimeState,
  ): Promise<'success' | 'failed' | 'cancelled'> => {
    const active = baseState.encounterV2?.active;
    if (
      !active
      || active.session.status !== 'narrative_pending'
      || active.session.intent.kind !== 'personal_combat'
      || active.checkpoint.checkpointKind !== 'post_result'
      || active.checkpoint.result.kind !== 'personal_combat'
    ) {
      setMessage('当前没有待生成正文的 Combat V2 封存战果。');
      return 'failed';
    }

    const execution = beginExecution();
    let preserveProcessingTrace = false;
    const result = active.checkpoint.result;
    const actionText = `【战斗结算】${active.session.intent.reason}`;
    setIsProcessing(true);
    setIsCancelling(false);
    resetProcessingTrace('准备战后正文');
    setPendingActionText(actionText);
    setNarrativeText('');
    setSuggestedActions([]);
    setMessage('');

    try {
      const apiConfig = await resolveApiConfigForTaskAsync('mainNarrative');
      assertExecutionCurrent(execution);
      if (!apiConfig) throw new Error('尚未配置主叙事 API。');

      const participantNames = Object.fromEntries(result.combatants.map((combatant) => {
        const actorId = combatant.actorId;
        const name = actorId === baseState.player.id
          ? baseState.player.name
          : baseState.npcs?.find((npc) => npc.npcId === actorId)?.name
            ?? baseState.knownActors.find((actor) => actor.id === actorId)?.name
            ?? (active.session.intent.kind === 'personal_combat'
              ? active.session.intent.scopedCombatants?.find((combatant) => combatant.actorId === actorId)?.name
              : undefined)
            ?? actorId;
        return [actorId, name];
      }));
      let streamedContent = '';
      const narrativeStage = startUiProcessingStage('generatingNarrative', '生成战后正文', {
        provider: apiConfig.provider,
        model: apiConfig.model,
      });
      const generated = await generateCombatNarrative({
        config: apiConfig,
        client: mainNarrativeLlmClient,
        signal: execution.signal,
        onContentDelta: (delta) => {
          if (!isExecutionCurrent(execution)) return;
          streamedContent += delta;
          setNarrativeText(extractNarrativePreview(streamedContent));
        },
        prompt: {
          result,
          encounterReason: active.session.intent.reason,
          locationLabel: buildCurrentLocationDisplayPath(worldBook, baseState),
          participantNames,
          playerName: baseState.player.name,
          playerSex: baseState.player.sex,
          narrativePerspective: baseState.narrativePerspective,
          recentNarratives: baseState.turnLog
            .slice(-3)
            .map((entry) => entry.fullNarrativeText ?? entry.narrativeText),
          persistentPromptGuide,
        },
      });
      assertExecutionCurrent(execution);
      finishUiProcessingStage(narrativeStage);

      const completed = completeCombatNarrativeTurn(baseState, {
        resultHash: result.resultHash,
        narrativeText: generated.narrativeText,
        suggestedActions: generated.suggestedActions,
        completedAt: new Date().toISOString(),
        provider: generated.provider,
        model: generated.model,
        promptTokens: generated.usage?.promptTokens,
        completionTokens: generated.usage?.completionTokens,
        totalTokens: generated.usage?.totalTokens,
        rawResponse: generated.rawResponse,
      });
      const turnNumber = completed.turnLog.length;
      const rollbackCandidate = createTurnRollbackSnapshot({
        beforeState: baseState,
        actionText,
        createdAt: new Date().toISOString(),
      });

      const saveStage = startUiProcessingStage('saving', '保存战后正文');
      await commitBeforePublish(
        () => commitSuccessfulTurn({
          saveId,
          runtimeState: completed,
          turnNumber,
          snapshot: rollbackCandidate,
          maxDepth: loadSnapshotDepthFromStorage(),
          autoSave: {
            intervalTurns: loadAutoSaveIntervalTurnsFromStorage(),
            limit: loadAutoSaveLimitFromStorage(),
          },
          signal: execution.signal,
        }),
        (committed) => {
          assertExecutionCurrent(execution);
          if (!committed) throw new Error('当前存档不存在，无法提交战后正文。');
          setRuntimeState(completed);
          setNarrativeText(generated.narrativeText);
          setSuggestedActions(generated.suggestedActions);
          setLastPatch(completed.lastStatePatch ?? null);
          setPatchValidation(completed.lastPatchValidation ?? null);
          setPromptContext(`Combat V2 封存战果：${result.resultHash}`);
          setSnapshotTurns(new Set(committed.snapshotTurnNumbers));
          setPendingActionText('');
          setMessage('');
        },
      );
      finishUiProcessingStage(saveStage);
      return 'success';
    } catch (error) {
      if (isTurnExecutionCancelled(error) || !isExecutionCurrent(execution)) {
        setMessage('已中止战后正文生成；封存战果仍已保存，可随时重试。');
        return 'cancelled';
      }
      preserveProcessingTrace = true;
      retainFailedProcessingAttempt({
        actionText,
        error,
        fallbackStage: 'generatingNarrative',
        fallbackLabel: '准备战后正文',
      });
      setNarrativeText('');
      setSuggestedActions(getLatestSuggestedActions(baseState));
      setMessage(`战后正文生成失败；封存战果仍已保存，可重试：${error instanceof Error ? error.message : '未知错误'}`);
      return 'failed';
    } finally {
      settleExecutionUi(execution, { clearPendingAction: true, preserveProcessingTrace });
      executionOwner.finish(execution);
    }
  }, [
    assertExecutionCurrent,
    beginExecution,
    executionOwner,
    isExecutionCurrent,
    persistentPromptGuide,
    resetProcessingTrace,
    retainFailedProcessingAttempt,
    saveId,
    settleExecutionUi,
    finishUiProcessingStage,
    startUiProcessingStage,
    worldBook,
  ]);

  const handleCombatResolved = useCallback(async ({
    session,
    result,
  }: CombatResolvedPayload): Promise<void> => {
    const postResultState = commitCombatResultToRuntime(runtimeState, {
      saveId,
      session,
      result,
      committedAt: new Date().toISOString(),
      locationName: currentLocationDisplayPath,
    });
    await commitBeforePublish(
      () => saveCurrentState(saveId, postResultState),
      (saved) => {
        if (!saved) throw new Error('当前存档不存在，无法保存封存战果。');
        enqueueBattleBriefings(runtimeState, postResultState);
        setRuntimeState(postResultState);
        setNarrativeText('');
        setSuggestedActions([]);
        setMessage('');
      },
    );
    await runCombatNarrativeFromState(postResultState);
  }, [
    currentLocationDisplayPath,
    enqueueBattleBriefings,
    runCombatNarrativeFromState,
    runtimeState,
    saveId,
  ]);

  const handleCombatNarrativeRequest = useCallback(async (): Promise<void> => {
    await runCombatNarrativeFromState(runtimeState);
  }, [runCombatNarrativeFromState, runtimeState]);

  const runWarNarrativeFromState = useCallback(async (
    baseState: RuntimeState,
  ): Promise<'success' | 'failed' | 'cancelled'> => {
    const active = baseState.encounterV2?.active;
    if (
      !active
      || active.session.status !== 'narrative_pending'
      || active.session.intent.kind !== 'war'
      || active.checkpoint.checkpointKind !== 'post_result'
      || active.checkpoint.result.kind !== 'war'
    ) {
      setMessage('当前没有待生成正文的 War V2 封存战果。');
      return 'failed';
    }

    const execution = beginExecution();
    let preserveProcessingTrace = false;
    const result = active.checkpoint.result;
    const actionText = `【战争结算】${active.session.intent.reason}`;
    setIsProcessing(true);
    setIsCancelling(false);
    resetProcessingTrace('准备战后正文');
    setPendingActionText(actionText);
    setNarrativeText('');
    setSuggestedActions([]);
    setMessage('');

    try {
      const apiConfig = await resolveApiConfigForTaskAsync('mainNarrative');
      assertExecutionCurrent(execution);
      if (!apiConfig) throw new Error('尚未配置主叙事 API。');

      const forceNames = Object.fromEntries(result.forces.map((force) => [
        force.troopId,
        baseState.troops?.find((troop) => troop.troopId === force.troopId)?.name ?? force.troopId,
      ]));
      const commanderNames = Object.fromEntries(result.commanders.map((commander) => {
        const actorId = commander.actorId;
        const name = actorId === baseState.player.id
          ? baseState.player.name
          : baseState.npcs?.find((npc) => npc.npcId === actorId)?.name
            ?? baseState.knownActors.find((actor) => actor.id === actorId)?.name
            ?? actorId;
        return [actorId, name];
      }));
      let streamedContent = '';
      const narrativeStage = startUiProcessingStage('generatingNarrative', '生成战后正文', {
        provider: apiConfig.provider,
        model: apiConfig.model,
      });
      const generated = await generateWarNarrative({
        config: apiConfig,
        client: mainNarrativeLlmClient,
        signal: execution.signal,
        onContentDelta: (delta) => {
          if (!isExecutionCurrent(execution)) return;
          streamedContent += delta;
          setNarrativeText(extractNarrativePreview(streamedContent));
        },
        prompt: {
          result,
          encounterReason: active.session.intent.reason,
          locationLabel: buildCurrentLocationDisplayPath(worldBook, baseState),
          forceNames,
          commanderNames,
          playerName: baseState.player.name,
          playerSex: baseState.player.sex,
          narrativePerspective: baseState.narrativePerspective,
          recentNarratives: baseState.turnLog
            .slice(-3)
            .map((entry) => entry.fullNarrativeText ?? entry.narrativeText),
          persistentPromptGuide,
        },
      });
      assertExecutionCurrent(execution);
      finishUiProcessingStage(narrativeStage);

      const completed = completeWarNarrativeTurn(baseState, {
        resultHash: result.resultHash,
        narrativeText: generated.narrativeText,
        suggestedActions: generated.suggestedActions,
        completedAt: new Date().toISOString(),
        provider: generated.provider,
        model: generated.model,
        promptTokens: generated.usage?.promptTokens,
        completionTokens: generated.usage?.completionTokens,
        totalTokens: generated.usage?.totalTokens,
        rawResponse: generated.rawResponse,
      });
      const turnNumber = completed.turnLog.length;
      const rollbackCandidate = createTurnRollbackSnapshot({
        beforeState: baseState,
        actionText,
        createdAt: new Date().toISOString(),
      });

      const saveStage = startUiProcessingStage('saving', '保存战后正文');
      await commitBeforePublish(
        () => commitSuccessfulTurn({
          saveId,
          runtimeState: completed,
          turnNumber,
          snapshot: rollbackCandidate,
          maxDepth: loadSnapshotDepthFromStorage(),
          autoSave: {
            intervalTurns: loadAutoSaveIntervalTurnsFromStorage(),
            limit: loadAutoSaveLimitFromStorage(),
          },
          signal: execution.signal,
        }),
        (committed) => {
          assertExecutionCurrent(execution);
          if (!committed) throw new Error('当前存档不存在，无法提交战后正文。');
          setRuntimeState(completed);
          setNarrativeText(generated.narrativeText);
          setSuggestedActions(generated.suggestedActions);
          setLastPatch(completed.lastStatePatch ?? null);
          setPatchValidation(completed.lastPatchValidation ?? null);
          setPromptContext(`War V2 封存战果：${result.resultHash}`);
          setSnapshotTurns(new Set(committed.snapshotTurnNumbers));
          setPendingActionText('');
          setMessage('');
        },
      );
      finishUiProcessingStage(saveStage);
      return 'success';
    } catch (error) {
      if (isTurnExecutionCancelled(error) || !isExecutionCurrent(execution)) {
        setMessage('已中止战后正文生成；封存战果仍已保存，可随时重试。');
        return 'cancelled';
      }
      preserveProcessingTrace = true;
      retainFailedProcessingAttempt({
        actionText,
        error,
        fallbackStage: 'generatingNarrative',
        fallbackLabel: '准备战后正文',
      });
      setNarrativeText('');
      setSuggestedActions(getLatestSuggestedActions(baseState));
      setMessage(`战后正文生成失败；封存战果仍已保存，可重试：${error instanceof Error ? error.message : '未知错误'}`);
      return 'failed';
    } finally {
      settleExecutionUi(execution, { clearPendingAction: true, preserveProcessingTrace });
      executionOwner.finish(execution);
    }
  }, [
    assertExecutionCurrent,
    beginExecution,
    executionOwner,
    isExecutionCurrent,
    persistentPromptGuide,
    resetProcessingTrace,
    retainFailedProcessingAttempt,
    saveId,
    settleExecutionUi,
    finishUiProcessingStage,
    startUiProcessingStage,
    worldBook,
  ]);

  const handleWarResolved = useCallback(async ({
    session,
    result,
  }: WarResolvedPayload): Promise<void> => {
    const postResultState = commitWarResultToRuntime(runtimeState, {
      saveId,
      session,
      result,
      committedAt: new Date().toISOString(),
      locationName: currentLocationDisplayPath,
    });
    await commitBeforePublish(
      () => saveCurrentState(saveId, postResultState),
      (saved) => {
        if (!saved) throw new Error('当前存档不存在，无法保存封存战果。');
        enqueueBattleBriefings(runtimeState, postResultState);
        setRuntimeState(postResultState);
        setNarrativeText('');
        setSuggestedActions([]);
        setMessage('');
      },
    );
    await runWarNarrativeFromState(postResultState);
  }, [
    currentLocationDisplayPath,
    enqueueBattleBriefings,
    runWarNarrativeFromState,
    runtimeState,
    saveId,
  ]);

  const handleWarNarrativeRequest = useCallback(async (): Promise<void> => {
    await runWarNarrativeFromState(runtimeState);
  }, [runWarNarrativeFromState, runtimeState]);

  const handleCancelGeneration = useCallback(() => {
    if (!isProcessing || isCancelling) return;

    const execution = activeExecutionRef.current;
    if (!execution || !executionOwner.isCurrent(execution, saveId, sessionGeneration)) return;

    const interruptedAction = pendingActionText.trim();
    setIsCancelling(true);
    setProcessingStageText('正在中止生成');
    if (!executionOwner.abort()) {
      setIsCancelling(false);
      return;
    }

    setNarrativeText('');
    setSuggestedActions(getLatestSuggestedActions(runtimeState));
    if (interruptedAction) {
      setPlayerInput((currentInput) => currentInput.trim() ? currentInput : interruptedAction);
    }
    setMessage('已中止本次生成，未完成内容不会作为新回合提交。');
  }, [
    executionOwner,
    isCancelling,
    isProcessing,
    pendingActionText,
    runtimeState,
    saveId,
    sessionGeneration,
  ]);

  const executeDeveloperCommand = useCallback(async (
    baseState: RuntimeState,
    fact: string,
    commandText: string,
  ): Promise<'success' | 'failed' | 'cancelled'> => {
    const execution = beginExecution();
    assertExecutionCurrent(execution);
    setIsProcessing(true);
    setMessage('');
    resetProcessingTrace('准备开发者事实纠错');
    setPendingActionText(commandText);
    const writebackStage = startUiProcessingStage('repairingStateWriteback', '翻译并校验开发者事实');
    try {
      const result = await executeDeveloperFactOverride({
        worldBook,
        runtimeState: baseState,
        fact,
        bookmark,
        crisis,
        llmClient: mainNarrativeLlmClient,
        signal: execution.signal,
      });
      assertExecutionCurrent(execution);
      finishUiProcessingStage(writebackStage);
      if (!result.ok) {
        setPatchValidation(result.validation ?? null);
        setMessage(`开发者纠错未应用：${result.reason}`);
        return 'failed';
      }
      setPatchValidation(result.validation);
      setLastPatch(result.patches[result.patches.length - 1] ?? null);
      if (!result.changed) {
        setMessage(result.summary);
        return 'success';
      }

      const saveStage = startUiProcessingStage('saving', '保存纠错与纠错前检查点');
      await commitBeforePublish(
        () => commitDeveloperOverride({
          saveId,
          previousRuntimeState: baseState,
          runtimeState: result.state,
          commandText,
          signal: execution.signal,
        }),
        (committed) => {
          assertExecutionCurrent(execution);
          if (!committed) throw new Error('当前存档不存在，无法保存开发者纠错。');
          runtimeStateRef.current = result.state;
          setRuntimeState(result.state);
          setCanUndoDeveloperOverride(true);
          setMessage(`${result.summary}${result.usedFallback ? '（已使用状态写回备用 API）' : ''}`);
        },
      );
      finishUiProcessingStage(saveStage);
      return 'success';
    } catch (error) {
      if (isTurnExecutionCancelled(error) || !isExecutionCurrent(execution)) return 'cancelled';
      setMessage(`开发者纠错失败：${error instanceof Error ? error.message : '未知错误'}`);
      return 'failed';
    } finally {
      settleExecutionUi(execution);
      executionOwner.finish(execution);
    }
  }, [
    assertExecutionCurrent,
    beginExecution,
    bookmark,
    crisis,
    executionOwner,
    finishUiProcessingStage,
    isExecutionCurrent,
    resetProcessingTrace,
    saveId,
    settleExecutionUi,
    startUiProcessingStage,
    worldBook,
  ]);

  const handleSubmit = useCallback(async () => {
    if (!playerInput.trim() || isProcessing || stateWritebackRecoveryPreview || runtimeState.encounterV2?.pendingOffer) return;

    const actionText = playerInput.trim();
    const developerCommand = parseDeveloperCommandInput(actionText);
    if (developerCommand.kind === 'invalid') {
      setMessage(developerCommand.reason);
      return;
    }
    setPlayerInput('');
    const outcome = developerCommand.kind === 'developer'
      ? await executeDeveloperCommand(runtimeState, developerCommand.fact, actionText)
      : await executeActionFromState(runtimeState, actionText);
    if (outcome === 'failed') setPlayerInput(actionText);
  }, [executeActionFromState, executeDeveloperCommand, isProcessing, playerInput, runtimeState, stateWritebackRecoveryPreview]);

  const handlePrepareStateWritebackRecovery = useCallback(async () => {
    if (isProcessing || isPreparingStateWritebackRecovery || stateWritebackRecoveryPreview) return;
    const execution = beginExecution();
    setIsPreparingStateWritebackRecovery(true);
    setIsProcessing(true);
    setMessage('正在重新整理本回合状态写回…');
    try {
      const apiConfig = await resolveApiConfigForTaskAsync('stateWriteback');
      assertExecutionCurrent(execution);
      if (!apiConfig) {
        setMessage('没有可用于状态写回重整的 API，请先检查主叙事或状态写回 API 设置。');
        return;
      }
      const result = await prepareStateWritebackRecovery({
        currentState: runtimeStateRef.current,
        worldBook,
        apiConfig,
        llmClient: mainNarrativeLlmClient,
        signal: execution.signal,
      });
      assertExecutionCurrent(execution);
      if (result.status === 'ready') {
        setStateWritebackRecoveryPreview(result);
        setMessage('状态写回重整候选已通过严格校验，请确认后应用。');
      } else {
        setMessage(result.message);
      }
    } catch (error) {
      if (!isTurnExecutionCancelled(error) && isExecutionCurrent(execution)) {
        setMessage(`状态写回重整失败，未应用任何状态：${error instanceof Error ? error.message : '未知错误'}`);
      }
    } finally {
      setIsPreparingStateWritebackRecovery(false);
      settleExecutionUi(execution);
      executionOwner.finish(execution);
    }
  }, [
    assertExecutionCurrent,
    beginExecution,
    executionOwner,
    isExecutionCurrent,
    isPreparingStateWritebackRecovery,
    isProcessing,
    settleExecutionUi,
    stateWritebackRecoveryPreview,
    worldBook,
  ]);

  const handleApplyStateWritebackRecovery = useCallback(async () => {
    if (!stateWritebackRecoveryPreview || isApplyingStateWritebackRecovery || isProcessing) return;
    const execution = beginExecution();
    setIsApplyingStateWritebackRecovery(true);
    setIsProcessing(true);
    setMessage('正在保存状态写回重整结果…');
    try {
      const applied = commitPreparedStateWritebackRecovery({
        currentState: runtimeStateRef.current,
        preview: stateWritebackRecoveryPreview.preview,
        worldBook,
      });
      assertExecutionCurrent(execution);
      if (applied.status === 'stale_lineage') {
        setStateWritebackRecoveryPreview(null);
        setMessage('存档已变化，状态写回重整预览失效，未应用任何状态。');
        return;
      }
      const saved = await saveCurrentState(saveId, applied.state, { signal: execution.signal });
      assertExecutionCurrent(execution);
      if (!saved) throw new Error('当前存档不存在，无法保存状态写回重整结果。');
      runtimeStateRef.current = applied.state;
      setRuntimeState(applied.state);
      setLastPatch(applied.state.lastStatePatch ?? null);
      setPatchValidation(applied.state.lastPatchValidation ?? null);
      setStateWritebackRecoveryPreview(null);
      setMessage(applied.status === 'already_applied'
        ? '本回合状态写回已经重整，无需重复应用。'
        : '本回合状态写回重整已保存；正文、回合时间、地点与地图均未改变。');
    } catch (error) {
      if (!isTurnExecutionCancelled(error) && isExecutionCurrent(execution)) {
        setMessage(`状态写回重整保存失败：${error instanceof Error ? error.message : '未知错误'}`);
      }
    } finally {
      setIsApplyingStateWritebackRecovery(false);
      settleExecutionUi(execution);
      executionOwner.finish(execution);
    }
  }, [
    assertExecutionCurrent,
    beginExecution,
    executionOwner,
    isApplyingStateWritebackRecovery,
    isExecutionCurrent,
    isProcessing,
    saveId,
    settleExecutionUi,
    stateWritebackRecoveryPreview,
    worldBook,
  ]);

  const handleUndoDeveloperOverride = useCallback(async () => {
    if (!canUndoDeveloperOverride || isProcessing) return;
    const execution = beginExecution();
    setIsProcessing(true);
    setMessage('');
    try {
      const restored = await restoreDeveloperOverrideCheckpoint(saveId, { signal: execution.signal });
      assertExecutionCurrent(execution);
      if (!restored) {
        setCanUndoDeveloperOverride(false);
        setMessage('开发者纠错检查点已因后续保存失效，不能再撤销。');
        return;
      }
      runtimeStateRef.current = restored.runtimeState;
      setRuntimeState(restored.runtimeState);
      setLastPatch(restored.runtimeState.lastStatePatch ?? null);
      setPatchValidation(restored.runtimeState.lastPatchValidation ?? null);
      setCanUndoDeveloperOverride(false);
      setMessage('已撤销最近一次开发者事实纠错；回合数与游戏时间保持不变。');
    } catch (error) {
      if (!isTurnExecutionCancelled(error) && isExecutionCurrent(execution)) {
        setMessage(`撤销开发者纠错失败：${error instanceof Error ? error.message : '未知错误'}`);
      }
    } finally {
      settleExecutionUi(execution);
      executionOwner.finish(execution);
    }
  }, [
    assertExecutionCurrent,
    beginExecution,
    canUndoDeveloperOverride,
    executionOwner,
    isExecutionCurrent,
    isProcessing,
    saveId,
    settleExecutionUi,
  ]);

  const handleRollbackLatestTurn = useCallback(async () => {
    const latestTurnNumber = runtimeState.turnLog.length;
    if (latestTurnNumber <= 0 || isProcessing) return;

    const execution = beginExecution();
    setIsProcessing(true);
    try {
      const storedSnapshot = await loadTurnSnapshot(saveId, latestTurnNumber);
      assertExecutionCurrent(execution);
      if (!storedSnapshot) {
        setMessage('上一轮快照已经被覆盖或未保存，无法回退。可以在设置中提高回溯快照数量。');
        await refreshSnapshotTurns(execution);
        assertExecutionCurrent(execution);
        return;
      }

      const restored = restoreTurnRollbackSnapshot(storedSnapshot.snapshot, runtimeState);
      assertExecutionCurrent(execution);
      await commitBeforePublish(
        () => commitTurnRestore({
          saveId,
          runtimeState: restored.state,
          deleteSnapshotsAfterTurn: latestTurnNumber - 1,
          signal: execution.signal,
        }),
        (committed) => {
          assertExecutionCurrent(execution);
          if (!committed) throw new Error('当前存档不存在，无法回退。');

          setRuntimeState(restored.state);
          setNarrativeText('');
          setSuggestedActions([]);
          setLastPatch(restored.state.lastStatePatch ?? null);
          setPatchValidation(restored.state.lastPatchValidation ?? null);
          setPromptContext('');
          setPlayerInput(restored.actionText);
          setActiveTurnPanel(null);
          setEditingActionKey(null);
          setEditingActionText('');
          setSnapshotTurns(new Set(committed.snapshotTurnNumbers));
          setMessage('已回退到上一轮。你可以修改输入后重新执行，或直接再次执行重ROLL。');
        },
      );
    } catch (error) {
      if (!isTurnExecutionCancelled(error) && isExecutionCurrent(execution)) {
        setMessage(`回退失败：${error instanceof Error ? error.message : '未知错误'}`);
      }
    } finally {
      settleExecutionUi(execution);
      executionOwner.finish(execution);
    }
  }, [
    assertExecutionCurrent,
    beginExecution,
    executionOwner,
    isExecutionCurrent,
    isProcessing,
    runtimeState,
    saveId,
    settleExecutionUi,
  ]);

  const regenerateFromEntrySnapshot = useCallback(async (entry: NarrativeRenderEntry, nextActionText: string) => {
    const actionText = nextActionText.trim();
    const turnNumber = entry.turnNumber;
    if (!turnNumber || !actionText || isProcessing) return;

    const execution = beginExecution();
    setIsProcessing(true);
    try {
      const storedSnapshot = await loadTurnSnapshot(saveId, turnNumber);
      assertExecutionCurrent(execution);
      if (!storedSnapshot) {
        setMessage('该回合快照已经被覆盖，不能从这里重发。可以在设置中提高回溯快照数量。');
        await refreshSnapshotTurns(execution);
        assertExecutionCurrent(execution);
        return;
      }

      const restored = restoreTurnRollbackSnapshot(storedSnapshot.snapshot, runtimeState);
      assertExecutionCurrent(execution);
      await commitBeforePublish(
        () => commitTurnRestore({
          saveId,
          runtimeState: restored.state,
          deleteSnapshotsAfterTurn: turnNumber - 1,
          signal: execution.signal,
        }),
        (committed) => {
          assertExecutionCurrent(execution);
          if (!committed) throw new Error('当前存档不存在，无法恢复重掷状态。');

          setRuntimeState(restored.state);
          setNarrativeText('');
          setSuggestedActions([]);
          setLastPatch(restored.state.lastStatePatch ?? null);
          setPatchValidation(restored.state.lastPatchValidation ?? null);
          setPromptContext('');
          setActiveTurnPanel(null);
          setEditingActionKey(null);
          setEditingActionText('');
          setPlayerInput('');
          setSnapshotTurns(new Set(committed.snapshotTurnNumbers));
        },
      );

      const outcome = await executeActionFromState(restored.state, actionText, execution);
      if (outcome === 'failed') {
        assertExecutionCurrent(execution);
        setPlayerInput(actionText);
      }
    } catch (error) {
      if (!isTurnExecutionCancelled(error) && isExecutionCurrent(execution)) {
        setMessage(`重掷失败：${error instanceof Error ? error.message : '未知错误'}`);
      }
    } finally {
      settleExecutionUi(execution);
      executionOwner.finish(execution);
    }
  }, [
    assertExecutionCurrent,
    beginExecution,
    executeActionFromState,
    executionOwner,
    isExecutionCurrent,
    isProcessing,
    runtimeState,
    saveId,
    settleExecutionUi,
  ]);

  useEffect(() => {
    const handleRightControlDown = (event: KeyboardEvent) => {
      if (isRightControlKey(event)) {
        isRightControlPressedRef.current = true;
      }
    };
    const handleRightControlUp = (event: KeyboardEvent) => {
      if (isRightControlKey(event)) {
        isRightControlPressedRef.current = false;
      }
    };
    const clearRightControl = () => {
      isRightControlPressedRef.current = false;
    };

    window.addEventListener('keydown', handleRightControlDown);
    window.addEventListener('keyup', handleRightControlUp);
    window.addEventListener('blur', clearRightControl);
    return () => {
      window.removeEventListener('keydown', handleRightControlDown);
      window.removeEventListener('keyup', handleRightControlUp);
      window.removeEventListener('blur', clearRightControl);
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isRightControlKey(e.nativeEvent)) {
      isRightControlPressedRef.current = true;
      return;
    }
    if (shouldSubmitActionFromKeyboard(e.nativeEvent, isRightControlPressedRef.current)) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isRightControlKey(e.nativeEvent)) {
      isRightControlPressedRef.current = false;
    }
  };

  const handleSuggestedAction = (action: { label: string; description?: string }) => {
    setPlayerInput((currentInput) => appendSuggestedActionToInput(currentInput, action));
  };

  const handleNpcSelect = useCallback((npcId: string) => {
    setSelectedNpcId(npcId);
    const targetNpc = runtimeState.npcs?.find((npc) => npc.npcId === npcId);
    if (!targetNpc?.presenceUpdates?.some((update) => update.readByPlayer === false)) return;

    const nextState: RuntimeState = {
      ...runtimeState,
      npcs: runtimeState.npcs?.map((npc) => (
        npc.npcId === npcId
          ? {
              ...npc,
              presenceUpdates: npc.presenceUpdates?.map((update) => ({ ...update, readByPlayer: true })),
            }
          : npc
      )),
    };
    setRuntimeState(nextState);
    void saveCurrentState(saveId, nextState).catch((error) => {
      setMessage(`人物近况已读状态保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    });
  }, [runtimeState, saveId]);

  const openBackpackForEquipmentSlot = useCallback((slot: EquipmentSlot, label: string, treasureIndex?: number) => {
    setEquipmentChooserSlot({ slot, label, treasureIndex });
    setActiveBackpackCategory('equipment');
    setActiveSystemPanel('backpack');
  }, []);

  const handleEquipInventoryItem = useCallback((itemId: string, slot?: EquipmentSlot, treasureIndex?: number) => {
    const nextPlayer = equipInventoryItem(runtimeState.player, itemId, { slot, treasureIndex });
    if (nextPlayer === runtimeState.player) {
      setMessage('该物品不能装备到这个槽位。');
      return;
    }
    const nextState: RuntimeState = {
      ...runtimeState,
      player: nextPlayer,
    };
    setRuntimeState(nextState);
    setEquipmentChooserSlot(null);
    void saveCurrentState(saveId, nextState).catch((error) => {
      setMessage(`换装保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    });
  }, [runtimeState, saveId]);

  const handleUnequipInventoryItem = useCallback((
    itemId: string,
    slot?: EquipmentSlot,
    itemName?: string,
    treasureIndex?: number,
  ) => {
    const nextPlayer = unequipInventoryItem(runtimeState.player, itemId, {
      slot,
      itemName,
      treasureIndex,
    });
    if (nextPlayer === runtimeState.player) {
      setMessage('目标装备已不在对应槽位，无需再次卸下。');
      return;
    }
    const nextState: RuntimeState = {
      ...runtimeState,
      player: nextPlayer,
    };
    setRuntimeState(nextState);
    setEquipmentChooserSlot(null);
    setSelectedBackpackItemId(null);
    setMessage(`已卸下「${itemName ?? '装备'}」，物品仍保留在背包。`);
    void saveCurrentState(saveId, nextState).catch((error) => {
      setMessage(`卸装保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    });
  }, [runtimeState, saveId]);

  const commitCorrespondenceState = useCallback(async (
    nextState: RuntimeState,
    successMessage: string,
  ): Promise<void> => {
    if (isProcessing) throw new Error('当前回合仍在处理中，请稍后再操作书信。');
    const saved = await saveCurrentState(saveId, nextState);
    if (!saved) throw new Error('当前存档不存在，无法保存书信。');
    runtimeStateRef.current = nextState;
    setRuntimeState(nextState);
    setMessage(successMessage);
  }, [isProcessing, saveId]);

  const requestNpcDeletion = useCallback((npcId: string) => {
    setPendingNpcDeletion(analyzeNpcProfileDeletion(runtimeState, npcId));
  }, [runtimeState]);

  const handleConfirmNpcDeletion = useCallback(async () => {
    if (!pendingNpcDeletion || isDeletingNpc || isProcessing || isMemorySummaryProcessing) return;
    const result = deleteNpcProfileSafely(runtimeState, pendingNpcDeletion.npcId);
    if (!result.deleted) {
      setPendingNpcDeletion(result.analysis);
      setMessage(
        result.analysis.exists
          ? `“${result.analysis.npcName}”仍被实时系统引用，暂不能删除。`
          : '目标人物已经不存在。',
      );
      return;
    }

    setIsDeletingNpc(true);
    try {
      await commitBeforePublish(
        async () => {
          const saved = await saveCurrentState(saveId, result.state);
          if (!saved) throw new Error('当前存档不存在或已经被移除。');
          return saved;
        },
        () => {
          setRuntimeState(result.state);
          setSelectedNpcId(null);
          setPendingNpcDeletion(null);
          setMessage(`已删除人物志中的“${result.analysis.npcName}”；既有正文与历史战报保持不变。`);
        },
      );
    } catch (error) {
      setMessage(`人物删除保存失败，档案仍保留：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsDeletingNpc(false);
    }
  }, [
    isDeletingNpc,
    isMemorySummaryProcessing,
    isProcessing,
    pendingNpcDeletion,
    runtimeState,
    saveId,
  ]);

  const requestHoldingDeletion = useCallback((holdingId: string) => {
    setPendingHoldingDeletion({
      analysis: analyzeHoldingDeletion(runtimeState, holdingId),
      step: 1,
    });
  }, [runtimeState]);

  const handleConfirmHoldingDeletion = useCallback(async () => {
    if (
      !pendingHoldingDeletion
      || pendingHoldingDeletion.step !== 2
      || isDeletingHolding
      || isProcessing
      || isMemorySummaryProcessing
    ) return;

    const result = deleteHoldingSafely(runtimeState, pendingHoldingDeletion.analysis.holdingId);
    if (!result.deleted) {
      setPendingHoldingDeletion({ analysis: result.analysis, step: 1 });
      setMessage(
        result.analysis.exists
          ? `“${result.analysis.holdingName}”仍被实时系统引用，暂不能删除。`
          : '目标领地已经不存在。',
      );
      return;
    }

    setIsDeletingHolding(true);
    try {
      await commitBeforePublish(
        async () => {
          const saved = await saveCurrentState(saveId, result.state);
          if (!saved) throw new Error('当前存档不存在或已经被移除。');
          return saved;
        },
        () => {
          const nextHoldingId = result.state.holdings?.[0]?.holdingId ?? null;
          runtimeStateRef.current = result.state;
          setRuntimeState(result.state);
          setSelectedHoldingId(nextHoldingId);
          if (!nextHoldingId) setActiveHoldingTab('overview');
          setPendingHoldingDeletion(null);
          setMessage(
            `已删除领地“${result.analysis.holdingName}”；地图地点、驻军部队与既有历史记录均保持不变。`,
          );
        },
      );
    } catch (error) {
      setMessage(`领地删除保存失败，账本仍保留：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsDeletingHolding(false);
    }
  }, [
    isDeletingHolding,
    isMemorySummaryProcessing,
    isProcessing,
    pendingHoldingDeletion,
    runtimeState,
    saveId,
  ]);

  const handleConfirmInventoryRemoval = useCallback(() => {
    if (!pendingInventoryRemoval) return;
    const nextPlayer = removePlayerItem(runtimeState.player, pendingInventoryRemoval.id);
    if (nextPlayer === runtimeState.player) {
      setPendingInventoryRemoval(null);
      setSelectedBackpackItemId(null);
      setMessage('目标物品已不存在，无需再次移除。');
      return;
    }

    const nextState: RuntimeState = {
      ...runtimeState,
      player: nextPlayer,
    };
    const removedName = pendingInventoryRemoval.name;
    setRuntimeState(nextState);
    setPendingInventoryRemoval(null);
    setSelectedBackpackItemId(null);
    setMessage(`已移除「${removedName}」。`);
    void saveCurrentState(saveId, nextState).catch((error) => {
      setMessage(`物品移除保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    });
  }, [pendingInventoryRemoval, runtimeState, saveId]);

  const handleUseRestorativeItem = useCallback(async (itemId: string) => {
    if (usingBackpackItemId || isProcessing || isMemorySummaryProcessing) return;
    const result = applyPlayerRestorativeItemUse(runtimeState, itemId);
    if (!result.applied) {
      setMessage(result.summary);
      return;
    }

    setUsingBackpackItemId(itemId);
    try {
      await commitBeforePublish(
        async () => {
          const saved = await saveCurrentState(saveId, result.state);
          if (!saved) throw new Error('当前存档不存在或已经被移除。');
          return saved;
        },
        () => {
          setRuntimeState(result.state);
          if (!result.state.player.inventory?.some((item) => item.id === itemId)) {
            setSelectedBackpackItemId(null);
          }
          setMessage(result.summary);
        },
      );
    } catch (error) {
      setMessage(`恢复物品使用失败，物品未消耗：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setUsingBackpackItemId(null);
    }
  }, [
    isMemorySummaryProcessing,
    isProcessing,
    runtimeState,
    saveId,
    usingBackpackItemId,
  ]);

  const handleAllocateGrowthPoint = useCallback((abilityKey: string) => {
    const result = allocatePlayerGrowthPoint(runtimeState.player, abilityKey);
    if (!result.applied) {
      setMessage(result.reason === 'no_growth_points' ? '没有可分配的成长点。' : '该能力不能通过成长点提升。');
      return;
    }
    const nextState: RuntimeState = {
      ...runtimeState,
      player: result.player,
    };
    setRuntimeState(nextState);
    setMessage(`已将 1 点成长点分配到${abilityKey}。`);
    void saveCurrentState(saveId, nextState).catch((error) => {
      setMessage(`成长点保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    });
  }, [runtimeState, saveId]);

  /* 渲染层数（仅 UI 显示，不影响 LLM/状态） */
  const dismissBattleBriefing = useCallback(() => {
    setBattleBriefingQueue((queue) => queue.slice(1));
  }, []);

  const openBattleBriefingArchive = useCallback((card: BattleBriefingCard) => {
    dismissBattleBriefing();
    window.setTimeout(() => {
      if (card.openPanel === 'battles') {
        setActiveBattleTab(card.panelTab as BattlePanelTabKey);
        setSelectedBattleId(card.selectedId);
        setActiveBattleReportId(card.selectedId);
        setActiveCombatReportId(null);
        setActiveSystemPanel('battles');
      } else {
        setActiveCombatTab(card.panelTab as CombatPanelTabKey);
        setSelectedCombatId(card.selectedId);
        setActiveCombatReportId(card.selectedId);
        setActiveBattleReportId(null);
        setActiveSystemPanel('combats');
      }
    }, 0);
  }, [dismissBattleBriefing]);

  const openBattleReport = useCallback((conflictId: string) => {
    setSelectedBattleId(conflictId);
    setActiveBattleReportId(conflictId);
  }, []);

  const openCombatReport = useCallback((combatId: string) => {
    setSelectedCombatId(combatId);
    setActiveCombatReportId(combatId);
  }, []);

  const openJudgementCardPanel = useCallback((card: TurnJudgementCard) => {
    if (!card.panel) return;
    if (card.panel.type === 'battles') {
      setActiveBattleTab(card.panel.tab as BattlePanelTabKey);
      setSelectedBattleId(card.panel.selectedId);
      setActiveBattleReportId(card.panel.selectedId);
      setActiveCombatReportId(null);
      setActiveSystemPanel('battles');
    } else {
      setActiveCombatTab(card.panel.tab as CombatPanelTabKey);
      setSelectedCombatId(card.panel.selectedId);
      setActiveCombatReportId(card.panel.selectedId);
      setActiveBattleReportId(null);
      setActiveSystemPanel('combats');
    }
  }, []);

  const renderDepth = loadRenderDepthFromStorage();

  const turnCount = runtimeState.turnLog.length;
  const latestTurnLog = runtimeState.turnLog[runtimeState.turnLog.length - 1];
  const displayedNarrativeText = narrativeText || latestTurnLog?.fullNarrativeText || latestTurnLog?.narrativeText || '';
  const turnDisplayTitle = latestTurnLog ? getTurnDisplayTitle(latestTurnLog) : '开场剧情';
  const renderedNarrativeEntries = buildNarrativeRenderEntries(runtimeState.turnLog, {
    limit: renderDepth,
    currentNarrativeText: narrativeText,
    currentPlayerInput: isProcessing ? pendingActionText : '',
    currentTitle: isProcessing ? '生成中' : turnDisplayTitle,
    includeLiveEntry: isProcessing,
    includeUnpersistedNarrativeFallback: true,
  });
  const avgPlaybackEntry = !isProcessing
    ? [...renderedNarrativeEntries].reverse().find((entry) => !entry.isLive && entry.narrativeText.trim())
    : undefined;
  const avgDecisionMode = narrativePresentation === 'classic'
    ? 'classic'
    : narrativePresentation === 'avg' || avgResourcePackReady ? 'avg' : 'classic';
  const narrativeGenerationFinished = Boolean(narrativeText.trim()) && processingStageEvents.some(
    (event) => event.stage === 'generatingNarrative' && event.status === 'finished',
  );
  const showAvgPreparing = isProcessing && avgResourcePackReady && avgDecisionMode === 'avg' && !narrativeGenerationFinished;
  const canAttemptAvgPlayback = !isProcessing && avgResourcePackReady && avgDecisionMode === 'avg' && Boolean(avgPlaybackEntry?.turnNumber);
  const avgPlaybackTurn = avgPlaybackEntry?.turnNumber
    ? runtimeState.turnLog.find((turn) => turn.turnNumber === avgPlaybackEntry.turnNumber)
    : undefined;
  const [avgPlaybackResourceStatus, setAvgPlaybackResourceStatus] = useState<'idle' | 'loading' | 'ready' | 'warning'>('idle');
  useEffect(() => {
    let active = true;
    if (!canAttemptAvgPlayback || !avgPlaybackTurn) {
      setAvgPlaybackResourceStatus('idle');
      return () => { active = false; };
    }
    setAvgPlaybackResourceStatus('loading');
    void preflightAvgPlayback(runtimeState, saveId, avgPlaybackTurn, avgPlayerPortraitMode, { packs: avgResourcePackManager })
      .then((result) => { if (active) setAvgPlaybackResourceStatus(result.status); })
      .catch(() => { if (active) setAvgPlaybackResourceStatus('warning'); });
    return () => { active = false; };
  }, [avgPlaybackEntry?.key, avgPlaybackTurn, avgPlayerPortraitMode, avgResourcePackManager, avgVisualRevision, canAttemptAvgPlayback, runtimeState, saveId]);
  const showAvgStage = canAttemptAvgPlayback && avgPlaybackResourceStatus === 'ready';
  useEffect(() => {
    const turnNumber = avgPlaybackEntry?.turnNumber;
    if (!canAttemptAvgPlayback || !turnNumber) return;
    const key = `${saveId}:${avgPlaybackEntry.key}`;
    if (avgMaterializationKeysRef.current.has(key)) return;
    const sourceState = runtimeStateRef.current;
    const materialized = materializeAvgPresentation(sourceState, { saveId, turnNumber, playerPortraitMode: avgPlayerPortraitMode });
    if (!materialized.changed) return;
    avgMaterializationKeysRef.current.add(key);
    runtimeStateRef.current = materialized.state;
    setRuntimeState(materialized.state);
    void saveCurrentState(saveId, materialized.state).then((saved) => {
      if (!saved) throw new Error('当前存档不存在');
    }).catch((error) => {
      avgMaterializationKeysRef.current.delete(key);
      setMessage(`AVG 演出绑定保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    });
  }, [avgPlaybackEntry?.key, avgPlaybackEntry?.turnNumber, avgPlayerPortraitMode, canAttemptAvgPlayback, saveId]);
  useEffect(() => {
    if (!showAvgStage) setIsAvgImmersive(false);
  }, [showAvgStage]);
  const dismissAvgImmersiveRail = useCallback(() => {
    setAvgImmersivePinnedRail(null);
    setAvgImmersiveHoveredRail(null);
  }, []);
  const exitAvgImmersive = useCallback(() => {
    dismissAvgImmersiveRail();
    setIsAvgImmersiveChoiceOpen(false);
    setIsAvgImmersive(false);
    setAvgImmersiveNotice('');
    if (typeof document !== 'undefined' && document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen().catch(() => undefined);
  }, [dismissAvgImmersiveRail]);
  const requestAvgImmersive = useCallback(() => {
    setAvgImmersiveNotice('');
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches) setIsAvgImmersive(true);
    else setIsAvgImmersiveChoiceOpen(true);
  }, []);
  const enterAvgBrowserFullscreen = useCallback(async () => {
    setIsAvgImmersiveChoiceOpen(false); setAvgImmersiveNotice(''); setIsAvgImmersive(true);
    if (!modalScopeRef.current?.requestFullscreen) { setAvgImmersiveNotice('当前浏览器不支持全屏，已保留页面沉浸模式。'); return; }
    try { await modalScopeRef.current.requestFullscreen(); } catch { setAvgImmersiveNotice('浏览器未能进入全屏，已保留页面沉浸模式。'); }
  }, []);
  useEffect(() => {
    if (!isAvgImmersive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (avgImmersivePinnedRail || avgImmersiveHoveredRail) { event.preventDefault(); dismissAvgImmersiveRail(); }
        else exitAvgImmersive();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [avgImmersiveHoveredRail, avgImmersivePinnedRail, dismissAvgImmersiveRail, exitAvgImmersive, isAvgImmersive]);
  const avgImmersiveOpenRail = avgImmersivePinnedRail ?? avgImmersiveHoveredRail;
  const latestRenderedNarrativeText = renderedNarrativeEntries[renderedNarrativeEntries.length - 1]?.narrativeText ?? '';
  const activeTurnEntry = activeTurnPanel
    ? renderedNarrativeEntries.find((entry) => entry.key === activeTurnPanel.entryKey)
    : undefined;
  const activeTurnTitle = activeTurnEntry?.title ?? turnDisplayTitle;
  const activeTurnProcessingStages = activeTurnEntry?.displayMeta?.processingStages ?? [];
  const activeTurnRawResponse =
    activeTurnEntry?.displayMeta?.rawResponse
    || JSON.stringify({
      narrativeText: activeTurnEntry?.narrativeText ?? displayedNarrativeText,
      statePatch: lastPatch,
      patchValidation,
      promptContext,
    }, null, 2);

  const openDiagnosticExport = useCallback(() => {
    const exportText = buildNarrativeDiagnosticExport({
      runtimeState,
      worldBook,
      renderedEntries: renderedNarrativeEntries,
      saveId,
      getLocationName,
      mode: 'default',
      failedProcessingAttempt: failedProcessingAttempt ?? undefined,
    });
    setDiagnosticExportText(exportText);
    setDiagnosticCopyStatus('');
    setIsDiagnosticExportOpen(true);
  }, [failedProcessingAttempt, getLocationName, renderedNarrativeEntries, runtimeState, saveId, worldBook]);

  const openFullDiagnosticExport = useCallback(() => {
    if (!confirmFullDiagnosticExport(window.confirm)) return;
    const exportText = buildNarrativeDiagnosticExport({
      runtimeState,
      worldBook,
      renderedEntries: renderedNarrativeEntries,
      saveId,
      getLocationName,
      mode: 'full',
      failedProcessingAttempt: failedProcessingAttempt ?? undefined,
    });
    setDiagnosticExportText(exportText);
    setDiagnosticCopyStatus('');
    setIsDiagnosticExportOpen(true);
  }, [failedProcessingAttempt, getLocationName, renderedNarrativeEntries, runtimeState, saveId, worldBook]);

  const copyDiagnosticExport = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(diagnosticExportText);
      setDiagnosticCopyStatus('已复制');
    } catch {
      setDiagnosticCopyStatus('复制失败，请手动选中文本复制');
    }
  }, [diagnosticExportText]);

  useEffect(() => {
    const onPresentationChanged = (event: Event) => {
      setNarrativePresentation(
        (event as CustomEvent<NarrativePresentationPreference>).detail ?? loadNarrativePresentationFromStorage(),
      );
    };
    const onPlayerPortraitChanged = (event: Event) => {
      setAvgPlayerPortraitMode(
        (event as CustomEvent<AvgPlayerPortraitMode>).detail ?? loadAvgPlayerPortraitModeFromStorage(),
      );
    };
    window.addEventListener(NARRATIVE_PRESENTATION_CHANGED_EVENT, onPresentationChanged);
    window.addEventListener(AVG_PLAYER_PORTRAIT_MODE_CHANGED_EVENT, onPlayerPortraitChanged);
    return () => {
      window.removeEventListener(NARRATIVE_PRESENTATION_CHANGED_EVENT, onPresentationChanged);
      window.removeEventListener(AVG_PLAYER_PORTRAIT_MODE_CHANGED_EVENT, onPlayerPortraitChanged);
    };
  }, []);

  useEffect(() => {
    const scrollElement = narrativeScrollRef.current;
    if (!scrollElement) return;
    if (!shouldFollowNarrativeBottomRef.current) return;
    scrollElement.scrollTop = scrollElement.scrollHeight;
  }, [renderedNarrativeEntries.length, latestRenderedNarrativeText]);

  const openTurnPanel = (mode: ActiveTurnPanelMode, entry: NarrativeRenderEntry) => {
    if (mode === 'edit') {
      setEditingNarrative(entry.narrativeText);
    }
    setActiveTurnPanel({ mode, entryKey: entry.key });
  };

  const saveEditedNarrative = async () => {
    if (!activeTurnPanel || !activeTurnEntry) return;

    const editedText = editingNarrative;
    const nextState: RuntimeState = JSON.parse(JSON.stringify(runtimeState));
    const editableLog = nextState.turnLog.find((log) => `${log.turnNumber}-${log.timestamp}` === activeTurnPanel.entryKey);
    if (!editableLog) {
      setActiveTurnPanel(null);
      return;
    }

    editableLog.narrativeText = summarizeNarrativeForLog(editedText);
    editableLog.fullNarrativeText = editedText;
    editableLog.displayMeta = {
      ...editableLog.displayMeta,
      rawResponse: editableLog.displayMeta?.rawResponse ?? activeTurnRawResponse,
    };

    const latestLogKey = latestTurnLog ? `${latestTurnLog.turnNumber}-${latestTurnLog.timestamp}` : '';
    if (activeTurnPanel.entryKey === latestLogKey) {
      setNarrativeText(editedText);
    }

    setRuntimeState(nextState);
    await saveCurrentState(saveId, nextState);
    setMessage('正文已更新并保存。');
    setActiveTurnPanel(null);
  };

  const beginActionEdit = useCallback((entry: NarrativeRenderEntry) => {
    if (!entry.playerInput || isProcessing) return;
    setEditingActionKey(entry.key);
    setEditingActionText(entry.playerInput);
  }, [isProcessing]);

  const cancelActionEdit = useCallback(() => {
    setEditingActionKey(null);
    setEditingActionText('');
  }, []);

  const handlePlayerActionContextMenu = (event: React.MouseEvent, entry: NarrativeRenderEntry) => {
    event.preventDefault();
    const decision = decideTurnActionContextMenu({
      playerInput: entry.playerInput,
      turnNumber: entry.turnNumber,
      isLatestTurn: entry.turnNumber === latestTurnLog?.turnNumber,
      hasRollbackSnapshot: Boolean(entry.turnNumber && snapshotTurns.has(entry.turnNumber)),
    });
    if (decision.type === 'noop') return;

    setPlayerInput(decision.inputText);
    setMessage(decision.message);
  };

  const p = runtimeState.player;
  const playerSidebarAge = derivePlayerSidebarAge(p, runtimeState.currentDate);
  const bottomBarCurrentMatter = selectBottomBarCurrentMatter(runtimeState);
  const playerProfileModel = buildPlayerProfilePanelModel(p, runtimeState.memoryArchive, runtimeState.currentDate);
  const reputationModel = playerProfileModel.reputation;
  const dynamicPanelModel = useMemo(
    () => derivePanelModelWhenActive(activeSystemPanel, 'dynamics', () => buildDynamicPanelModel(runtimeState)),
    [activeSystemPanel, runtimeState],
  );
  const activeDynamicItems = dynamicPanelModel?.itemsByStage[activeDynamicStage];
  const dynamicCurrentMatters = activeDynamicItems?.currentMatters ?? [];
  const dynamicSignals = activeDynamicItems?.signals ?? [];
  const dynamicChronicles = activeDynamicItems?.chronicles ?? [];
  const dynamicUndercurrents = activeDynamicItems?.undercurrents ?? [];
  const dynamicTabCounts: Record<DynamicPanelTabKey, number> = {
    currentMatters: dynamicCurrentMatters.length,
    signals: dynamicSignals.length,
    chronicles: dynamicChronicles.length,
    undercurrents: dynamicUndercurrents.length,
  };
  const dynamicStageHasItems = Object.values(dynamicTabCounts).some((count) => count > 0);
  const dynamicTabs = dynamicPanelModel
    ? dynamicPanelModel.tabs.map((tab) => ({
        ...tab,
        count: dynamicTabCounts[tab.key],
        enabled: dynamicTabCounts[tab.key] > 0 || (!dynamicStageHasItems && tab.key === 'currentMatters'),
      }))
    : [];
  const npcPanelModel = useMemo(
    () => derivePanelModelWhenActive(activeSystemPanel, 'npcs', () => buildNpcPanelModel(runtimeState, {
      selectedNpcId,
      searchText: npcSearchText,
      onlyFocused: npcOnlyFocused,
      groupByLocation: npcGroupByLocation,
      presenceHintsEnabled: npcPresenceHintsEnabled,
      currentLocationLabel: currentLocationDisplayPath,
    })),
    [activeSystemPanel, currentLocationDisplayPath, npcGroupByLocation, npcOnlyFocused, npcPresenceHintsEnabled, npcSearchText, runtimeState, selectedNpcId],
  );
  const selectedNpcCard = npcPanelModel?.selectedCard;
  const selectedNpcRosterItem = npcPanelModel?.selectedRosterItem;
  const selectedNpcMemoryLayer = selectedNpcCard?.memoryLayers.find((layer) => layer.key === activeNpcMemoryLayer)
    ?? selectedNpcCard?.memoryLayers[0];
  const selectedNpcAllPrivateRecords = selectedNpcCard?.femaleProfile?.wombRecords ?? [];
  const selectedNpcPrivateRecords = selectNpcPrivateRecords(
    selectedNpcAllPrivateRecords,
    npcPrivateRecordDisplayLimit,
  );
  const selectedNpcHasAdultPrivateContent = Boolean(
    selectedNpcCard?.femaleProfile
    && (
      selectedNpcCard.femaleProfile.adultPrivateRows.length > 0
      || selectedNpcCard.femaleProfile.wombRecords.length > 0
    ),
  );
  const heroinePanelModel = useMemo(
    () => derivePanelModelWhenActive(activeSystemPanel, 'heroines', () => buildHeroinePanelModel(runtimeState, selectedHeroineThreadId)),
    [activeSystemPanel, runtimeState, selectedHeroineThreadId],
  );
  const selectedHeroineThread = heroinePanelModel?.selectedThread;
  const bondPanelModel = useMemo(
    () => derivePanelModelWhenActive(activeSystemPanel, 'bonds', () => buildBondPanelModel(runtimeState, selectedBondThreadId)),
    [activeSystemPanel, runtimeState, selectedBondThreadId],
  );
  const selectedBondThread = bondPanelModel?.selectedThread;
  const canRollbackLatestTurn = turnCount > 0 && snapshotTurns.has(turnCount);
  const showTrueOpeningRetry = shouldShowTrueOpeningRetryButton({
    message,
    isProcessing,
    trueOpeningGenerated: Boolean(runtimeState.worldStateDelta.trueOpeningGenerated),
  });
  const equipmentRows = buildEquipmentRows(p.equipment);
  const personalMoney = p.personalMoney ?? 0;
  const moneyText = formatCurrency(personalMoney);
  const backpackPanelModel = buildBackpackPanelModel(p, runtimeState);
  const equipmentChooserItem = equipmentChooserSlot
    ? equipmentRows.find((row) => (
      row.slot === equipmentChooserSlot.slot
      && row.treasureIndex === equipmentChooserSlot.treasureIndex
    ))?.item
    : undefined;
  const displayedBackpackItems = equipmentChooserSlot
    ? backpackPanelModel.getEquipCandidates(equipmentChooserSlot.slot)
    : backpackPanelModel.getItemsByCategory(activeBackpackCategory);
  const selectedBackpackItem = backpackPanelModel.items.find((item) => item.id === selectedBackpackItemId);
  const factionPanelModel = useMemo(
    () => derivePanelModelWhenActive(activeSystemPanel, 'factions', () => buildFactionPanelModel(runtimeState, selectedFactionId)),
    [activeSystemPanel, runtimeState, selectedFactionId],
  );
  const selectedFaction = factionPanelModel?.selectedFaction;
  const holdingPanelModel = useMemo(
    () => derivePanelModelWhenActive(activeSystemPanel, 'holdings', () => buildHoldingPanelModel(runtimeState, selectedHoldingId)),
    [activeSystemPanel, runtimeState, selectedHoldingId],
  );
  const selectedHolding = holdingPanelModel?.selectedHolding;
  const isSelectedHoldingMilitarySite = selectedHolding
    ? HOLDING_MILITARY_SITE_TYPES.has(selectedHolding.type)
      || resolveHoldingCivilAdministrationScope(selectedHolding) === 'none'
    : false;
  const selectedHoldingRosterItem = holdingPanelModel?.rosterItems.find((holding) => holding.holdingId === selectedHolding?.holdingId);
  const selectedHoldingVisual = holdingPanelModel?.visualProfile ? resolveHoldingVisualAsset(holdingPanelModel.visualProfile) : null;
  const holdingGovernancePanelModel = useMemo(
    () => selectedHolding
      ? buildHoldingGovernancePanelModel(runtimeState, selectedHolding, {
        selectedType: selectedGovernanceProjectType,
        selectedHostKey: selectedGovernanceHostKey,
        selectedAssistantKey: selectedGovernanceAssistantKey,
      })
      : null,
    [
      runtimeState,
      selectedHolding,
      selectedGovernanceAssistantKey,
      selectedGovernanceHostKey,
      selectedGovernanceProjectType,
    ],
  );
  const selectedPrivateAsset = runtimeState.privateAssets?.find((asset) => asset.privateAssetId === selectedPrivateAssetId)
    ?? runtimeState.privateAssets?.[0];
  const privateAssetManagementPanelModel = useMemo(
    () => selectedPrivateAsset
      ? buildPrivateAssetManagementPanelModel(runtimeState, selectedPrivateAsset, {
        selectedType: selectedPrivateAssetProjectType,
        selectedHostKey: selectedPrivateAssetHostKey,
        selectedAssistantKey: selectedPrivateAssetAssistantKey,
      })
      : null,
    [
      runtimeState,
      selectedPrivateAsset,
      selectedPrivateAssetAssistantKey,
      selectedPrivateAssetHostKey,
      selectedPrivateAssetProjectType,
    ],
  );
  const holdingSiegeRows = holdingPanelModel?.administrationRows.filter((row) => HOLDING_SIEGE_ROW_LABELS.has(row.label)) ?? [];
  const holdingAdministrationRows = holdingPanelModel?.administrationRows.filter((row) => !HOLDING_SIEGE_ROW_LABELS.has(row.label)) ?? [];
  const troopEntries = runtimeState.troops ?? [];
  const activeHeavyCavalryFormationProjects = (runtimeState.heavyCavalryFormationProjects ?? [])
    .filter((project) => project.status === 'active');
  const troopPanelModel = useMemo(
    () => derivePanelModelWhenActive(activeSystemPanel, 'troops', () => buildTroopPanelModel(runtimeState, selectedTroopId)),
    [activeSystemPanel, runtimeState, selectedTroopId],
  );
  const selectedTroop = troopPanelModel?.selectedTroop;
  const selectedTroopRosterItem = troopPanelModel?.rosterItems.find((troop) => troop.troopId === selectedTroop?.troopId);
  const troopVisualAsset = troopPanelModel?.visualProfile ? resolveTroopVisualAsset(troopPanelModel.visualProfile) : null;
  const pickTroopRows = (labels: string[]): TroopPanelDetailRow[] => labels
    .map((label) => troopPanelModel?.detailRows.find((row) => row.label === label))
    .filter((row): row is TroopPanelDetailRow => Boolean(row));
  const troopHeaderMetaRows = pickTroopRows(['所属势力']);
  const troopOfficerRows = troopPanelModel?.officerRows ?? [];
  const troopStatRows = pickTroopRows(['兵种', '规模', '精锐度', '整备', '士气', '训练', '补给', '疲劳']);
  const troopPositionRows = pickTroopRows(['当前位置', '最后已知位置', '当前任务', '对玩家关系', '军令状态', '目标地点', '行军状态']);
  const troopIntelRows = pickTroopRows(['可信度', '情报来源', '兵力变化', '变化原因', '消息时间']);
  const battlePanelModel = useMemo(
    () => derivePanelModelWhenActive(activeSystemPanel, 'battles', () => buildBattlePanelModel(runtimeState, activeBattleTab, selectedBattleId)),
    [activeBattleTab, activeSystemPanel, runtimeState, selectedBattleId],
  );
  const combatPanelModel = useMemo(
    () => derivePanelModelWhenActive(activeSystemPanel, 'combats', () => buildCombatPanelModel(runtimeState, activeCombatTab, selectedCombatId)),
    [activeCombatTab, activeSystemPanel, runtimeState, selectedCombatId],
  );
  const uniqueArtsPanelModel = useMemo(
    () => derivePanelModelWhenActive(activeSystemPanel, 'uniqueArts', () => buildUniqueArtsPanelModel(runtimeState, selectedUniqueArtId)),
    [activeSystemPanel, runtimeState, selectedUniqueArtId],
  );
  const selectedUniqueArt = uniqueArtsPanelModel?.selectedArt;
  const handleStartHoldingGovernanceProject = useCallback(async () => {
    if (
      !selectedHolding
      || !holdingGovernancePanelModel
      || !holdingGovernancePanelModel.canStart
      || isMutatingHoldingGovernance
      || isProcessing
      || isMemorySummaryProcessing
    ) return;
    const result = startHoldingGovernanceProject(runtimeState, {
      holdingId: selectedHolding.holdingId,
      type: holdingGovernancePanelModel.selectedType,
      host: holdingGovernancePanelModel.selectedHost,
      ...(holdingGovernancePanelModel.selectedAssistant
        ? { assistant: holdingGovernancePanelModel.selectedAssistant }
        : {}),
    });
    if (!result.ok || !result.project) {
      setMessage(result.error ?? '治理项目未能开工。');
      return;
    }

    setIsMutatingHoldingGovernance(true);
    try {
      await commitBeforePublish(
        async () => {
          const saved = await saveCurrentState(saveId, result.state);
          if (!saved) throw new Error('当前存档不存在或已经被移除。');
          return saved;
        },
        () => {
          setRuntimeState(result.state);
          setMessage(`“${holdingGovernancePanelModel.preview?.title ?? '治理项目'}”已经开工；钱粮已按本地合同一次扣除。`);
        },
      );
    } catch (error) {
      setMessage(`治理项目保存失败，未开工也未扣除钱粮：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsMutatingHoldingGovernance(false);
    }
  }, [
    holdingGovernancePanelModel,
    isMemorySummaryProcessing,
    isMutatingHoldingGovernance,
    isProcessing,
    runtimeState,
    saveId,
    selectedHolding,
  ]);

  const handleCancelHoldingGovernanceProject = useCallback(async (projectId: string) => {
    if (isMutatingHoldingGovernance || isProcessing || isMemorySummaryProcessing) return;
    const result = cancelHoldingGovernanceProject(runtimeState, projectId);
    if (!result.ok || !result.project) {
      setMessage(result.error ?? '治理项目未能取消。');
      return;
    }
    setIsMutatingHoldingGovernance(true);
    try {
      await commitBeforePublish(
        async () => {
          const saved = await saveCurrentState(saveId, result.state);
          if (!saved) throw new Error('当前存档不存在或已经被移除。');
          return saved;
        },
        () => {
          setRuntimeState(result.state);
          setMessage('治理项目已取消；已经投入的钱粮不会返还。');
        },
      );
    } catch (error) {
      setMessage(`治理项目取消保存失败，项目仍保持原状：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsMutatingHoldingGovernance(false);
    }
  }, [
    isMemorySummaryProcessing,
    isMutatingHoldingGovernance,
    isProcessing,
    runtimeState,
    saveId,
  ]);
  const handleStartPrivateAssetProject = useCallback(async () => {
    if (!selectedPrivateAsset || !privateAssetManagementPanelModel || !privateAssetManagementPanelModel.canStart
      || isMutatingPrivateAsset || isProcessing || isMemorySummaryProcessing) return;
    const result = startPrivateAssetManagementProject(runtimeState, {
      assetId: selectedPrivateAsset.privateAssetId,
      type: privateAssetManagementPanelModel.selectedType,
      host: privateAssetManagementPanelModel.selectedHost,
      ...(privateAssetManagementPanelModel.selectedAssistant
        ? { assistant: privateAssetManagementPanelModel.selectedAssistant }
        : {}),
    });
    if (!result.ok || !result.project) {
      setMessage(result.error ?? '私产经营项目未能开工。');
      return;
    }
    setIsMutatingPrivateAsset(true);
    try {
      await commitBeforePublish(
        async () => {
          const saved = await saveCurrentState(saveId, result.state);
          if (!saved) throw new Error('当前存档不存在或已经被移除。');
          return saved;
        },
        () => {
          setRuntimeState(result.state);
          setMessage(`“${privateAssetManagementPanelModel.preview.title}”已经开工；钱粮已按本地合同一次扣除。`);
        },
      );
    } catch (error) {
      setMessage(`私产项目保存失败，未开工也未扣除钱粮：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsMutatingPrivateAsset(false);
    }
  }, [
    isMemorySummaryProcessing, isMutatingPrivateAsset, isProcessing,
    privateAssetManagementPanelModel, runtimeState, saveId, selectedPrivateAsset,
  ]);

  const handleCancelPrivateAssetProject = useCallback(async (projectId: string) => {
    if (isMutatingPrivateAsset || isProcessing || isMemorySummaryProcessing) return;
    const result = cancelPrivateAssetManagementProject(runtimeState, projectId);
    if (!result.ok || !result.project) {
      setMessage(result.error ?? '私产项目未能取消。');
      return;
    }
    setIsMutatingPrivateAsset(true);
    try {
      await commitBeforePublish(
        async () => {
          const saved = await saveCurrentState(saveId, result.state);
          if (!saved) throw new Error('当前存档不存在或已经被移除。');
          return saved;
        },
        () => {
          setRuntimeState(result.state);
          setMessage('私产项目已取消；已经投入的钱粮不会返还。');
        },
      );
    } catch (error) {
      setMessage(`私产项目取消保存失败，项目仍保持原状：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsMutatingPrivateAsset(false);
    }
  }, [isMemorySummaryProcessing, isMutatingPrivateAsset, isProcessing, runtimeState, saveId]);
  const activeBattleBriefing = activeSystemPanel ? null : battleBriefingQueue[0] ?? null;
  const resolveNpcLabel = (npcId: string) => {
    const npc = (runtimeState.npcs ?? []).find((item) => item.npcId === npcId);
    return npc ? npc.name : '未登记人物';
  };
  const resolveTroopLabel = (troopId: string) => {
    const troop = troopEntries.find((item) => item.troopId === troopId);
    return troop ? troop.name : '未登记部队';
  };
  const resolveFactionLabel = (factionId: string) => {
    const faction = (runtimeState.factions ?? []).find((item) => item.factionId === factionId);
    return faction ? faction.name : '未登记势力';
  };
  const resolvePlaceLabel = (placeId: string) => getLocationName(placeId);
  const resolveHoldingLabel = (holdingId: string) => {
    const holding = (runtimeState.holdings ?? []).find((item) => item.holdingId === holdingId);
    return holding ? holding.name : '未登记领地';
  };
  const resolveQuestLabel = (questId: string) => {
    const quest = (runtimeState.activeQuests ?? []).find((item) => item.id === questId);
    return quest ? quest.title : '未登记事项';
  };
  const resolveSignalLabel = (signalId: string) => {
    const signal = (runtimeState.knownRumors ?? []).find((item) => item.id === signalId);
    return signal ? (signal.title ?? signal.content) : '未登记风声';
  };
  const resolveConflictLabel = (conflictId: string) => {
    const conflict = (runtimeState.conflicts ?? []).find((item) => item.conflictId === conflictId);
    return conflict ? conflict.title : '未登记战事';
  };
  const formatResolvedList = (values: string[] | undefined, resolve: (id: string) => string) => (
    values?.map(resolve).filter((value) => value.trim().length > 0).join(' / ') ?? ''
  );
  const hasResolvedValues = (rows: Array<{ values?: string[]; resolve: (id: string) => string }>) => (
    rows.some((row) => formatResolvedList(row.values, row.resolve).length > 0)
  );
  const buildImpactRows = (values: {
    affectedNpcIds?: string[];
    affectedFactionIds?: string[];
    affectedPlaceIds?: string[];
    affectedForceIds?: string[];
    affectedHoldingIds?: string[];
  }) => [
    { label: '影响人物', values: values.affectedNpcIds, resolve: resolveNpcLabel },
    { label: '影响势力', values: values.affectedFactionIds, resolve: resolveFactionLabel },
    { label: '影响地点', values: values.affectedPlaceIds, resolve: resolvePlaceLabel },
    { label: '影响部队', values: values.affectedForceIds, resolve: resolveTroopLabel },
    { label: '影响领地', values: values.affectedHoldingIds, resolve: resolveHoldingLabel },
  ];
  const renderResolvedRows = (rows: Array<{ label: string; values?: string[]; resolve: (id: string) => string }>) => (
    rows.map(({ label, values, resolve }) => {
      const text = formatResolvedList(values, resolve);
      return text ? <span key={label}>{label} <strong>{text}</strong></span> : null;
    })
  );
  const heroineDetailRows = selectedHeroineThread
    ? ([
        ['阶段', selectedHeroineThread.stage],
        ['关系定位', selectedHeroineThread.relationshipRole],
        ['当前牵引', selectedHeroineThread.currentPull],
        ['承诺记录', selectedHeroineThread.promiseNotes],
        ['风险', selectedHeroineThread.riskNotes],
        ['近期进展', selectedHeroineThread.recentProgress],
        ['最近后台结算', heroinePanelModel?.evolutionTiming?.lastEvaluatedAt],
        ['下次演化到期', heroinePanelModel?.evolutionTiming?.nextDueAt],
        ['更新于', selectedHeroineThread.lastUpdatedAt],
        ['来源', selectedHeroineThread.source ? formatKnownSourceLabel(selectedHeroineThread.source) : undefined],
      ] as const).filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    : [];
  const bondDetailRows = selectedBondThread
    ? ([
        ['类型', bondTypeLabels[selectedBondThread.bondType] ?? selectedBondThread.bondType],
        ['状态', relationshipStatusLabels[selectedBondThread.status] ?? selectedBondThread.status],
        ['当前张力', selectedBondThread.currentTension],
        ['承诺记录', selectedBondThread.promiseNotes],
        ['冲突记录', selectedBondThread.conflictNotes],
        ['近期进展', selectedBondThread.recentProgress],
        ['最近后台结算', bondPanelModel?.evolutionTiming?.lastEvaluatedAt],
        ['下次演化到期', bondPanelModel?.evolutionTiming?.nextDueAt],
        ['更新于', selectedBondThread.lastUpdatedAt],
        ['来源', selectedBondThread.source ? formatKnownSourceLabel(selectedBondThread.source) : undefined],
      ] as const).filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    : [];
  const factionCorePeople = factionPanelModel?.corePeople ?? [];
  const factionKnownMembers = factionPanelModel?.knownMembers ?? [];
  const factionRelatedTroops = factionPanelModel?.relatedTroops ?? [];
  const factionRelatedHoldings = factionPanelModel?.relatedHoldings ?? [];
  const factionRelatedMatters = factionPanelModel?.relatedMatters ?? [];
  const factionRelatedSignals = factionPanelModel?.relatedSignals ?? [];
  const factionRelatedChronicles = factionPanelModel?.relatedChronicles ?? [];
  const factionRecentActions = factionPanelModel?.recentActions ?? [];
  const visibleFactionRecentActions = selectFactionRecentActions(
    factionRecentActions,
    factionRecentActionDisplayLimit,
  );
  const activeBattleReport = activeBattleReportId
    ? (runtimeState.conflicts ?? []).find((battle) => battle.conflictId === activeBattleReportId) ?? null
    : null;
  const activeBattleArchiveBriefing = activeBattleReport ? buildConflictBriefingCard(activeBattleReport) : null;
  const activeCombatReport = activeCombatReportId
    ? (runtimeState.combatRecords ?? []).find((combat) => combat.combatId === activeCombatReportId) ?? null
    : null;
  const activeCombatArchiveBriefing = activeCombatReport ? buildCombatBriefingCard(activeCombatReport) : null;
  const buildBattleDetailRows = (battle: ConflictRecord) => ([
    ['类型', formatConflictType(battle.type)],
    ['记录级别', battle.recordLevel === 'full' ? '完整战报' : '简略记录'],
    ['发生时间', battle.occurredAt],
    ['地点', battle.locationName ?? (battle.locationId ? resolvePlaceLabel(battle.locationId) : undefined)],
    ['结果', formatConflictResultLevel(battle.resultLevel) ?? battle.result],
    ['胜方', battle.winnerSide],
    ['败方', battle.loserSide],
    ['更新于', battle.updatedAt],
  ] as const).filter(([, value]) => typeof value === 'string' && value.trim().length > 0);
  const buildCombatDetailRows = (combat: CombatRecord) => ([
    ['类型', formatCombatKind(combat.kind)],
    ['结果等级', formatCombatResult(combat.resultLevel)],
    ['重要度', formatCombatSignificance(combat.significance)],
    ['发生时间', combat.occurredAt],
    ['地点', combat.locationName ?? (combat.locationId ? resolvePlaceLabel(combat.locationId) : undefined)],
    ['更新于', combat.updatedAt],
  ] as const).filter(([, value]) => typeof value === 'string' && value.trim().length > 0);
  const activeBattleDetailRows = activeBattleReport ? buildBattleDetailRows(activeBattleReport) : [];
  const activeBattleSides = activeBattleReport?.sides ?? [];
  const activeBattleCommanders = activeBattleReport?.commanderNpcIds?.map(resolveNpcLabel) ?? [];
  const activeBattleTroops = activeBattleReport?.involvedTroopIds?.map(resolveTroopLabel) ?? [];
  const activeBattleFactions = activeBattleReport?.involvedFactionIds?.map(resolveFactionLabel) ?? [];
  const activeBattleNpcLabels = activeBattleReport?.involvedNpcIds?.map(resolveNpcLabel) ?? [];
  const activeBattleReportText = activeBattleReport
    ? activeBattleReport.reportText ?? activeBattleReport.summary ?? activeBattleReport.outcome
    : '';
  const activeCombatDetailRows = activeCombatReport ? buildCombatDetailRows(activeCombatReport) : [];
  const activeCombatReportText = activeCombatReport
    ? sanitizeCombatReportText(activeCombatReport.reportText ?? activeCombatReport.briefText ?? activeCombatReport.summary ?? activeCombatReport.outcome)
    : '';
  const memorySummaryMaintenance = getMemorySummaryMaintenance(runtimeState);
  const gameModalKey = stateWritebackRecoveryPreview
    ? 'state-writeback-recovery-preview'
    : isMemorySummaryRecoveryOpen
      ? 'memory-summary-recovery'
      : activeTurnPanel
      ? `turn:${activeTurnPanel.entryKey}`
      : activeBattleBriefing
        ? `briefing:${activeBattleBriefing.title}`
        : activeBattleReportId
          ? `battle-report:${activeBattleReportId}`
          : activeCombatReportId
            ? `combat-report:${activeCombatReportId}`
            : activeSystemPanel
              ? `system:${activeSystemPanel}`
              : isStoryExportOpen
                ? 'story-export'
                : isDiagnosticExportOpen
                  ? 'diagnostic-export'
                  : isPersistentPromptOpen
                    ? 'persistent-prompt'
                    : null;
  useModalAccessibility({
    modalKey: gameModalKey,
    scopeRef: modalScopeRef,
    onClose: () => {
      if (stateWritebackRecoveryPreview) {
        if (!isApplyingStateWritebackRecovery) setStateWritebackRecoveryPreview(null);
      } else if (isMemorySummaryRecoveryOpen) {
        setIsMemorySummaryRecoveryOpen(false);
      } else if (activeTurnPanel) {
        setActiveTurnPanel(null);
      } else if (activeBattleBriefing) {
        dismissBattleBriefing();
      } else if (activeBattleReportId) {
        setActiveBattleReportId(null);
      } else if (activeCombatReportId) {
        setActiveCombatReportId(null);
      } else if (activeSystemPanel) {
        if (activeSystemPanel === 'backpack') {
          setEquipmentChooserSlot(null);
          setSelectedBackpackItemId(null);
        }
        setActiveSystemPanel(null);
      } else if (isStoryExportOpen) {
        setIsStoryExportOpen(false);
      } else if (isDiagnosticExportOpen) {
        setIsDiagnosticExportOpen(false);
      } else if (isPersistentPromptOpen) {
        setIsPersistentPromptOpen(false);
      }
    },
  });
  const hiddenAbilityKeys = new Set(worldBook.characterOptions?.hiddenAbilityKeys ?? []);
  const visibleAbilityEntries = Object.entries(p.abilityScores ?? {}).filter(([key]) => !hiddenAbilityKeys.has(key));
  const growthPointsAvailable = Math.max(0, Math.floor(p.growthPoints ?? 0));
  const allocatableAbilityKeys = new Set<string>([...CORE_PLAYER_ATTRIBUTE_KEYS]);
  const turnSubmitButton = buildTurnSubmitButtonModel({
    hasInput: Boolean(playerInput.trim())
      && !pendingEncounterOffer
      && !isResolvingEncounterOffer
      && !stateWritebackRecoveryPreview,
    isProcessing,
    isCancelling,
    onSubmit: () => {
      void handleSubmit();
    },
    onCancel: handleCancelGeneration,
  });
  const messageTone = classifyGameMessageTone(message);

  /* 声名/德行刻度位置（读取 RuntimeState 已有数值） */
  const repPos = (v: number | undefined): number => {
    if (v == null) return 50;
    return Math.max(2, Math.min(98, ((v + 1000) / 2000) * 100));
  };

  return (
    <div ref={modalScopeRef} className={`start-shell game-screen-shell${isAvgImmersive ? ' avg-immersive' : ''}`} data-avg-immersive={isAvgImmersive}>
      <CombatEncounterScreen
        runtimeState={runtimeState}
        locationLabel={currentLocationDisplayPath}
        onResolved={handleCombatResolved}
        onRequestNarrative={handleCombatNarrativeRequest}
        narrativeBusy={isProcessing}
        onCancelNarrative={handleCancelGeneration}
        statusMessage={message}
      />
      <WarEncounterScreen
        runtimeState={runtimeState}
        locationLabel={currentLocationDisplayPath}
        onResolved={handleWarResolved}
        onRequestNarrative={handleWarNarrativeRequest}
        narrativeBusy={isProcessing}
        onCancelNarrative={handleCancelGeneration}
        statusMessage={message}
      />
      <div className="game-frame cloud-frame">
        {/* ========== 顶部信息栏 ========== */}
        <div className="game-topbar">
          <DesktopWeatherAtmosphere
            label={currentWeather.label}
            tags={currentWeather.tags}
            hour={currentGameHour}
          />
          <div className="gtb-left">
            <button onClick={onBackToStart} className="gtb-back-btn">← 返回</button>
            <span className="gtb-title">乱世风云录</span>
            <div className="gtb-weather-row" title={currentWeather.impactSummary}>
              天候：{currentWeather.label}
            </div>
          </div>
          <div className="gtb-center">
            <div className="gtb-time-row">
              <span className="gtb-time-full">{topBarDateLabel}</span>
              <span className="gtb-time-mobile">{mobileTopBarDateLabel}</span>
            </div>
            <div className="gtb-place-row">
              <span
                className="gtb-weather-icon"
                title={`天候：${currentWeather.label}；${currentWeather.impactSummary}`}
                aria-label={`天候：${currentWeather.label}`}
              >
                {currentWeatherGlyph}
              </span>
              <span className="gtb-place-dot" />
              <span className="gtb-place-label" title={currentLocationDisplayPath}>
                {currentLocationDisplayPath}
              </span>
            </div>
          </div>
          <div className="gtb-right">
            <button
              type="button"
              className="gtb-export-btn gtb-story-export-btn"
              data-testid="story-export-button"
              onClick={() => setIsStoryExportOpen(true)}
              title="导出玩家已经看到的剧情正文与行动"
            >
              导出剧情
            </button>
            <button
              type="button"
              className="gtb-export-btn"
              data-testid="diagnostic-export-button"
              onClick={openDiagnosticExport}
              title="导出默认脱敏诊断，包含当前显示正文、玩家输入和 token 信息"
            >
              诊断导出
            </button>
            <span className="gtb-tag">{bookmark?.label ?? '未知时代'}</span>
          </div>
        </div>

        {isAvgImmersive && <button type="button" className="avg-immersive-exit-handle" data-testid="avg-immersive-exit-handle" onClick={exitAvgImmersive} aria-label="退出 AVG 沉浸模式"><span aria-hidden="true">⌄</span><strong>退出沉浸</strong></button>}

        <MobileRegionSwitcher activeRegion={mobileGameRegion} onSelect={setMobileGameRegion} />

        {/* ========== 三栏主体 ========== */}
        <div className="game-body">
          {isAvgImmersive && <>
            <button id="avg-immersive-left-trigger" type="button" className="avg-immersive-rail-trigger avg-immersive-rail-trigger--left" data-testid="avg-immersive-left-trigger" aria-label="打开人物状态栏" aria-controls="game-region-profile" aria-expanded={avgImmersiveOpenRail === 'left'} data-avg-rail-pinned={avgImmersivePinnedRail === 'left'} onMouseEnter={() => setAvgImmersiveHoveredRail('left')} onMouseLeave={() => setAvgImmersiveHoveredRail(null)} onFocus={() => setAvgImmersiveHoveredRail('left')} onBlur={() => { if (avgImmersivePinnedRail !== 'left') setAvgImmersiveHoveredRail(null); }} onClick={() => setAvgImmersivePinnedRail((rail) => rail === 'left' ? null : 'left')}><span aria-hidden="true">›</span></button>
            <button id="avg-immersive-right-trigger" type="button" className="avg-immersive-rail-trigger avg-immersive-rail-trigger--right" data-testid="avg-immersive-right-trigger" aria-label="打开功能面板" aria-controls="game-region-systems" aria-expanded={avgImmersiveOpenRail === 'right'} data-avg-rail-pinned={avgImmersivePinnedRail === 'right'} onMouseEnter={() => setAvgImmersiveHoveredRail('right')} onMouseLeave={() => setAvgImmersiveHoveredRail(null)} onFocus={() => setAvgImmersiveHoveredRail('right')} onBlur={() => { if (avgImmersivePinnedRail !== 'right') setAvgImmersiveHoveredRail(null); }} onClick={() => setAvgImmersivePinnedRail((rail) => rail === 'right' ? null : 'right')}><span aria-hidden="true">‹</span></button>
            {avgImmersivePinnedRail && <button type="button" className="avg-immersive-rail-backdrop" data-testid="avg-immersive-rail-backdrop" aria-label="关闭沉浸侧栏" onClick={dismissAvgImmersiveRail} />}
          </>}
          {/* ---- 左侧：玩家简档 ---- */}
          <aside
            id="game-region-profile"
            className={`game-panel-left${isAvgImmersive ? ' avg-immersive-rail avg-immersive-rail--left' : ''}`}
            data-mobile-active={mobileGameRegion === 'profile'}
            data-avg-rail-open={isAvgImmersive && avgImmersiveOpenRail === 'left'}
            data-avg-rail-pinned={isAvgImmersive && avgImmersivePinnedRail === 'left'}
            onMouseEnter={isAvgImmersive ? () => setAvgImmersiveHoveredRail('left') : undefined}
            onMouseLeave={isAvgImmersive ? () => { if (avgImmersivePinnedRail !== 'left') setAvgImmersiveHoveredRail(null); } : undefined}
          >
            {isAvgImmersive && <button type="button" className="avg-immersive-rail-close" aria-label="关闭人物状态栏" onClick={dismissAvgImmersiveRail}>×</button>}
            <div className="profile-card">
              <div className="profile-header">
                <button
                  type="button"
                  className="profile-name profile-name-button"
                  data-testid="player-profile-entry"
                  onClick={() => setActiveSystemPanel('playerProfile')}
                  title="查看主角档案"
                >
                  <span className="profile-name-main">{p.name}</span>
                  {p.courtesyName && <span className="profile-courtesy">字{p.courtesyName}</span>}
                </button>
                <div className="profile-basic">
                  {p.sex && <span>{p.sex}</span>}
                  {playerSidebarAge != null && <span>{playerSidebarAge}岁</span>}
                </div>
              </div>

              {p.birthOrigin && (
                <div className="profile-row">
                  <span className="profile-label">出身</span>
                  <span className="profile-value">{p.birthOrigin}</span>
                </div>
              )}
              {p.currentIdentity && (
                <div className="profile-row">
                  <span className="profile-label">身份</span>
                  <span className="profile-value">{p.currentIdentity}</span>
                </div>
              )}

              <div className="profile-row">
                <span className="profile-label">阅历</span>
                <span className="profile-value">
                  Lv.{p.level ?? 1} · {p.xp ?? 0}/{experienceForNextLevel(p.level ?? 1)} · 成长点 {p.growthPoints ?? 0}
                </span>
              </div>

              {p.vitals && (
                <div className="profile-vital-bars">
                  <div className="vital-line">
                    <div className="vital-line-head"><span>生命</span><strong>{p.vitals.hp}/{p.vitals.maxHp}</strong></div>
                    <span className="vital-track"><span className="vital-fill" style={{ width: `${percentOf(p.vitals.hp, p.vitals.maxHp)}%` }} /></span>
                  </div>
                  <div className="vital-line">
                    <div className="vital-line-head"><span>体力</span><strong>{p.vitals.stamina}/{p.vitals.maxStamina}</strong></div>
                    <span className="vital-track"><span className="vital-fill" style={{ width: `${percentOf(p.vitals.stamina, p.vitals.maxStamina)}%` }} /></span>
                  </div>
                </div>
              )}

              <div className="profile-row profile-wall">
                <span className="profile-label">资财</span>
                <span className="profile-value">{moneyText}</span>
              </div>

              <div className="profile-reputation">
                <span className="profile-label">声名</span>
                <div className="rep-scale-block">
                  <span className="rep-eval">{reputationModel?.fameDisplay ?? '声名未显'}</span>
                  <div className="rep-scale">
                    <span className="rep-scale-label rep-scale-left">恶名</span>
                    <span className="rep-scale-track">
                      <span className="rep-scale-dot" style={{ left: `${repPos(reputationModel?.fame)}%` }} />
                    </span>
                    <span className="rep-scale-label rep-scale-right">美名</span>
                  </div>
                </div>
                <div className="rep-scale-block">
                  <span className="rep-eval">{reputationModel?.moralityDisplay ?? '德行未定'}</span>
                  <div className="rep-scale">
                    <span className="rep-scale-label rep-scale-left">失德</span>
                    <span className="rep-scale-track">
                      <span className="rep-scale-dot" style={{ left: `${repPos(reputationModel?.morality)}%` }} />
                    </span>
                    <span className="rep-scale-label rep-scale-right">有德</span>
                  </div>
                </div>
              </div>

              {/* 能力值 */}
              {visibleAbilityEntries.length > 0 && (
                <div className="profile-abilities">
                  <span className="profile-label">能力</span>
                  <div className="ability-bars">
                    {visibleAbilityEntries.map(([key, val]) => (
                      <div key={key} className="ability-bar-row">
                        <span className="ab-key">{key}</span>
                        <span className="ab-track"><span className="ab-fill" style={{ width: `${val}%` }} /></span>
                        <span className="ab-val">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {p.traits && p.traits.length > 0 && (
                <div className="profile-tags">
                  <span className="profile-label trait-help-label" title={TRAIT_RARITY_LEGEND_TITLE}>特质</span>
                  <div className="res-grid">
                    {p.traits.map((trait, index) => (
                      <span key={trait.id ?? `${trait.label}-${index}`} className={`res-chip rarity-${normalizeTraitRarity(trait.rarity)}`} title={buildTraitTooltipTitle(trait)}>{trait.label}</span>
                    ))}
                  </div>
                </div>
              )}

              {p.uniqueArts && p.uniqueArts.length > 0 && (
                <div className="profile-tags">
                  <span className="profile-label trait-help-label" title={TRAIT_RARITY_LEGEND_TITLE}>绝艺</span>
                  <div className="res-grid">
                    {p.uniqueArts.map((art) => (
                      <span
                        key={art.id}
                className={`res-chip unique-art rarity-${normalizeUniqueArtRarity(art.rarity)}`}
                        title={buildUniqueArtTooltipTitle(art)}
                      >
                        {art.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {p.effects && p.effects.length > 0 && (
                <div className="profile-tags">
                  <span className="profile-label">状态</span>
                  <div className="res-grid">
                    {p.effects.map((effect, index) => (
                      <span key={effect.id ?? `${effect.label}-${index}`} className={`res-chip effect-${effect.type}`} title={[effect.description, effect.promptHint].filter(Boolean).join('\n')}>{effect.label}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="profile-equipment">
                <span className="profile-label">装备</span>
                <div className="equipment-slot-list">
                  {equipmentRows.map((row) => (
                    <button
                      key={row.label}
                      type="button"
                      className="equipment-slot-row equipment-slot-row--button"
                      onClick={() => openBackpackForEquipmentSlot(row.slot, row.label, row.treasureIndex)}
                    >
                      <span>{row.label}</span>
                      <strong title={equipmentTitle(row.item)}>{equipmentDisplay(row.item)}</strong>
                    </button>
                  ))}
                </div>
              </div>

              {/* 当前危机 */}
              {crisis && (
                <div className="profile-crisis">
                  <span className="profile-label">当前危机</span>
                  <span className="crisis-name">{crisis.label}</span>
                  <span className="crisis-summary">{crisis.crisisSummary}</span>
                </div>
              )}
            </div>
          </aside>

          {/* ---- 中间：叙事 + 输入 ---- */}
          <main
            id="game-region-narrative"
            className="game-panel-center"
            data-mobile-active={mobileGameRegion === 'narrative'}
          >
            <div
              className="narrative-scroll"
              data-testid="narrative-scroll"
              ref={narrativeScrollRef}
              onScroll={handleNarrativeScroll}
            >
              {/* 时代背景 */}
              <div className="context-box">
                <h3>时代背景</h3>
                <p>{bookmark?.situationSummary ?? '暂无特定时代信息'}</p>
              </div>

              {/* 当前危机 */}
              {crisis && (
                <div className="crisis-box">
                  <h3>⚠ 当前危机：{crisis.label}</h3>
                  <p>{crisis.crisisSummary}</p>
                </div>
              )}

              {/* 剧情正文 */}
              {renderedNarrativeEntries.length > 0 && (
                <div className="narrative-box narrative-stream-box" data-testid="narrative-stream-box">
                  <h3>{narrativeTurnDisplayLabels.sectionTitle}</h3>
                  <div className="narrative-presentation-toolbar" role="group" aria-label="正文呈现模式">
                    <span className="narrative-presentation-toolbar-title">正文呈现</span>
                    <div className="narrative-presentation-controls">
                      <button
                        type="button"
                        className={`narrative-presentation-button${showAvgStage || showAvgPreparing ? '' : ' active'}`}
                        onClick={() => setNarrativePresentation(saveNarrativePresentationToStorage('classic'))}
                      >
                        原正文
                      </button>
                      <button
                        type="button"
                        className={`narrative-presentation-button${showAvgStage || showAvgPreparing ? ' active' : ''}`}
                        onClick={() => setNarrativePresentation(saveNarrativePresentationToStorage('avg'))}
                      >
                        AVG 演出
                      </button>
                      <button type="button" className="narrative-presentation-button narrative-visual-status-button" onClick={() => onOpenSettings('avg')}>视觉状态</button>
                      <button type="button" className="narrative-presentation-button avg-immersive-toggle" data-testid="avg-immersive-toggle" disabled={!showAvgStage} onClick={requestAvgImmersive}>
                        沉浸式
                      </button>
                    </div>
                    <span className="narrative-presentation-status" role="status" aria-live="polite">
                      {showAvgPreparing
                        ? 'AVG 舞台正在准备；流式正文将在提交完成后形成安全演出帧。'
                        : showAvgStage
                          ? narrativePresentation === 'auto' ? '自动：外置资源包与当前演出均已就绪。' : '手动：当前采用 AVG 演出。'
                          : avgResourcePackStatus === 'loading' && narrativePresentation !== 'classic'
                            ? '正在读取本机外置 AVG 美术包；当前完整显示原正文。'
                            : avgResourcePackStatus === 'empty' && narrativePresentation !== 'classic'
                              ? '尚未安装外置 AVG 美术包，当前完整显示原正文。'
                              : avgResourcePackStatus === 'warning' && narrativePresentation !== 'classic'
                                ? '本机 AVG 美术包暂时无法读取，当前完整显示原正文。'
                                : avgPlaybackResourceStatus === 'loading' && canAttemptAvgPlayback
                                  ? '正在按需读取当前 AVG 画面；当前完整显示原正文。'
                                  : avgPlaybackResourceStatus === 'warning' && canAttemptAvgPlayback
                                    ? '当前 AVG 图片缺失或读取失败，已完整回退原正文。'
                                    : '当前完整显示原正文。'}
                    </span>
                  </div>
                  {isAvgImmersiveChoiceOpen && <div className="avg-immersive-choice-backdrop" role="presentation" onClick={() => setIsAvgImmersiveChoiceOpen(false)}><section className="avg-immersive-choice" role="dialog" aria-modal="true" aria-label="选择沉浸方式" onClick={(event) => event.stopPropagation()}><h4>选择沉浸方式</h4><p>页面沉浸始终可用；浏览器全屏需要浏览器授权，拒绝时仍会保留页面沉浸。</p><div><button type="button" onClick={() => { setIsAvgImmersiveChoiceOpen(false); setAvgImmersiveNotice(''); setIsAvgImmersive(true); }}>页面沉浸</button><button type="button" onClick={() => void enterAvgBrowserFullscreen()}>浏览器全屏</button><button type="button" onClick={() => setIsAvgImmersiveChoiceOpen(false)}>取消</button></div></section></div>}
                  {avgImmersiveNotice && <p className="avg-immersive-notice" role="status">{avgImmersiveNotice}</p>}
                  {showAvgPreparing ? (
                    <section className="avg-preparing-stage" data-testid="avg-preparing-stage" role="status" aria-live="polite" aria-atomic="true">
                      <div className="avg-preparing-stage-visual" aria-hidden="true"><span className="avg-preparing-stage-orbit" /><span className="avg-preparing-stage-core" /></div>
                      <div className="avg-preparing-stage-copy"><strong>AVG 舞台正在准备</strong><span>AI 正在处理</span><small data-testid="avg-preparing-stage-phase">{sanitizeAvgPreparingStageText(processingStageText.trim()) || '正在建立安全演出帧'}</small></div>
                    </section>
                  ) : showAvgStage && avgPlaybackEntry ? (
                    <AvgNarrativeStage
                      entryKey={avgPlaybackEntry.key}
                      narrativeText={avgPlaybackEntry.narrativeText}
                      displayMeta={avgPlaybackEntry.displayMeta}
                      visualSnapshot={avgPlaybackEntry.avgVisualSnapshot}
                      avgPresentation={avgPlaybackEntry.avgPresentation}
                      runtimeState={runtimeState}
                      saveId={saveId}
                      worldBookId={runtimeState.worldBookId}
                      playerPortraitMode={avgPlayerPortraitMode}
                      onOpenAvgSettings={() => onOpenSettings('avg')}
                      onReturnClassic={() => setNarrativePresentation(saveNarrativePresentationToStorage('classic'))}
                    />
                  ) : (
                  <div className="narrative-stream" data-testid="narrative-stream">
                    {renderedNarrativeEntries.map((entry, index) => (
                      <article
                        key={entry.key}
                        className={`narrative-turn ${entry.isLive ? 'live' : ''}`}
                        data-testid="narrative-turn"
                      >
                        {index > 0 && <div className="nt-separator" />}
                        {entry.playerInput && (
                          <div className="player-action-row">
                            {editingActionKey === entry.key ? (
                              <div className="player-action-editor" data-testid="player-action-editor">
                                <textarea
                                  value={editingActionText}
                                  onChange={(event) => setEditingActionText(event.target.value)}
                                  data-testid="player-action-edit-input"
                                  aria-label="编辑本回合行动"
                                  rows={3}
                                  autoFocus
                                />
                                <div className="player-action-edit-actions">
                                  <button
                                    type="button"
                                    className="player-action-mini-button"
                                    data-testid="player-action-cancel-edit"
                                    onClick={cancelActionEdit}
                                  >
                                    取消
                                  </button>
                                  <button
                                    type="button"
                                    className="player-action-mini-button primary"
                                    data-testid="player-action-send-edit"
                                    disabled={!editingActionText.trim() || isProcessing || !entry.turnNumber || !snapshotTurns.has(entry.turnNumber)}
                                    onClick={() => regenerateFromEntrySnapshot(entry, editingActionText)}
                                  >
                                    发送
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="player-action-stack">
                                <button
                                  type="button"
                                  className="player-action-bubble"
                                  data-testid="player-action-bubble"
                                  title="右键：带回输入框；悬停：编辑或重发快照内回合"
                                  onContextMenu={(event) => handlePlayerActionContextMenu(event, entry)}
                                >
                                  {entry.playerInput}
                                </button>
                                <div className="player-action-tools" aria-label="玩家行动工具">
                                  <button
                                    type="button"
                                    className="player-action-mini-button"
                                    data-testid="player-action-edit"
                                    disabled={isProcessing || !entry.turnNumber || !snapshotTurns.has(entry.turnNumber)}
                                    title={!entry.turnNumber || !snapshotTurns.has(entry.turnNumber) ? '该回合快照已被覆盖，不能从这里编辑' : '编辑并从本回合重新发送'}
                                    onClick={() => beginActionEdit(entry)}
                                  >
                                    编辑
                                  </button>
                                  <button
                                    type="button"
                                    className="player-action-mini-button"
                                    data-testid="player-action-resend"
                                    disabled={isProcessing || !entry.turnNumber || !snapshotTurns.has(entry.turnNumber)}
                                    title={!entry.turnNumber || !snapshotTurns.has(entry.turnNumber) ? '该回合快照已被覆盖，不能从这里重发' : '用原输入从本回合重发'}
                                    onClick={() => regenerateFromEntrySnapshot(entry, entry.playerInput)}
                                  >
                                    重发
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <section className="turn-display-panel narrative-turn-toolbar" data-testid="turn-display-panel">
                          <div className="turn-display-main">
                            <div className="turn-display-actions">
                              {!entry.isLive && (
                                <button
                                  type="button"
                                  className="turn-tool-button"
                                  data-testid="turn-edit-button"
                                  title="编辑本回合正文"
                                  onClick={() => openTurnPanel('edit', entry)}
                                >
                                  编
                                </button>
                              )}
                            </div>
                            <div className="turn-display-title" data-testid="turn-display-title">
                              {entry.title}
                            </div>
                            <details className="turn-inspection-menu" data-testid="turn-inspection-menu">
                              <summary className="turn-tool-button" title="回合排查工具">查</summary>
                              <div className="turn-inspection-popover">
                                <button
                                  type="button"
                                  data-testid="turn-processing-trace-button"
                                  onClick={() => openTurnPanel('trace', entry)}
                                >
                                  处理轨迹
                                </button>
                                <button
                                  type="button"
                                  data-testid="turn-raw-button"
                                  onClick={() => openTurnPanel('raw', entry)}
                                >
                                  模型原文
                                </button>
                                {entry.displayMeta && (
                                  <div className="turn-display-stats" data-testid="turn-display-stats">
                                    <span>{narrativeTurnDisplayLabels.promptTokens} {formatTokenCount(entry.displayMeta.promptTokens)}</span>
                                    <span>{formatElapsedTime(entry.displayMeta.elapsedMs)}</span>
                                    <span>{narrativeTurnDisplayLabels.completionTokens} {formatTokenCount(entry.displayMeta.completionTokens)}</span>
                                    {getPromptCacheHitRate(entry.displayMeta) !== undefined && (
                                      <span>
                                        缓存命中 {Math.round((getPromptCacheHitRate(entry.displayMeta) ?? 0) * 1000) / 10}%
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </details>
                          </div>
                          {entry.date && <div className="narrative-turn-date">{entry.date}</div>}
                        </section>
                        {entry.isLive && !entry.narrativeText.trim() ? (
                          <NarrativeLiveLoader />
                        ) : (
                          <>
                            <NarrativeTextView
                              text={entry.narrativeText}
                              protagonistName={runtimeState.player.name}
                              judgementCards={entry.displayMeta?.judgementCards}
                              onOpenJudgementPanel={openJudgementCardPanel}
                            />
                            <div className="narrative-word-count">
                              {formatNarrativeWordCountLabel(entry.narrativeText)}
                            </div>
                          </>
                        )}
                      </article>
                    ))}
                  </div>
                  )}
                </div>
              )}
            </div>

            {/* 输入区 */}
            <div className="game-input-footer">
              {pendingEncounterOffer && (
                <section
                  className="encounter-transition-offer"
                  data-testid="encounter-transition-offer"
                  aria-labelledby="encounter-transition-offer-title"
                >
                  <div className="encounter-transition-offer-copy">
                    <span className="encounter-transition-offer-kicker">战局一触即发</span>
                    <strong id="encounter-transition-offer-title">
                      {pendingEncounterOffer.intent.reason}
                    </strong>
                    <span>此刻仍有一线回旋余地。你的选择只决定是否进入本地战斗，不会另跑剧情回合。</span>
                  </div>
                  <div className="encounter-transition-offer-actions">
                    <button
                      type="button"
                      className="ghost-btn"
                      data-testid="encounter-transition-decline"
                      onClick={() => {
                        void declinePendingEncounterOffer();
                      }}
                      disabled={isProcessing || isResolvingEncounterOffer}
                    >
                      暂不交锋
                    </button>
                    <button
                      type="button"
                      className="primary-btn"
                      data-testid="encounter-transition-accept"
                      onClick={() => {
                        void acceptPendingEncounterOffer();
                      }}
                      disabled={isProcessing || isResolvingEncounterOffer}
                    >
                      {isResolvingEncounterOffer ? '保存选择…' : '迎战'}
                    </button>
                  </div>
                </section>
              )}

              <StateWritebackRecoveryPanel
                runtimeState={runtimeState}
                worldBook={worldBook}
                preview={stateWritebackRecoveryPreview}
                isPreparing={isPreparingStateWritebackRecovery}
                isApplying={isApplyingStateWritebackRecovery}
                onPrepare={() => { void handlePrepareStateWritebackRecovery(); }}
                onCancelPreview={() => setStateWritebackRecoveryPreview(null)}
                onApplyPreview={() => { void handleApplyStateWritebackRecovery(); }}
              />

              {memorySummaryMaintenance && !isMemorySummaryRecoveryOpen && (
                <div
                  className="memory-summary-pending-notice"
                  data-testid="memory-summary-pending-notice"
                  role="status"
                  aria-live="polite"
                >
                  <div>
                    <strong>{isMemorySummaryProcessing ? '正在整理记忆' : '记忆待整理'}</strong>
                    <span>
                      {isMemorySummaryProcessing
                        ? ' 本回合已经保存，整理在后台进行。'
                        : ' 原始记忆已保留；请检查记忆压缩 API 后手动重试。'}
                    </span>
                  </div>
                  <div className="memory-summary-pending-actions">
                    <button
                      type="button"
                      className="ghost-btn"
                      data-testid="memory-summary-open-settings"
                      onClick={() => onOpenSettings('memory')}
                      disabled={isProcessing}
                    >
                      记忆 API 设置
                    </button>
                    <button
                      type="button"
                      className="primary-btn"
                      data-testid="memory-summary-retry"
                      onClick={() => {
                        void retryPendingMemorySummary();
                      }}
                      disabled={isProcessing || isMemorySummaryProcessing}
                    >
                      {isMemorySummaryProcessing ? '整理中…' : '重试整理'}
                    </button>
                  </div>
                </div>
              )}

              {message && (
                <div
                  className={`message-box message-box-${messageTone} ${(showTrueOpeningRetry || isDismissibleTurnCompletionMessage(message)) ? 'message-box-with-action' : ''}`}
                  role={messageTone === 'error' ? 'alert' : 'status'}
                  aria-live={messageTone === 'error' ? 'assertive' : 'polite'}
                >
                  <span className="message-box-text">{message}</span>
                  {showTrueOpeningRetry && (
                    <button
                      type="button"
                      className="message-retry-btn"
                      onClick={runTrueOpening}
                      disabled={isProcessing}
                      aria-label="重试开场剧情"
                    >
                      重试开局
                    </button>
                  )}
                  {isDismissibleTurnCompletionMessage(message) && (
                    <button
                      type="button"
                      className="message-retry-btn"
                      onClick={() => setMessage('')}
                      aria-label="关闭本回合提示"
                    >
                      关闭
                    </button>
                  )}
                </div>
              )}

              {(isProcessing || failedProcessingAttempt)
                && processingStageText && (
                <TurnProcessingTrace
                  key={failedProcessingAttempt?.failedAt ?? 'live-processing-trace'}
                  compact
                  events={processingStageEvents}
                  title={failedProcessingAttempt ? '最近失败的 AI 处理轨迹' : 'AI 处理轨迹'}
                  defaultOpen={Boolean(failedProcessingAttempt)}
                  currentLabel={failedProcessingAttempt
                    ? '未写入存档 · 可随诊断导出一并复制'
                    : narrativeText.trim()
                      ? `${processingStageText} · 正文已返回`
                      : processingStageText}
                />
              )}

              {/* 建议行动与低频行动工具 */}
              <div className="action-option-row">
                <div className="suggested-actions" aria-label="建议行动">
                  {suggestedActions.map((a, i) => (
                    <button
                      key={i}
                      onClick={() => handleSuggestedAction(a)}
                      className="action-btn"
                      title={a.description?.trim() || a.label}
                      disabled={Boolean(pendingEncounterOffer) || isResolvingEncounterOffer}
                    >
                      {summarizeSuggestedAction(a)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="persistent-prompt-trigger developer-command-trigger"
                  data-testid="developer-command-desktop-trigger"
                  title="插入 /dev 开发者事实纠错前缀；该命令不生成正文或推进回合"
                  disabled={isProcessing || Boolean(pendingEncounterOffer) || isResolvingEncounterOffer}
                  onClick={() => setPlayerInput((current) => (
                    current.trim() ? `${DEVELOPER_COMMAND_PREFIX} ${current.trim()}` : `${DEVELOPER_COMMAND_PREFIX} `
                  ))}
                >
                  事实纠错
                </button>
                {canUndoDeveloperOverride && (
                  <button
                    type="button"
                    className="persistent-prompt-trigger developer-command-undo"
                    data-testid="developer-command-undo"
                    disabled={isProcessing}
                    onClick={handleUndoDeveloperOverride}
                  >
                    撤销纠错
                  </button>
                )}
                <button
                  type="button"
                  className="persistent-prompt-trigger"
                  data-testid="persistent-prompt-desktop-trigger"
                  onClick={openPersistentPrompts}
                >
                  永久提示词
                  {enabledPersistentPromptCount > 0 && <span>{enabledPersistentPromptCount}</span>}
                </button>
                <div className="mobile-action-tools">
                  <button
                    type="button"
                    className="mobile-action-tools-trigger"
                    data-testid="mobile-action-tools-trigger"
                    aria-label="展开行动工具"
                    aria-expanded={isMobileActionToolsOpen}
                    onClick={() => setIsMobileActionToolsOpen((current) => !current)}
                  >
                    ⋯
                    {enabledPersistentPromptCount > 0 && <span>{enabledPersistentPromptCount}</span>}
                  </button>
                  {isMobileActionToolsOpen && (
                    <div className="mobile-action-tools-menu" data-testid="mobile-action-tools-menu">
                      <button
                        type="button"
                        onClick={() => {
                          setPlayerInput((current) => (
                            current.trim() ? `${DEVELOPER_COMMAND_PREFIX} ${current.trim()}` : `${DEVELOPER_COMMAND_PREFIX} `
                          ));
                          setIsMobileActionToolsOpen(false);
                        }}
                      >
                        事实纠错
                        <small>插入 /dev 命令</small>
                      </button>
                      {canUndoDeveloperOverride && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsMobileActionToolsOpen(false);
                            void handleUndoDeveloperOverride();
                          }}
                        >
                          撤销纠错
                          <small>恢复最近纠错前状态</small>
                        </button>
                      )}
                      <button type="button" onClick={openPersistentPrompts}>
                        永久提示词
                        <small>{enabledPersistentPromptCount} 条启用</small>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="input-row">
                <button
                  type="button"
                  className="reroll-btn"
                  aria-label="回退上一轮"
                  title="回退到上一轮行动前，并把上一轮行动放回输入框"
                  disabled={isProcessing || !canRollbackLatestTurn}
                  onClick={handleRollbackLatestTurn}
                >
                  ↻
                </button>
                <textarea
                  value={playerInput}
                  onChange={(e) => setPlayerInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onKeyUp={handleKeyUp}
                  onBlur={() => {
                    isRightControlPressedRef.current = false;
                  }}
                  aria-label="玩家行动输入框，回车换行，右 Ctrl 加 Enter 执行动作"
                  title="回车换行；右 Ctrl + Enter 执行动作"
                  placeholder="输入你的行动……（如：去市集打听消息 / 前往官署 / 拜访豪族 / 休息一天）"
                  disabled={isProcessing || Boolean(pendingEncounterOffer) || isResolvingEncounterOffer}
                  rows={2}
                />
                <MobileActionEditor
                  value={playerInput}
                  disabled={isProcessing || Boolean(pendingEncounterOffer) || isResolvingEncounterOffer}
                  onConfirm={setPlayerInput}
                />
                <button
                  type="button"
                  onClick={turnSubmitButton.onClick}
                  disabled={turnSubmitButton.disabled}
                  className={turnSubmitButton.className}
                  aria-label={turnSubmitButton.shortcutHint
                    ? `${turnSubmitButton.label}（${turnSubmitButton.shortcutHint}）`
                    : turnSubmitButton.label}
                  title={turnSubmitButton.shortcutHint
                    ? `${turnSubmitButton.label}；回车换行，${turnSubmitButton.shortcutHint} 执行`
                    : turnSubmitButton.label}
                >
                  <span>{turnSubmitButton.label}</span>
                  {turnSubmitButton.shortcutHint && (
                    <small className="submit-btn-shortcut">{turnSubmitButton.shortcutHint}</small>
                  )}
                </button>
              </div>
            </div>
          </main>

          {/* ---- 右侧：功能模块 ---- */}
          <aside
            id="game-region-systems"
            className={`game-panel-right${isAvgImmersive ? ' avg-immersive-rail avg-immersive-rail--right' : ''}`}
            data-mobile-active={mobileGameRegion === 'systems'}
            data-avg-rail-open={isAvgImmersive && avgImmersiveOpenRail === 'right'}
            data-avg-rail-pinned={isAvgImmersive && avgImmersivePinnedRail === 'right'}
            onMouseEnter={isAvgImmersive ? () => setAvgImmersiveHoveredRail('right') : undefined}
            onMouseLeave={isAvgImmersive ? () => { if (avgImmersivePinnedRail !== 'right') setAvgImmersiveHoveredRail(null); } : undefined}
          >
            {isAvgImmersive && <button type="button" className="avg-immersive-rail-close" aria-label="关闭功能面板" onClick={dismissAvgImmersiveRail}>×</button>}
            <div className="right-scroll">
              <div className="system-menu-panel">
                <div className="system-menu-buttons">
                  {sidePanelButtons.map((btn) => (
                    <button
                      key={btn.panel}
                      type="button"
                        className={`system-menu-button system-menu-button--${btn.tone}`}
                        data-testid={`right-menu-${btn.panel}`}
                        onClick={() => {
                          setActiveBattleReportId(null);
                          setActiveCombatReportId(null);
                          setActiveSystemPanel(btn.panel);
                        }}
                      >
                      <span className="system-menu-icon" aria-hidden="true">
                        {btn.icon}
                      </span>
                      <span className="system-menu-label">{btn.label}</span>
                      {btn.panel === 'correspondence' && unreadCorrespondenceCount > 0 && (
                        <span className="system-menu-badge" aria-label={`${unreadCorrespondenceCount} 封未读书信`}>
                          {unreadCorrespondenceCount}
                        </span>
                      )}
                      <span className="system-menu-spacer" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="game-side-system-actions" data-testid="game-utility-actions">
              <button
                type="button"
                className="system-utility-button"
                data-testid="game-save-progress"
                onClick={onOpenSaveProgress}
              >
                保存进度
              </button>
              <button
                type="button"
                className="system-utility-button"
                data-testid="game-load-progress"
                onClick={onOpenLoadProgress}
              >
                读取进度
              </button>
              <button
                type="button"
                className="system-utility-button"
                data-testid="game-open-settings"
                onClick={() => onOpenSettings()}
              >
                设置
              </button>
            </div>
          </aside>
        </div>

        {isStoryExportOpen && (
          <StoryExportPanel
            runtimeState={runtimeState}
            onClose={() => setIsStoryExportOpen(false)}
          />
        )}

        {isPersistentPromptOpen && (
          <PersistentPromptPanel
            entries={persistentPrompts}
            onChange={updatePersistentPrompts}
            onClose={() => setIsPersistentPromptOpen(false)}
          />
        )}

        {isDiagnosticExportOpen && (
          <SystemModalFrame
            title="诊断导出"
            subtitle="NARRATIVE DIAGNOSTIC"
            ariaLabel="诊断导出"
            onClose={() => setIsDiagnosticExportOpen(false)}
            className="diagnostic-export-modal"
            testId="diagnostic-export-panel"
          >
              <PanelNotice className="diagnostic-export-hint">
                默认脱敏诊断包含当前显示正文、玩家输入、token 和状态诊断；不包含模型原文、密钥或成人私密档案。
              </PanelNotice>
              <textarea
                className="diagnostic-export-textarea"
                data-testid="diagnostic-export-text"
                value={diagnosticExportText}
                readOnly
              />
              <div className="diagnostic-export-actions">
                {diagnosticCopyStatus && <span>{diagnosticCopyStatus}</span>}
                <button
                  type="button"
                  className="nav-btn"
                  data-testid="diagnostic-full-export-button"
                  onClick={openFullDiagnosticExport}
                >
                  完整诊断
                </button>
                <button type="button" className="primary-btn" onClick={copyDiagnosticExport}>一键复制</button>
              </div>
          </SystemModalFrame>
        )}

        {activeSystemPanel === 'dynamics' && dynamicPanelModel && (
          <SystemModalFrame
            title="局势"
            subtitle="SITUATION"
            ariaLabel="局势"
            onClose={() => setActiveSystemPanel(null)}
            className="dynamic-panel-modal"
            workspace
            testId="dynamic-panel"
          >

              <div className="dynamic-stage-tabs" aria-label="局势扫描阶段">
                {dynamicPanelModel.stageTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    className={`dynamic-stage-tab stage-${tab.key} ${activeDynamicStage === tab.key ? 'active' : ''}`}
                    onClick={() => {
                      setActiveDynamicStage(tab.key);
                      const nextItems = dynamicPanelModel.itemsByStage[tab.key];
                      if (nextItems[activeDynamicTab].length === 0) {
                        const firstAvailableTab = dynamicPanelModel.tabs.find((candidate) => nextItems[candidate.key].length > 0);
                        setActiveDynamicTab(firstAvailableTab?.key ?? 'currentMatters');
                      }
                    }}
                  >
                    {tab.label}
                    <strong>{tab.count}</strong>
                  </button>
                ))}
              </div>
              <p className="dynamic-stage-intro">{DYNAMIC_STAGE_DESCRIPTIONS[activeDynamicStage]}</p>

              <div className="dynamic-panel-layout">
                <aside className="dynamic-sidebar" aria-label="局势分类">
                  {dynamicTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      className={`dynamic-sidebar-tab ${activeDynamicTab === tab.key ? 'active' : ''} ${tab.enabled ? '' : 'disabled'}`}
                      disabled={!tab.enabled}
                      onClick={() => setActiveDynamicTab(tab.key)}
                    >
                      <span>{tab.label}</span>
                      <strong>{tab.count}</strong>
                    </button>
                  ))}
                </aside>

                <div className="dynamic-content">
                  <div className="dynamic-panel-summary">
                    {dynamicPanelModel.stageTabs.map((stage) => (
                      <span key={stage.key} className={activeDynamicStage === stage.key ? 'is-active' : ''}>
                        {stage.label} <strong>{stage.count}</strong>
                      </span>
                    ))}
                  </div>

              {activeDynamicTab === 'currentMatters' && (
                <section className="dynamic-section">
                <h4>当前事项</h4>
                {dynamicCurrentMatters.length === 0 ? (
                  <p className="dynamic-empty">暂无当前事项。后续由剧情写回玩家承诺、委托、牵挂和可行动目标。</p>
                ) : (
                  <div className="dynamic-card-list">
                    {dynamicCurrentMatters.map((matter) => (
                      <article key={matter.id} className={`dynamic-card status-${matter.status}`}>
                        <header>
                          <div>
                            <h5>{matter.title}</h5>
                            {matter.sourceLabel && <small>{matter.sourceLabel}</small>}
                          </div>
                          <span className={`dynamic-status status-${matter.status}`}>{matter.statusLabel}</span>
                        </header>
                        <p>{matter.description}</p>
                        <div className="dynamic-meta-grid">
                          {matter.priorityLabel && <span>优先级 <strong>{matter.priorityLabel}</strong></span>}
                          {matter.severityLabel && <span>影响级别 <strong>{matter.severityLabel}</strong></span>}
                          {matter.source && <span>来源 <strong>{matter.sourceLabel}</strong></span>}
                          {matter.deadlineAt && <span>期限 <strong>{matter.deadlineAt}</strong></span>}
                          <span>更新 <strong>{matter.updatedAt}</strong></span>
                        </div>
                        {matter.currentStep && (
                          <div className="dynamic-note">
                            <span>当前步骤</span>
                            <p>{matter.currentStep}</p>
                          </div>
                        )}
                        {matter.stakes && (
                          <div className="dynamic-note danger">
                            <span>风险</span>
                            <p>{matter.stakes}</p>
                          </div>
                        )}
                        {matter.outcomeSummary && (
                          <div className="dynamic-note">
                            <span>后果</span>
                            <p>{matter.outcomeSummary}</p>
                          </div>
                        )}
                        {matter.consequenceTags && matter.consequenceTags.length > 0 && (
                          <div className="dynamic-tag-list" aria-label="后果标签">
                            {matter.consequenceTags.map((tag) => (
                              <span key={tag}>{tag}</span>
                            ))}
                          </div>
                        )}
                        {hasResolvedValues(buildImpactRows(matter)) && (
                          <div className="dynamic-impact-grid">
                            {renderResolvedRows(buildImpactRows(matter))}
                          </div>
                        )}
                        {matter.followUpHooks && matter.followUpHooks.length > 0 && (
                          <div className="dynamic-note">
                            <span>后续钩子</span>
                            <p>{matter.followUpHooks.join('；')}</p>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
                </section>
              )}

              {activeDynamicTab === 'signals' && (
                <section className="dynamic-section">
                <h4>风声线索</h4>
                {dynamicSignals.length === 0 ? (
                  <p className="dynamic-empty">暂无风声线索。后续由剧情写回玩家已听闻、发现或可合理感知的传闻、线索与异动。</p>
                ) : (
                  <div className="dynamic-card-list">
                    {dynamicSignals.map((signal) => (
                      <article key={signal.id} className="dynamic-card signal-card">
                        <header>
                          <div>
                            <h5>{signal.title}</h5>
                            <small>{signal.sourceLabel}</small>
                          </div>
                          <span className="dynamic-status signal-status">{signal.signalTypeLabel ?? '风声'}</span>
                        </header>
                        <p>{signal.content}</p>
                        <div className="dynamic-meta-grid">
                          <span>来源 <strong>{signal.sourceLabel}</strong></span>
                          {signal.confidenceLabel && <span>可信度 <strong>{signal.confidenceLabel}</strong></span>}
                          {signal.severityLabel && <span>影响级别 <strong>{signal.severityLabel}</strong></span>}
                          {signal.expiresAt && <span>时效 <strong>{signal.expiresAt}</strong></span>}
                          <span>记录 <strong>{signal.createdAt}</strong></span>
                        </div>
                        {signal.potentialOutcomeSummary && (
                          <div className="dynamic-note">
                            <span>潜在后果</span>
                            <p>{signal.potentialOutcomeSummary}</p>
                          </div>
                        )}
                        {signal.consequenceTags && signal.consequenceTags.length > 0 && (
                          <div className="dynamic-tag-list" aria-label="风声后果标签">
                            {signal.consequenceTags.map((tag) => (
                              <span key={tag}>{tag}</span>
                            ))}
                          </div>
                        )}
                        {hasResolvedValues(buildImpactRows(signal)) && (
                          <div className="dynamic-impact-grid">
                            {renderResolvedRows(buildImpactRows(signal))}
                          </div>
                        )}
                        {signal.followUpHooks && signal.followUpHooks.length > 0 && (
                          <div className="dynamic-note">
                            <span>后续钩子</span>
                            <p>{signal.followUpHooks.join('；')}</p>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
                </section>
              )}

              {activeDynamicTab === 'chronicles' && (
                <section className="dynamic-section">
                <h4>纪事</h4>
                {dynamicChronicles.length === 0 ? (
                  <p className="dynamic-empty">暂无纪事。后续由剧情写回已发生、已获知或有明确来源的局势变化。</p>
                ) : (
                  <div className="dynamic-card-list">
                    {dynamicChronicles.map((chronicle) => (
                      <article key={chronicle.id} className="dynamic-card chronicle-card">
                        <header>
                          <div>
                            <h5>{chronicle.title}</h5>
                            <small>{chronicle.sourceLabel ?? '纪事'}</small>
                          </div>
                          <span className="dynamic-status chronicle-status">{chronicle.severityLabel}</span>
                        </header>
                        <p>{chronicle.summary}</p>
                        <div className="dynamic-meta-grid">
                          {chronicle.scope && <span>范围 <strong>{chronicle.scopeLabel}</strong></span>}
                          {chronicle.certainty && <span>可信度 <strong>{chronicle.certaintyLabel}</strong></span>}
                          {chronicle.visibility && <span>可见性 <strong>{chronicle.visibilityLabel}</strong></span>}
                          {chronicle.source && <span>来源 <strong>{chronicle.sourceLabel}</strong></span>}
                          {chronicle.locationId && <span>地点 <strong>{resolvePlaceLabel(chronicle.locationId)}</strong></span>}
                          {chronicle.happenedAt && <span>发生 <strong>{chronicle.happenedAt}</strong></span>}
                          {chronicle.learnedAt && <span>获知 <strong>{chronicle.learnedAt}</strong></span>}
                          <span>更新 <strong>{chronicle.updatedAt}</strong></span>
                        </div>
                        {chronicle.outcomeSummary && (
                          <div className="dynamic-note">
                            <span>已成后果</span>
                            <p>{chronicle.outcomeSummary}</p>
                          </div>
                        )}
                        {chronicle.consequenceTags && chronicle.consequenceTags.length > 0 && (
                          <div className="dynamic-tag-list" aria-label="纪事后果标签">
                            {chronicle.consequenceTags.map((tag) => (
                              <span key={tag}>{tag}</span>
                            ))}
                          </div>
                        )}
                        {hasResolvedValues(buildImpactRows(chronicle)) && (
                          <div className="dynamic-impact-grid">
                            {renderResolvedRows(buildImpactRows(chronicle))}
                          </div>
                        )}
                        {[chronicle.sourceQuestIds, chronicle.sourceSignalIds, chronicle.sourceConflictIds].some((values) => values && values.length > 0) && (
                          <div className="dynamic-impact-grid">
                            {chronicle.sourceQuestIds && chronicle.sourceQuestIds.length > 0 && (
                              <span>关联事项 <strong>{formatResolvedList(chronicle.sourceQuestIds, resolveQuestLabel)}</strong></span>
                            )}
                            {chronicle.sourceSignalIds && chronicle.sourceSignalIds.length > 0 && (
                              <span>关联风声 <strong>{formatResolvedList(chronicle.sourceSignalIds, resolveSignalLabel)}</strong></span>
                            )}
                            {chronicle.sourceConflictIds && chronicle.sourceConflictIds.length > 0 && (
                              <span>关联战事 <strong>{formatResolvedList(chronicle.sourceConflictIds, resolveConflictLabel)}</strong></span>
                            )}
                          </div>
                        )}
                        {chronicle.followUpHooks && chronicle.followUpHooks.length > 0 && (
                          <div className="dynamic-note">
                            <span>后续钩子</span>
                            <p>{chronicle.followUpHooks.join('；')}</p>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
                </section>
              )}

              {activeDynamicTab === 'undercurrents' && (
                <section className="dynamic-section">
                  <h4>暗流</h4>
                  {dynamicUndercurrents.length === 0 ? (
                    <p className="dynamic-empty">该扫描阶段暂无当地暗流记录。</p>
                  ) : (
                    <div className="dynamic-card-list dynamic-undercurrent-list">
                      {dynamicUndercurrents.map((undercurrent) => (
                        <article key={undercurrent.id} className="dynamic-card undercurrent-card">
                          <header>
                            <h5>当地态势</h5>
                            <span className="dynamic-status undercurrent-status">暗流</span>
                          </header>
                          <p>{undercurrent.content}</p>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )}
                </div>
              </div>
          </SystemModalFrame>
        )}

        {activeSystemPanel === 'playerProfile' && (
          <div className="system-modal-backdrop" role="presentation" onClick={() => setActiveSystemPanel(null)}>
            <section
              className="system-modal ui-system-workspace player-profile-modal"
              data-testid="player-profile-panel"
              role="dialog"
              aria-label="主角档案"
              onClick={(event) => event.stopPropagation()}
            >
              <SystemModalHeader
                title="主角档案"
                subtitle="身份、能力与行装"
                onClose={() => setActiveSystemPanel(null)}
              />

              <div className="player-profile-scroll">

              <div className="player-profile-hero">
                <div>
                  <h3>{playerProfileModel.title}</h3>
                  {playerProfileModel.subtitle && <p>{playerProfileModel.subtitle}</p>}
                </div>
                {p.vitals && (
                  <div className="player-profile-vitals">
                    <span>生命 <strong>{p.vitals.hp}/{p.vitals.maxHp}</strong></span>
                    <span>体力 <strong>{p.vitals.stamina}/{p.vitals.maxStamina}</strong></span>
                  </div>
                )}
              </div>

              <div className="character-summary-grid">
                {playerProfileModel.summaryRows.map((row) => (
                  <div key={`${row.label}-${row.value}`} title={profileRowTitle(row)}>
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                    {row.detail && <small>{row.detail}</small>}
                  </div>
                ))}
              </div>

              <div className="player-profile-sections">
                {(playerProfileModel.basicRows.length > 0 || playerProfileModel.identityRows.length > 0) && (
                  <div className="player-profile-section-grid">
                    {playerProfileModel.basicRows.length > 0 && (
                      <section className="player-profile-section player-profile-basic-card">
                        <h4>基础档案</h4>
                        <div className="player-profile-row-stack">
                          {playerProfileModel.basicRows.map((row) => (
                            <div key={`${row.label}-${row.value}`} className={profileRowClassName(row)} title={profileRowTitle(row)}>
                              <span>{row.label}</span>
                              <strong>{row.value}</strong>
                              {row.detail && <small>{row.detail}</small>}
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                    {playerProfileModel.identityRows.length > 0 && (
                      <section className="player-profile-section player-profile-identity-card">
                        <h4>身份履历</h4>
                        <div className="player-profile-row-stack">
                          {playerProfileModel.identityRows.map((row) => (
                            <div key={`${row.label}-${row.value}`} className={profileRowClassName(row)} title={profileRowTitle(row)}>
                              <span>{row.label}</span>
                              <strong>{row.value}</strong>
                              {row.detail && <small>{row.detail}</small>}
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                )}

                {playerProfileModel.narrativeRows.length > 0 && (
                  <section className="player-profile-section">
                    <h4>人物描写</h4>
                    {playerProfileModel.narrativeRows.map((row) => (
                      <div key={`${row.label}-${row.value}`} className="player-profile-note" title={profileRowTitle(row)}>
                        <span>{row.label}</span>
                        <p>{row.value}</p>
                      </div>
                    ))}
                  </section>
                )}

                {visibleAbilityEntries.length > 0 && (
                  <section className="player-profile-section">
                    <div className="player-profile-section-head">
                      <h4>能力</h4>
                      <span
                        className="player-profile-growth-points"
                        title="升级奖励递减：Lv.2–5 每级 5 点，Lv.6–10 每级 4 点，Lv.11–20 每级 3 点，Lv.21–30 每级 2 点，Lv.31 起每级 1 点。"
                      >
                        可分配成长点 {growthPointsAvailable} · 下级 +{growthPointsForReachedLevel((p.level ?? 1) + 1)}
                      </span>
                    </div>
                    <div className="player-profile-ability-grid">
                      {visibleAbilityEntries.map(([key, val]) => {
                        const canAllocate = growthPointsAvailable > 0 && allocatableAbilityKeys.has(key);
                        return (
                          <div key={key} className="player-profile-ability">
                            <span>{key}</span>
                            <strong>{val}</strong>
                            {allocatableAbilityKeys.has(key) && (
                              <button
                                type="button"
                                className="player-ability-plus"
                                disabled={!canAllocate}
                                title={canAllocate ? `消耗 1 点成长点提升${key}` : '没有可分配的成长点'}
                                onClick={() => handleAllocateGrowthPoint(key)}
                              >
                                +
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {(playerProfileModel.uniqueArtCards.length > 0 || playerProfileModel.traitCards.length > 0 || playerProfileModel.effectCards.length > 0) && (
                  <section className="player-profile-section">
                    <h4><span className="trait-help-label" title={TRAIT_RARITY_LEGEND_TITLE}>特质</span>与状态</h4>
                    <div className="player-profile-chip-grid">
                      {playerProfileModel.uniqueArtCards.map((card) => (
                        <span key={`unique-art-${card.label}`} className={`player-profile-chip trait unique-art rarity-${card.rarity ?? 'white'}`} title={card.tooltip}>{card.label}</span>
                      ))}
                      {playerProfileModel.traitCards.map((card) => (
                        <span key={`trait-${card.label}`} className={`player-profile-chip trait rarity-${card.rarity ?? 'white'}`} title={card.tooltip}>{card.label}</span>
                      ))}
                      {playerProfileModel.effectCards.map((card) => (
                        <span key={`effect-${card.label}`} className={`player-profile-chip ${card.kind}`} title={card.tooltip}>{card.label}</span>
                      ))}
                    </div>
                  </section>
                )}

                {(playerProfileModel.equipmentRows.length > 0 || playerProfileModel.inventoryPreview.length > 0) && (
                  <section className="player-profile-section player-profile-two-col">
                    <div>
                      <h4>装备</h4>
                      {playerProfileModel.equipmentRows.length === 0 ? <p className="muted">暂无装备</p> : playerProfileModel.equipmentRows.map((row) => (
                        <div key={`${row.label}-${row.value}`} className="player-profile-row" title={profileRowTitle(row)}>
                          <span>{row.label}</span>
                          <strong>{row.value}</strong>
                        </div>
                      ))}
                    </div>
                    <div>
                      <h4>随身物品</h4>
                      {playerProfileModel.inventoryRows.length === 0 ? <p className="muted">暂无携物</p> : (
                        <div className="player-profile-row-stack">
                          {playerProfileModel.inventoryRows.map((row) => (
                            <div key={`${row.label}-${row.value}`} className="player-profile-row" title={profileRowTitle(row)}>
                              <span>{row.label}</span>
                              <strong>{row.value}</strong>
                              {row.detail && <small>{row.detail}</small>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>
                )}

              </div>
              </div>
            </section>
          </div>
        )}
        {activeSystemPanel === 'memories' && (
          <MemoryPanel
            sections={playerProfileModel.memorySections}
            recall={runtimeState.turnLog[runtimeState.turnLog.length - 1]?.displayMeta?.memoryRecall}
            onClose={() => setActiveSystemPanel(null)}
          />
        )}
        {activeSystemPanel === 'npcs' && npcPanelModel && (
          <div className="system-modal-backdrop" role="presentation" onClick={() => setActiveSystemPanel(null)}>
            <section
              className="system-modal ui-system-workspace npc-panel-modal"
              data-testid="npc-panel"
              role="dialog"
              aria-label="人物志"
              onClick={(event) => event.stopPropagation()}
            >
              <SystemModalHeader title="人物志" subtitle="人物档案" onClose={() => setActiveSystemPanel(null)} />

              <div className="npc-panel-summary">
                <span>已记录 <strong>{npcPanelModel.totalCount}</strong></span>
                <span>在场 <strong>{npcPanelModel.presentCount}</strong></span>
                <span>关注 <strong>{npcPanelModel.focusedCount}</strong></span>
                <span>当前显示 <strong>{npcPanelModel.visibleCount}</strong></span>
              </div>

              {npcPanelModel.cards.length === 0 ? (
                <p className="npc-panel-empty">
                  暂无已记录人物。后续回合由 LLM 通过人物档案写回后，NPC 会出现在这里。
                </p>
              ) : (
                <div className="npc-archive-layout">
                  <aside className="npc-roster-panel" aria-label="人物名单">
                  <div className="npc-roster-head">
                      <span>人物名单</span>
                      <strong>{npcPanelModel.visibleCount}/{npcPanelModel.totalCount}</strong>
                    </div>
                    <input
                      className="npc-roster-search"
                      type="search"
                      value={npcSearchText}
                      onChange={(event) => {
                        setNpcSearchText(event.target.value);
                        setSelectedNpcId(null);
                      }}
                      placeholder="搜索姓名/称呼/身份/地点/势力..."
                    />
                    <div className="npc-roster-tools">
                      <button
                        type="button"
                        className={npcOnlyFocused ? 'active' : ''}
                        onClick={() => {
                          setNpcOnlyFocused((value) => !value);
                          setSelectedNpcId(null);
                        }}
                      >
                        仅重要NPC
                      </button>
                      <button
                        type="button"
                        className={npcGroupByLocation ? 'active' : ''}
                        onClick={() => setNpcGroupByLocation((value) => !value)}
                      >
                        按地点分组
                      </button>
                    </div>

                    {npcPanelModel.rosterGroups.length === 0 ? (
                      <p className="npc-roster-empty">没有匹配的人物。</p>
                    ) : (
                      <div className="npc-roster-list">
                        {npcPanelModel.rosterGroups.map((group) => (
                          <div key={group.title} className="npc-roster-group">
                            {npcGroupByLocation && <div className="npc-roster-group-title">{group.title}</div>}
                            {group.items.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                className={`npc-roster-card ${selectedNpcCard?.id === item.id ? 'active' : ''} ${item.isPresent ? 'present' : ''} ${item.hasUnreadPresence ? 'has-unread-presence' : ''}`}
                                onClick={() => handleNpcSelect(item.id)}
                              >
                                <span className="npc-roster-avatar">{item.avatarText}</span>
                                <span className="npc-roster-main">
                                  <strong>
                                    {item.name}
                                    {item.hasUnreadPresence && <span className="npc-presence-dot" title="有新的近况" />}
                                  </strong>
                                  <small>{item.roleText}</small>
                                  <small className="npc-roster-location">{item.locationText || '地点未明'}</small>
                                  <em>{item.relationPreview}</em>
                                </span>
                                <span className="npc-roster-side">
                                  <span className={`npc-presence ${item.isPresent ? 'present' : 'away'}`}>{item.presenceText}</span>
                                  {item.isFocused && <span className="npc-focus-mark">关注</span>}
                                  <span className="npc-contact-score">往来 {item.contactLevel}</span>
                                </span>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </aside>

                  <article className="npc-detail-panel" aria-label="人物详情">
                    {!selectedNpcCard ? (
                      <p className="npc-detail-empty">请选择左侧人物。</p>
                    ) : (
                      <div className="npc-detail-layout">
                        <div className="npc-detail-main">
                          <header className="npc-detail-hero">
                            <div className="npc-detail-avatar">{selectedNpcRosterItem?.avatarText ?? selectedNpcCard.name[0]}</div>
                            <div className="npc-detail-hero-info">
                               <div className="npc-detail-title-line">
                                 <h3>{selectedNpcCard.name}</h3>
                                 {selectedNpcCard.subtitle && <p>{selectedNpcCard.subtitle}</p>}
                                 <button
                                   type="button"
                                   className="npc-delete-profile-button"
                                   disabled={isProcessing || isMemorySummaryProcessing || isDeletingNpc}
                                   title="删除前会检查部队、事项、领地和关系线等实时引用"
                                   onClick={() => requestNpcDeletion(selectedNpcCard.id)}
                                 >
                                   删除人物
                                 </button>
                               </div>
                              <div className="npc-detail-location-line">
                                <span>所在地点</span>
                                <strong>{selectedNpcRosterItem?.locationText || '地点未明'}</strong>
                              </div>
                              <div className="npc-detail-badges">
                                <span className={`npc-presence ${selectedNpcCard.isPresent ? 'present' : 'away'}`}>
                                  {selectedNpcCard.isPresent ? '在场中' : '未在场'}
                                </span>
                                {selectedNpcCard.statusBadges
                                  .filter((badge) => badge !== '在场' && badge !== '关注')
                                  .map((badge) => <span key={badge}>{badge}</span>)}
                                {selectedNpcCard.isFocused && <span>关注</span>}
                              </div>
                            </div>
                          </header>

                          <div className="npc-detail-overview-grid">
                            {selectedNpcCard.overviewRows.map((row) => (
                              <div key={`${selectedNpcCard.id}-overview-${row.label}`} title={row.detail}>
                                <span>{row.label}</span>
                                <strong>{row.value}</strong>
                                {row.detail && <small>{row.detail}</small>}
                              </div>
                            ))}
                          </div>

                          <div className="npc-relation-panel">
                            <div>
                              <span>往来度</span>
                              <strong>{selectedNpcCard.contactLevel}</strong>
                            </div>
                            <div>
                              <span>近况态度</span>
                              <strong>{selectedNpcCard.recentAttitude}</strong>
                            </div>
                            <p>{selectedNpcCard.relation}</p>
                          </div>

                          {selectedNpcCard.presenceUpdates.length > 0 && (
                            <section className="npc-card-section npc-presence-updates-section">
                              <h4>近况</h4>
                              <div className="npc-presence-update-list">
                                {selectedNpcCard.presenceUpdates.map((update) => (
                                  <div
                                    key={`${selectedNpcCard.id}-presence-${update.id}`}
                                    className={`npc-presence-update-item ${update.readByPlayer ? '' : 'unread'}`}
                                  >
                                    {update.meta && <span>{update.meta}</span>}
                                    <p>{update.summary}</p>
                                  </div>
                                ))}
                              </div>
                            </section>
                          )}

                          {selectedNpcCard.identityRows.length > 0 && (
                            <section className="npc-card-section">
                              <h4>身份</h4>
                              <div className="npc-row-grid">
                                {selectedNpcCard.identityRows.map((row) => (
                                  <div key={`${selectedNpcCard.id}-identity-${row.label}-${row.value}`} className="npc-info-row" title={row.detail}>
                                    <span>{row.label}</span>
                                    <strong>{row.value}</strong>
                                    {row.detail && <small>{row.detail}</small>}
                                  </div>
                                ))}
                              </div>
                            </section>
                          )}

                          {selectedNpcCard.descriptionRows.length > 0 && (
                            <section className="npc-card-section">
                              <h4>人物</h4>
                              {selectedNpcCard.descriptionRows.map((row) => (
                                <div key={`${selectedNpcCard.id}-desc-${row.label}-${row.value}`} className="npc-note-row">
                                  <span>{row.label}</span>
                                  <p>{row.value}</p>
                                </div>
                              ))}
                            </section>
                          )}

                          {selectedNpcCard.abilityRows.length > 0 && (
                            <section className="npc-card-section">
                              <h4>能力</h4>
                              <div className="npc-ability-grid">
                                {selectedNpcCard.abilityRows.map((row) => (
                                  <div key={`${selectedNpcCard.id}-ability-${row.label}`} className="npc-ability-row">
                                    <span>{row.label}</span>
                                    <strong>{row.value}</strong>
                                  </div>
                                ))}
                              </div>
                            </section>
                          )}

                          {(selectedNpcCard.uniqueArtChips.length > 0 || selectedNpcCard.traitChips.length > 0 || selectedNpcCard.effectLabels.length > 0) && (
                            <section className="npc-card-section">
                              <h4><span className="trait-help-label" title={TRAIT_RARITY_LEGEND_TITLE}>特质</span>与状态</h4>
                              <div className="npc-chip-row">
                                {selectedNpcCard.uniqueArtChips.map((art) => (
                                  <span
                                    key={`${selectedNpcCard.id}-unique-art-${art.id}`}
                                    className={`npc-trait-chip unique-art rarity-${normalizeUniqueArtRarity(art.rarity)}`}
                                    title={art.title}
                                  >
                                    {art.label}
                                  </span>
                                ))}
                                {selectedNpcCard.traitChips.map((trait) => (
                                  <span
                                    key={`${selectedNpcCard.id}-trait-${trait.id}`}
                                    className={`npc-trait-chip rarity-${trait.rarity}`}
                                    title={trait.title}
                                  >
                                    {trait.label}
                                  </span>
                                ))}
                                {selectedNpcCard.effectLabels.map((label) => (
                                  <span
                                    key={`${selectedNpcCard.id}-effect-${label}`}
                                    className="npc-effect-chip"
                                    title={label}
                                  >
                                    {label}
                                  </span>
                                ))}
                              </div>
                            </section>
                          )}

                          {selectedNpcCard.femaleProfile && (
                            <details className="npc-card-section npc-female-profile-section npc-female-profile-disclosure">
                              <summary className="npc-female-profile-summary">
                                <span>女性档案</span>
                                {selectedNpcHasAdultPrivateContent && <small>含香闺秘档</small>}
                              </summary>
                              <div className="npc-female-profile-disclosure-body">
                                {selectedNpcCard.femaleProfile.sections.map((section) => (
                                  <div key={`${selectedNpcCard.id}-female-section-${section.title}`} className={`npc-female-profile-subsection ${section.kind ? `npc-female-profile-subsection-${section.kind}` : ''}`}>
                                    <h5>{section.title}</h5>
                                    <div className="npc-female-profile-grid">
                                      {section.rows.map((row) => (
                                        <div key={`${selectedNpcCard.id}-female-${section.title}-${row.label}-${row.value}`} className="npc-info-row npc-female-profile-row" title={row.detail}>
                                          <span>{row.label}</span>
                                          <strong>{row.value}</strong>
                                          {row.detail && <small>{row.detail}</small>}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                                {selectedNpcHasAdultPrivateContent && (
                                  <div className="npc-adult-private-profile">
                                    <div className="npc-adult-private-profile-head">
                                      <h5>香闺秘档</h5>
                                      <span>TOP SECRET</span>
                                    </div>
                                    {selectedNpcCard.femaleProfile.adultPrivateAnchorRows.length > 0 && (
                                      <div className="npc-secret-body-grid">
                                        {selectedNpcCard.femaleProfile.adultPrivateAnchorRows.map((row) => (
                                          <article key={`${selectedNpcCard.id}-secret-body-${row.label}`} className="npc-secret-body-card" title={row.detail}>
                                            <header>
                                              <strong>{row.label}</strong>
                                              <span>无图</span>
                                            </header>
                                            <p>{row.value}</p>
                                          </article>
                                        ))}
                                      </div>
                                    )}

                                    {selectedNpcCard.femaleProfile.adultPrivatePreferenceRows.length > 0 && (
                                      <div className="npc-secret-preference-grid">
                                        {selectedNpcCard.femaleProfile.adultPrivatePreferenceRows.map((row) => (
                                          <div key={`${selectedNpcCard.id}-secret-preference-${row.label}`} className="npc-secret-preference-card" title={row.detail}>
                                            <span>{row.label}</span>
                                            <strong>{row.value}</strong>
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    {selectedNpcCard.femaleProfile.adultPrivateSections
                                      .filter((section) => section.kind === 'womb')
                                      .map((section) => {
                                        const status = section.rows.find((row) => row.label === '状态');
                                        const otherRows = section.rows.filter((row) => row.label !== '状态');
                                        return (
                                          <div key={`${selectedNpcCard.id}-adult-private-womb`} className="npc-secret-womb-card">
                                            <header>
                                              <h5>子宫档案</h5>
                                              {status && <span>STATUS：{status.value}</span>}
                                            </header>
                                            <div className="npc-secret-womb-rows">
                                              {otherRows.map((row) => (
                                                <div key={`${selectedNpcCard.id}-adult-private-womb-${row.label}`} className="npc-secret-womb-row" title={row.detail}>
                                                  <span>{row.label}</span>
                                                  <strong>{row.value}</strong>
                                                </div>
                                              ))}
                                            </div>
                                            {selectedNpcAllPrivateRecords.length > 0 && (
                                              <div className="npc-secret-record-section">
                                                <div className="npc-secret-record-head">
                                                  <div>
                                                    <span>内射记录</span>
                                                    <small>本地共 {selectedNpcAllPrivateRecords.length} 条</small>
                                                  </div>
                                                  <label className="npc-private-record-limit">
                                                    <span>显示</span>
                                                    <select
                                                      aria-label="内射记录显示数量"
                                                      value={npcPrivateRecordDisplayLimit}
                                                      onChange={(event) => {
                                                        const value = event.target.value;
                                                        setNpcPrivateRecordDisplayLimit(value === 'all' ? 'all' : value === '20' ? 20 : 10);
                                                      }}
                                                    >
                                                      <option value="10">10条</option>
                                                      <option value="20">20条</option>
                                                      <option value="all">全部</option>
                                                    </select>
                                                  </label>
                                                </div>
                                                <div className="npc-secret-record-scroll" data-testid="npc-private-record-scroll">
                                                  {selectedNpcPrivateRecords.map((record) => (
                                                    <article key={record.id} className="npc-secret-record-entry">
                                                      <time>{record.date}</time>
                                                      <p>{record.description}</p>
                                                      {record.pregnancyCheckDate && (
                                                        <small>怀孕判定日：{record.pregnancyCheckDate}</small>
                                                      )}
                                                    </article>
                                                  ))}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}

                                    {selectedNpcCard.femaleProfile.adultPrivateSections
                                      .filter((section) => !['privateAnchor', 'bodyParts', 'preferences', 'womb'].includes(section.kind ?? ''))
                                      .map((section) => (
                                        <div key={`${selectedNpcCard.id}-adult-private-section-${section.title}`} className={`npc-female-profile-subsection ${section.kind ? `npc-female-profile-subsection-${section.kind}` : ''}`}>
                                          <h5>{section.title}</h5>
                                          <div className="npc-female-profile-grid">
                                            {section.rows.map((row) => (
                                              <div key={`${selectedNpcCard.id}-adult-private-${section.title}-${row.label}-${row.value}`} className="npc-info-row npc-adult-private-row" title={row.detail}>
                                                <span>{row.label}</span>
                                                <strong>{row.value}</strong>
                                                {row.detail && <small>{row.detail}</small>}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      ))}
                                  </div>
                                )}
                              </div>
                            </details>
                          )}

                          {selectedNpcCard.equipmentRows.length > 0 && (
                            <section className="npc-card-section">
                              <h4>装备</h4>
                              <div className="npc-row-grid npc-info-grid">
                                {selectedNpcCard.equipmentRows.map((row, index) => (
                                  <div key={row.id ?? `${selectedNpcCard.id}-equipment-${row.label}-${row.value}-${index}`} className="npc-info-row" title={row.detail}>
                                    <span>{row.label}</span>
                                    <strong>{row.value}</strong>
                                    {row.detail && <small>{row.detail}</small>}
                                  </div>
                                ))}
                              </div>
                            </section>
                          )}

                          {selectedNpcCard.inventoryRows.length > 0 && (
                            <section className="npc-card-section">
                              <h4>携物</h4>
                              <div className="npc-row-grid npc-info-grid">
                                {selectedNpcCard.inventoryRows.map((row, index) => (
                                  <div key={row.id ?? `${selectedNpcCard.id}-inventory-${row.label}-${row.value}-${index}`} className="npc-info-row" title={row.detail}>
                                    <span>{row.label}</span>
                                    <strong>{row.value}</strong>
                                    {row.detail && <small>{row.detail}</small>}
                                  </div>
                                ))}
                              </div>
                            </section>
                          )}

                          {selectedNpcCard.memoryLayers.some((layer) => layer.entries.length > 0) && selectedNpcMemoryLayer && (
                            <section className="npc-card-section npc-memory-workspace">
                              <div className="npc-memory-section-head">
                                <h4>记忆</h4>
                                <small>{selectedNpcMemoryLayer.description}</small>
                              </div>
                              <div className="npc-memory-tabs" role="tablist" aria-label={`${selectedNpcCard.name}的记忆层级`}>
                                {selectedNpcCard.memoryLayers.map((layer) => (
                                  <button
                                    key={`${selectedNpcCard.id}-memory-tab-${layer.key}`}
                                    type="button"
                                    role="tab"
                                    aria-selected={layer.key === selectedNpcMemoryLayer.key}
                                    className={layer.key === selectedNpcMemoryLayer.key ? 'active' : ''}
                                    data-testid={`npc-memory-tab-${layer.key}`}
                                    onClick={() => setActiveNpcMemoryLayer(layer.key)}
                                  >
                                    <span>{layer.label}</span>
                                    <strong>{layer.entries.length}</strong>
                                  </button>
                                ))}
                              </div>
                              <div
                                className="npc-memory-list npc-memory-layer-list"
                                role="tabpanel"
                                data-testid={`npc-memory-layer-${selectedNpcMemoryLayer.key}`}
                                tabIndex={0}
                              >
                                {selectedNpcMemoryLayer.entries.length === 0 ? (
                                  <p className="npc-memory-empty">此层级尚未形成记忆。</p>
                                ) : selectedNpcMemoryLayer.entries.map((memory) => (
                                  <article key={`${selectedNpcCard.id}-memory-${selectedNpcMemoryLayer.key}-${memory.id}`}>
                                    <span>{memory.meta}</span>
                                    <p>{memory.content}</p>
                                    {memory.detail && <small>{memory.detail}</small>}
                                  </article>
                                ))}
                              </div>
                            </section>
                          )}
                        </div>

                      </div>
                    )}
                  </article>
                </div>
              )}
            </section>
          </div>
         )}

        {pendingNpcDeletion && (
          <div
            className="modal-backdrop npc-delete-confirm-backdrop"
            role="presentation"
            onClick={() => {
              if (!isDeletingNpc) setPendingNpcDeletion(null);
            }}
          >
            <section
              className="confirm-modal npc-delete-confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-label={`删除人物 ${pendingNpcDeletion.npcName || pendingNpcDeletion.npcId}`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="confirm-modal-head">
                <span>确认删除人物</span>
                <button
                  type="button"
                  className="save-modal-close"
                  disabled={isDeletingNpc}
                  onClick={() => setPendingNpcDeletion(null)}
                >
                  {'\u2715'}
                </button>
              </div>
              <div className="confirm-modal-body">
                {pendingNpcDeletion.exists ? (
                  <>
                    <p>
                      确定要从人物志删除“{pendingNpcDeletion.npcName}”吗？人物档案、记忆和个人行装会一并移除，
                      既有正文与历史战报不会改写。此操作不可恢复。
                    </p>
                    {pendingNpcDeletion.blockers.length > 0 && (
                      <div className="npc-delete-blockers" role="alert">
                        <strong>当前不能删除，仍有实时引用：</strong>
                        <ul>
                          {pendingNpcDeletion.blockers.map((blocker) => (
                            <li key={`${blocker.kind}-${blocker.sourceId}`}>{blocker.label}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : (
                  <p>该人物已经不存在，无需再次删除。</p>
                )}
              </div>
              <div className="confirm-modal-footer">
                <button
                  type="button"
                  className="nav-btn"
                  disabled={isDeletingNpc}
                  onClick={() => setPendingNpcDeletion(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="nav-btn danger"
                  disabled={!pendingNpcDeletion.canDelete || isDeletingNpc}
                  onClick={() => void handleConfirmNpcDeletion()}
                >
                  {isDeletingNpc ? '正在删除…' : '确认删除'}
                </button>
              </div>
            </section>
          </div>
        )}

        {pendingHoldingDeletion && (
          <div
            className="modal-backdrop holding-delete-confirm-backdrop"
            role="presentation"
            onClick={() => {
              if (!isDeletingHolding) setPendingHoldingDeletion(null);
            }}
          >
            <section
              className="confirm-modal holding-delete-confirm-modal"
              data-testid="holding-delete-confirm-modal"
              role="dialog"
              aria-modal="true"
              aria-label={`删除领地 ${pendingHoldingDeletion.analysis.holdingName || pendingHoldingDeletion.analysis.holdingId}`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="confirm-modal-head">
                <span>{pendingHoldingDeletion.step === 1 ? '确认删除领地' : '再次确认删除'}</span>
                <button
                  type="button"
                  className="save-modal-close"
                  disabled={isDeletingHolding}
                  onClick={() => setPendingHoldingDeletion(null)}
                >
                  {'\u2715'}
                </button>
              </div>
              <div className="confirm-modal-body">
                {pendingHoldingDeletion.analysis.exists ? (
                  <>
                    {pendingHoldingDeletion.step === 1 ? (
                      <>
                        <p>
                          是否删除领地“{pendingHoldingDeletion.analysis.holdingName}”？这只会移除本局的领地账本记录，
                          不会删除同名地图地点、驻军部队、NPC、势力、玩家钱粮或既有正文与战报。
                        </p>
                        <ul className="holding-delete-impact-list">
                          <li>
                            随领地一并移除的已结束治理记录：
                            {pendingHoldingDeletion.analysis.removableGovernanceProjectCount} 项
                          </li>
                          <li>
                            保留且不解散的驻军部队：
                            {pendingHoldingDeletion.analysis.preservedGarrisonTroopCount} 支
                          </li>
                        </ul>
                      </>
                    ) : (
                      <p className="holding-delete-final-warning" role="alert">
                        最后确认：删除“{pendingHoldingDeletion.analysis.holdingName}”后，领地账本不能自动恢复。
                        确定这是错误生成或你明确不再需要的领地吗？
                      </p>
                    )}
                    {pendingHoldingDeletion.analysis.blockers.length > 0 && (
                      <div className="holding-delete-blockers" role="alert">
                        <strong>当前不能删除，仍有实时引用：</strong>
                        <ul>
                          {pendingHoldingDeletion.analysis.blockers.map((blocker) => (
                            <li key={`${blocker.kind}-${blocker.sourceId}`}>{blocker.label}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : (
                  <p>该领地已经不存在，无需再次删除。</p>
                )}
              </div>
              <div className="confirm-modal-footer">
                <button
                  type="button"
                  className="nav-btn"
                  disabled={isDeletingHolding}
                  onClick={() => setPendingHoldingDeletion(null)}
                >
                  取消
                </button>
                {pendingHoldingDeletion.step === 1 ? (
                  <button
                    type="button"
                    className="nav-btn danger"
                    data-testid="holding-delete-continue"
                    disabled={!pendingHoldingDeletion.analysis.canDelete || isDeletingHolding}
                    onClick={() => setPendingHoldingDeletion({
                      analysis: analyzeHoldingDeletion(runtimeState, pendingHoldingDeletion.analysis.holdingId),
                      step: 2,
                    })}
                  >
                    继续
                  </button>
                ) : (
                  <button
                    type="button"
                    className="nav-btn danger"
                    data-testid="holding-delete-final"
                    disabled={!pendingHoldingDeletion.analysis.canDelete || isDeletingHolding}
                    onClick={() => void handleConfirmHoldingDeletion()}
                  >
                    {isDeletingHolding ? '正在删除…' : '永久删除'}
                  </button>
                )}
              </div>
            </section>
          </div>
        )}

        {activeSystemPanel === 'heroines' && heroinePanelModel && (
          <div className="system-modal-backdrop" role="presentation" onClick={() => setActiveSystemPanel(null)}>
            <section
              className="system-modal ui-system-workspace strategic-modal relationship-modal"
              data-testid="heroine-panel"
              role="dialog"
              aria-label="红颜"
              onClick={(event) => event.stopPropagation()}
            >
              <SystemModalHeader title="红颜" subtitle="红颜关系" onClose={() => setActiveSystemPanel(null)} />

              <PanelListDetailLayout>
                <aside className="strategic-roster" aria-label="红颜列表">
                  <div className="strategic-roster-head">
                    <span>红颜关系</span>
                    <strong>{heroinePanelModel.rosterItems.length}</strong>
                  </div>
                  {heroinePanelModel.rosterItems.length === 0 ? (
                    <PanelEmptyState>暂无红颜关系记录</PanelEmptyState>
                  ) : (
                    heroinePanelModel.rosterItems.map((thread) => (
                      <button
                        key={thread.id}
                        type="button"
                        className={`strategic-roster-item ${heroinePanelModel.selectedThreadId === thread.id ? 'is-active' : ''}`}
                        onClick={() => setSelectedHeroineThreadId(thread.id)}
                      >
                        <span>{thread.name}</span>
                        <small>{thread.stage}</small>
                        <em>{thread.summary}</em>
                        <strong>{relationshipStatusLabels[thread.status] ?? thread.status}</strong>
                      </button>
                    ))
                  )}
                </aside>

                <section className="strategic-detail" aria-label="红颜详情">
                  {selectedHeroineThread ? (
                    <>
                      <div className="strategic-detail-head">
                        <div>
                          <h4>{selectedHeroineThread.npcName}</h4>
                          <small>{selectedHeroineThread.stage}</small>
                        </div>
                        <span>{relationshipStatusLabels[selectedHeroineThread.status] ?? selectedHeroineThread.status}</span>
                      </div>
                      <p className="strategic-detail-summary">{selectedHeroineThread.summary}</p>
                      {selectedHeroineThread.tags && selectedHeroineThread.tags.length > 0 && (
                        <div className="relationship-chip-list" aria-label="红颜标签">
                          {selectedHeroineThread.tags.map((tag, index) => (
                            <span key={`${tag}-${index}`} className="relationship-chip">{tag}</span>
                          ))}
                        </div>
                      )}
                      <div className="strategic-detail-grid">
                        {heroineDetailRows.map(([label, value]) => (
                          <div key={label}>
                            <span>{label}</span>
                            <strong>{value}</strong>
                          </div>
                        ))}
                      </div>
                      {heroinePanelModel.latestKnownUpdate && (
                        <div className="strategic-detail-notes">
                          <span>最后获知近况</span>
                          <p>{heroinePanelModel.latestKnownUpdate.summary}</p>
                          <small>{heroinePanelModel.latestKnownUpdate.createdAt} · {heroinePanelModel.latestKnownUpdate.source}</small>
                        </div>
                      )}
                      {selectedHeroineThread.milestones && selectedHeroineThread.milestones.length > 0 && (
                        <div className="strategic-detail-notes">
                          <span>阶段节点</span>
                          <ul>
                            {selectedHeroineThread.milestones.map((milestone) => (
                              <li key={milestone.milestoneId}>
                                <strong>{milestone.happenedAt}</strong>
                                <span>：{milestone.summary}</span>
                                {milestone.source && <small>（{formatKnownSourceLabel(milestone.source)}）</small>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <PanelEmptyState>暂无红颜详情</PanelEmptyState>
                  )}
                </section>
              </PanelListDetailLayout>
            </section>
          </div>
        )}

        {activeSystemPanel === 'bonds' && bondPanelModel && (
          <div className="system-modal-backdrop" role="presentation" onClick={() => setActiveSystemPanel(null)}>
            <section
              className="system-modal ui-system-workspace strategic-modal relationship-modal"
              data-testid="bond-panel"
              role="dialog"
              aria-label="羁绊"
              onClick={(event) => event.stopPropagation()}
            >
              <SystemModalHeader title="羁绊" subtitle="关系账本" onClose={() => setActiveSystemPanel(null)} />

              <PanelListDetailLayout>
                <aside className="strategic-roster" aria-label="羁绊列表">
                  <div className="strategic-roster-head">
                    <span>羁绊关系</span>
                    <strong>{bondPanelModel.rosterItems.length}</strong>
                  </div>
                  {bondPanelModel.rosterItems.length === 0 ? (
                    <PanelEmptyState>暂无羁绊关系记录</PanelEmptyState>
                  ) : (
                    bondPanelModel.rosterItems.map((thread) => (
                      <button
                        key={thread.id}
                        type="button"
                        className={`strategic-roster-item ${bondPanelModel.selectedThreadId === thread.id ? 'is-active' : ''}`}
                        onClick={() => setSelectedBondThreadId(thread.id)}
                      >
                        <span>{thread.title}</span>
                        <small>{bondTypeLabels[thread.bondType] ?? thread.bondType}</small>
                        <em>{thread.summary}</em>
                        <strong>{relationshipStatusLabels[thread.status] ?? thread.status}</strong>
                      </button>
                    ))
                  )}
                </aside>

                <section className="strategic-detail" aria-label="羁绊详情">
                  {selectedBondThread ? (
                    <>
                      <div className="strategic-detail-head">
                        <div>
                          <h4>{selectedBondThread.targetNames.join('、')}</h4>
                          <small>{bondTypeLabels[selectedBondThread.bondType] ?? selectedBondThread.bondType}</small>
                        </div>
                        <span>{relationshipStatusLabels[selectedBondThread.status] ?? selectedBondThread.status}</span>
                      </div>
                      <p className="strategic-detail-summary">{selectedBondThread.summary}</p>
                      {selectedBondThread.tags && selectedBondThread.tags.length > 0 && (
                        <div className="relationship-chip-list" aria-label="羁绊标签">
                          {selectedBondThread.tags.map((tag, index) => (
                            <span key={`${tag}-${index}`} className="relationship-chip">{tag}</span>
                          ))}
                        </div>
                      )}
                      <div className="strategic-detail-grid">
                        {bondDetailRows.map(([label, value]) => (
                          <div key={label}>
                            <span>{label}</span>
                            <strong>{value}</strong>
                          </div>
                        ))}
                      </div>
                      {selectedBondThread.targetNpcIds && selectedBondThread.targetNpcIds.length > 0 && (
                        <div className="strategic-detail-notes">
                          <span>相关人物</span>
                          <p>{selectedBondThread.targetNpcIds.map(resolveNpcLabel).join('、')}</p>
                        </div>
                      )}
                      {bondPanelModel.latestKnownUpdates.length > 0 && (
                        <div className="strategic-detail-notes">
                          <span>最后获知近况</span>
                          <ul>
                            {bondPanelModel.latestKnownUpdates.map(({ npcId, npcName, update }) => (
                              <li key={`${npcId}-${update.id}`}>
                                <strong>{npcName}</strong>
                                <span>：{update.summary}</span>
                                <small>（{update.createdAt} · {update.source}）</small>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {selectedBondThread.milestones && selectedBondThread.milestones.length > 0 && (
                        <div className="strategic-detail-notes">
                          <span>阶段节点</span>
                          <ul>
                            {selectedBondThread.milestones.map((milestone) => (
                              <li key={milestone.milestoneId}>
                                <strong>{milestone.happenedAt}</strong>
                                <span>：{milestone.summary}</span>
                                {milestone.source && <small>（{formatKnownSourceLabel(milestone.source)}）</small>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <PanelEmptyState>暂无羁绊详情</PanelEmptyState>
                  )}
                </section>
              </PanelListDetailLayout>
            </section>
          </div>
        )}

        {activeSystemPanel === 'correspondence' && (
          <CorrespondencePanel
            runtimeState={runtimeState}
            onCommit={commitCorrespondenceState}
            onClose={() => setActiveSystemPanel(null)}
          />
        )}

        {activeSystemPanel === 'map' && (
          <React.Suspense
            fallback={(
              <div className="system-modal-backdrop" role="presentation">
                <section className="system-modal ui-system-workspace map-panel-modal" role="dialog" aria-modal="true" aria-label="局势地图">
                  <SystemModalHeader title="局势地图" subtitle="正在载入地图资源…" onClose={() => setActiveSystemPanel(null)} />
                  <div className="panel-empty-state" role="status">正在载入天下形势…</div>
                </section>
              </div>
            )}
          >
            <LazyMapPanel
              worldBook={worldBook}
              runtimeState={runtimeState}
              onClose={() => setActiveSystemPanel(null)}
            />
          </React.Suspense>
        )}

        {activeSystemPanel === 'backpack' && (
          <div
            className="system-modal-backdrop"
            role="presentation"
            onClick={() => {
              setEquipmentChooserSlot(null);
              setSelectedBackpackItemId(null);
              setPendingInventoryRemoval(null);
              setActiveSystemPanel(null);
            }}
          >
            <section
              className="system-modal ui-system-workspace backpack-modal"
              data-testid="backpack-panel"
              role="dialog"
              aria-label="背包"
              onClick={(event) => event.stopPropagation()}
            >
              <SystemModalHeader
                title="随身背包"
                subtitle="装备、钱财与物品"
                onClose={() => {
                  setEquipmentChooserSlot(null);
                  setSelectedBackpackItemId(null);
                  setPendingInventoryRemoval(null);
                  setActiveSystemPanel(null);
                }}
              />
              {equipmentChooserSlot && (
                <div className="backpack-equip-target">
                  <div>
                    <span>正在选择</span>
                    <strong>{equipmentChooserSlot.label}</strong>
                  </div>
                  <div className="backpack-equip-target-actions">
                    {equipmentChooserItem && (
                      <button
                        type="button"
                        className="backpack-unequip-button"
                        onClick={() => handleUnequipInventoryItem(
                          equipmentChooserItem.id,
                          equipmentChooserItem.slot,
                          equipmentChooserItem.name,
                          equipmentChooserSlot.treasureIndex,
                        )}
                      >
                        卸下当前装备
                      </button>
                    )}
                    <button type="button" onClick={() => setEquipmentChooserSlot(null)}>取消</button>
                  </div>
                </div>
              )}
              <div className="backpack-summary-grid">
                {backpackPanelModel.summaryRows.map((row) => (
                  <div key={`${row.label}-${row.value}`}>
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
              <div className="backpack-grid">
                <aside className="backpack-sidebar">
                  <div className="backpack-money-row">
                    <span>钱财</span>
                    <strong>{moneyText}</strong>
                  </div>
                  <div className="backpack-category-list" aria-label="背包分类">
                    {backpackPanelModel.categories.map((category) => (
                      <button
                        key={category.key}
                        type="button"
                        className={`backpack-category-button ${activeBackpackCategory === category.key ? 'is-active' : ''}`}
                        onClick={() => {
                          setActiveBackpackCategory(category.key);
                          setSelectedBackpackItemId(null);
                        }}
                      >
                        <span>{category.label}</span>
                        <strong>{category.count}</strong>
                      </button>
                    ))}
                  </div>
                </aside>
                <div className="backpack-main">
                  <div className="backpack-item-grid">
                    {displayedBackpackItems.length === 0 ? (
                      <p className="backpack-empty">
                        {equipmentChooserSlot ? `背包中暂无可替换到${equipmentChooserSlot.label}的物品。` : '该分类暂无物品。'}
                      </p>
                    ) : displayedBackpackItems.map((item) => {
                      const targetSlot = equipmentChooserSlot?.slot ?? item.equipSlot;
                      const targetTreasureIndex = equipmentChooserSlot?.slot === 'treasure' ? equipmentChooserSlot.treasureIndex : undefined;
                      const slotMismatch = Boolean(equipmentChooserSlot && item.equipSlot !== equipmentChooserSlot.slot);
                      const canEquipThisItem = Boolean(item.canEquip && targetSlot && !slotMismatch && !item.isEquipped);
                      return (
                        <article
                          key={item.id}
                          className={`backpack-item-card quality-${item.qualityTone} ${selectedBackpackItemId === item.id ? 'is-selected' : ''} ${item.isEquipped ? 'is-equipped' : ''}`}
                          title={item.detailTitle}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedBackpackItemId(item.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelectedBackpackItemId(item.id);
                            }
                          }}
                        >
                          <div className="backpack-item-visual">
                            <span className="backpack-item-icon" aria-hidden="true">
                              {renderBackpackItemIcon(item.iconLabel)}
                            </span>
                            {item.isEquipped && <em className="backpack-equipped-corner">装</em>}
                            {item.quantity > 1 && <span className="backpack-quantity-corner">x{item.quantity}</span>}
                          </div>
                          <strong className="backpack-item-name">{item.name}</strong>
                          {item.qualityLabel && <span className="backpack-item-quality">{item.qualityLabel}</span>}
                          {item.canUse && !equipmentChooserSlot && (
                            <button
                              type="button"
                              className="backpack-card-use-button"
                              aria-label={`使用物品：${item.name}${item.useEffectText ? `，${item.useEffectText}` : ''}`}
                              title={item.useEffectText ? `立即使用 · ${item.useEffectText}` : '立即使用'}
                              disabled={
                                Boolean(usingBackpackItemId)
                                || isProcessing
                                || isMemorySummaryProcessing
                              }
                              onKeyDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleUseRestorativeItem(item.id);
                              }}
                            >
                              {usingBackpackItemId === item.id ? '使用中…' : '使用'}
                            </button>
                          )}
                          {item.canEquip && targetSlot && (
                            <button
                              type="button"
                              className="backpack-equip-button"
                              disabled={item.isEquipped ? false : !canEquipThisItem}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (item.isEquipped) {
                                  handleUnequipInventoryItem(item.id, item.equipSlot, item.name);
                                } else {
                                  handleEquipInventoryItem(item.id, targetSlot, targetTreasureIndex);
                                }
                                setSelectedBackpackItemId(null);
                              }}
                            >
                              {item.isEquipped ? '卸下' : slotMismatch ? '槽位不符' : equipmentChooserSlot ? '换上' : '装备'}
                            </button>
                          )}
                        </article>
                      );
                    })}
                  </div>
                  {selectedBackpackItem && (
                    <aside className={`backpack-item-detail quality-${selectedBackpackItem.qualityTone}`}>
                      <div>
                        <span className="backpack-item-icon" aria-hidden="true">
                          {renderBackpackItemIcon(selectedBackpackItem.iconLabel)}
                        </span>
                        <strong>{selectedBackpackItem.name}</strong>
                        {selectedBackpackItem.quantity > 1 && <em>x{selectedBackpackItem.quantity}</em>}
                      </div>
                      <p>{selectedBackpackItem.description ?? '暂无说明。'}</p>
                      <small>
                        {selectedBackpackItem.qualityLabel ?? selectedBackpackItem.categoryLabel}
                        {selectedBackpackItem.isEquipped ? ` · 已装备${selectedBackpackItem.equippedSlotLabel ? `：${selectedBackpackItem.equippedSlotLabel}` : ''}` : ''}
                        {selectedBackpackItem.canEquip ? ' · 可装备' : ''}
                        {selectedBackpackItem.useEffectText ? ` · ${selectedBackpackItem.useEffectText}` : ''}
                      </small>
                      {selectedBackpackItem.hasRestorativeUse
                        && !selectedBackpackItem.canUse
                        && selectedBackpackItem.useDisabledReason && (
                          <small className="backpack-use-notice">{selectedBackpackItem.useDisabledReason}</small>
                      )}
                      {!equipmentChooserSlot && (
                        <div className="backpack-item-actions">
                          {selectedBackpackItem.isEquipped && (
                            <button
                              type="button"
                              className="backpack-unequip-button"
                              onClick={() => handleUnequipInventoryItem(
                                selectedBackpackItem.id,
                                selectedBackpackItem.equipSlot,
                                selectedBackpackItem.name,
                              )}
                            >
                              卸下装备
                            </button>
                          )}
                          {selectedBackpackItem.hasRestorativeUse && (
                            <button
                              type="button"
                              className="backpack-use-button"
                              aria-label={`使用物品：${selectedBackpackItem.name}`}
                              title={selectedBackpackItem.useDisabledReason}
                              disabled={
                                !selectedBackpackItem.canUse
                                || Boolean(usingBackpackItemId)
                                || isProcessing
                                || isMemorySummaryProcessing
                              }
                              onClick={() => void handleUseRestorativeItem(selectedBackpackItem.id)}
                            >
                              {usingBackpackItemId === selectedBackpackItem.id ? '正在使用…' : '直接使用'}
                            </button>
                          )}
                          <button
                            type="button"
                            className="backpack-remove-button"
                            aria-label={`移除物品：${selectedBackpackItem.name}`}
                            onClick={() => setPendingInventoryRemoval(selectedBackpackItem)}
                          >
                            移除物品
                          </button>
                        </div>
                      )}
                    </aside>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}

        {pendingInventoryRemoval && (
          <div
            className="inventory-removal-backdrop"
            role="presentation"
            onClick={() => setPendingInventoryRemoval(null)}
          >
            <section
              className="confirm-modal inventory-removal-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-label="确认移除物品"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="confirm-modal-head">
                <span>确认移除物品</span>
                <button
                  type="button"
                  className="save-modal-close"
                  aria-label="关闭移除确认"
                  onClick={() => setPendingInventoryRemoval(null)}
                >
                  ×
                </button>
              </div>
              <div className="confirm-modal-body inventory-removal-copy">
                <p>确定从背包移除「{pendingInventoryRemoval.name}」吗？此操作会立即保存。</p>
                {pendingInventoryRemoval.isKeyItem && (
                  <p className="inventory-removal-warning">这是关键物品，移除后可能影响后续剧情。</p>
                )}
                {pendingInventoryRemoval.isEquipped && (
                  <p className="inventory-removal-warning">该物品已装备，移除后会同时清空对应装备槽。</p>
                )}
              </div>
              <div className="confirm-modal-footer">
                <button type="button" className="nav-btn" onClick={() => setPendingInventoryRemoval(null)}>取消</button>
                <button type="button" className="nav-btn danger" onClick={handleConfirmInventoryRemoval}>确认移除</button>
              </div>
            </section>
          </div>
        )}

        {activeSystemPanel === 'factions' && factionPanelModel && (
          <div className="system-modal-backdrop" role="presentation" onClick={() => setActiveSystemPanel(null)}>
            <section
              className="system-modal ui-system-workspace strategic-modal strategic-modal--factions"
              data-testid="faction-panel"
              role="dialog"
              aria-label="势力"
              onClick={(event) => event.stopPropagation()}
            >
              <SystemModalHeader title="势力" subtitle="势力账本" onClose={() => setActiveSystemPanel(null)} />

              <PanelListDetailLayout>
                <aside className="strategic-roster" aria-label="势力列表">
                  <div className="strategic-roster-head">
                    <span>已知势力</span>
                    <strong>{factionPanelModel.rosterItems.length}</strong>
                  </div>
                  {factionPanelModel.rosterItems.length === 0 ? (
                    <PanelEmptyState>暂无已知势力记录</PanelEmptyState>
                  ) : factionPanelModel.rosterItems.map((faction) => (
                    <button
                      key={faction.factionId}
                      type="button"
                      className={`strategic-roster-item ${factionPanelModel.selectedFactionId === faction.factionId ? 'is-active' : ''}`}
                      onClick={() => setSelectedFactionId(faction.factionId)}
                    >
                      <span>{faction.name}</span>
                      <small>{faction.type}</small>
                      <em>{faction.stanceToPlayer}</em>
                      <strong>{faction.knownLevel}</strong>
                    </button>
                  ))}
                </aside>

                <section className="strategic-detail" aria-label="势力详情">
                  {selectedFaction ? (
                    <>
                      <div className="strategic-detail-head">
                        <div>
                          <h4>{selectedFaction.name}</h4>
                          <small>{factionPanelModel.rosterItems.find((item) => item.factionId === selectedFaction.factionId)?.type ?? '势力'}</small>
                        </div>
                        <span>{selectedFaction.knownLevel}</span>
                      </div>
                      <p className="strategic-detail-summary">{selectedFaction.summary}</p>
                      <div className="faction-command-grid" aria-label="势力态势摘要">
                        {factionPanelModel.briefingRows.map((row) => (
                          <div
                            key={row.key}
                            className={`faction-command-card faction-command-card--${row.key} faction-command-card--${row.tone ?? 'normal'}`}
                          >
                            <span>{row.label}</span>
                            <strong>{row.value}</strong>
                          </div>
                        ))}
                      </div>
                      {factionPanelModel.detailSections.filter((section) => section.key !== 'timing').map((section) => (
                        <div key={section.key} className="strategic-detail-section">
                          <span className="strategic-subsection-title">{section.title}</span>
                          <div className="strategic-detail-grid strategic-detail-grid--compact">
                            {section.rows.map(({ label, value }) => (
                              <div key={label}>
                                <span>{label}</span>
                                <strong>{value}</strong>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {factionPanelModel.summaryRows.find((row) => row.label === '情报来源') && (
                        <div className="faction-intel-footnote">
                          <span>情报来源</span>
                          <strong>{factionPanelModel.summaryRows.find((row) => row.label === '情报来源')?.value}</strong>
                        </div>
                      )}
                      {(factionCorePeople.length > 0 || factionKnownMembers.length > 0) && (
                        <div className="strategic-detail-notes">
                          <span>人物</span>
                          {factionCorePeople.length > 0 && (
                            <p>核心人物：{factionCorePeople.join('、')}</p>
                          )}
                          {factionKnownMembers.length > 0 && (
                            <p>已知成员：{factionKnownMembers.join('、')}</p>
                          )}
                        </div>
                      )}
                      {factionRelatedTroops.length > 0 && (
                        <div className="strategic-detail-notes">
                          <span>已知部队</span>
                          <p>{factionRelatedTroops.join('、')}</p>
                        </div>
                      )}
                      {factionRelatedHoldings.length > 0 && (
                        <div className="strategic-detail-notes">
                          <span>相关领地</span>
                          <p>{factionRelatedHoldings.join('、')}</p>
                        </div>
                      )}
                      {factionRelatedMatters.length > 0 && (
                        <div className="strategic-detail-notes">
                          <span>当前事项</span>
                          <p>{factionRelatedMatters.join('、')}</p>
                        </div>
                      )}
                      {factionRelatedSignals.length > 0 && (
                        <div className="strategic-detail-notes">
                          <span>风声线索</span>
                          <p>{factionRelatedSignals.join('、')}</p>
                        </div>
                      )}
                      {factionRelatedChronicles.length > 0 && (
                        <div className="strategic-detail-notes">
                          <span>相关纪事</span>
                          <ul>
                            {factionRelatedChronicles.map((chronicle) => (
                              <li key={chronicle}>{chronicle}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {factionRecentActions.length > 0 && (
                        <div className="strategic-detail-notes faction-action-log">
                          <div className="faction-action-log__head">
                            <div>
                              <span>近期动作记录</span>
                              <small>共 {factionRecentActions.length} 条，最新记录优先</small>
                            </div>
                            <label>
                              <span>显示</span>
                              <select
                                aria-label="近期动作显示条数"
                                value={factionRecentActionDisplayLimit}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setFactionRecentActionDisplayLimit(
                                    value === 'all' ? 'all' : Number(value) as 10 | 20 | 30,
                                  );
                                }}
                              >
                                <option value="10">10 条</option>
                                <option value="20">20 条</option>
                                <option value="30">30 条</option>
                                <option value="all">全部</option>
                              </select>
                            </label>
                          </div>
                          <ol className="faction-action-log__scroll" data-testid="faction-action-log-scroll">
                            {visibleFactionRecentActions.map((action) => (
                              <li key={action.key}>
                                <div className="faction-action-log__meta">
                                  <time>{action.observedAt ?? '时间未详'}</time>
                                  <span data-known-level={action.knownLevel}>{action.knownLevel}</span>
                                </div>
                                <p>{action.summary}</p>
                                {action.sourceNote && <small>来源：{action.sourceNote}</small>}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </>
                  ) : (
                    <PanelEmptyState>暂无势力详情</PanelEmptyState>
                  )}
                </section>
              </PanelListDetailLayout>
            </section>
          </div>
        )}

        {activeSystemPanel === 'holdings' && holdingPanelModel && (
          <div className="system-modal-backdrop" role="presentation" onClick={() => setActiveSystemPanel(null)}>
            <section
              className="system-modal ui-system-workspace strategic-modal strategic-modal--holdings"
              data-testid="holding-panel"
              role="dialog"
              aria-label="领地"
              onClick={(event) => event.stopPropagation()}
            >
              <SystemModalHeader title="领地" subtitle="领地账本" onClose={() => setActiveSystemPanel(null)} />

              <div className="strategic-archive-layout">
                <aside className="strategic-roster" aria-label="领地列表">
                  <div className="holding-tab-list" role="tablist" aria-label="领地分区">
                    {holdingPanelModel.tabs.map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        aria-selected={activeHoldingTab === tab.key}
                        className={`holding-tab-button ${activeHoldingTab === tab.key ? 'is-active' : ''}`}
                        onClick={() => setActiveHoldingTab(tab.key)}
                      >
                        <span>{tab.label}</span>
                        <strong>{tab.count}</strong>
                      </button>
                    ))}
                  </div>

                  {activeHoldingTab !== 'controlledHoldings' && (
                    <p className="holding-tab-hint">
                      选择“控制领地”查看具体城池、营地或辖地详情。
                    </p>
                  )}

                  {activeHoldingTab === 'controlledHoldings' && (
                    <>
                  <div className="strategic-roster-head">
                    <span>掌控领地</span>
                    <strong>{holdingPanelModel.rosterItems.length}</strong>
                  </div>
                  {holdingPanelModel.rosterItems.length === 0 ? (
                    <p className="muted">暂无领地记录。</p>
                  ) : holdingPanelModel.rosterItems.map((holding) => (
                    <button
                      key={holding.holdingId}
                      type="button"
                      className={`strategic-roster-item ${holdingPanelModel.selectedHoldingId === holding.holdingId ? 'is-active' : ''}`}
                      onClick={() => setSelectedHoldingId(holding.holdingId)}
                    >
                      <span>{holding.name}</span>
                      <strong>{holding.statusText}</strong>
                      <small>{holding.subtitle}</small>
                      <em>{holding.scaleText} · {holding.riskText}</em>
                    </button>
                  ))}
                    </>
                  )}
                </aside>

                <section className="strategic-detail" aria-label="领地详情">
                  <div className="holding-resource-grid" aria-label="本势力资源总览">
                    {holdingPanelModel.resourceRows.map((row) => (
                      <div key={row.key}>
                        <span>{row.label}</span>
                        <strong>{row.value}</strong>
                      </div>
                    ))}
                  </div>

                  {activeHoldingTab === 'overview' && (
                    <>
                      <div className="strategic-detail-head">
                        <div>
                          <h4>领地总览</h4>
                          <small>本地年度结算、私产和控制领地的汇总视图。</small>
                        </div>
                      </div>
                      <div className="holding-overview-grid" aria-label="领地总览指标">
                        {holdingPanelModel.overviewRows.map((row) => (
                          <div key={row.label} className={`holding-row-tone-${row.tone ?? 'normal'}`}>
                            <span>{row.label}</span>
                            <strong>{row.value}</strong>
                          </div>
                        ))}
                      </div>
                      {holdingPanelModel.reports[0] && (
                        <article className="holding-report-card holding-latest-report">
                          <div>
                            <strong>{holdingPanelModel.reports[0].title}</strong>
                            <small>{holdingPanelModel.reports[0].settledAt}</small>
                          </div>
                          <p>{holdingPanelModel.reports[0].summary}</p>
                        </article>
                      )}
                    </>
                  )}

                  {activeHoldingTab === 'privateAssets' && (
                    <>
                      <div className="strategic-detail-head">
                        <div>
                          <h4>私人产业</h4>
                          <small>庄园、田产、工坊、马场等长期私产，年度结算时并入势力资源。</small>
                        </div>
                      </div>
                      {holdingPanelModel.privateAssets.length === 0 ? (
                        <p className="muted">暂无私人产业记录。</p>
                      ) : (
                        <div className="holding-private-list">
                          {holdingPanelModel.privateAssets.map((asset) => (
                            <article key={asset.privateAssetId} className="holding-private-card">
                              <div className="holding-private-card-head">
                                <div>
                                  <strong>{asset.name}</strong>
                                  <small>{asset.subtitle}</small>
                                </div>
                                <span>{asset.statusText}</span>
                              </div>
                              <button
                                type="button"
                                className="holding-private-manage-button"
                                aria-pressed={selectedPrivateAsset?.privateAssetId === asset.privateAssetId}
                                onClick={() => setSelectedPrivateAssetId(asset.privateAssetId)}
                              >
                                {selectedPrivateAsset?.privateAssetId === asset.privateAssetId ? '正在经营此产业' : '经营此产业'}
                              </button>
                              <p>{asset.summary}</p>
                              <div className="strategic-detail-grid holding-private-detail-grid">
                                {asset.detailRows.map((row) => (
                                  <div key={`${asset.privateAssetId}-${row.label}`}>
                                    <span>{row.label}</span>
                                    <strong>{row.value}</strong>
                                  </div>
                                ))}
                              </div>
                              {asset.conditionNotes.length > 0 && (
                                <div className="holding-muted-list">
                                  <span>经营状况</span>
                                  <p>{asset.conditionNotes.join('；')}</p>
                                </div>
                              )}
                              {asset.riskNotes.length > 0 && (
                                <div className="holding-muted-list holding-warning-notes">
                                  <span>风险</span>
                                  <p>{asset.riskNotes.join('；')}</p>
                                </div>
                              )}
                              {asset.projectTitles.length > 0 && (
                                <div className="holding-muted-list">
                                  <span>相关工程</span>
                                  <p>{asset.projectTitles.join('、')}</p>
                                </div>
                              )}
                            </article>
                          ))}
                        </div>
                      )}

                      {selectedPrivateAsset && privateAssetManagementPanelModel && (
                        <section className="holding-governance-section" data-testid="private-asset-management-panel" aria-label="私人产业经营">
                          <div className="holding-governance-head">
                            <div>
                              <span className="strategic-subsection-title">经营：{selectedPrivateAsset.name}</span>
                              <p>项目按产业类型开放，使用当前共用钱粮账本；玩家或已登记且在场的产业管事可主持，规模增长受本地硬上限约束。</p>
                            </div>
                            <small>同一产业同时只能进行一项经营</small>
                          </div>

                          {privateAssetManagementPanelModel.activeProject ? (
                            <article className="holding-governance-active-card">
                              <div className="holding-governance-project-head">
                                <div>
                                  <strong>{privateAssetManagementPanelModel.activeProject.title}</strong>
                                  <small>{privateAssetManagementPanelModel.activeProject.timingText}</small>
                                </div>
                                <span>{privateAssetManagementPanelModel.activeProject.progressText}</span>
                              </div>
                              <div className="holding-governance-progress" role="progressbar"
                                aria-valuemin={0} aria-valuemax={100}
                                aria-valuenow={privateAssetManagementPanelModel.activeProject.progressPercent}>
                                <i style={{ width: `${privateAssetManagementPanelModel.activeProject.progressPercent}%` }} />
                              </div>
                              <div className="holding-governance-meta-grid">
                                <div><span>主持</span><strong>{privateAssetManagementPanelModel.activeProject.hostText}</strong></div>
                                <div><span>协助</span><strong>{privateAssetManagementPanelModel.activeProject.assistantText}</strong></div>
                                <div><span>投入</span><strong>{privateAssetManagementPanelModel.activeProject.investmentText}</strong></div>
                                <div><span>风险</span><strong>{privateAssetManagementPanelModel.activeProject.riskText}</strong></div>
                              </div>
                              {privateAssetManagementPanelModel.activeProject.appliedArtNames.length > 0 && (
                                <p className="holding-governance-arts">生效绝艺：{privateAssetManagementPanelModel.activeProject.appliedArtNames.join('、')}</p>
                              )}
                              <div className="holding-governance-effect-list">
                                {privateAssetManagementPanelModel.activeProject.effectRows.map((row) => (
                                  <span key={`private-active-${row.field}`}>{row.label} {row.value}</span>
                                ))}
                              </div>
                              <button type="button" className="holding-governance-cancel-button"
                                disabled={isMutatingPrivateAsset || isProcessing || isMemorySummaryProcessing}
                                onClick={() => {
                                  if (window.confirm('确定取消这项经营吗？已经投入的钱粮不会返还。')) {
                                    void handleCancelPrivateAssetProject(privateAssetManagementPanelModel.activeProject!.projectId);
                                  }
                                }}>
                                取消项目
                              </button>
                            </article>
                          ) : (
                            <div className="holding-governance-builder">
                              <div className="holding-governance-project-options" aria-label="私产经营项目类型">
                                {privateAssetManagementPanelModel.projectOptions.map((option) => (
                                  <button key={option.type} type="button"
                                    aria-pressed={privateAssetManagementPanelModel.selectedType === option.type}
                                    aria-disabled={Boolean(option.disabledReason)}
                                    title={option.disabledReason ?? option.description}
                                    className={`${privateAssetManagementPanelModel.selectedType === option.type ? 'is-active' : ''} ${option.disabledReason ? 'is-disabled' : ''}`}
                                    onClick={() => { if (!option.disabledReason) setSelectedPrivateAssetProjectType(option.type); }}>
                                    <strong>{option.label}</strong>
                                    <small>{option.disabledReason ?? option.description}</small>
                                  </button>
                                ))}
                              </div>
                              <div className="holding-governance-actor-grid">
                                <label><span>主持者</span><select value={privateAssetManagementPanelModel.selectedHostKey}
                                  onChange={(event) => {
                                    setSelectedPrivateAssetHostKey(event.target.value);
                                    if (event.target.value === privateAssetManagementPanelModel.selectedAssistantKey) setSelectedPrivateAssetAssistantKey('');
                                  }}>
                                  {privateAssetManagementPanelModel.actorOptions.map((actor) => (
                                    <option key={`private-host-${actor.key}`} value={actor.key}>{actor.label}｜{actor.subtitle}</option>
                                  ))}
                                </select></label>
                                <label><span>协助者</span><select value={privateAssetManagementPanelModel.selectedAssistantKey}
                                  onChange={(event) => setSelectedPrivateAssetAssistantKey(event.target.value)}>
                                  <option value="">不设协助者</option>
                                  {privateAssetManagementPanelModel.actorOptions
                                    .filter((actor) => actor.key !== privateAssetManagementPanelModel.selectedHostKey)
                                    .map((actor) => <option key={`private-assistant-${actor.key}`} value={actor.key}>{actor.label}｜{actor.subtitle}</option>)}
                                </select>
                                {privateAssetManagementPanelModel.assistantEligibilityHint && <small className="holding-governance-assistant-hint">{privateAssetManagementPanelModel.assistantEligibilityHint}</small>}
                                </label>
                              </div>
                              <article className="holding-governance-preview">
                                <div className="holding-governance-project-head"><div>
                                  <strong>{privateAssetManagementPanelModel.preview.title}</strong>
                                  <small>{privateAssetManagementPanelModel.preview.description}</small>
                                </div><span>风险 {privateAssetManagementPanelModel.preview.riskText}</span></div>
                                <div className="holding-governance-meta-grid">
                                  <div><span>钱财</span><strong>{privateAssetManagementPanelModel.preview.moneyCostText}</strong></div>
                                  <div><span>粮草</span><strong>{privateAssetManagementPanelModel.preview.grainCostText}</strong></div>
                                  <div><span>预计工期</span><strong>{privateAssetManagementPanelModel.preview.durationText}</strong></div>
                                </div>
                                <p className="holding-governance-modifiers">{privateAssetManagementPanelModel.preview.modifierSummary}</p>
                                {privateAssetManagementPanelModel.preview.appliedArtNames.length > 0 && <p className="holding-governance-arts">生效绝艺：{privateAssetManagementPanelModel.preview.appliedArtNames.join('、')}</p>}
                                <div className="holding-governance-effect-list">
                                  {privateAssetManagementPanelModel.preview.effectRows.map((row) => <span key={`private-preview-${row.field}`}>{row.label} {row.value}</span>)}
                                </div>
                              </article>
                              {privateAssetManagementPanelModel.startError && <p className="holding-governance-error">{privateAssetManagementPanelModel.startError}</p>}
                              <button type="button" className="holding-governance-start-button"
                                disabled={!privateAssetManagementPanelModel.canStart || isMutatingPrivateAsset || isProcessing || isMemorySummaryProcessing}
                                onClick={() => void handleStartPrivateAssetProject()}>
                                {isMutatingPrivateAsset ? '正在保存……' : '确认开工'}
                              </button>
                            </div>
                          )}
                        </section>
                      )}

                      <div className="holding-subsection-title">全部私产工程</div>
                      {holdingPanelModel.privateAssetProjects.length === 0 ? (
                        <p className="muted">暂无私产工程。</p>
                      ) : (
                        <div className="holding-project-list">
                          {holdingPanelModel.privateAssetProjects.map((project) => (
                            <article key={project.projectId} className="holding-project-card">
                              <div>
                                <strong>{project.title}</strong>
                                <span>{project.statusText}</span>
                              </div>
                              <p>{project.timingText}</p>
                              <p>{project.investmentText}</p>
                              <p>{project.targetText}</p>
                              {project.notes.length > 0 && <small>{project.notes.join('；')}</small>}
                            </article>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {activeHoldingTab === 'controlledHoldings' && (selectedHolding ? (
                    <>
                      <div className="strategic-detail-head holding-detail-head">
                        <div>
                          <h4>{selectedHolding.name}</h4>
                          <small>{selectedHoldingRosterItem?.subtitle ?? '领地'}</small>
                        </div>
                        <div className="holding-detail-actions">
                          <span>{selectedHoldingRosterItem?.statusText ?? selectedHolding.status}</span>
                          <button
                            type="button"
                            className="holding-delete-button"
                            data-testid="holding-delete-trigger"
                            disabled={
                              isDeletingHolding
                              || isMutatingHoldingGovernance
                              || isProcessing
                              || isMemorySummaryProcessing
                            }
                            onClick={() => requestHoldingDeletion(selectedHolding.holdingId)}
                          >
                            删除领地
                          </button>
                        </div>
                      </div>
                      {!isSelectedHoldingMilitarySite && (
                        <p className="strategic-detail-summary">{selectedHolding.summary}</p>
                      )}

                      <div className={`holding-controlled-layout ${isSelectedHoldingMilitarySite ? 'holding-controlled-layout--military' : ''}`}>
                        <div className={`holding-controlled-top-row ${isSelectedHoldingMilitarySite ? 'holding-controlled-top-row--military' : ''}`}>
                          <div className="holding-controlled-info-stack">
                            {isSelectedHoldingMilitarySite && (
                              <section className="holding-military-overview" aria-label="军事据点概况">
                                <p className="strategic-detail-summary holding-military-summary">{selectedHolding.summary}</p>
                                {holdingAdministrationRows.length > 0 && (
                                  <div className="strategic-detail-grid holding-administration-grid--military">
                                    {holdingAdministrationRows.map((row) => (
                                      <div key={`${row.label}-${row.value}`} className={`holding-row-tone-${row.tone ?? 'normal'}`}>
                                        <span>{row.label}</span>
                                        <strong>{row.value}</strong>
                                        {row.detail && <small>{row.detail}</small>}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </section>
                            )}

                            {holdingPanelModel.collectionRows.length > 0 && (
                              <div className="strategic-detail-section strategic-detail-section--primary">
                                <span className="strategic-subsection-title">理论产出、实征与差额</span>
                                <div className="holding-collection-stack">
                                  {holdingPanelModel.collectionRows.map((row) => (
                                    <div key={`${row.label}-${row.value}`} className={`holding-row-tone-${row.tone ?? 'normal'}`}>
                                      <span>{row.label}</span>
                                      <strong>{row.value}</strong>
                                      {row.detail && <small>{row.detail}</small>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          <ProgressivePanelVisual
                            variant="holding"
                            eligible={shouldLoadHoldingVisualAsset(activeSystemPanel, activeHoldingTab, selectedHoldingVisual?.assetKey)}
                            assetKey={selectedHoldingVisual?.assetKey}
                            loadManifest={loadHoldingVisualManifest}
                            alt=""
                            aria-label={selectedHoldingVisual?.label ?? holdingPanelModel.visualProfile?.caption ?? `${selectedHolding.name} · 领地示意`}
                            data-testid="holding-visual-state"
                          />
                        </div>

                        {holdingSiegeRows.length > 0 && (
                          <div className="holding-siege-section" aria-label="围城与补给态势">
                            <span className="strategic-subsection-title">围城与补给</span>
                            <div className="holding-siege-grid">
                              {holdingSiegeRows.map((row) => (
                                <div key={`${row.label}-${row.value}`} className={`holding-row-tone-${row.tone ?? 'normal'}`}>
                                  <span>{row.label}</span>
                                  <strong>{row.value}</strong>
                                  {row.detail && <small>{row.detail}</small>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="holding-controlled-info-stack holding-controlled-secondary-stack">
                          {holdingPanelModel.landRegisterRows.length > 0 && (
                            <div className="strategic-detail-section">
                              <span className="strategic-subsection-title">田亩户口与豪强</span>
                              <div className="strategic-detail-grid strategic-detail-grid--compact holding-land-register-grid">
                                {holdingPanelModel.landRegisterRows.map((row) => (
                                  <div key={`${row.label}-${row.value}`} className={`holding-row-tone-${row.tone ?? 'normal'}`}>
                                    <span>{row.label}</span>
                                    <strong>{row.value}</strong>
                                    {row.detail && <small>{row.detail}</small>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {!isSelectedHoldingMilitarySite && holdingAdministrationRows.length > 0 && (
                            <div className="strategic-detail-section">
                              <span className="strategic-subsection-title">管辖与行政</span>
                              <div className="strategic-detail-grid strategic-detail-grid--compact">
                                {holdingAdministrationRows.map((row) => (
                                  <div key={`${row.label}-${row.value}`} className={`holding-row-tone-${row.tone ?? 'normal'}`}>
                                    <span>{row.label}</span>
                                    <strong>{row.value}</strong>
                                    {row.detail && <small>{row.detail}</small>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="holding-score-grid" aria-label="领地指标">
                        {holdingPanelModel.scoreRows.map((row) => (
                          <div key={row.label} className={`holding-score-card holding-score-${row.tone ?? 'normal'}`}>
                            <span>{row.label}</span>
                            <strong>{row.value}</strong>
                          </div>
                        ))}
                      </div>

                      {holdingGovernancePanelModel && (
                        <section className="holding-governance-section" data-testid="holding-governance-panel" aria-label="领地治理">
                          <div className="holding-governance-head">
                            <div>
                              <span className="strategic-subsection-title">领地治理</span>
                              <p>项目按具体领地类型开放，以本地钱粮立项并随游戏时间推进；主持者、绝艺与能力只调整工期、成本、风险和效果范围。</p>
                            </div>
                            <small>同一领地同时只能进行一项治理</small>
                          </div>

                          {holdingGovernancePanelModel.activeProject ? (
                            <article className="holding-governance-active-card">
                              <div className="holding-governance-project-head">
                                <div>
                                  <strong>{holdingGovernancePanelModel.activeProject.title}</strong>
                                  <small>{holdingGovernancePanelModel.activeProject.statusText}</small>
                                </div>
                                <span>{holdingGovernancePanelModel.activeProject.progressText}</span>
                              </div>
                              <div
                                className="holding-governance-progress"
                                role="progressbar"
                                aria-label={`${holdingGovernancePanelModel.activeProject.title}进度`}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={holdingGovernancePanelModel.activeProject.progressPercent}
                              >
                                <i style={{ width: `${holdingGovernancePanelModel.activeProject.progressPercent}%` }} />
                              </div>
                              <div className="holding-governance-meta-grid">
                                <div><span>工期</span><strong>{holdingGovernancePanelModel.activeProject.timingText}</strong></div>
                                <div><span>主持</span><strong>{holdingGovernancePanelModel.activeProject.hostText}</strong></div>
                                <div><span>协助</span><strong>{holdingGovernancePanelModel.activeProject.assistantText ?? '无'}</strong></div>
                                <div><span>投入</span><strong>{holdingGovernancePanelModel.activeProject.investmentText}</strong></div>
                                <div><span>风险</span><strong>{holdingGovernancePanelModel.activeProject.riskText}</strong></div>
                              </div>
                              {holdingGovernancePanelModel.activeProject.appliedArtNames.length > 0 && (
                                <p className="holding-governance-arts">
                                  生效绝艺：{holdingGovernancePanelModel.activeProject.appliedArtNames.join('、')}
                                </p>
                              )}
                              <div className="holding-governance-effect-list">
                                {holdingGovernancePanelModel.activeProject.expectedEffectRows.map((row) => (
                                  <span key={`${holdingGovernancePanelModel.activeProject?.projectId}-${row.field}`}>
                                    {row.label} {row.value}
                                  </span>
                                ))}
                              </div>
                              <button
                                type="button"
                                className="holding-governance-cancel-button"
                                disabled={isMutatingHoldingGovernance || isProcessing || isMemorySummaryProcessing}
                                onClick={() => {
                                  if (window.confirm('确定取消这项治理吗？已经投入的钱粮不会返还。')) {
                                    void handleCancelHoldingGovernanceProject(holdingGovernancePanelModel.activeProject!.projectId);
                                  }
                                }}
                              >
                                取消项目
                              </button>
                            </article>
                          ) : (
                            <div className="holding-governance-builder">
                              <div className="holding-governance-project-options" aria-label="治理项目类型">
                                {holdingGovernancePanelModel.projectOptions.map((option) => (
                                  <button
                                    key={option.type}
                                    type="button"
                                    aria-pressed={holdingGovernancePanelModel.selectedType === option.type}
                                    aria-disabled={Boolean(option.disabledReason)}
                                    title={option.disabledReason ?? option.description}
                                    className={`${holdingGovernancePanelModel.selectedType === option.type ? 'is-active' : ''} ${option.disabledReason ? 'is-disabled' : ''}`}
                                    onClick={() => {
                                      if (!option.disabledReason) setSelectedGovernanceProjectType(option.type);
                                    }}
                                  >
                                    <strong>{option.label}</strong>
                                    <small>{option.disabledReason ?? option.description}</small>
                                  </button>
                                ))}
                              </div>

                              <div className="holding-governance-actor-grid">
                                <label>
                                  <span>主持者</span>
                                  <select
                                    value={holdingGovernancePanelModel.selectedHostKey}
                                    onChange={(event) => {
                                      setSelectedGovernanceHostKey(event.target.value);
                                      if (event.target.value === holdingGovernancePanelModel.selectedAssistantKey) {
                                        setSelectedGovernanceAssistantKey('');
                                      }
                                    }}
                                  >
                                    {holdingGovernancePanelModel.actorOptions.map((actor) => (
                                      <option key={`host-${actor.key}`} value={actor.key}>{actor.label}｜{actor.subtitle}</option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  <span>协助者</span>
                                  <select
                                    value={holdingGovernancePanelModel.selectedAssistantKey}
                                    onChange={(event) => setSelectedGovernanceAssistantKey(event.target.value)}
                                  >
                                    <option value="">不设协助者</option>
                                    {holdingGovernancePanelModel.actorOptions
                                      .filter((actor) => actor.key !== holdingGovernancePanelModel.selectedHostKey)
                                      .map((actor) => (
                                        <option key={`assistant-${actor.key}`} value={actor.key}>{actor.label}｜{actor.subtitle}</option>
                                      ))}
                                  </select>
                                  {holdingGovernancePanelModel.assistantEligibilityHint && (
                                    <small className="holding-governance-assistant-hint">
                                      {holdingGovernancePanelModel.assistantEligibilityHint}
                                    </small>
                                  )}
                                </label>
                              </div>

                              {holdingGovernancePanelModel.preview && (
                                <article className="holding-governance-preview">
                                  <div className="holding-governance-project-head">
                                    <div>
                                      <strong>{holdingGovernancePanelModel.preview.title}</strong>
                                      <small>{holdingGovernancePanelModel.preview.description}</small>
                                    </div>
                                    <span>风险 {holdingGovernancePanelModel.preview.riskText}</span>
                                  </div>
                                  <div className="holding-governance-meta-grid">
                                    <div><span>钱财</span><strong>{holdingGovernancePanelModel.preview.moneyCostText}</strong></div>
                                    <div><span>粮草</span><strong>{holdingGovernancePanelModel.preview.grainCostText}</strong></div>
                                    <div><span>预计工期</span><strong>{holdingGovernancePanelModel.preview.durationText}</strong></div>
                                  </div>
                                  <p className="holding-governance-modifiers">{holdingGovernancePanelModel.preview.modifierSummary}</p>
                                  {holdingGovernancePanelModel.preview.appliedArtNames.length > 0 && (
                                    <p className="holding-governance-arts">
                                      生效绝艺：{holdingGovernancePanelModel.preview.appliedArtNames.join('、')}
                                    </p>
                                  )}
                                  <div className="holding-governance-effect-list">
                                    {holdingGovernancePanelModel.preview.effectRows.map((row) => (
                                      <span key={`preview-${row.field}`}>{row.label} {row.value}</span>
                                    ))}
                                  </div>
                                </article>
                              )}

                              {holdingGovernancePanelModel.startError && (
                                <p className="holding-governance-error">{holdingGovernancePanelModel.startError}</p>
                              )}
                              <button
                                type="button"
                                className="holding-governance-start-button"
                                disabled={
                                  !holdingGovernancePanelModel.canStart
                                  || isMutatingHoldingGovernance
                                  || isProcessing
                                  || isMemorySummaryProcessing
                                }
                                onClick={() => void handleStartHoldingGovernanceProject()}
                              >
                                {isMutatingHoldingGovernance ? '正在保存……' : '确认开工'}
                              </button>
                            </div>
                          )}

                          {holdingGovernancePanelModel.projectHistory.some((project) => (
                            project.projectId !== holdingGovernancePanelModel.activeProject?.projectId
                          )) && (
                            <div className="holding-governance-history">
                              <span className="strategic-subsection-title">治理记录</span>
                              {holdingGovernancePanelModel.projectHistory
                                .filter((project) => project.projectId !== holdingGovernancePanelModel.activeProject?.projectId)
                                .slice(0, 5)
                                .map((project) => (
                                  <article key={project.projectId}>
                                    <div className="holding-governance-project-head">
                                      <div><strong>{project.title}</strong><small>{project.timingText}</small></div>
                                      <span>{project.statusText}</span>
                                    </div>
                                    {project.resultSummary && <p>{project.resultSummary}</p>}
                                    {project.blockedReason && <p className="holding-governance-error">{project.blockedReason}</p>}
                                    {project.resultRows.length > 0 && (
                                      <div className="holding-governance-effect-list">
                                        {project.resultRows.map((row) => (
                                          <span key={`${project.projectId}-result-${row.field}`}>{row.label} {row.value}</span>
                                        ))}
                                      </div>
                                    )}
                                  </article>
                                ))}
                            </div>
                          )}
                        </section>
                      )}

                      {(holdingPanelModel.relatedNpcNames.length > 0 || holdingPanelModel.garrisonTroopNames.length > 0) && (
                        <div className="strategic-detail-notes">
                          <span>相关对象</span>
                          {holdingPanelModel.relatedNpcNames.length > 0 && <p>相关人物：{holdingPanelModel.relatedNpcNames.join('、')}</p>}
                          {holdingPanelModel.garrisonTroopNames.length > 0 && <p>明确驻军：{holdingPanelModel.garrisonTroopNames.join('、')}</p>}
                        </div>
                      )}

                      {selectedHolding.riskNotes && selectedHolding.riskNotes.length > 0 && (
                        <div className="strategic-detail-notes holding-warning-notes">
                          <span>风险</span>
                          <ul>
                            {selectedHolding.riskNotes.map((note) => (
                              <li key={note}>{note}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {selectedHolding.recentChanges && selectedHolding.recentChanges.length > 0 && (
                        <div className="strategic-detail-notes">
                          <span>近况</span>
                          <ul>
                            {selectedHolding.recentChanges.map((change) => (
                              <li key={change}>{change}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="muted">暂无领地详情。</p>
                  ))}

                  {activeHoldingTab === 'domesticReports' && (
                  <div className="strategic-detail-notes holding-report-section">
                    <span>内政报告</span>
                    {holdingPanelModel.reports.length === 0 ? (
                      <p>暂无年度收支或内政报告。</p>
                    ) : (
                      <div className="holding-report-list">
                        {holdingPanelModel.reports.map((report) => (
                          <article key={report.reportId} className="holding-report-card">
                            <div>
                              <strong>{report.title}</strong>
                              <small>{report.settledAt}</small>
                            </div>
                            <p>{report.summary}</p>
                            <dl>
                              <div>
                                <dt>收入</dt>
                                <dd>{report.incomeText}</dd>
                              </div>
                              <div>
                                <dt>支出</dt>
                                <dd>{report.expenseText}</dd>
                              </div>
                              <div>
                                <dt>结余</dt>
                                <dd>{report.netText}</dd>
                              </div>
                            </dl>
                            {report.warnings.length > 0 && (
                              <ul>
                                {report.warnings.map((warning) => (
                                  <li key={warning}>{warning}</li>
                                ))}
                              </ul>
                            )}
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                  )}
                </section>
              </div>
            </section>
          </div>
        )}

        {activeSystemPanel === 'troops' && troopPanelModel && (
          <div className="system-modal-backdrop" role="presentation" onClick={() => setActiveSystemPanel(null)}>
            <section
              className="system-modal ui-system-workspace strategic-modal strategic-modal--troops"
              data-testid="troop-panel"
              role="dialog"
              aria-label="部队"
              onClick={(event) => event.stopPropagation()}
            >
              <SystemModalHeader title="部队" subtitle="部队信息" onClose={() => setActiveSystemPanel(null)} />

              {activeHeavyCavalryFormationProjects.length > 0 && (
                <div className="strategic-detail-notes" data-testid="heavy-cavalry-formation-projects">
                  <span>重骑组建中</span>
                  {activeHeavyCavalryFormationProjects.map((project) => (
                    <p key={project.projectId}>
                      {project.troopName} · {project.requestedSize}骑 · 预计 {project.expectedCompleteAt} 完成
                    </p>
                  ))}
                </div>
              )}

              <div className="strategic-archive-layout">
                <aside className="strategic-roster" aria-label="部队势力分组">
                  <div className="strategic-roster-head">
                    <span>势力分组</span>
                    <strong>{troopPanelModel.groupItems.length}</strong>
                  </div>
                  {troopPanelModel.groupItems.length === 0 ? (
                    <p className="muted">暂无已知部队记录</p>
                  ) : (
                    troopPanelModel.groupItems.map((group) => (
                      <button
                        key={group.groupId}
                        type="button"
                        className={`strategic-roster-item ${troopPanelModel.selectedGroupId === group.groupId ? 'is-active' : ''}`}
                        onClick={() => setSelectedTroopId(group.firstTroopId)}
                      >
                        <span>{group.name}</span>
                        <strong>{group.troopCount}支</strong>
                        <small>{group.subtitle}</small>
                        <em>{group.relationSummary} · {group.totalSizeText} · {group.statusSummary}</em>
                      </button>
                    ))
                  )}
                </aside>

                <section className="strategic-detail" aria-label="部队详情">
                  {troopPanelModel.selectedGroup ? (
                    <>
                      <div className="strategic-detail-head">
                        <div>
                          <h4>{troopPanelModel.selectedGroup.name}</h4>
                          <small>{troopPanelModel.selectedGroup.subtitle}</small>
                        </div>
                        <div className="troop-switch-control">
                          <span>{troopPanelModel.selectedGroup.troopCount}支部队</span>
                          {troopPanelModel.groupTroops.length > 1 && (
                            <select
                              className="troop-switch-select"
                              aria-label="切换部队"
                              value={troopPanelModel.selectedTroopId ?? ''}
                              onChange={(event) => setSelectedTroopId(event.target.value)}
                            >
                              {troopPanelModel.groupTroops.map((troop) => (
                                <option key={troop.troopId} value={troop.troopId}>
                                  {troop.name} · {troop.sizeText}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                      <div className="troop-group-summary">
                        <div>
                          <span>兵力合计</span>
                          <strong>{troopPanelModel.selectedGroup.totalSizeText}</strong>
                        </div>
                        <div>
                          <span>关系</span>
                          <strong>{troopPanelModel.selectedGroup.relationSummary}</strong>
                        </div>
                        <div>
                          <span>状态</span>
                          <strong>{troopPanelModel.selectedGroup.statusSummary}</strong>
                        </div>
                      </div>

                      {selectedTroop ? (
                        <div className="troop-detail-block">
                          <article className="troop-record-card" aria-label="部队档案">
                            <div className="troop-record-head">
                              <div className="troop-record-title">
                                <div className="troop-record-title-line">
                                  <h4>{selectedTroop.name}</h4>
                                  <div className="troop-record-meta">
                                    {troopHeaderMetaRows.map((row) => (
                                      <span key={`troop-meta-${row.label}`}>
                                        <small>{row.label}</small>
                                        <strong>{row.value}</strong>
                                      </span>
                                    ))}
                                    <span>
                                      <small>已知方式</small>
                                      <strong>{selectedTroop.knownLevel ?? '已知'}</strong>
                                    </span>
                                  </div>
                                </div>
                                <small>{selectedTroopRosterItem?.subtitle ?? '部队'}</small>
                              </div>
                            </div>

                            <div className="troop-stat-strip" aria-label="战力与状态">
                              {troopStatRows.map((row) => (
                                <div key={`troop-stat-${row.label}`} className="troop-stat-cell">
                                  <span>{row.label}</span>
                                  <strong>{row.value}</strong>
                                  {row.detail && <small>{row.detail}</small>}
                                </div>
                              ))}
                            </div>
                            {troopPanelModel?.monthlyUpkeepNote && (
                              <p
                                className="troop-upkeep-note"
                                data-testid="troop-monthly-upkeep"
                              >
                                {troopPanelModel.monthlyUpkeepNote}
                              </p>
                            )}

                            <div className="troop-record-body">
                              <div className="troop-record-info">
                                <section className="troop-info-section troop-officer-section" aria-label="将领编制">
                                  <h5>将领编制</h5>
                                  <dl>
                                    {troopOfficerRows.map((row) => (
                                      <div key={`troop-officer-${row.label}`} className="troop-info-row">
                                        <dt>{row.label}</dt>
                                        <dd>{row.value}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                </section>
                                {troopPositionRows.length > 0 && (
                                  <section className="troop-info-section">
                                    <h5>位置与任务</h5>
                                    <dl>
                                      {troopPositionRows.map((row) => (
                                        <div key={`troop-position-${row.label}`} className="troop-info-row">
                                          <dt>{row.label}</dt>
                                          <dd>
                                            {row.value}
                                            {row.detail && <small>{row.detail}</small>}
                                          </dd>
                                        </div>
                                      ))}
                                    </dl>
                                  </section>
                                )}

                                {(troopIntelRows.length > 0 || troopPanelModel.statusTags.length > 0) && (
                                  <section className="troop-info-section">
                                    <h5>情报与变动</h5>
                                    {troopIntelRows.length > 0 && (
                                      <dl>
                                        {troopIntelRows.map((row) => (
                                          <div key={`troop-intel-${row.label}`} className="troop-info-row">
                                            <dt>{row.label}</dt>
                                            <dd>
                                              {row.value}
                                              {row.detail && <small>{row.detail}</small>}
                                            </dd>
                                          </div>
                                        ))}
                                      </dl>
                                    )}
                                    {troopPanelModel.statusTags.length > 0 && (
                                      <div className="strategic-tag-row troop-tag-row">
                                        {troopPanelModel.statusTags.map((tag) => (
                                          <em key={tag}>{tag}</em>
                                        ))}
                                      </div>
                                    )}
                                  </section>
                                )}
                              </div>

                              {troopPanelModel.visualProfile && troopVisualAsset && (
                                <ProgressivePanelVisual
                                  variant="troop"
                                  eligible={shouldLoadTroopVisualAsset(activeSystemPanel, troopVisualAsset.assetKey)}
                                  assetKey={troopVisualAsset.assetKey}
                                  loadManifest={loadTroopVisualManifest}
                                  alt={troopVisualAsset.label}
                                  caption={troopPanelModel.visualProfile.caption}
                                  aria-label="部队示意"
                                  data-testid="troop-visual-state"
                                />
                              )}
                            </div>
                          </article>

                          {troopPanelModel.recentBattles.length > 0 && (
                            <div className="strategic-detail-notes">
                              <span>相关战事</span>
                              <ul>
                                {troopPanelModel.recentBattles.map((battle) => (
                                  <li key={battle.conflictId}>
                                    <strong>{battle.title}</strong>
                                    {battle.occurredAt && <>｜{battle.occurredAt}</>}
                                    {battle.outcome && <>｜{battle.outcome}</>}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <p className="troop-intel-notice">{troopPanelModel.intelNotice}</p>
                        </div>
                      ) : (
                        <p className="muted">暂无部队详情</p>
                      )}
                    </>
                  ) : (
                    <p className="muted">暂无部队详情</p>
                  )}
                </section>
              </div>
            </section>
          </div>
        )}

        {activeSystemPanel === 'battles' && battlePanelModel && (
          <div className="system-modal-backdrop" role="presentation" onClick={() => setActiveSystemPanel(null)}>
            <section
              className="system-modal ui-system-workspace strategic-modal"
              data-testid="battle-panel"
              role="dialog"
              aria-label="战事"
              onClick={(event) => event.stopPropagation()}
            >
              <SystemModalHeader title="战事" subtitle="战事记录" onClose={() => setActiveSystemPanel(null)} />

              <div className="strategic-archive-layout archive-record-layout">
                <aside className="strategic-roster archive-tab-sidebar" aria-label="战事分类">
                  <div className="strategic-roster-head">
                    <span>分类</span>
                    <strong>{(runtimeState.conflicts ?? []).length}</strong>
                  </div>
                  <div className="battle-tab-list" role="tablist" aria-label="战事分类">
                    {battlePanelModel.tabs.map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        className={`battle-tab-button ${battlePanelModel.activeTab === tab.key ? 'is-active' : ''}`}
                        onClick={() => {
                          setActiveBattleTab(tab.key);
                          setSelectedBattleId(null);
                          setActiveBattleReportId(null);
                        }}
                      >
                        <span>{tab.label}</span>
                        <strong>{tab.count}</strong>
                      </button>
                    ))}
                  </div>
                  <p className="archive-tab-hint">按亲历、听闻与重要记录筛选右侧归档。</p>
                </aside>

                <section className="strategic-detail archive-record-pane" aria-label="战事条目">
                  <div className="strategic-detail-head">
                    <div>
                      <h4>战事条目</h4>
                      <small>{battlePanelModel.tabs.find((tab) => tab.key === battlePanelModel.activeTab)?.label ?? '战事记录'}</small>
                    </div>
                    <span>{battlePanelModel.listItems.length}条</span>
                  </div>

                  {battlePanelModel.listItems.length === 0 ? (
                    <p className="muted">暂无该类战事记录</p>
                  ) : (
                    <div className="archive-record-list">
                      {battlePanelModel.listItems.map((battle) => (
                        <article
                          key={battle.conflictId}
                          className={`archive-record-card ${battlePanelModel.selectedConflictId === battle.conflictId ? 'is-active' : ''}`}
                        >
                          <div className="archive-record-main" data-record-kind="battle">
                            <h4>{battle.title}</h4>
                            <div className="archive-record-facts">
                              <span><small>时间</small><strong>{battle.occurredAt}</strong></span>
                              <span><small>结果</small><strong>{battle.resultText}</strong></span>
                              <span><small>重要性</small><strong>{battle.importanceText}</strong></span>
                            </div>
                          </div>
                          <div className="archive-record-actions">
                            <button type="button" onClick={() => openBattleReport(battle.conflictId)}>查看战报</button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </section>
          </div>
        )}

        {activeSystemPanel === 'combats' && combatPanelModel && (
          <div className="system-modal-backdrop" role="presentation" onClick={() => setActiveSystemPanel(null)}>
            <section
              className="system-modal ui-system-workspace strategic-modal"
              data-testid="combat-panel"
              role="dialog"
              aria-label="战斗"
              onClick={(event) => event.stopPropagation()}
            >
              <SystemModalHeader title="战斗" subtitle="战斗记录" onClose={() => setActiveSystemPanel(null)} />

              <div className="strategic-archive-layout archive-record-layout">
                <aside className="strategic-roster archive-tab-sidebar" aria-label="战斗分类">
                  <div className="strategic-roster-head">
                    <span>分类</span>
                    <strong>{(runtimeState.combatRecords ?? []).length}</strong>
                  </div>
                  <div className="battle-tab-list" role="tablist" aria-label="战斗分类">
                    {combatPanelModel.tabs.map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        className={`battle-tab-button ${combatPanelModel.activeTab === tab.key ? 'is-active' : ''}`}
                        onClick={() => {
                          setActiveCombatTab(tab.key);
                          setSelectedCombatId(null);
                          setActiveCombatReportId(null);
                        }}
                      >
                        <span>{tab.label}</span>
                        <strong>{tab.count}</strong>
                      </button>
                    ))}
                  </div>
                  <p className="archive-tab-hint">按亲历、重要程度与听闻记录筛选右侧归档。</p>
                </aside>

                <section className="strategic-detail archive-record-pane" aria-label="战斗条目">
                  <div className="strategic-detail-head">
                    <div>
                      <h4>战斗条目</h4>
                      <small>{combatPanelModel.tabs.find((tab) => tab.key === combatPanelModel.activeTab)?.label ?? '战斗记录'}</small>
                    </div>
                    <span>{combatPanelModel.listItems.length}条</span>
                  </div>

                  {combatPanelModel.listItems.length === 0 ? (
                    <p className="muted">暂无该类战斗记录</p>
                  ) : (
                    <div className="archive-record-list">
                      {combatPanelModel.listItems.map((combat) => (
                        <article
                          key={combat.combatId}
                          className={`archive-record-card archive-record-card--combat ${combatPanelModel.selectedCombatId === combat.combatId ? 'is-active' : ''}`}
                        >
                          <div className="archive-record-main" data-record-kind="combat">
                            <h4>{combat.title}</h4>
                            <div className="archive-record-facts">
                              <span><small>时间</small><strong>{combat.occurredAt}</strong></span>
                              <span><small>结果</small><strong>{combat.resultText}</strong></span>
                              <span><small>重要性</small><strong>{combat.importanceText}</strong></span>
                            </div>
                          </div>
                          <div className="archive-record-actions">
                            <button type="button" onClick={() => openCombatReport(combat.combatId)}>查看战报</button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </section>
          </div>
        )}

        {activeSystemPanel === 'battles' && activeBattleReport && (
          <div className="system-modal-backdrop archive-report-backdrop" role="presentation" onClick={() => setActiveBattleReportId(null)}>
            <section
              className="system-modal ui-system-workspace strategic-modal archive-report-modal"
              data-testid="battle-report-detail"
              role="dialog"
              aria-label="战事战报"
              onClick={(event) => event.stopPropagation()}
            >
              <SystemModalHeader
                title={activeBattleReport.title}
                subtitle="战事战报"
                onClose={() => setActiveBattleReportId(null)}
              />

              <article className="battle-report-card battle-report-card--archive">
                <div className="battle-report-card-head">
                  <div>
                    <span>战事简报</span>
                    <h4>{activeBattleReport.title}</h4>
                    <small>{activeBattleReport.summary}</small>
                  </div>
                  <em>{activeBattleReport.recordLevel === 'full' ? '完整战报' : '简略记录'}</em>
                </div>
                <div className="battle-report-meta">
                  {activeBattleReport.occurredAt && (
                    <div>
                      <span>时间</span>
                      <strong>{activeBattleReport.occurredAt}</strong>
                    </div>
                  )}
                  {(activeBattleReport.locationName ?? activeBattleReport.locationId) && (
                    <div>
                      <span>地点</span>
                      <strong>{activeBattleReport.locationName ?? resolvePlaceLabel(activeBattleReport.locationId ?? '')}</strong>
                    </div>
                  )}
                  {(activeBattleReport.result ?? activeBattleReport.resultLevel) && (
                    <div>
                      <span>结果</span>
                    <strong>{formatConflictResultLevel(activeBattleReport.resultLevel) ?? activeBattleReport.result}</strong>
                    </div>
                  )}
                </div>
                {activeBattleArchiveBriefing && (
                  <BattleBriefingVisual
                    card={activeBattleArchiveBriefing}
                    label="战场记录"
                    testId="battle-report-visual"
                  />
                )}
                <div className="battle-report-body battle-report-body--archive">
                  <p>{activeBattleReportText}</p>
                </div>
              </article>

              <div className="strategic-detail-grid">
                {activeBattleDetailRows.map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <div className="strategic-detail-notes">
                <span>战果</span>
                <p>{activeBattleReport.outcome}</p>
              </div>
              {activeBattleReport.judgement && (
                <div className="strategic-detail-notes">
                  <span>战争判定</span>
                  <p>{activeBattleReport.judgement.method === 'warJudgementV1' ? '战争判定' : activeBattleReport.judgement.method}</p>
                  {activeBattleReport.judgement.baselineAdvantage && <p>基准形势：{formatCombatAdvantage(activeBattleReport.judgement.baselineAdvantage)}</p>}
                  {activeBattleReport.judgement.commanderAssessment && <p>主帅判断：{activeBattleReport.judgement.commanderAssessment}</p>}
                  {activeBattleReport.judgement.tacticalAssessment && <p>战术判断：{activeBattleReport.judgement.tacticalAssessment}</p>}
                  {activeBattleReport.judgement.underdogReason && <p>以弱胜强理由：{activeBattleReport.judgement.underdogReason}</p>}
                  {activeBattleReport.judgement.scoreBreakdown && (
                    <p>
                      评分：{formatConflictScoreBreakdown(activeBattleReport.judgement.scoreBreakdown as Record<string, unknown>)}
                    </p>
                  )}
                  {activeBattleReport.judgement.scoreBreakdown?.notes && activeBattleReport.judgement.scoreBreakdown.notes.length > 0 && (
                    <p>依据：{activeBattleReport.judgement.scoreBreakdown.notes.join('、')}</p>
                  )}
                </div>
              )}
              {activeBattleReport.turningPoints && activeBattleReport.turningPoints.length > 0 && (
                <div className="strategic-detail-notes">
                  <span>战局转折</span>
                  <ul className="battle-turning-point-list">
                    {activeBattleReport.turningPoints.map((point, index) => (
                      <li key={`${point.type}-${index}`}>
                        <strong>{formatConflictTurningPointType(point.type)}</strong>
                        <span>｜影响：{formatConflictTurningPointImpact(point.impact)}</span>
                        {point.side && <span>｜一方：{point.side}</span>}
                        {typeof point.scoreModifier === 'number' && <span>｜修正：{point.scoreModifier > 0 ? `+${point.scoreModifier}` : point.scoreModifier}</span>}
                        <p>{point.summary}</p>
                        {((point.relatedNpcIds && point.relatedNpcIds.length > 0) || (point.relatedTroopIds && point.relatedTroopIds.length > 0)) && (
                          <small>
                            {point.relatedNpcIds && point.relatedNpcIds.length > 0 && <>人物：{point.relatedNpcIds.map(resolveNpcLabel).join('、')}</>}
                            {point.relatedNpcIds && point.relatedNpcIds.length > 0 && point.relatedTroopIds && point.relatedTroopIds.length > 0 && '；'}
                            {point.relatedTroopIds && point.relatedTroopIds.length > 0 && <>部队：{point.relatedTroopIds.map(resolveTroopLabel).join('、')}</>}
                          </small>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(activeBattleSides.length > 0 || activeBattleCommanders.length > 0 || activeBattleTroops.length > 0 || activeBattleFactions.length > 0 || activeBattleNpcLabels.length > 0) && (
                <div className="strategic-detail-notes">
                  <span>战场对象</span>
                  {activeBattleSides.length > 0 && <p>交战双方：{activeBattleSides.join('、')}</p>}
                  {activeBattleCommanders.length > 0 && <p>主帅/指挥：{activeBattleCommanders.join('、')}</p>}
                  {activeBattleTroops.length > 0 && <p>相关部队：{activeBattleTroops.join('、')}</p>}
                  {activeBattleFactions.length > 0 && <p>相关势力：{activeBattleFactions.join('、')}</p>}
                  {activeBattleNpcLabels.length > 0 && <p>相关人物：{activeBattleNpcLabels.join('、')}</p>}
                </div>
              )}
              {activeBattleReport.decisiveFactors && activeBattleReport.decisiveFactors.length > 0 && (
                <div className="strategic-detail-notes">
                  <span>关键因素</span>
                  <p>{activeBattleReport.decisiveFactors.join('、')}</p>
                </div>
              )}
              {[
                ['部队影响', activeBattleReport.troopEffects],
                ['势力影响', activeBattleReport.factionEffects],
                ['地点影响', activeBattleReport.placeEffects],
              ].some(([, values]) => Array.isArray(values) && values.length > 0) && (
                <div className="strategic-detail-notes">
                  <span>后续影响</span>
                  {activeBattleReport.troopEffects && activeBattleReport.troopEffects.length > 0 && <p>部队：{activeBattleReport.troopEffects.join('、')}</p>}
                  {activeBattleReport.factionEffects && activeBattleReport.factionEffects.length > 0 && <p>势力：{activeBattleReport.factionEffects.join('、')}</p>}
                  {activeBattleReport.placeEffects && activeBattleReport.placeEffects.length > 0 && <p>地点：{activeBattleReport.placeEffects.join('、')}</p>}
                </div>
              )}
              {[
                ['结果标签', activeBattleReport.resultTags],
                ['关联事项', activeBattleReport.relatedQuestIds],
                ['关联纪事', activeBattleReport.relatedTrendIds],
              ].some(([, values]) => Array.isArray(values) && values.length > 0) && (
                <div className="strategic-detail-notes">
                  <span>关联信息</span>
                  {activeBattleReport.resultTags && activeBattleReport.resultTags.length > 0 && <p>结果标签：{activeBattleReport.resultTags.join('、')}</p>}
                  {activeBattleReport.relatedQuestIds && activeBattleReport.relatedQuestIds.length > 0 && <p>关联事项：{activeBattleReport.relatedQuestIds.map(resolveQuestLabel).join('、')}</p>}
                  {activeBattleReport.relatedTrendIds && activeBattleReport.relatedTrendIds.length > 0 && <p>关联纪事：{activeBattleReport.relatedTrendIds.join('、')}</p>}
                </div>
              )}
            </section>
          </div>
        )}

        {activeSystemPanel === 'combats' && activeCombatReport && (
          <div className="system-modal-backdrop archive-report-backdrop" role="presentation" onClick={() => setActiveCombatReportId(null)}>
            <section
              className="system-modal ui-system-workspace strategic-modal archive-report-modal"
              data-testid="combat-report-detail"
              role="dialog"
              aria-label="战斗战报"
              onClick={(event) => event.stopPropagation()}
            >
              <SystemModalHeader
                title={activeCombatReport.title}
                subtitle="个人战报"
                onClose={() => setActiveCombatReportId(null)}
              />

              <article className="battle-report-card battle-report-card--archive battle-report-card--combat">
                <div className="battle-report-card-head">
                  <div>
                    <span>战斗简报</span>
                    <h4>{activeCombatReport.title}</h4>
                    <small>{activeCombatReport.summary}</small>
                  </div>
                  <em>{activeCombatReport.playerInvolved ? '亲历' : activeCombatReport.chronicleWorthy ? '纪事' : '记录'}</em>
                </div>
                <div className="battle-report-meta">
                  {activeCombatReport.occurredAt && (
                    <div>
                      <span>时间</span>
                      <strong>{activeCombatReport.occurredAt}</strong>
                    </div>
                  )}
                  {(activeCombatReport.locationName ?? activeCombatReport.locationId) && (
                    <div>
                      <span>地点</span>
                      <strong>{activeCombatReport.locationName ?? resolvePlaceLabel(activeCombatReport.locationId ?? '')}</strong>
                    </div>
                  )}
                  {activeCombatReport.resultLevel && (
                    <div>
                      <span>结果</span>
                    <strong>{formatCombatResult(activeCombatReport.resultLevel)}</strong>
                    </div>
                  )}
                </div>
                {activeCombatArchiveBriefing && (
                  <BattleBriefingVisual card={activeCombatArchiveBriefing} label="个人战记录" />
                )}
                <div className="battle-report-body battle-report-body--archive">
                  <p>{activeCombatReportText}</p>
                </div>
              </article>

              <div className="strategic-detail-grid">
                {activeCombatDetailRows.map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <div className="strategic-detail-notes">
                <span>结果</span>
                <p>{activeCombatReport.outcome}</p>
              </div>
              {activeCombatReport.participants.length > 0 && (
                <div className="strategic-detail-notes">
                  <span>参战人物</span>
                  <ul>
                    {activeCombatReport.participants.map((participant, index) => (
                      <li key={`${participant.participantId ?? participant.npcId ?? participant.name}-${index}`}>
                        <strong>{participant.name}</strong>
                        <span>｜{formatCombatParticipantSide(participant.side)}</span>
                        {participant.role && <span>｜{participant.role}</span>}
                        {participant.outcome && <span>｜{participant.outcome}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {activeCombatReport.judgement && (
                <div className="strategic-detail-notes">
                  <span>判定</span>
                  <p>{activeCombatReport.judgement.method === 'combatJudgementV1' ? '个人战判定' : activeCombatReport.judgement.method}</p>
                  {activeCombatReport.judgement.advantageBand && <p>优势：{formatCombatAdvantage(activeCombatReport.judgement.advantageBand)}</p>}
                  {activeCombatReport.judgement.decisiveMoment && <p>关键瞬间：{activeCombatReport.judgement.decisiveMoment}</p>}
                  {activeCombatReport.judgement.underdogReason && <p>以弱胜强理由：{activeCombatReport.judgement.underdogReason}</p>}
                  {activeCombatReport.judgement.scoreBreakdown && (
                    <p>
                      评分：{formatCombatScoreBreakdown(activeCombatReport.judgement.scoreBreakdown as Record<string, unknown>)}
                    </p>
                  )}
                </div>
              )}
              {[
                ['结果标签', activeCombatReport.outcomeTags],
                ['视觉标签', activeCombatReport.visualTags],
                ['声望影响', activeCombatReport.reputationEffects],
                ['关联战事', activeCombatReport.relatedConflictIds],
                ['关联纪事', activeCombatReport.relatedTrendIds],
              ].some(([, values]) => Array.isArray(values) && values.length > 0) && (
                <div className="strategic-detail-notes">
                  <span>关联信息</span>
                  {activeCombatReport.outcomeTags && activeCombatReport.outcomeTags.length > 0 && <p>结果标签：{activeCombatReport.outcomeTags.map(formatCombatOutcomeTag).join('、')}</p>}
                  {activeCombatReport.visualTags && activeCombatReport.visualTags.length > 0 && <p>视觉标签：{activeCombatReport.visualTags.join('、')}</p>}
                  {activeCombatReport.reputationEffects && activeCombatReport.reputationEffects.length > 0 && <p>声望影响：{activeCombatReport.reputationEffects.join('、')}</p>}
                  {activeCombatReport.relatedConflictIds && activeCombatReport.relatedConflictIds.length > 0 && <p>关联战事：{activeCombatReport.relatedConflictIds.join('、')}</p>}
                  {activeCombatReport.relatedTrendIds && activeCombatReport.relatedTrendIds.length > 0 && <p>关联纪事：{activeCombatReport.relatedTrendIds.join('、')}</p>}
                </div>
              )}
            </section>
          </div>
        )}

        {activeSystemPanel === 'uniqueArts' && uniqueArtsPanelModel && (
          <div className="system-modal-backdrop" role="presentation" onClick={() => setActiveSystemPanel(null)}>
            <section
              className="system-modal ui-system-workspace strategic-modal unique-arts-modal"
              data-testid="unique-arts-panel"
              role="dialog"
              aria-label="绝艺"
              onClick={(event) => event.stopPropagation()}
            >
              <SystemModalHeader
                title="绝艺"
                subtitle="主角与人物绝艺"
                onClose={() => setActiveSystemPanel(null)}
              />

              <div className="unique-arts-count-row">
                <span>已记录 <strong>{uniqueArtsPanelModel.totalCount}</strong></span>
                <span>主角 <strong>{uniqueArtsPanelModel.playerCount}</strong></span>
                <span>NPC <strong>{uniqueArtsPanelModel.npcCount}</strong></span>
              </div>

              <div className="strategic-archive-layout">
                <aside className="strategic-roster" aria-label="绝艺列表">
                  <div className="strategic-roster-head">
                    <span>绝艺列表</span>
                    <strong>{uniqueArtsPanelModel.totalCount}</strong>
                  </div>
                  {uniqueArtsPanelModel.rosterItems.length === 0 ? (
                    <p className="muted">暂无绝艺。开局或后续剧情中的习得与成长会记录在这里。</p>
                  ) : uniqueArtsPanelModel.rosterGroups.map((group) => (
                    <div key={group.title} className="unique-art-roster-group">
                      <div className="unique-art-roster-group-title">{group.title}</div>
                      {group.items.map((art) => (
                        <button
                          key={art.id}
                          type="button"
                          className={`strategic-roster-item unique-art-roster-item ${uniqueArtsPanelModel.selectedArtId === art.id ? 'is-active' : ''}`}
                          onClick={() => setSelectedUniqueArtId(art.id)}
                        >
                          <span>{art.name}</span>
                          <small>{art.characterName} · {art.domainLabel}</small>
                          <em>{[art.levelText, art.progressText].filter(Boolean).join(' · ')}</em>
                          <strong>{art.rarityLabel}</strong>
                        </button>
                      ))}
                    </div>
                  ))}
                </aside>

                <section className="strategic-detail" aria-label="绝艺详情">
                  {selectedUniqueArt ? (
                    <>
                      <div className="strategic-detail-head">
                        <div>
                          <h4>{selectedUniqueArt.name}</h4>
                          <small>{selectedUniqueArt.characterName} · {selectedUniqueArt.characterType === 'player' ? '主角' : 'NPC'}</small>
                        </div>
                        <span>{selectedUniqueArt.rarityLabel}</span>
                      </div>

                      <div className="unique-art-effect-block" title={selectedUniqueArt.tooltip}>
                        <span>效果</span>
                        <p>{selectedUniqueArt.effectSummary}</p>
                      </div>

                      {selectedUniqueArt.mechanicsSummary && (
                        <div className="unique-art-detail-block unique-art-trigger-block" data-testid="unique-art-mechanics">
                          <h4>本地执行规则</h4>
                          <p>{selectedUniqueArt.mechanicsSummary}</p>
                          {selectedUniqueArt.lastExecutionSummary && <small>最近执行：{selectedUniqueArt.lastExecutionSummary}</small>}
                        </div>
                      )}

                      <div className="unique-art-progress-block">
                        <div>
                          <span>{selectedUniqueArt.isMaxLevel ? '当前等级已满' : '成长进度'}</span>
                          <strong>{selectedUniqueArt.isMaxLevel ? 'MAX' : `${selectedUniqueArt.currentProgress} / 100`}</strong>
                        </div>
                        <div
                          className="unique-art-progress-track"
                          role="progressbar"
                          aria-label={`${selectedUniqueArt.name}成长进度`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={selectedUniqueArt.progressPercent}
                        >
                          <i style={{ width: `${selectedUniqueArt.progressPercent}%` }} />
                        </div>
                        <small>
                          {selectedUniqueArt.nextLevelText}
                          {selectedUniqueArt.bankedProgress > 0 ? ` · 已保留溢出 ${selectedUniqueArt.bankedProgress} 点` : ''}
                        </small>
                      </div>

                      {(selectedUniqueArt.acquisitionLabel || selectedUniqueArt.acquisitionSummary) && (
                        <div className="unique-art-detail-block unique-art-acquisition-block">
                          <h4>获得经历</h4>
                          <div className="unique-art-acquisition-meta">
                            {selectedUniqueArt.acquisitionLabel && <span>{selectedUniqueArt.acquisitionLabel}</span>}
                            {selectedUniqueArt.acquisitionOccurredAt && <span>{selectedUniqueArt.acquisitionOccurredAt}</span>}
                            {selectedUniqueArt.acquisitionInstructorName && <span>传授者：{selectedUniqueArt.acquisitionInstructorName}</span>}
                          </div>
                          {selectedUniqueArt.acquisitionSummary && <p>{selectedUniqueArt.acquisitionSummary}</p>}
                        </div>
                      )}

                      {selectedUniqueArt.promptHint && (
                        <div className="unique-art-detail-block unique-art-trigger-block">
                          <h4>触发与承接</h4>
                          <p>{selectedUniqueArt.promptHint}</p>
                        </div>
                      )}

                      <div className="strategic-detail-grid">
                        <div>
                          <span>持有者</span>
                          <strong>{selectedUniqueArt.characterName}</strong>
                          <small>{selectedUniqueArt.characterType === 'player' ? '主角' : '人物'}</small>
                        </div>
                        <div>
                          <span>等级</span>
                          <strong>{selectedUniqueArt.levelText}</strong>
                          {selectedUniqueArt.progressText && <small>进度 {selectedUniqueArt.progressText}</small>}
                        </div>
                        <div>
                          <span>领域</span>
                          <strong>{selectedUniqueArt.domainLabel}</strong>
                        </div>
                        <div>
                          <span>来源</span>
                          <strong>{selectedUniqueArt.sourceLabel}</strong>
                        </div>
                        {selectedUniqueArt.acquiredAt && (
                          <div>
                            <span>获得</span>
                            <strong>{selectedUniqueArt.acquiredAt}</strong>
                          </div>
                        )}
                        {selectedUniqueArt.upgradedAt && (
                          <div>
                            <span>最近提升</span>
                            <strong>{selectedUniqueArt.upgradedAt}</strong>
                          </div>
                        )}
                      </div>

                      <div className="unique-art-detail-block">
                        <h4>介绍</h4>
                        <p>{selectedUniqueArt.description}</p>
                      </div>

                      {selectedUniqueArt.checkHookRows.length > 0 && (
                        <div className="unique-art-detail-block">
                          <h4>判定条件</h4>
                          <div className="unique-art-hook-list">
                            {selectedUniqueArt.checkHookRows.map((hook, index) => (
                              <span key={`${selectedUniqueArt.id}-hook-${index}`}>
                                {hook.scope}
                                {typeof hook.modifier === 'number' ? ` ${hook.modifier >= 0 ? '+' : ''}${hook.modifier}` : ''}
                                {hook.note ? ` · ${hook.note}` : ''}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {selectedUniqueArt.progressHistory.length > 0 && (
                        <div className="unique-art-detail-block unique-art-history-block">
                          <h4>成长记录</h4>
                          <div className="unique-art-history-list">
                            {selectedUniqueArt.progressHistory.map((record) => (
                              <article key={record.id} className={record.levelledUp ? 'is-level-up' : ''}>
                                <div>
                                  <strong>{record.sourceLabel} · {record.intensityLabel}</strong>
                                  <span>{record.occurredAt}</span>
                                </div>
                                <p>{record.summary}</p>
                                <small>{record.awardedText} 成长 · {record.transitionText}</small>
                              </article>
                            ))}
                          </div>
                        </div>
                      )}

                      {selectedUniqueArt.tags.length > 0 && (
                        <div className="unique-art-detail-block">
                          <h4>标签</h4>
                          <div className="strategic-tag-row">
                            {selectedUniqueArt.tags.map((tag) => <em key={`${selectedUniqueArt.id}-tag-${tag}`}>{tag}</em>)}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="muted">暂无绝艺详情。</p>
                  )}
                </section>
              </div>
            </section>
          </div>
        )}

        {activeBattleBriefing && (
          <div className="system-modal-backdrop battle-briefing-backdrop" role="presentation" onClick={dismissBattleBriefing}>
            <section
              className="system-modal battle-briefing-modal"
              data-testid="battle-briefing-modal"
              role="dialog"
              aria-label={activeBattleBriefing.eyebrow}
              onClick={(event) => event.stopPropagation()}
            >
              <SystemModalHeader
                title={activeBattleBriefing.title}
                subtitle={activeBattleBriefing.eyebrow}
                onClose={dismissBattleBriefing}
              />

              <BattleBriefingVisual card={activeBattleBriefing} />

              <div className="battle-briefing-meta-grid">
                {activeBattleBriefing.occurredAt && (
                  <div>
                    <span>时间</span>
                    <strong>{activeBattleBriefing.occurredAt}</strong>
                  </div>
                )}
                {activeBattleBriefing.location && (
                  <div>
                    <span>地点</span>
                    <strong>{activeBattleBriefing.location}</strong>
                  </div>
                )}
                {activeBattleBriefing.result && (
                  <div>
                    <span>结果</span>
                    <strong>{activeBattleBriefing.result}</strong>
                  </div>
                )}
              </div>

              <div className="battle-briefing-summary battle-report-body">
                <p>{activeBattleBriefing.summary}</p>
              </div>

              <div className="battle-briefing-actions">
                <button type="button" className="battle-briefing-secondary" onClick={() => openBattleBriefingArchive(activeBattleBriefing)}>
                  查看归档
                </button>
                <button type="button" className="battle-briefing-primary" onClick={dismissBattleBriefing}>
                  继续
                </button>
              </div>
            </section>
          </div>
        )}

        {activeTurnPanel && (
          <div className="system-modal-backdrop" role="presentation" onClick={() => setActiveTurnPanel(null)}>
            <section
              className="system-modal turn-inspection-modal"
              data-testid="turn-inspection-panel"
              role="dialog"
              aria-label="回合查看"
              onClick={(event) => event.stopPropagation()}
            >
              <SystemModalHeader
                title={(
                  <>
                    {activeTurnPanel.mode === 'trace' && 'AI 处理轨迹'}
                    {activeTurnPanel.mode === 'edit' && '编辑正文'}
                    {activeTurnPanel.mode === 'raw' && '查看原文'}
                  </>
                )}
                subtitle={activeTurnTitle}
                onClose={() => setActiveTurnPanel(null)}
              />

              {activeTurnPanel.mode === 'trace' && (
                <div className="turn-inspection-text" data-testid="turn-processing-trace-content">
                  <TurnProcessingTrace events={activeTurnProcessingStages} />
                </div>
              )}

              {activeTurnPanel.mode === 'raw' && (
                <pre className="turn-raw-view" data-testid="turn-raw-content">{activeTurnRawResponse}</pre>
              )}

              {activeTurnPanel.mode === 'edit' && (
                <div className="turn-edit-panel">
                  <textarea
                    value={editingNarrative}
                    onChange={(event) => setEditingNarrative(event.target.value)}
                    data-testid="turn-edit-textarea"
                  />
                  <div className="turn-edit-actions">
                    <button type="button" className="ghost-btn" onClick={() => setActiveTurnPanel(null)}>取消</button>
                    <button type="button" className="primary-btn" onClick={saveEditedNarrative}>保存正文</button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {isMemorySummaryRecoveryOpen && memorySummaryMaintenance && (
          <div
            className="system-modal-backdrop memory-summary-recovery-backdrop"
            role="presentation"
            onClick={() => setIsMemorySummaryRecoveryOpen(false)}
          >
            <section
              className="system-modal memory-summary-recovery-modal"
              data-testid="memory-summary-recovery-modal"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="memory-summary-recovery-title"
              aria-describedby="memory-summary-recovery-description"
              onClick={(event) => event.stopPropagation()}
            >
              <SystemModalHeader
                title={<span id="memory-summary-recovery-title">记忆整理未完成</span>}
                subtitle="本回合已经安全保存"
                onClose={() => setIsMemorySummaryRecoveryOpen(false)}
              />
              <div className="memory-summary-recovery-body">
                <p id="memory-summary-recovery-description">
                  本回合内容、NPC 与世界状态写回以及原始记忆均已保留，不会因记忆压缩失败而回滚。
                </p>
                <p className="memory-summary-recovery-reason">
                  {memorySummaryMaintenance.lastFailureReason
                    ?? '记忆压缩 API 暂时不可用，请检查 API 设置后重试。'}
                </p>
                <p>
                  选择“稍后处理”后，后续回合不会自动重试或等待；你可以更换可用 API，再从“记忆待整理”入口手动重试。
                </p>
              </div>
              <div className="memory-summary-recovery-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  data-testid="memory-summary-later"
                  onClick={() => setIsMemorySummaryRecoveryOpen(false)}
                >
                  稍后处理
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  data-testid="memory-summary-dialog-open-settings"
                  onClick={() => {
                    setIsMemorySummaryRecoveryOpen(false);
                    onOpenSettings('memory');
                  }}
                >
                  打开记忆 API 设置
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  data-testid="memory-summary-dialog-retry"
                  onClick={() => {
                    void retryPendingMemorySummary();
                  }}
                  disabled={isMemorySummaryProcessing}
                >
                  {isMemorySummaryProcessing ? '重试中…' : '立即重试'}
                </button>
              </div>
            </section>
          </div>
        )}

        {/* ========== 底部状态栏 ========== */}
        <div className="game-bottombar">
          <span className="gbb-item gbb-world">世界书：{runtimeState.worldBookId} v{runtimeState.worldBookVersion}</span>
          <span className="gbb-sep">|</span>
          <span className="gbb-item gbb-opening">开局：{bookmark?.label ?? '—'}</span>
          <span className="gbb-sep">|</span>
          <span className="gbb-item gbb-turn">回合：{turnCount}</span>
          {bottomBarCurrentMatter && (
            <>
              <span className="gbb-sep">|</span>
              <span className="gbb-item gbb-quest">任务：{bottomBarCurrentMatter.title}</span>
            </>
          )}
          {runtimeState.knownRumors.length > 0 && (
            <>
              <span className="gbb-sep">|</span>
              <span className="gbb-item gbb-rumor">{runtimeState.knownRumors[runtimeState.knownRumors.length - 1].content}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

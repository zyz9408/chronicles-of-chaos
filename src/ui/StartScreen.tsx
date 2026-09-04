import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CharacterTrait,
  GameDifficultyLevel,
  NarrativePerspective,
  MapNode,
  RuntimeState,
  OpeningCharacterOption,
  OpeningCharacterOptions,
  SaveKind,
  SaveListItem,
  WorldlineKnowledgeMode,
} from '../engine/types';
import { initWorldBookRegistry, listWorldBooks, getWorldBook } from '../engine/worldbook/WorldBookLoader';
import { listStartBookmarks, getStartBookmark } from '../engine/worldbook/StartBookmarkResolver';
import { listWorldlineKnowledgeBasesForWorldBook } from '../engine/worldline/WorldlineKnowledgeRegistry';
import { clearAllSaves, continueLastSave, createManualSave, createSave, deleteSave, exportSaves, loadSave, listSaves } from '../engine/save/SaveManager';
import { createPortableSaveZip, readSaveArchiveBundleFile } from '../engine/save/SaveArchiveZip';
import {
  deleteUnreferencedSaveVisualPartitions,
  exportSaveVisualPartitions,
  importPortableSaveBundleAtomically,
} from '../engine/avg/AvgVisualSaveIntegration';
import { IndexedDbAvgVisualOverrideRepository } from '../engine/avg/AvgVisualOverrideRepository';
import {
  CloudSaveApiError,
  deleteCloudSave,
  downloadCloudSave,
  getCloudSession,
  getKnownCloudRevision,
  listCloudSaves,
  loadCloudSyncPreferences,
  startDiscordCloudLogin,
  syncCurrentSave,
  uploadLocalSave,
  type CloudSaveItem,
  type CloudSessionState,
  type CloudUsage,
} from '../engine/save/CloudSaveService';
import type { SaveData } from '../engine/types';
import { createCustomOpeningState } from '../engine/state/createCustomOpeningState';
import { ensureCompleteBirthDate } from '../engine/time/npcAge';
import {
  resolveApiConfigForTaskAsync,
  resolveExplicitApiConfigForTaskAsync,
  type ApiConfigArchive,
} from '../engine/settings/ApiConfigManager';
import { BrowserLlmClient } from '../engine/llm/LlmClient';
import { copyUint8ArrayToArrayBuffer, downloadBlobFile } from './downloadBlobFile';
import {
  TurnExecutionCancelledError,
  TurnExecutionOwner,
  isTurnExecutionCancelled,
} from '../engine/turn/TurnExecutionContext';
import { WorldBookSelect } from './WorldBookSelect';
import { OpeningTraitButton } from './OpeningTraitButton';
import { createOpeningWorldlineSettings, getDefaultWorldlineKnowledgeMode } from './worldlineKnowledgeModeModel';
import { StartBookmarkSelect } from './StartBookmarkSelect';
import { useModalAccessibility } from './modalAccessibility';
import {
  attachCustomOpeningPlaces,
  buildOpeningLocationSelection,
  createCustomOpeningPlace,
} from './openingLocation';
import customCharacterSilhouette from '../assets/ui/custom-character-silhouette.png';
import historicalFiguresSilhouette from '../assets/ui/historical-figures-silhouette.png';
import {
  createCustomOpeningOption,
  createCustomOpeningTrait,
  isCustomBirthOption,
  isCustomIdentityOption,
  isCustomOpeningTrait,
  loadCustomOpeningOptions,
  saveCustomOpeningOptions,
  updateCustomOpeningTrait,
} from './openingCustomOptions';
import {
  applyHistoricalRoleCompletion,
  buildHistoricalRoleCompletionMessages,
  buildHistoricalRoleKnowledgeHints,
  parseHistoricalRoleCompletionContent,
} from './historicalRoleCompletion';
import {
  adjustOpeningAbilityAllocation,
  canDecreaseOpeningAbility,
  canIncreaseOpeningAbility,
  getOpeningAbilityPointsRemaining,
  normalizeOpeningAbilityAllocation,
} from './openingAbilityPoints';
import { PressAndHoldButton } from './PressAndHoldButton';
import type { SettingsTab } from './settingsPanelModel';
import { ReleaseNotesPanel } from './ReleaseNotesPanel';
import {
  APP_VERSION_LABEL,
  recordDailyReleaseNotesView,
  shouldShowDailyReleaseNotes,
} from './releaseNotes';
import {
  deleteOpeningCharacterTemplate,
  loadOpeningCharacterTemplates,
  saveOpeningCharacterTemplate,
} from '../engine/opening/OpeningCharacterTemplateStore';
import type {
  OpeningCharacterTemplate,
  OpeningCharacterTemplateProfile,
} from '../engine/opening/OpeningCharacterTemplateStore';
import {
  combatDifficultyProfiles,
  gameDifficultyProfiles,
  getEncounterDifficultyProfile,
  getGameDifficultyProfile,
  warDifficultyProfiles,
} from '../engine/settings/GameDifficulty';
import {
  getNarrativePerspectiveProfile,
  narrativePerspectiveProfiles,
} from '../engine/settings/NarrativePerspective';

const ApiSettingsPanel = React.lazy(async () => {
  const module = await import('./ApiSettingsPanel');
  return { default: module.ApiSettingsPanel };
});

const GameScreen = React.lazy(async () => {
  const module = await import('./GameScreen');
  return { default: module.GameScreen };
});

type Screen = 'menu' | 'create' | 'load' | 'settings' | 'game';
type GameModal = 'save' | 'load' | 'settings';
type PlayerMode = 'original' | 'historical';
type AbilityScores = Record<string, number>;
type CharacterTemplateModal = 'save' | 'load';

const openingBirthMonths = Array.from({ length: 12 }, (_, index) => index + 1);
const openingBirthDays = Array.from({ length: 30 }, (_, index) => index + 1);

export function shouldAdvanceSessionWhenClosingGameLoad(pendingGeneration: number | null): boolean {
  return pendingGeneration !== null;
}

export function StartScreenLoadEntryButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" data-index="02" onClick={onOpen} className="menu-btn secondary">
      兵戈再起
    </button>
  );
}

const openingLlmClient = new BrowserLlmClient();
const NPC_COMPLETION_REQUEST_TIMEOUT_MS = 60_000;

function dateStamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function pickSaveArchiveFile(): Promise<File | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/zip,.zip,application/json,.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    const finish = (file: File | null, error?: Error) => {
      input.remove();
      if (error) reject(error);
      else resolve(file);
    };
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      finish(file);
    };
    input.addEventListener('cancel', () => finish(null), { once: true });
    input.onerror = () => finish(null, new Error('无法读取所选存档文件。'));
    try {
      input.click();
    } catch (error) {
      finish(null, error instanceof Error ? error : new Error('无法打开存档文件选择器。'));
    }
  });
}

const flattenMapNodes = (nodes: MapNode[]): Array<{ id: string; name: string; level: string }> =>
  nodes.flatMap((node) => [
    { id: node.id, name: node.name, level: node.level },
    ...flattenMapNodes(node.subLocations ?? []),
  ]);

const findMapNodePath = (nodes: MapNode[], targetId: string, path: MapNode[] = []): MapNode[] | null => {
  for (const node of nodes) {
    const nextPath = [...path, node];
    if (node.id === targetId) return nextPath;
    const childPath = findMapNodePath(node.subLocations ?? [], targetId, nextPath);
    if (childPath) return childPath;
  }
  return null;
};

const resolveOpeningLocationPath = (nodes: MapNode[], preferredIds: string[] = []): MapNode[] => {
  const expandToPlace = (path: MapNode[]) => {
    const expanded = [...path];
    let current = expanded[expanded.length - 1];
    while (current?.subLocations?.[0] && expanded.length < 3) {
      current = current.subLocations[0];
      expanded.push(current);
    }
    return expanded;
  };

  for (const preferredId of preferredIds) {
    const path = findMapNodePath(nodes, preferredId);
    if (path) {
      return expandToPlace(path);
    }
  }

  const firstRegion = nodes[0];
  if (!firstRegion) return [];
  const firstCommandery = firstRegion.subLocations?.[0];
  const firstPlace = firstCommandery?.subLocations?.[0];
  return [firstRegion, firstCommandery, firstPlace].filter(Boolean) as MapNode[];
};

const fallbackAbilityScores: AbilityScores = {
  武力: 52,
  统率: 52,
  智力: 52,
  政治: 52,
  魅力: 52,
  机运: 50,
};

/* 存档列表展示用富化项 */
interface EnrichedSaveItem {
  id: string;
  saveKind: SaveKind;
  playerName: string;
  currentDate: string;
  locationName: string;
  turnCount: number;
  updatedAt: string;
}

function formatSaveTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso.slice(0, 16);
  }
}

function formatCloudBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 1 : 2)} MB`;
}

export const StartScreen: React.FC = () => {
  const [worldBooks] = useState(() => {
    initWorldBookRegistry();
    return listWorldBooks();
  });

  const [screen, setScreen] = useState<Screen>('menu');
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('game');
  const [mainApiStatus, setMainApiStatus] = useState<'checking' | 'ready' | 'missing'>('checking');
  const [isFirstUseGuideOpen, setIsFirstUseGuideOpen] = useState(false);
  const [isReleaseNotesOpen, setIsReleaseNotesOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [selectedWorldBookId, setSelectedWorldBookId] = useState<string | null>(null);
  const [selectedWorldlineKnowledgeMode, setSelectedWorldlineKnowledgeMode] = useState<WorldlineKnowledgeMode>(
    getDefaultWorldlineKnowledgeMode(),
  );
  const [selectedBookmarkId, setSelectedBookmarkId] = useState<string | null>(null);
  const [selectedBirthOrigin, setSelectedBirthOrigin] = useState<string>('');
  const [selectedOrigin, setSelectedOrigin] = useState<string>('');
  const [selectedRegionId, setSelectedRegionId] = useState<string>('');
  const [selectedCommanderyId, setSelectedCommanderyId] = useState<string>('');
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [selectedSceneId, setSelectedSceneId] = useState<string>('');
  const [currentSaveId, setCurrentSaveId] = useState<string | null>(null);
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const sessionGenerationRef = useRef(0);
  const modalScopeRef = useRef<HTMLDivElement>(null);
  const turnExecutionOwnerRef = useRef(new TurnExecutionOwner());
  const sessionAbortControllerRef = useRef(new AbortController());
  const pendingGameLoadGenerationRef = useRef<number | null>(null);
  const lastAutoCloudSyncKeyRef = useRef('');
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const [activeGameModal, setActiveGameModal] = useState<GameModal | null>(null);
  const [saveItems, setSaveItems] = useState<SaveListItem[]>([]);
  const [saveStatus, setSaveStatus] = useState('');
  const [enrichedSaves, setEnrichedSaves] = useState<EnrichedSaveItem[]>([]);
  const [saveSource, setSaveSource] = useState<'local' | 'cloud'>('local');
  const [cloudSession, setCloudSession] = useState<CloudSessionState | null>(null);
  const [cloudSaves, setCloudSaves] = useState<CloudSaveItem[]>([]);
  const [cloudUsage, setCloudUsage] = useState<CloudUsage | null>(null);
  const [cloudBusyId, setCloudBusyId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<
    | { type: 'single'; saveId: string }
    | { type: 'all' }
    | { type: 'customTrait'; traitId: string; label: string }
    | { type: 'customBirthOrigin'; optionId: string; label: string }
    | { type: 'customIdentity'; optionId: string; label: string }
    | { type: 'openingCharacterTemplate'; templateId: string; label: string }
    | null
  >(null);
  const [playerMode, setPlayerMode] = useState<PlayerMode>('original');
  const [playerName, setPlayerName] = useState('无名氏');
  const [playerCourtesyName, setPlayerCourtesyName] = useState('');
  const [playerSex, setPlayerSex] = useState<'男' | '女' | '其他'>('男');
  const [playerAge, setPlayerAge] = useState(18);
  const [playerBirthMonth, setPlayerBirthMonth] = useState(() => Math.floor(Math.random() * 12) + 1);
  const [playerBirthDay, setPlayerBirthDay] = useState(() => Math.floor(Math.random() * 30) + 1);
  const [playerAppearance, setPlayerAppearance] = useState('');
  const [playerPersonality, setPlayerPersonality] = useState('');
  const [situationSummary, setSituationSummary] = useState('');
  const [customNotes, setCustomNotes] = useState('');
  const [playerExtraRequest, setPlayerExtraRequest] = useState('');
  const [gameDifficulty, setGameDifficulty] = useState<GameDifficultyLevel>('standard');
  const [combatDifficulty, setCombatDifficulty] = useState<GameDifficultyLevel>('standard');
  const [warDifficulty, setWarDifficulty] = useState<GameDifficultyLevel>('standard');
  const [narrativePerspective, setNarrativePerspective] = useState<NarrativePerspective>('second_person');
  const [historicalName, setHistoricalName] = useState('');
  const [completionStatus, setCompletionStatus] = useState('');
  const [selectedAbilityPresetId, setSelectedAbilityPresetId] = useState('balanced');
  const [abilityScores, setAbilityScores] = useState<AbilityScores>(fallbackAbilityScores);
  const [abilityBaseScores, setAbilityBaseScores] = useState<AbilityScores>(fallbackAbilityScores);
  const [selectedTraitIds, setSelectedTraitIds] = useState<string[]>([]);
  const [customTraits, setCustomTraits] = useState<CharacterTrait[]>([]);
  const [customTraitDraft, setCustomTraitDraft] = useState({ label: '', description: '' });
  const [showCustomTraitForm, setShowCustomTraitForm] = useState(false);
  const [editingCustomTraitId, setEditingCustomTraitId] = useState<string | null>(null);
  const [customBirthOrigins, setCustomBirthOrigins] = useState<OpeningCharacterOption[]>([]);
  const [customIdentities, setCustomIdentities] = useState<OpeningCharacterOption[]>([]);
  const [customBirthDraft, setCustomBirthDraft] = useState({ label: '', description: '' });
  const [customIdentityDraft, setCustomIdentityDraft] = useState({ label: '', description: '' });
  const [customOpeningPlaces, setCustomOpeningPlaces] = useState<MapNode[]>([]);
  const [customPlaceDraft, setCustomPlaceDraft] = useState({ label: '', description: '' });
  const [showCustomBirthForm, setShowCustomBirthForm] = useState(false);
  const [showCustomIdentityForm, setShowCustomIdentityForm] = useState(false);
  const [showCustomPlaceForm, setShowCustomPlaceForm] = useState(false);
  const [editingCustomBirthId, setEditingCustomBirthId] = useState<string | null>(null);
  const [editingCustomIdentityId, setEditingCustomIdentityId] = useState<string | null>(null);
  const [loadedCustomOpeningWorldBookId, setLoadedCustomOpeningWorldBookId] = useState<string | null>(null);
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [openingStartStatus, setOpeningStartStatus] = useState('');
  const [pendingTrueOpeningSaveId, setPendingTrueOpeningSaveId] = useState<string | null>(null);
  const [characterTemplates, setCharacterTemplates] = useState<OpeningCharacterTemplate[]>(
    () => loadOpeningCharacterTemplates(),
  );
  const [characterTemplateModal, setCharacterTemplateModal] = useState<CharacterTemplateModal | null>(null);
  const [characterTemplateName, setCharacterTemplateName] = useState('');
  const [activeCharacterTemplateId, setActiveCharacterTemplateId] = useState<string | null>(null);
  const [characterTemplateStatus, setCharacterTemplateStatus] = useState('');

  const refreshMainApiStatus = useCallback(async () => {
    try {
      setMainApiStatus(await resolveApiConfigForTaskAsync('mainNarrative') ? 'ready' : 'missing');
    } catch {
      setMainApiStatus('missing');
    }
  }, []);

  useEffect(() => {
    void refreshMainApiStatus();
  }, [refreshMainApiStatus]);

  useEffect(() => {
    if (!shouldShowDailyReleaseNotes()) return;
    recordDailyReleaseNotesView();
    setIsReleaseNotesOpen(true);
  }, []);

  const advanceGameSession = useCallback((cancellationStatus?: string) => {
    const cancelledActiveExecution = turnExecutionOwnerRef.current.invalidate();
    if (!sessionAbortControllerRef.current.signal.aborted) {
      sessionAbortControllerRef.current.abort(new TurnExecutionCancelledError());
    }
    sessionAbortControllerRef.current = new AbortController();
    pendingGameLoadGenerationRef.current = null;
    sessionGenerationRef.current += 1;
    setSessionGeneration(sessionGenerationRef.current);
    if (cancelledActiveExecution && cancellationStatus) {
      setSaveStatus(cancellationStatus);
    }
    return sessionGenerationRef.current;
  }, []);

  useEffect(() => {
    if (sessionAbortControllerRef.current.signal.aborted) {
      sessionAbortControllerRef.current = new AbortController();
    }
    return () => {
      turnExecutionOwnerRef.current.invalidate();
      if (!sessionAbortControllerRef.current.signal.aborted) {
        sessionAbortControllerRef.current.abort(new TurnExecutionCancelledError());
      }
    };
  }, []);

  const isCurrentSession = useCallback(
    (generation: number) => sessionGenerationRef.current === generation,
    [],
  );

  const beginGameLoadOperation = useCallback((cancellationStatus: string) => {
    const generation = advanceGameSession(cancellationStatus);
    if (screen === 'game') pendingGameLoadGenerationRef.current = generation;
    return generation;
  }, [advanceGameSession, screen]);

  const finishGameLoadOperation = useCallback((generation: number) => {
    if (pendingGameLoadGenerationRef.current === generation) {
      pendingGameLoadGenerationRef.current = null;
    }
  }, []);

  const worldBook = useMemo(
    () => (selectedWorldBookId ? getWorldBook(selectedWorldBookId) : null),
    [selectedWorldBookId],
  );
  const bookmarks = useMemo(
    () => (worldBook ? listStartBookmarks(worldBook) : []),
    [worldBook],
  );
  const selectedBookmark = useMemo(
    () => bookmarks.find((bookmark) => bookmark.id === selectedBookmarkId),
    [bookmarks, selectedBookmarkId],
  );
  const derivedPlayerBirthDate = useMemo(() => (
    selectedBookmark
      ? ensureCompleteBirthDate({
          age: playerAge,
          currentDate: selectedBookmark.startDate,
          stableId: 'player_1',
          preferredMonth: playerBirthMonth,
          preferredDay: playerBirthDay,
        })
      : undefined
  ), [playerAge, playerBirthDay, playerBirthMonth, selectedBookmark]);
  const baseOpeningLocationSeed = useMemo(
    () => worldBook?.openingLocationSeed ?? worldBook?.mapSeed ?? [],
    [worldBook],
  );
  const openingLocationSeed = useMemo(
    () => attachCustomOpeningPlaces(baseOpeningLocationSeed, customOpeningPlaces),
    [baseOpeningLocationSeed, customOpeningPlaces],
  );
  const locationOptions = useMemo(
    () => flattenMapNodes(openingLocationSeed),
    [openingLocationSeed],
  );
  const characterOptions = useMemo<OpeningCharacterOptions>(() => {
    const socialClasses = worldBook?.ontology.socialClasses ?? [];
    const actorRoles = worldBook?.ontology.actorRoleTypes ?? [];

    return {
      birthOrigins: worldBook?.characterOptions?.birthOrigins ?? socialClasses.map((label) => ({ id: label, label })),
      identities: worldBook?.characterOptions?.identities ?? actorRoles.map((label) => ({ id: label, label })),
      abilityPresets: worldBook?.characterOptions?.abilityPresets ?? [
        { id: 'balanced', label: '均衡型', scores: fallbackAbilityScores },
      ],
      traits: worldBook?.characterOptions?.traits ?? [],
      hiddenAbilityKeys: worldBook?.characterOptions?.hiddenAbilityKeys ?? ['机运'],
    };
  }, [worldBook]);
  const openingCharacterOptions = useMemo<OpeningCharacterOptions>(() => ({
    ...characterOptions,
    birthOrigins: [...characterOptions.birthOrigins, ...customBirthOrigins],
    identities: [...characterOptions.identities, ...customIdentities],
    traits: [...(characterOptions.traits ?? []), ...customTraits],
  }), [characterOptions, customBirthOrigins, customIdentities, customTraits]);
  const selectedAbilityPreset = useMemo(
    () => openingCharacterOptions.abilityPresets.find((preset) => preset.id === selectedAbilityPresetId),
    [openingCharacterOptions.abilityPresets, selectedAbilityPresetId],
  );
  const selectedTraits = useMemo(
    () => (openingCharacterOptions.traits ?? []).filter((trait) => selectedTraitIds.includes(trait.id)),
    [openingCharacterOptions.traits, selectedTraitIds],
  );
  const visibleAbilityEntries = useMemo(
    () => Object.entries(abilityScores).filter(([key]) => !(openingCharacterOptions.hiddenAbilityKeys ?? []).includes(key)),
    [abilityScores, openingCharacterOptions.hiddenAbilityKeys],
  );
  const visibleAbilityKeys = useMemo(
    () => visibleAbilityEntries.map(([key]) => key),
    [visibleAbilityEntries],
  );
  const remainingAbilityPoints = useMemo(
    () => getOpeningAbilityPointsRemaining(abilityBaseScores, abilityScores, visibleAbilityKeys),
    [abilityBaseScores, abilityScores, visibleAbilityKeys],
  );
  const locationSelection = useMemo(
    () => buildOpeningLocationSelection(openingLocationSeed, selectedRegionId, selectedCommanderyId, selectedLocationId, selectedSceneId),
    [openingLocationSeed, selectedRegionId, selectedCommanderyId, selectedLocationId, selectedSceneId],
  );
  const selectedBirthOption = openingCharacterOptions.birthOrigins.find((option) => option.id === selectedBirthOrigin);
  const selectedIdentityOption = openingCharacterOptions.identities.find((option) => option.id === selectedOrigin);
  const selectedBirthLabel = selectedBirthOption?.label ?? selectedBirthOrigin;
  const selectedIdentityLabel = selectedIdentityOption?.label ?? selectedOrigin;
  const selectedBirthDescription = selectedBirthOption?.description ?? '';
  const selectedIdentityDescription = selectedIdentityOption?.description ?? '';
  const compatibleCharacterTemplates = useMemo(
    () => characterTemplates.filter((template) => template.worldBookId === selectedWorldBookId),
    [characterTemplates, selectedWorldBookId],
  );
  const activeCharacterTemplate = useMemo(
    () => characterTemplates.find((template) => template.id === activeCharacterTemplateId) ?? null,
    [activeCharacterTemplateId, characterTemplates],
  );
  const selectedLocationName = locationSelection.pathLabel || (locationOptions.find((loc) => loc.id === selectedLocationId)?.name ?? selectedLocationId);
  const openingSituationSummary = useMemo(() => {
    const explicitSituation = situationSummary.trim();
    if (explicitSituation) return explicitSituation;
    return [
      selectedBirthLabel || '未定出身',
      selectedIdentityLabel ? `以${selectedIdentityLabel}身份` : '身份未定',
      selectedLocationName ? `起于${selectedLocationName}` : '起点未定',
    ].join('，');
  }, [selectedBirthLabel, selectedIdentityLabel, selectedLocationName, situationSummary]);
  const composedCustomNotes = useMemo(() => {
    const abilityText = Object.entries(abilityScores).map(([key, value]) => `${key}${value}`).join('、');
    return [
      playerCourtesyName.trim() ? `字：${playerCourtesyName.trim()}` : '',
      playerAppearance.trim() ? `外貌：${playerAppearance.trim()}` : '',
      playerPersonality.trim() ? `性格：${playerPersonality.trim()}` : '',
      selectedBirthLabel ? `出身：${selectedBirthLabel}` : '',
      selectedBirthDescription ? `出身说明：${selectedBirthDescription}` : '',
      selectedIdentityLabel ? `当前身份：${selectedIdentityLabel}` : '',
      selectedIdentityDescription ? `身份说明：${selectedIdentityDescription}` : '',
      selectedLocationName ? `初始地点：${selectedLocationName}` : '',
      abilityText ? `开局能力：${abilityText}` : '',
      selectedTraits.length > 0 ? `开局特质：${selectedTraits.map((trait) => `${trait.label}：${trait.description}`).join('；')}` : '',
      '初始行装：根据姓名、出身、当前身份、历史人物档案、初始地点与玩家额外要求，随开场剧情一并确定，无需手动选择。',
      playerExtraRequest.trim() ? `玩家额外开局要求：${playerExtraRequest.trim()}` : '',
      customNotes.trim() ? `AI补全/补充档案：${customNotes.trim()}` : '',
    ].filter(Boolean).join('\n');
  }, [
    abilityScores,
    customNotes,
    playerAppearance,
    playerCourtesyName,
    playerExtraRequest,
    playerPersonality,
    selectedBirthLabel,
    selectedBirthDescription,
    selectedIdentityLabel,
    selectedIdentityDescription,
    selectedLocationName,
    selectedTraits,
  ]);

  const manualSaves = useMemo(
    () => enrichedSaves.filter((save) => save.saveKind === 'manual'),
    [enrichedSaves],
  );
  const autoSaves = useMemo(
    () => enrichedSaves.filter((save) => save.saveKind !== 'manual'),
    [enrichedSaves],
  );

  const refreshSaveItems = useCallback(async () => {
    const items = await listSaves();
    setSaveItems(items);
    setEnrichedSaves(items.map((item) => ({
      id: item.id,
      saveKind: item.saveKind ?? 'auto',
      playerName: item.playerName,
      currentDate: item.currentDate,
      locationName: item.locationName,
      turnCount: item.turnCount,
      updatedAt: item.updatedAt,
    })));
  }, []);

  const refreshCloudSaves = useCallback(async () => {
    try {
      const session = await getCloudSession();
      setCloudSession(session);
      if (!session.authenticated) {
        setCloudSaves([]);
        setCloudUsage(session.usage ?? null);
        return;
      }
      const cloud = await listCloudSaves();
      setCloudSaves(cloud.saves);
      setCloudUsage(cloud.usage);
    } catch (error) {
      setCloudSaves([]);
      setCloudUsage(null);
      setSaveStatus(`云存档状态读取失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, []);

  useEffect(() => {
    void refreshSaveItems();
  }, [refreshSaveItems]);

  useEffect(() => {
    if (screen === 'load') {
      setSaveSource('local');
      void refreshCloudSaves();
    }
  }, [refreshCloudSaves, screen]);

  useEffect(() => {
    const cloudAuth = new URLSearchParams(window.location.search).get('cloudAuth');
    if (!cloudAuth) return;
    setSaveStatus(cloudAuth === 'success' ? 'Discord 登录成功，可以使用云存档。' : 'Discord 登录未完成，请重试。');
    void refreshCloudSaves();
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('cloudAuth');
    window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }, [refreshCloudSaves]);

  useEffect(() => {
    if (!currentSaveId || !runtimeState || !loadCloudSyncPreferences().autoSyncCurrentSave) return;
    const syncKey = `${currentSaveId}:${runtimeState.currentDate}:${runtimeState.turnLog.length}`;
    if (lastAutoCloudSyncKeyRef.current === syncKey) return;
    const timer = window.setTimeout(() => {
      lastAutoCloudSyncKeyRef.current = syncKey;
      void syncCurrentSave(currentSaveId)
        .then(() => {
          if (activeGameModal === 'save' || activeGameModal === 'load') {
            setSaveStatus('当前活动存档已自动同步到云端。');
            void refreshCloudSaves();
          }
        })
        .catch((error) => {
          if (error instanceof CloudSaveApiError && error.code === 'not_authenticated') return;
          if (activeGameModal === 'save' || activeGameModal === 'load') {
            setSaveStatus(`云端自动同步未完成：${error instanceof Error ? error.message : '未知错误'}；本地存档已保留。`);
          }
        });
    }, 4_000);
    return () => window.clearTimeout(timer);
  }, [
    activeGameModal,
    currentSaveId,
    refreshCloudSaves,
    runtimeState,
  ]);

  useEffect(() => {
    if (!selectedWorldBookId) {
      setCustomTraits([]);
      setCustomBirthOrigins([]);
      setCustomIdentities([]);
      setEditingCustomTraitId(null);
      setEditingCustomBirthId(null);
      setEditingCustomIdentityId(null);
      setShowCustomTraitForm(false);
      setLoadedCustomOpeningWorldBookId(null);
      return;
    }

    const savedCustomOptions = loadCustomOpeningOptions(selectedWorldBookId);
    setCustomTraits(savedCustomOptions.traits);
    setCustomBirthOrigins(savedCustomOptions.birthOrigins);
    setCustomIdentities(savedCustomOptions.identities);
    setEditingCustomTraitId(null);
    setEditingCustomBirthId(null);
    setEditingCustomIdentityId(null);
    setShowCustomTraitForm(false);
    setShowCustomBirthForm(false);
    setShowCustomIdentityForm(false);
    setLoadedCustomOpeningWorldBookId(selectedWorldBookId);
  }, [selectedWorldBookId]);

  useEffect(() => {
    if (!selectedWorldBookId || loadedCustomOpeningWorldBookId !== selectedWorldBookId) return;

    saveCustomOpeningOptions(selectedWorldBookId, {
      birthOrigins: customBirthOrigins,
      identities: customIdentities,
      traits: customTraits,
    });
  }, [customBirthOrigins, customIdentities, customTraits, loadedCustomOpeningWorldBookId, selectedWorldBookId]);

  const handleSelectWorldBook = (id: string) => {
    const nextWorldBook = getWorldBook(id);
    const nextPreset = nextWorldBook?.characterOptions?.abilityPresets[0];
    const nextBookmark = nextWorldBook ? listStartBookmarks(nextWorldBook)[0] : undefined;
    const defaultLocationPath = nextWorldBook
      ? resolveOpeningLocationPath(nextWorldBook.openingLocationSeed ?? nextWorldBook.mapSeed, nextBookmark?.recommendedRegions)
      : [];
    setSelectedWorldBookId(id);
    setSelectedWorldlineKnowledgeMode(getDefaultWorldlineKnowledgeMode());
    setSelectedBookmarkId(nextBookmark?.id ?? null);
    setSelectedBirthOrigin('');
    setSelectedOrigin('');
    setSelectedRegionId(defaultLocationPath[0]?.id ?? '');
    setSelectedCommanderyId(defaultLocationPath[1]?.id ?? '');
    setSelectedLocationId(defaultLocationPath[2]?.id ?? defaultLocationPath[1]?.id ?? defaultLocationPath[0]?.id ?? '');
    setSelectedSceneId('');
    setSelectedAbilityPresetId(nextPreset?.id ?? 'balanced');
    setAbilityScores({ ...(nextPreset?.scores ?? fallbackAbilityScores) });
    setAbilityBaseScores({ ...(nextPreset?.scores ?? fallbackAbilityScores) });
    setSelectedTraitIds([]);
    setCustomTraits([]);
    setCustomTraitDraft({ label: '', description: '' });
    setShowCustomTraitForm(false);
    setEditingCustomTraitId(null);
    setCustomOpeningPlaces([]);
    setCustomPlaceDraft({ label: '', description: '' });
    setShowCustomBirthForm(false);
    setShowCustomIdentityForm(false);
    setShowCustomPlaceForm(false);
    setEditingCustomBirthId(null);
    setEditingCustomIdentityId(null);
    setActiveCharacterTemplateId(null);
    setCharacterTemplateStatus('');
  };

  const handleSelectBookmark = (id: string) => {
    setSelectedBookmarkId(id);
    if (worldBook) {
      const nextBookmark = getStartBookmark(worldBook, id);
      const defaultLocationPath = resolveOpeningLocationPath(openingLocationSeed, nextBookmark?.recommendedRegions);
      setSelectedRegionId(defaultLocationPath[0]?.id ?? '');
      setSelectedCommanderyId(defaultLocationPath[1]?.id ?? '');
      setSelectedLocationId(defaultLocationPath[2]?.id ?? defaultLocationPath[1]?.id ?? defaultLocationPath[0]?.id ?? '');
      setSelectedSceneId('');
    }
  };

  const generateRuntimeState = useCallback((): RuntimeState | null => {
    if (!worldBook || !selectedBookmarkId || !selectedOrigin || !selectedLocationId) return null;

    const bookmark = getStartBookmark(worldBook, selectedBookmarkId);
    if (!bookmark) return null;

    return createCustomOpeningState({
      worldBook: { ...worldBook, openingLocationSeed },
      bookmark,
      playerName: playerMode === 'historical' ? historicalName || playerName : playerName,
      courtesyName: playerCourtesyName,
      playerSex,
      playerAge,
      playerBirthMonth,
      playerBirthDay,
      origin: [selectedBirthLabel, selectedIdentityLabel].filter(Boolean).join(' / '),
      birthOrigin: selectedBirthLabel,
      birthOriginDescription: selectedBirthDescription,
      currentIdentity: selectedIdentityLabel,
      currentIdentityDescription: selectedIdentityDescription,
      locationId: selectedLocationId,
      locationPath: selectedLocationName,
      situationSummary: openingSituationSummary,
      appearance: playerAppearance,
      personality: playerPersonality,
      abilityScores: normalizeOpeningAbilityAllocation(
        abilityBaseScores,
        abilityScores,
        visibleAbilityKeys,
      ),
      traits: selectedTraits,
      openingExtraRequest: playerExtraRequest,
      customNotes: composedCustomNotes,
      worldlineSettings: createOpeningWorldlineSettings(selectedWorldBookId, selectedWorldlineKnowledgeMode),
      gameDifficulty,
      combatDifficulty,
      warDifficulty,
      narrativePerspective,
    });
  }, [
    worldBook,
    selectedWorldBookId,
    selectedWorldlineKnowledgeMode,
    gameDifficulty,
    combatDifficulty,
    warDifficulty,
    narrativePerspective,
    selectedBookmarkId,
    selectedOrigin,
    selectedLocationId,
    openingLocationSeed,
    playerMode,
    historicalName,
    playerName,
    playerCourtesyName,
    playerSex,
    playerAge,
    playerBirthMonth,
    playerBirthDay,
    playerAppearance,
    playerPersonality,
    abilityBaseScores,
    abilityScores,
    visibleAbilityKeys,
    selectedTraits,
    playerExtraRequest,
    selectedBirthLabel,
    selectedBirthDescription,
    selectedIdentityLabel,
    selectedIdentityDescription,
    selectedLocationName,
    openingSituationSummary,
    composedCustomNotes,
  ]);

  const openingPreview = useMemo(
    () => (step === 6 ? generateRuntimeState() : null),
    [step, generateRuntimeState],
  );
  const selectedGameDifficulty = getGameDifficultyProfile(gameDifficulty);
  const selectedCombatDifficulty = getEncounterDifficultyProfile('combat', combatDifficulty);
  const selectedWarDifficulty = getEncounterDifficultyProfile('war', warDifficulty);
  const selectedNarrativePerspective = getNarrativePerspectiveProfile(narrativePerspective);

  const handleStartNew = () => {
    advanceGameSession('当前回合已取消。');
    if (!selectedWorldBookId && worldBooks[0]) {
      const defaultWorldBook = getWorldBook(worldBooks[0].id);
      const defaultPreset = defaultWorldBook?.characterOptions?.abilityPresets[0];
      const defaultBookmark = defaultWorldBook ? listStartBookmarks(defaultWorldBook)[0] : undefined;
      const defaultLocationPath = defaultWorldBook
        ? resolveOpeningLocationPath(defaultWorldBook.openingLocationSeed ?? defaultWorldBook.mapSeed, defaultBookmark?.recommendedRegions)
        : [];
      setSelectedWorldBookId(worldBooks[0].id);
      setSelectedWorldlineKnowledgeMode(getDefaultWorldlineKnowledgeMode());
      setSelectedBookmarkId(defaultBookmark?.id ?? null);
      setSelectedRegionId(defaultLocationPath[0]?.id ?? '');
      setSelectedCommanderyId(defaultLocationPath[1]?.id ?? '');
      setSelectedLocationId(defaultLocationPath[2]?.id ?? defaultLocationPath[1]?.id ?? defaultLocationPath[0]?.id ?? '');
      setSelectedSceneId('');
      setSelectedAbilityPresetId(defaultPreset?.id ?? 'balanced');
      setAbilityScores({ ...(defaultPreset?.scores ?? fallbackAbilityScores) });
      setAbilityBaseScores({ ...(defaultPreset?.scores ?? fallbackAbilityScores) });
    }
    setScreen('create');
    setStep(1);
    setGameDifficulty('standard');
    setCombatDifficulty('standard');
    setWarDifficulty('standard');
    setNarrativePerspective('second_person');
  };

  const handleStartNewWithConfigCheck = async () => {
    const apiConfig = await resolveApiConfigForTaskAsync('mainNarrative');
    if (!apiConfig) {
      setMainApiStatus('missing');
      setIsFirstUseGuideOpen(true);
      return;
    }
    setMainApiStatus('ready');
    handleStartNew();
  };

  const openSettingsAt = (tab: SettingsTab) => {
    setSettingsInitialTab(tab);
    setIsFirstUseGuideOpen(false);
    setScreen('settings');
  };

  const openReleaseNotes = () => {
    recordDailyReleaseNotesView();
    setIsReleaseNotesOpen(true);
  };

  const closeReleaseNotes = () => setIsReleaseNotesOpen(false);

  const handleContinue = async () => {
    const generation = beginGameLoadOperation('当前回合已取消，正在读取最近存档。');
    try {
      const save = await continueLastSave();
      if (!isCurrentSession(generation)) return;
      if (save) {
        const activeSave = await prepareLoadedSaveForPlay(save, generation);
        if (!activeSave || !isCurrentSession(generation)) return;
        setSelectedWorldBookId(activeSave.runtimeState.worldBookId);
        setCurrentSaveId(activeSave.id);
        setRuntimeState(activeSave.runtimeState);
        setActiveGameModal(null);
        setSaveStatus('');
        setScreen('game');
      }
    } finally {
      finishGameLoadOperation(generation);
    }
  };

  const handleLoadSave = async (saveId: string) => {
    const generation = beginGameLoadOperation('当前回合已取消，正在切换存档。');
    try {
      const save = await loadSave(saveId);
      if (!isCurrentSession(generation)) return;
      if (save) {
        const activeSave = await prepareLoadedSaveForPlay(save, generation);
        if (!activeSave || !isCurrentSession(generation)) return;
        setSelectedWorldBookId(activeSave.runtimeState.worldBookId);
        setCurrentSaveId(activeSave.id);
        setRuntimeState(activeSave.runtimeState);
        setActiveGameModal(null);
        setSaveStatus('');
        setScreen('game');
      }
    } finally {
      finishGameLoadOperation(generation);
    }
  };

  const prepareLoadedSaveForPlay = async (
    save: SaveData,
    generation: number,
  ): Promise<SaveData | null> => {
    if (save.saveKind !== 'manual') return save;
    const signal = sessionAbortControllerRef.current.signal;
    const activeSave = await createSave(
      save.runtimeState,
      `${save.runtimeState.player.name || '未命名角色'} - 从手动存档继续`,
      { signal },
    );
    if (!isCurrentSession(generation)) return null;
    await refreshSaveItems();
    return isCurrentSession(generation) ? activeSave : null;
  };

  const handleDeleteSingleSave = (saveId: string) => {
    setDeleteConfirm({ type: 'single', saveId });
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirm) return;

    if (deleteConfirm.type === 'customTrait') {
      const traitId = deleteConfirm.traitId;
      setCustomTraits((current) => current.filter((trait) => trait.id !== traitId));
      setSelectedTraitIds((current) => current.filter((id) => id !== traitId));
      if (editingCustomTraitId === traitId) {
        setEditingCustomTraitId(null);
        setCustomTraitDraft({ label: '', description: '' });
        setShowCustomTraitForm(false);
      }
      setDeleteConfirm(null);
      return;
    }

    if (deleteConfirm.type === 'customBirthOrigin') {
      const optionId = deleteConfirm.optionId;
      setCustomBirthOrigins((current) => current.filter((item) => item.id !== optionId));
      if (selectedBirthOrigin === optionId) setSelectedBirthOrigin('');
      if (editingCustomBirthId === optionId) {
        setEditingCustomBirthId(null);
        setCustomBirthDraft({ label: '', description: '' });
        setShowCustomBirthForm(false);
      }
      setDeleteConfirm(null);
      return;
    }

    if (deleteConfirm.type === 'customIdentity') {
      const optionId = deleteConfirm.optionId;
      setCustomIdentities((current) => current.filter((item) => item.id !== optionId));
      if (selectedOrigin === optionId) setSelectedOrigin('');
      if (editingCustomIdentityId === optionId) {
        setEditingCustomIdentityId(null);
        setCustomIdentityDraft({ label: '', description: '' });
        setShowCustomIdentityForm(false);
      }
      setDeleteConfirm(null);
      return;
    }

    if (deleteConfirm.type === 'openingCharacterTemplate') {
      const templates = deleteOpeningCharacterTemplate(deleteConfirm.templateId);
      setCharacterTemplates(templates);
      if (activeCharacterTemplateId === deleteConfirm.templateId) {
        setActiveCharacterTemplateId(null);
        setCharacterTemplateName('');
      }
      setCharacterTemplateStatus('人物模板已删除。');
      setDeleteConfirm(null);
      return;
    }

    if (deleteConfirm.type === 'single') {
      const previousArchive = await exportSaves();
      await deleteSave(deleteConfirm.saveId);
      await deleteUnreferencedSaveVisualPartitions(previousArchive, await exportSaves());
    } else {
      await clearAllSaves();
      await new IndexedDbAvgVisualOverrideRepository().clear();
    }
    setDeleteConfirm(null);
    await refreshSaveItems();
  };

  const enterGameWithState = async (
    state: RuntimeState,
    options: { autoGenerateOpening?: boolean; sessionGeneration?: number } = {},
  ): Promise<number | null> => {
    const generation = options.sessionGeneration
      ?? advanceGameSession('当前回合已取消，正在建立新存档。');
    if (!isCurrentSession(generation)) return null;
    const signal = sessionAbortControllerRef.current.signal;
    let save;
    try {
      save = await createSave(state, `${state.player.name} - ${selectedBookmarkId}`, { signal });
    } catch (error) {
      if (signal.aborted || isTurnExecutionCancelled(error)) return null;
      throw error;
    }
    if (!isCurrentSession(generation)) return null;
    setCurrentSaveId(save.id);
    setRuntimeState(state);
    setPendingTrueOpeningSaveId(options.autoGenerateOpening ? save.id : null);
    await refreshSaveItems();
    if (!isCurrentSession(generation)) return null;
    setScreen('game');
    return generation;
  };

  const handleDebugStartGame = async () => {
    const state = generateRuntimeState();
    if (!state) return;

    setOpeningStartStatus('');
    await enterGameWithState(state);
  };

  // 保留 handleDebugStartGame 为代码层调试入口（不再在 UI 渲染）。
  // 开发/测试环境暴露到 window.__cocDebugStart，供 Codex / Playwright 调用。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as unknown as { __cocDebugStart?: () => Promise<void> }).__cocDebugStart = handleDebugStartGame;
    return () => {
      delete (window as unknown as { __cocDebugStart?: () => Promise<void> }).__cocDebugStart;
    };
  }, [handleDebugStartGame]);

  const handleTrueOpeningStart = async () => {
    let generation = advanceGameSession('当前回合已取消。');
    if (!worldBook) return;

    const state = generateRuntimeState();
    if (!state) {
      setOpeningStartStatus('开局设定还不完整，请检查世界书、书签、角色与初始地点。');
      return;
    }

    setIsStartingGame(true);
    setOpeningStartStatus('正在调用主剧情 API 生成开场剧情...');

    try {
      const apiConfig = await resolveApiConfigForTaskAsync('mainNarrative');
      if (!isCurrentSession(generation)) return;
      if (!apiConfig) {
        throw new Error('开局前请先配置主剧情 API。');
      }

      const enteredGeneration = await enterGameWithState(state, {
        autoGenerateOpening: true,
        sessionGeneration: generation,
      });
      if (enteredGeneration !== null) generation = enteredGeneration;
    } catch (error) {
      if (isCurrentSession(generation)) {
        setOpeningStartStatus(error instanceof Error ? error.message : '开场剧情生成失败。');
      }
    } finally {
      if (isCurrentSession(generation)) setIsStartingGame(false);
    }
  };

  const handleReturnToMenu = () => {
    advanceGameSession();
    setActiveGameModal(null);
    setScreen('menu');
    setRuntimeState(null);
    setCurrentSaveId(null);
    setPendingTrueOpeningSaveId(null);
    setIsStartingGame(false);
    void refreshMainApiStatus();
  };

  const handleBackToMenu = () => {
    void refreshSaveItems();
    handleReturnToMenu();
  };

  const handleExportSaves = async () => {
    try {
      const archive = await exportSaves();
      const avgVisualPartitions = await exportSaveVisualPartitions(archive);
      const zipBytes = await createPortableSaveZip(archive, { avgVisualPartitions });
      downloadBlobFile(
        `coc-v2-saves-${dateStamp()}.zip`,
        new Blob([copyUint8ArrayToArrayBuffer(zipBytes)], { type: 'application/zip' }),
      );
      setSaveStatus(`存档已导出为 ZIP 分包，并包含 ${avgVisualPartitions.length} 个本地 AVG 视觉分区。`);
    } catch (error) {
      setSaveStatus(`存档导出失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleImportSaves = async () => {
    const generation = beginGameLoadOperation('当前回合已取消，正在导入存档。');
    try {
      const file = await pickSaveArchiveFile();
      if (!isCurrentSession(generation)) return;
      if (!file) return;
      const bundle = await readSaveArchiveBundleFile(file);
      if (!isCurrentSession(generation)) return;
      await importPortableSaveBundleAtomically(bundle);
      if (!isCurrentSession(generation)) return;
      await refreshSaveItems();
      if (!isCurrentSession(generation)) return;
      setSaveStatus('存档已导入并合并（支持 ZIP 与旧版 JSON）。');
    } catch (error) {
      if (isCurrentSession(generation)) {
        setSaveStatus(`存档导入失败：${error instanceof Error ? error.message : '未知错误'}`);
      }
    } finally {
      finishGameLoadOperation(generation);
    }
  };

  const handleManualSaveCurrent = async () => {
    if (!runtimeState) {
      setSaveStatus('当前没有可保存的游戏进度。');
      return;
    }

    try {
      const turnCount = runtimeState.turnLog?.length ?? 0;
      const label = `${runtimeState.player.name || '未命名角色'} - 第${turnCount}回合手动存档`;
      await createManualSave(runtimeState, label);
      await refreshSaveItems();
      setSaveStatus('当前进度已保存到手动存档。');
    } catch (error) {
      setSaveStatus(`保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleUploadCloudSave = async (saveId: string) => {
    const local = saveItems.find((save) => save.id === saveId);
    if (!local) {
      setSaveStatus('本地存档不存在，无法上传。');
      return;
    }
    const remote = cloudSaves.find((save) => save.slotId === saveId);
    const knownRevision = getKnownCloudRevision(saveId);
    if (remote && knownRevision !== remote.revision) {
      const confirmed = window.confirm(
        '云端已有一个本机未确认的版本。继续会以当前本地存档覆盖云端；如需保留云端版本，请先下载。确定继续吗？',
      );
      if (!confirmed) return;
    }
    setCloudBusyId(saveId);
    setSaveStatus('正在压缩并上传存档……');
    try {
      const uploaded = await uploadLocalSave(local, remote?.revision ?? 0);
      setSaveStatus(`云端上传完成：第 ${uploaded.revision} 版。`);
      await refreshCloudSaves();
    } catch (error) {
      setSaveStatus(`云端上传失败：${error instanceof Error ? error.message : '未知错误'}；本地存档不受影响。`);
    } finally {
      setCloudBusyId(null);
    }
  };

  const handleDownloadCloudSave = async (cloudSave: CloudSaveItem) => {
    const local = saveItems.find((save) => save.id === cloudSave.slotId);
    if (local && local.updatedAt !== cloudSave.metadata.updatedAt) {
      const confirmed = window.confirm(
        '本机已有同一槽位的存档。下载会用云端版本覆盖本机同槽位，但不会删除其他本地存档。确定继续吗？',
      );
      if (!confirmed) return;
    }
    setCloudBusyId(cloudSave.slotId);
    setSaveStatus('正在下载并校验云存档……');
    try {
      await downloadCloudSave(cloudSave);
      await refreshSaveItems();
      setSaveStatus('云存档已校验并写入本机；可切回“本地存档”读取。');
    } catch (error) {
      setSaveStatus(`云存档下载失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setCloudBusyId(null);
    }
  };

  const handleDeleteCloudSave = async (cloudSave: CloudSaveItem) => {
    if (!window.confirm('确定删除这个云存档吗？本机同名存档不会删除。')) return;
    setCloudBusyId(cloudSave.slotId);
    try {
      await deleteCloudSave(cloudSave);
      await refreshCloudSaves();
      setSaveStatus('云存档已删除，本地存档保持不变。');
    } catch (error) {
      setSaveStatus(`云存档删除失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setCloudBusyId(null);
    }
  };

  const openGameModal = (modal: GameModal, settingsTab?: SettingsTab) => {
    setSaveStatus('');
    if (modal === 'settings') {
      setSettingsInitialTab(settingsTab ?? 'game');
    }
    if (modal === 'save' || modal === 'load') {
      setSaveSource('local');
      void refreshSaveItems();
      void refreshCloudSaves();
    }
    setActiveGameModal(modal);
  };

  const handleCloseGameLoadModal = () => {
    if (shouldAdvanceSessionWhenClosingGameLoad(pendingGameLoadGenerationRef.current)) {
      advanceGameSession();
    }
    setActiveGameModal(null);
  };

  const handleAiCompleteHistoricalRole = async () => {
    if (!historicalName.trim()) {
      setCompletionStatus('请先填写历史人物姓名。');
      return;
    }

    const apiConfig = await resolveApiConfigForTaskAsync('npcCompletion');
    const configuredFallbackApiConfig = await resolveExplicitApiConfigForTaskAsync('npcCompletionFallback');
    const fallbackApiConfig = configuredFallbackApiConfig
      && (
        configuredFallbackApiConfig.id !== apiConfig?.id
        || configuredFallbackApiConfig.model !== apiConfig?.model
      )
      ? configuredFallbackApiConfig
      : null;
    if (!apiConfig) {
      setCompletionStatus('尚未配置 API。请先到设置里新建 API，并在任务路由中分配给 NPC/历史人物补全。');
      return;
    }

    setCompletionStatus('正在调用 AI 补全人物档案...');
    try {
      const selectedBookmark = worldBook && selectedBookmarkId ? getStartBookmark(worldBook, selectedBookmarkId) : undefined;
      const knowledgeBase = worldBook ? listWorldlineKnowledgeBasesForWorldBook(worldBook.manifest.id)[0] : undefined;
      const knowledgeHints = worldBook ? buildHistoricalRoleKnowledgeHints({
        knowledgeBase,
        worldBookId: worldBook.manifest.id,
        historicalName,
        bookmarkLabel: selectedBookmark?.label,
        bookmarkStartDate: selectedBookmark?.startDate,
        bookmarkSummary: selectedBookmark?.situationSummary ?? selectedBookmark?.description,
        currentLocationId: selectedLocationId,
      }) : [];
      const messages = buildHistoricalRoleCompletionMessages({
          worldName: worldBook?.manifest.name ?? '未知',
          bookmarkLabel: selectedBookmark?.label ?? '未选',
          bookmarkStartDate: selectedBookmark?.startDate,
          bookmarkSummary: selectedBookmark?.situationSummary ?? selectedBookmark?.description,
          historicalName,
          currentLocationId: selectedLocationId,
          birthOrigins: openingCharacterOptions.birthOrigins,
          identities: openingCharacterOptions.identities,
          traits: openingCharacterOptions.traits ?? [],
          mapSeed: openingLocationSeed,
          knowledgeHints,
      });
      const requestCompletion = async (config: ApiConfigArchive) => {
        const result = await openingLlmClient.generate({
          config,
          messages,
          temperature: config.temperature,
          maxOutputTokens: Math.min(config.maxOutputTokens ?? 2048, 2048),
          responseFormat: 'json_object',
          timeoutMs: NPC_COMPLETION_REQUEST_TIMEOUT_MS,
          retryCount: 0,
          retryDelayMs: 0,
        });
        if (!result.content.trim()) {
          throw new Error('接口没有返回人物内容');
        }
        return parseHistoricalRoleCompletionContent(result.content);
      };
      let parsed;
      try {
        parsed = await requestCompletion(apiConfig);
      } catch (primaryError) {
        if (!fallbackApiConfig) throw primaryError;
        setCompletionStatus('NPC建档主要 API 未完成，正在切换备用 API...');
        parsed = await requestCompletion(fallbackApiConfig);
      }
      const applied = applyHistoricalRoleCompletion(parsed, {
        currentHistoricalName: historicalName,
        currentSex: playerSex,
        currentAge: playerAge,
        currentBirthOriginId: selectedBirthOrigin,
        currentIdentityId: selectedOrigin,
        currentLocationId: selectedLocationId,
        currentAbilityScores: abilityScores,
        currentTraitIds: selectedTraitIds,
        birthOrigins: openingCharacterOptions.birthOrigins,
        identities: openingCharacterOptions.identities,
        traits: openingCharacterOptions.traits ?? [],
        mapSeed: openingLocationSeed,
      });
      setHistoricalName(applied.historicalName);
      setPlayerName(applied.playerName);
      setPlayerCourtesyName(applied.courtesyName);
      setPlayerSex(applied.sex);
      setPlayerAge(applied.age);
      setPlayerAppearance(applied.appearance);
      setPlayerPersonality(applied.personality);
      setSelectedBirthOrigin(applied.selectedBirthOriginId);
      setSelectedOrigin(applied.selectedIdentityId);
      setSelectedRegionId(applied.selectedLocationPathIds.regionId);
      setSelectedCommanderyId(applied.selectedLocationPathIds.commanderyId);
      setSelectedLocationId(applied.selectedLocationId);
      setSelectedSceneId(applied.selectedLocationPathIds.sceneId);
      setSituationSummary(applied.situationSummary);
      setSelectedAbilityPresetId('custom');
      setAbilityScores({ ...applied.abilityScores });
      setAbilityBaseScores({ ...applied.abilityScores });
      setSelectedTraitIds(applied.selectedTraitIds);
      setCustomNotes(applied.customNotes);
      setCompletionStatus('AI 补全已写入基础档案、出身身份、初始地点与补充设定，你可以继续手动修改。');
    } catch (error) {
      setCompletionStatus(`AI 补全失败：${error instanceof Error ? error.message : '未知错误'}。你仍然可以手动填写。`);
    }
  };

  const handleSelectAbilityPreset = (presetId: string) => {
    const preset = openingCharacterOptions.abilityPresets.find((item) => item.id === presetId);
    if (!preset) return;
    setSelectedAbilityPresetId(preset.id);
    setAbilityScores({ ...preset.scores });
    setAbilityBaseScores({ ...preset.scores });
  };

  const handleAdjustAbility = (key: string, delta: number) => {
    setSelectedAbilityPresetId('custom');
    setAbilityScores((current) => adjustOpeningAbilityAllocation(
      abilityBaseScores,
      current,
      visibleAbilityKeys,
      key,
      delta,
    ));
  };

  const buildCharacterTemplateProfile = (): OpeningCharacterTemplateProfile => ({
    playerMode,
    playerName,
    historicalName,
    courtesyName: playerCourtesyName,
    sex: playerSex,
    age: playerAge,
    birthMonth: playerBirthMonth,
    birthDay: playerBirthDay,
    appearance: playerAppearance,
    personality: playerPersonality,
    customNotes,
    ...(playerExtraRequest.trim() ? { playerExtraRequest: playerExtraRequest.trim() } : {}),
    abilityPresetId: selectedAbilityPresetId,
    abilityBaseScores: { ...abilityBaseScores },
    abilityScores: { ...abilityScores },
    birthOrigin: selectedBirthOption ? { ...selectedBirthOption } : null,
    identity: selectedIdentityOption ? { ...selectedIdentityOption } : null,
    traits: selectedTraits.map((trait) => ({ ...trait })),
  });

  const openCharacterTemplateSave = () => {
    const defaultName = activeCharacterTemplate?.label
      ?? (playerMode === 'historical' ? historicalName.trim() : playerName.trim())
      ?? '';
    setCharacterTemplates(loadOpeningCharacterTemplates());
    setCharacterTemplateName(defaultName || '未命名人物');
    setCharacterTemplateStatus('');
    setCharacterTemplateModal('save');
  };

  const openCharacterTemplateLoad = () => {
    setCharacterTemplates(loadOpeningCharacterTemplates());
    setCharacterTemplateStatus('');
    setCharacterTemplateModal('load');
  };

  const handleSaveCharacterTemplate = (mode: 'copy' | 'update') => {
    if (!selectedWorldBookId) {
      setCharacterTemplateStatus('请先选择世界。');
      return;
    }
    const label = characterTemplateName.trim();
    if (!label) {
      setCharacterTemplateStatus('请填写人物模板名称。');
      return;
    }
    const targetId = mode === 'update' && activeCharacterTemplate?.worldBookId === selectedWorldBookId
      ? activeCharacterTemplate.id
      : undefined;
    const templates = saveOpeningCharacterTemplate({
      ...(targetId ? { id: targetId } : {}),
      label,
      worldBookId: selectedWorldBookId,
      profile: buildCharacterTemplateProfile(),
    });
    const saved = targetId
      ? templates.find((template) => template.id === targetId)
      : templates[0];
    setCharacterTemplates(templates);
    setActiveCharacterTemplateId(saved?.id ?? null);
    setCharacterTemplateName(saved?.label ?? label);
    setCharacterTemplateStatus(targetId ? '当前人物模板已更新。' : '当前人物已另存为新模板。');
  };

  const handleLoadCharacterTemplate = (template: OpeningCharacterTemplate) => {
    if (!selectedWorldBookId || template.worldBookId !== selectedWorldBookId) {
      setCharacterTemplateStatus('该人物模板属于另一个世界，不能在当前世界读取。');
      return;
    }

    const profile = template.profile;
    if (profile.birthOrigin && !openingCharacterOptions.birthOrigins.some((option) => option.id === profile.birthOrigin?.id)) {
      setCustomBirthOrigins((current) => [...current, profile.birthOrigin as OpeningCharacterOption]);
    }
    if (profile.identity && !openingCharacterOptions.identities.some((option) => option.id === profile.identity?.id)) {
      setCustomIdentities((current) => [...current, profile.identity as OpeningCharacterOption]);
    }
    const knownTraitIds = new Set((openingCharacterOptions.traits ?? []).map((trait) => trait.id));
    const missingTraits = profile.traits.filter((trait) => !knownTraitIds.has(trait.id));
    if (missingTraits.length > 0) {
      setCustomTraits((current) => [
        ...current,
        ...missingTraits.filter((trait) => !current.some((existing) => existing.id === trait.id)),
      ]);
    }

    setPlayerMode(profile.playerMode);
    setPlayerName(profile.playerName);
    setHistoricalName(profile.historicalName);
    setPlayerCourtesyName(profile.courtesyName);
    setPlayerSex(profile.sex);
    setPlayerAge(profile.age);
    if (profile.birthMonth) setPlayerBirthMonth(profile.birthMonth);
    if (profile.birthDay) setPlayerBirthDay(profile.birthDay);
    setPlayerAppearance(profile.appearance);
    setPlayerPersonality(profile.personality);
    setCustomNotes(profile.customNotes);
    setPlayerExtraRequest(profile.playerExtraRequest ?? '');
    setSelectedAbilityPresetId(profile.abilityPresetId);
    setAbilityBaseScores({ ...profile.abilityBaseScores });
    setAbilityScores({ ...profile.abilityScores });
    setSelectedBirthOrigin(profile.birthOrigin?.id ?? '');
    setSelectedOrigin(profile.identity?.id ?? '');
    setSelectedTraitIds(profile.traits.map((trait) => trait.id));
    setActiveCharacterTemplateId(template.id);
    setCharacterTemplateName(template.label);
    setCharacterTemplateModal(null);
    setCharacterTemplateStatus(`已读取人物模板“${template.label}”；人物档案与模板中的开局额外要求已恢复，当前剧本、日期与地点未改变。`);
    setStep(3);
  };

  const handleToggleTrait = (traitId: string) => {
    setSelectedTraitIds((current) => {
      if (current.includes(traitId)) {
        return current.filter((id) => id !== traitId);
      }
      if (current.length >= 3) {
        return current;
      }
      return [...current, traitId];
    });
  };

  const beginCustomTraitEdit = (trait: CharacterTrait) => {
    setEditingCustomTraitId(trait.id);
    setCustomTraitDraft({ label: trait.label, description: trait.description });
    setShowCustomTraitForm(true);
  };

  const cancelCustomTraitEdit = () => {
    setEditingCustomTraitId(null);
    setCustomTraitDraft({ label: '', description: '' });
    setShowCustomTraitForm(false);
  };

  const handleAddCustomTrait = () => {
    const label = customTraitDraft.label.trim();
    const description = customTraitDraft.description.trim();
    if (!label) return;

    if (editingCustomTraitId) {
      setCustomTraits((current) => current.map((trait) => (
        trait.id === editingCustomTraitId
          ? updateCustomOpeningTrait(trait, label, description)
          : trait
      )));
    } else {
      const trait = createCustomOpeningTrait(label, description);
      setCustomTraits((current) => [...current, trait]);
      setSelectedTraitIds((current) => [...current.slice(0, 2), trait.id]);
    }

    cancelCustomTraitEdit();
  };

  const handleDeleteCustomTrait = (trait: CharacterTrait) => {
    setDeleteConfirm({ type: 'customTrait', traitId: trait.id, label: trait.label });
  };

  const beginCustomBirthOriginEdit = (option: OpeningCharacterOption) => {
    setEditingCustomBirthId(option.id);
    setCustomBirthDraft({ label: option.label, description: option.description ?? '' });
    setShowCustomBirthForm(true);
  };

  const cancelCustomBirthOriginEdit = () => {
    setEditingCustomBirthId(null);
    setCustomBirthDraft({ label: '', description: '' });
    setShowCustomBirthForm(false);
  };

  const handleAddCustomBirthOrigin = () => {
    const label = customBirthDraft.label.trim();
    const description = customBirthDraft.description.trim();
    if (!label) return;

    if (editingCustomBirthId) {
      setCustomBirthOrigins((current) => current.map((option) => (
        option.id === editingCustomBirthId
          ? { ...option, label, description: description || '玩家自定义出身。' }
          : option
      )));
      setSelectedBirthOrigin(editingCustomBirthId);
    } else {
      const option = createCustomOpeningOption('birth', label, description);
      setCustomBirthOrigins((current) => [...current, option]);
      setSelectedBirthOrigin(option.id);
    }

    cancelCustomBirthOriginEdit();
  };

  const handleDeleteCustomBirthOrigin = (option: OpeningCharacterOption) => {
    setDeleteConfirm({ type: 'customBirthOrigin', optionId: option.id, label: option.label });
  };

  const beginCustomIdentityEdit = (option: OpeningCharacterOption) => {
    setEditingCustomIdentityId(option.id);
    setCustomIdentityDraft({ label: option.label, description: option.description ?? '' });
    setShowCustomIdentityForm(true);
  };

  const cancelCustomIdentityEdit = () => {
    setEditingCustomIdentityId(null);
    setCustomIdentityDraft({ label: '', description: '' });
    setShowCustomIdentityForm(false);
  };

  const handleAddCustomIdentity = () => {
    const label = customIdentityDraft.label.trim();
    const description = customIdentityDraft.description.trim();
    if (!label) return;

    if (editingCustomIdentityId) {
      setCustomIdentities((current) => current.map((option) => (
        option.id === editingCustomIdentityId
          ? { ...option, label, description: description || '玩家自定义身份。' }
          : option
      )));
      setSelectedOrigin(editingCustomIdentityId);
    } else {
      const option = createCustomOpeningOption('identity', label, description);
      setCustomIdentities((current) => [...current, option]);
      setSelectedOrigin(option.id);
    }

    cancelCustomIdentityEdit();
  };

  const handleDeleteCustomIdentity = (option: OpeningCharacterOption) => {
    setDeleteConfirm({ type: 'customIdentity', optionId: option.id, label: option.label });
  };

  const handleAddCustomOpeningPlace = () => {
    const label = customPlaceDraft.label.trim();
    const description = customPlaceDraft.description.trim();
    if (!label || !selectedCommanderyId) return;
    const place = createCustomOpeningPlace({
      id: `custom_place_${Date.now()}`,
      parentId: selectedCommanderyId,
      name: label,
      summary: description || '玩家自定义开局地点，开局时由 LLM 结合世界书自洽生成。',
    });

    setCustomOpeningPlaces((current) => [...current, place]);
    setSelectedLocationId(place.id);
    setSelectedSceneId('');
    setCustomPlaceDraft({ label: '', description: '' });
    setShowCustomPlaceForm(false);
  };

  const handleSelectRegion = (regionId: string) => {
    const region = openingLocationSeed.find((node) => node.id === regionId);
    const firstCommandery = region?.subLocations?.[0];
    const firstPlace = firstCommandery?.subLocations?.[0];
    setSelectedRegionId(regionId);
    setSelectedCommanderyId(firstCommandery?.id ?? '');
    setSelectedLocationId(firstPlace?.id ?? firstCommandery?.id ?? regionId);
    setSelectedSceneId('');
    setShowCustomPlaceForm(false);
  };

  const handleSelectCommandery = (commanderyId: string) => {
    const commandery = locationSelection.commanderies.find((node) => node.id === commanderyId);
    const firstPlace = commandery?.subLocations?.[0];
    setSelectedCommanderyId(commanderyId);
    setSelectedLocationId(firstPlace?.id ?? commanderyId);
    setSelectedSceneId('');
    setShowCustomPlaceForm(false);
  };

  const handleSelectPlace = (placeId: string) => {
    setSelectedLocationId(placeId);
    setSelectedSceneId('');
  };

  const canProceedToNext = (): boolean => {
    switch (step) {
      case 1: return !!selectedWorldBookId && !!selectedBookmarkId;
      case 2: return true;
      case 3:
        return !!selectedLocationId
          && playerAge >= 1
          && (playerMode === 'original' || !!historicalName.trim());
      case 4: return true;
      case 5: return !!selectedBirthOrigin && !!selectedOrigin;
      case 6: return true;
      default: return false;
    }
  };

  /** 是否已满足进入指定 step 的所有前置条件（左侧导航跳转用） */
  const canEnterStep = (targetStep: number): boolean => {
    if (targetStep <= 1) return true;
    if (targetStep <= 2) return canProceedToNextAt(1);
    if (targetStep <= 3) return canProceedToNextAt(1) && canProceedToNextAt(2);
    if (targetStep <= 4) return canProceedToNextAt(1) && canProceedToNextAt(2) && canProceedToNextAt(3);
    if (targetStep <= 5) return canProceedToNextAt(1) && canProceedToNextAt(2) && canProceedToNextAt(3) && canProceedToNextAt(4);
    return canProceedToNextAt(1) && canProceedToNextAt(2) && canProceedToNextAt(3) && canProceedToNextAt(4) && canProceedToNextAt(5);
  };

  /** 不依赖 step state 的纯校验 */
  const canProceedToNextAt = (s: number): boolean => {
    switch (s) {
      case 1: return !!selectedWorldBookId && !!selectedBookmarkId;
      case 2: return true;
      case 3:
        return !!selectedLocationId
          && playerAge >= 1
          && (playerMode === 'original' || !!historicalName.trim());
      case 4: return true;
      case 5: return !!selectedBirthOrigin && !!selectedOrigin;
      case 6: return true;
      default: return false;
    }
  };

  const handleStepJump = (targetStep: number) => {
    if (targetStep === step) return;
    if (!canEnterStep(targetStep)) return;
    setStep(targetStep);
  };

  const renderWizardFooter = () => {
    if (step === 1) {
      return (
        <div className="wizard-footer">
          <span>步骤 1/6</span>
          <button onClick={() => setStep(2)} disabled={!canProceedToNext()} className="nav-btn">下一步</button>
        </div>
      );
    }

    if (step === 6) {
      return (
        <div className="wizard-footer">
          <button onClick={() => setStep(5)} className="nav-btn back" disabled={isStartingGame}>上一步</button>
          <button onClick={handleTrueOpeningStart} className="nav-btn primary" disabled={isStartingGame}>
            {isStartingGame ? '生成中...' : '踏入乱世'}
          </button>
        </div>
      );
    }

    return (
      <div className="wizard-footer wizard-footer-right">
        <button onClick={() => setStep(step - 1)} className="nav-btn previous-button">上一步</button>
        <button onClick={() => setStep(step + 1)} disabled={!canProceedToNext()} className="nav-btn next-button">下一步</button>
      </div>
    );
  };

  const renderSaveList = (saves: EnrichedSaveItem[], emptyText: string) => (
    <div className="save-section-scroll">
      <div className="save-section-list">
        {saves.length === 0 ? (
          <p className="muted">{emptyText}</p>
        ) : (
          saves.map((save) => (
            <div key={save.id} className="save-item">
              <button type="button" className="save-item-main" onClick={() => handleLoadSave(save.id)}>
                <span className="save-item-name">{save.playerName}</span>
                <span className="save-item-info">
                  {save.currentDate && `${save.currentDate} · `}
                  {save.locationName && `${save.locationName} · `}
                  第{save.turnCount}回合
                </span>
                <span className="save-item-time">保存于 {formatSaveTime(save.updatedAt)}</span>
              </button>
              <span className="save-item-actions">
                {cloudSession?.authenticated && (
                  <button
                    type="button"
                    className="save-item-cloud-action"
                    disabled={cloudBusyId === save.id}
                    title="上传或更新此云存档"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleUploadCloudSave(save.id);
                    }}
                  >
                    {cloudBusyId === save.id ? '上传中' : cloudSaves.some((item) => item.slotId === save.id) ? '更新云端' : '上传云端'}
                  </button>
                )}
                <button
                  type="button"
                  className="save-item-delete"
                  title="删除此存档"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDeleteSingleSave(save.id);
                  }}
                >
                  ✕
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderCloudSaveList = () => {
    if (!cloudSession) {
      return <div className="cloud-save-empty"><p>正在检查云存档服务……</p></div>;
    }
    if (!cloudSession.configured) {
      return <div className="cloud-save-empty"><p>云存档数据库尚未配置；本地存档仍可正常使用。</p></div>;
    }
    if (!cloudSession.authConfigured) {
      return <div className="cloud-save-empty"><p>云存档已接入，尚需维护者完成 Discord OAuth 配置。</p></div>;
    }
    if (!cloudSession.authenticated) {
      return (
        <div className="cloud-save-empty">
          <p>登录 Discord 后，可在电脑与手机之间同步存档。</p>
          <button type="button" className="nav-btn primary" onClick={() => startDiscordCloudLogin('/?cloud=1')}>
            登录 Discord
          </button>
          <small>只请求基础身份，不读取聊天内容，也不会自动加入服务器。</small>
        </div>
      );
    }
    if (cloudSaves.length === 0) {
      return (
        <div className="cloud-save-empty">
          <p>云端暂无存档。切回“本地存档”，选择需要上传的槽位。</p>
        </div>
      );
    }
    return (
      <div className="cloud-save-list">
        {cloudSaves.map((save) => (
          <article key={save.slotId} className="cloud-save-item">
            <div className="cloud-save-item-main">
              <div className="cloud-save-item-head">
                <strong>{save.metadata.playerName || save.metadata.label || '未命名角色'}</strong>
                <span>云端第 {save.revision} 版</span>
              </div>
              <p>
                {save.metadata.currentDate && `${save.metadata.currentDate} · `}
                {save.metadata.locationName && `${save.metadata.locationName} · `}
                第 {save.metadata.turnCount} 回合
              </p>
              <small>
                上传于 {formatSaveTime(save.updatedAt)} · {formatCloudBytes(save.sizeBytes)}
              </small>
            </div>
            <div className="cloud-save-item-actions">
              <button
                type="button"
                className="nav-btn primary"
                disabled={cloudBusyId === save.slotId}
                onClick={() => void handleDownloadCloudSave(save)}
              >
                {cloudBusyId === save.slotId ? '处理中…' : '下载到本机'}
              </button>
              <button
                type="button"
                className="nav-btn danger"
                disabled={cloudBusyId === save.slotId}
                onClick={() => void handleDeleteCloudSave(save)}
              >
                删除云端
              </button>
            </div>
          </article>
        ))}
      </div>
    );
  };

  const renderSaveSourceBar = () => (
    <div className="save-source-bar">
      <div className="save-source-tabs" role="tablist" aria-label="存档来源">
        <button
          type="button"
          className={saveSource === 'local' ? 'active' : ''}
          aria-selected={saveSource === 'local'}
          onClick={() => setSaveSource('local')}
        >
          本地存档 <span>{saveItems.length}</span>
        </button>
        <button
          type="button"
          className={saveSource === 'cloud' ? 'active' : ''}
          aria-selected={saveSource === 'cloud'}
          onClick={() => {
            setSaveSource('cloud');
            void refreshCloudSaves();
          }}
        >
          云端存档 <span>{cloudSaves.length}</span>
        </button>
      </div>
      <div className="save-cloud-summary">
        {cloudSession?.authenticated && cloudSession.account ? (
          <>
            <strong>{cloudSession.account.displayName}</strong>
            <span>{formatCloudBytes(cloudUsage?.usedBytes ?? 0)} / {formatCloudBytes(cloudUsage?.limitBytes ?? 0)}</span>
          </>
        ) : (
          <span>云存档为可选功能，本地模式始终可用</span>
        )}
      </div>
    </div>
  );

  const renderSaveModalBody = () => saveSource === 'cloud' ? (
    <div className="save-modal-body save-modal-body--cloud">
      {renderCloudSaveList()}
    </div>
  ) : (
    <div className="save-modal-body">
      <div className="save-section">
        <h3 className="save-section-title"><span>手动存档</span><span className="save-section-count">{manualSaves.length}</span></h3>
        {renderSaveList(manualSaves, '暂无手动存档')}
      </div>
      <div className="save-section-divider" />
      <div className="save-section">
        <h3 className="save-section-title"><span>自动存档</span><span className="save-section-count">{autoSaves.length}</span></h3>
        {renderSaveList(autoSaves, '暂无自动存档')}
      </div>
    </div>
  );

  const renderLoadModal = (onClose: () => void) => (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="save-modal" role="dialog" aria-modal="true" aria-label="读取存档" onClick={(event) => event.stopPropagation()}>
        <div className="save-modal-head">
          <div className="save-modal-title">
            <h2>兵戈再起</h2>
            <p>读取已有存档，继续当前乱世。</p>
          </div>
          <div className="save-modal-actions">
            <div className="save-modal-actions-main">
              <button className="nav-btn" disabled={saveItems.length === 0} onClick={handleContinue}>读取最近存档</button>
              <button className="nav-btn" onClick={handleExportSaves}>导出存档</button>
              <button className="nav-btn" onClick={handleImportSaves}>导入存档</button>
            </div>
            <div className="save-modal-danger-zone">
              <button
                className="nav-btn danger"
                disabled={saveItems.length === 0}
                onClick={() => setDeleteConfirm({ type: 'all' })}
              >
                清除存档
              </button>
            </div>
          </div>
          <button className="save-modal-close" onClick={onClose}>✕</button>
        </div>
        {renderSaveSourceBar()}
        {renderSaveModalBody()}
        {saveStatus && <p className="save-modal-status">{saveStatus}</p>}
      </section>
    </div>
  );

  const renderSaveProgressModal = (onClose: () => void) => (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="save-modal" role="dialog" aria-modal="true" aria-label="保存进度" onClick={(event) => event.stopPropagation()}>
        <div className="save-modal-head">
          <div className="save-modal-title">
            <h2>风云入卷</h2>
            <p>保存当前进度，将此刻乱世写入手动存档。</p>
          </div>
          <div className="save-modal-actions">
            <button className="nav-btn primary" onClick={() => void handleManualSaveCurrent()}>
              保存进度
            </button>
          </div>
          <button className="save-modal-close" onClick={onClose}>✕</button>
        </div>
        {renderSaveSourceBar()}
        {renderSaveModalBody()}
        {saveStatus && <p className="save-modal-status">{saveStatus}</p>}
      </section>
    </div>
  );

  const renderCharacterTemplateList = () => (
    <div className="character-template-list">
      {compatibleCharacterTemplates.length === 0 ? (
        <div className="character-template-empty">
          <strong>当前世界还没有人物模板</strong>
          <span>填写人物档案后点击左侧“保存人物”，以后可直接读取并继续修改。</span>
        </div>
      ) : compatibleCharacterTemplates.map((template) => (
        <article
          key={template.id}
          className={`character-template-item ${activeCharacterTemplateId === template.id ? 'active' : ''}`}
        >
          <button
            type="button"
            className="character-template-main"
            onClick={() => handleLoadCharacterTemplate(template)}
          >
            <span className="character-template-item-head">
              <strong>{template.label}</strong>
              <em>{template.profile.playerMode === 'historical' ? '历史人物' : '自创人物'}</em>
            </span>
            <span>
              {template.profile.playerName}
              {template.profile.courtesyName ? ` · 字${template.profile.courtesyName}` : ''}
              {` · ${template.profile.sex} ${template.profile.age}岁`}
            </span>
            <span>
              {template.profile.birthOrigin?.label ?? '出身未定'}
              {' · '}
              {template.profile.identity?.label ?? '身份未定'}
              {template.profile.traits.length > 0
                ? ` · ${template.profile.traits.map((trait) => trait.label).join('、')}`
                : ''}
            </span>
          </button>
          <button
            type="button"
            className="character-template-delete"
            aria-label={`删除人物模板 ${template.label}`}
            onClick={() => setDeleteConfirm({
              type: 'openingCharacterTemplate',
              templateId: template.id,
              label: template.label,
            })}
          >
            删除
          </button>
        </article>
      ))}
    </div>
  );

  const renderCharacterTemplateModal = () => {
    if (!characterTemplateModal) return null;
    const isSaveMode = characterTemplateModal === 'save';
    const canUpdate = Boolean(
      activeCharacterTemplate
      && activeCharacterTemplate.worldBookId === selectedWorldBookId,
    );
    return (
      <div className="modal-backdrop opening-template-backdrop" onClick={() => setCharacterTemplateModal(null)}>
        <section
          className="character-template-modal"
          role="dialog"
          aria-modal="true"
          aria-label={isSaveMode ? '保存开局人物' : '读取开局人物'}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="character-template-modal-head">
            <div>
              <p>{isSaveMode ? 'CHARACTER ARCHIVE' : 'CHARACTER LIBRARY'}</p>
              <h2>{isSaveMode ? '保存开局人物' : '读取开局人物'}</h2>
              <span>保存人物档案；已填写的开局额外要求也会一并保存，当前剧本、日期与地点不会改变。</span>
            </div>
            <button type="button" className="save-modal-close" onClick={() => setCharacterTemplateModal(null)}>✕</button>
          </header>

          {isSaveMode && (
            <div className="character-template-save-bar">
              <label>
                <span>模板名称</span>
                <input
                  type="text"
                  maxLength={80}
                  value={characterTemplateName}
                  onChange={(event) => setCharacterTemplateName(event.target.value)}
                  placeholder="例如：荆襄武官、寒门谋士"
                />
              </label>
              <div className="character-template-save-actions">
                {canUpdate && (
                  <button type="button" className="nav-btn" onClick={() => handleSaveCharacterTemplate('update')}>
                    更新当前模板
                  </button>
                )}
                <button type="button" className="nav-btn primary" onClick={() => handleSaveCharacterTemplate('copy')}>
                  另存为新模板
                </button>
              </div>
            </div>
          )}

          <div className="character-template-modal-body">
            <div className="character-template-list-head">
              <strong>{isSaveMode ? '当前世界的人物模板' : '选择要读取的人物'}</strong>
              <span>{compatibleCharacterTemplates.length} / 40</span>
            </div>
            {renderCharacterTemplateList()}
          </div>
          {characterTemplateStatus && (
            <p className="character-template-modal-status" role="status">{characterTemplateStatus}</p>
          )}
        </section>
      </div>
    );
  };

  const getDeleteConfirmTitle = () => {
    if (!deleteConfirm) return '';

    switch (deleteConfirm.type) {
      case 'customTrait':
        return '删除自定义特质';
      case 'customBirthOrigin':
        return '\u5220\u9664\u81ea\u5b9a\u4e49\u51fa\u8eab';
      case 'customIdentity':
        return '\u5220\u9664\u81ea\u5b9a\u4e49\u8eab\u4efd';
      case 'openingCharacterTemplate':
        return '删除人物模板';
      default:
        return '\u5220\u9664\u5b58\u6863';
    }
  };

  const getDeleteConfirmMessage = () => {
    if (!deleteConfirm) return '';

    switch (deleteConfirm.type) {
      case 'single':
        return '\u786e\u5b9a\u8981\u5220\u9664\u8fd9\u4e2a\u5b58\u6863\u5417\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u6062\u590d\u3002';
      case 'all':
        return '\u786e\u5b9a\u8981\u6e05\u9664\u5168\u90e8\u5b58\u6863\u5417\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u6062\u590d\u3002';
      case 'customTrait':
        return `确定要删除自定义特质“${deleteConfirm.label}”吗？此操作不可恢复，并会从本次已选特质中移除。`;
      case 'customBirthOrigin':
        return '\u786e\u5b9a\u8981\u5220\u9664\u81ea\u5b9a\u4e49\u51fa\u8eab\u300c' + deleteConfirm.label + '\u300d\u5417\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u6062\u590d\u3002';
      case 'customIdentity':
        return '\u786e\u5b9a\u8981\u5220\u9664\u81ea\u5b9a\u4e49\u8eab\u4efd\u300c' + deleteConfirm.label + '\u300d\u5417\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u6062\u590d\u3002';
      case 'openingCharacterTemplate':
        return `确定要删除人物模板“${deleteConfirm.label}”吗？此操作不可恢复。`;
    }
  };

  const renderDeleteConfirmModal = () => (
    <div className="modal-backdrop" onClick={() => setDeleteConfirm(null)}>
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-label={getDeleteConfirmTitle()} onClick={(event) => event.stopPropagation()}>
        <div className="confirm-modal-head">
          <span>{getDeleteConfirmTitle()}</span>
          <button className="save-modal-close" onClick={() => setDeleteConfirm(null)}>{'\u2715'}</button>
        </div>
        <div className="confirm-modal-body">
          <p>{getDeleteConfirmMessage()}</p>
        </div>
        <div className="confirm-modal-footer">
          <button className="nav-btn" onClick={() => setDeleteConfirm(null)}>{'\u53d6\u6d88'}</button>
          <button className="nav-btn danger" onClick={() => void handleConfirmDelete()}>{'\u786e\u8ba4\u5220\u9664'}</button>
        </div>
      </section>
    </div>
  );

  const renderSettingsModal = (onClose: () => void) => (
    <div className="modal-backdrop settings-backdrop" onClick={onClose}>
      <React.Suspense
        fallback={(
          <section className="settings-modal settings-modal-loading" role="dialog" aria-modal="true" aria-label="设置" onClick={(event) => event.stopPropagation()}>
            <div role="status">正在载入设置…</div>
            <button type="button" className="nav-btn" onClick={onClose}>关闭设置</button>
          </section>
        )}
      >
        <ApiSettingsPanel
          onClose={onClose}
          initialTab={settingsInitialTab}
          runtimeState={runtimeState}
          saveId={currentSaveId}
          onRuntimeStateChange={setRuntimeState}
        />
      </React.Suspense>
    </div>
  );

  const startModalKey = deleteConfirm
    ? `delete:${deleteConfirm.type}`
    : isFirstUseGuideOpen
      ? 'first-use-guide'
      : isReleaseNotesOpen
        ? 'release-notes'
        : characterTemplateModal
          ? `opening-character:${characterTemplateModal}`
          : activeGameModal
            ? `game:${activeGameModal}`
            : screen === 'load' || screen === 'settings'
              ? `screen:${screen}`
              : null;
  useModalAccessibility({
    modalKey: startModalKey,
    scopeRef: modalScopeRef,
    onClose: () => {
      if (deleteConfirm) {
        setDeleteConfirm(null);
      } else if (isFirstUseGuideOpen) {
        setIsFirstUseGuideOpen(false);
      } else if (isReleaseNotesOpen) {
        closeReleaseNotes();
      } else if (characterTemplateModal) {
        setCharacterTemplateModal(null);
      } else if (activeGameModal === 'load') {
        handleCloseGameLoadModal();
      } else if (activeGameModal) {
        setActiveGameModal(null);
      } else if (screen === 'load' || screen === 'settings') {
        handleReturnToMenu();
      }
    },
  });

  if (screen === 'game' && runtimeState && currentSaveId && worldBook) {
    const gameWorldBook = { ...worldBook, openingLocationSeed };
    return (
      <div ref={modalScopeRef} className="start-shell game-shell">
        <React.Suspense fallback={<div role="status">正在载入乱世……</div>}>
          <GameScreen
            key={`${currentSaveId}:${sessionGeneration}`}
            worldBook={gameWorldBook}
            runtimeState={runtimeState}
            saveId={currentSaveId}
            sessionGeneration={sessionGeneration}
            executionOwner={turnExecutionOwnerRef.current}
            autoGenerateOpening={pendingTrueOpeningSaveId === currentSaveId}
            onAutoOpeningStarted={() => setPendingTrueOpeningSaveId(null)}
            onRuntimeStateChange={setRuntimeState}
            onOpenSaveProgress={() => openGameModal('save')}
            onOpenLoadProgress={() => openGameModal('load')}
            onOpenSettings={(tab) => openGameModal('settings', tab)}
            onBackToStart={handleBackToMenu}
          />
        </React.Suspense>
        {activeGameModal === 'save' && renderSaveProgressModal(() => setActiveGameModal(null))}
        {activeGameModal === 'load' && renderLoadModal(handleCloseGameLoadModal)}
        {activeGameModal === 'settings' && renderSettingsModal(() => setActiveGameModal(null))}
        {deleteConfirm && renderDeleteConfirmModal()}
      </div>
    );
  }

  return (
    <div
      ref={modalScopeRef}
      className={`start-shell${screen === 'menu' || screen === 'load' || screen === 'settings' ? ' start-shell--menu-stage' : ''}`}
    >
      {(screen === 'menu' || screen === 'load' || screen === 'settings') && (
        <div className="main-menu-screen cloud-frame">
          <div className="main-menu-backdrop" aria-hidden="true">
            <div className="main-menu-collage">
              <div className="main-menu-scene main-menu-scene--watchtower">
                <span className="main-menu-scene-image" />
              </div>
              <div className="main-menu-scene main-menu-scene--river">
                <span className="main-menu-scene-image" />
              </div>
              <div className="main-menu-scene main-menu-scene--siege">
                <span className="main-menu-scene-image" />
              </div>
              <div className="main-menu-scene main-menu-scene--council">
                <span className="main-menu-scene-image" />
              </div>
            </div>
            <div className="main-menu-backdrop-mist" />
            <div className="main-menu-backdrop-glow">
              <span className="main-menu-light main-menu-light--watchtower" />
              <span className="main-menu-light main-menu-light--river" />
              <span className="main-menu-light main-menu-light--siege" />
              <span className="main-menu-light main-menu-light--council" />
            </div>
            <div className="main-menu-backdrop-shade" />
          </div>

          <section className="main-menu-focus" aria-label="主菜单">
            <p className="main-menu-kicker">CHRONICLES OF CHAOS</p>
            <h1 className="main-menu-title">乱世风云录</h1>
            <div className="main-menu vertical">
              <button type="button" data-index="01" onClick={() => void handleStartNewWithConfigCheck()} className="menu-btn primary">
                新的征程
              </button>
              <StartScreenLoadEntryButton onOpen={() => setScreen('load')} />
              <button type="button" data-index="03" onClick={() => openSettingsAt('game')} className="menu-btn secondary">
                设置
              </button>
            </div>
            {mainApiStatus !== 'ready' && (
              <div className="main-menu-utility" aria-label="配置状态">
                <button type="button" className="main-menu-config-warning" onClick={() => setIsFirstUseGuideOpen(true)}>
                  {mainApiStatus === 'checking' ? '正在检查主剧情 API…' : '主剧情 API 未配置'}
                </button>
              </div>
            )}
          </section>
          {screen === 'menu' && (
            <button
              type="button"
              className="main-menu-changelog-button"
              aria-label="打开更新日志"
              onClick={openReleaseNotes}
            >
              <span>更新日志</span>
              <small>CHANGELOG · {APP_VERSION_LABEL}</small>
            </button>
          )}
        </div>
      )}

      {screen === 'load' && renderLoadModal(handleReturnToMenu)}
      {characterTemplateModal && renderCharacterTemplateModal()}

      {deleteConfirm && renderDeleteConfirmModal()}

      {screen === 'settings' && renderSettingsModal(handleReturnToMenu)}

      {isFirstUseGuideOpen && (
        <div className="modal-backdrop first-use-backdrop" onClick={() => setIsFirstUseGuideOpen(false)}>
          <section
            className="confirm-modal first-use-modal"
            role="dialog"
            aria-modal="true"
            aria-label="开局配置检查"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirm-modal-head">
              <div>
                <span>开局配置检查</span>
                <small>还差一项必需配置</small>
              </div>
              <button type="button" className="save-modal-close" onClick={() => setIsFirstUseGuideOpen(false)}>✕</button>
            </div>
            <div className="confirm-modal-body first-use-body">
              <div className="first-use-status-card missing">
                <strong>主剧情 API</strong>
                <span>未找到可用配置</span>
                <p>先保存一份 API 接口和模型，并把主剧情路由指向该模型。完成后即可创建新档。</p>
              </div>
              <div className="first-use-status-card optional">
                <strong>辅助功能 API</strong>
                <span>可稍后设置</span>
                <p>记忆压缩、NPC 动态、向量检索和独立写回都允许复用主接口或暂时留空。</p>
              </div>
            </div>
            <div className="confirm-modal-footer">
              <button type="button" className="nav-btn" onClick={() => setIsFirstUseGuideOpen(false)}>暂不设置</button>
              <button type="button" className="nav-btn primary" onClick={() => openSettingsAt('api')}>前往 API 配置</button>
            </div>
          </section>
        </div>
      )}

      {isReleaseNotesOpen && <ReleaseNotesPanel onClose={closeReleaseNotes} />}

      {screen === 'create' && (
        <div className="creation-page cloud-frame">
          <div className="page-title-row">
            <div>
              <p className="eyebrow">CHRONICLES OF CHAOS</p>
              <h2>乱世开局向导</h2>
              <p>选择世界、时代与主角身份，生成可手动验收的开局状态。</p>
            </div>
            <button className="nav-btn back" onClick={handleReturnToMenu}>返回首页</button>
          </div>

          <div className="wizard-steps side">
            {[
              { num: 1, label: '01 世界与剧本' },
              { num: 2, label: '02 主角类型' },
              { num: 3, label: '03 基础档案' },
              { num: 4, label: '04 开局特质' },
              { num: 5, label: '05 出身身份' },
              { num: 6, label: '06 确认生成' },
            ].map((item) => {
              const isActive = step === item.num;
              const canEnter = canEnterStep(item.num);
              return (
                <button
                  key={item.num}
                  type="button"
                  className={`wizard-step-link ${isActive ? 'active' : ''} ${canEnter ? '' : 'disabled'}`}
                  onClick={() => handleStepJump(item.num)}
                  disabled={!canEnter}
                >
                  {item.label}
                </button>
              );
            })}
            <div className="opening-template-tools" aria-label="开局人物模板">
              <p>人物模板</p>
              <div>
                <button
                  type="button"
                  onClick={openCharacterTemplateSave}
                  disabled={!selectedWorldBookId}
                >
                  保存人物
                </button>
                <button
                  type="button"
                  onClick={openCharacterTemplateLoad}
                  disabled={!selectedWorldBookId}
                >
                  读取人物
                  {compatibleCharacterTemplates.length > 0 && <span>{compatibleCharacterTemplates.length}</span>}
                </button>
              </div>
              {characterTemplateStatus && (
                <small role="status">{characterTemplateStatus}</small>
              )}
            </div>
          </div>

          <div className="wizard-content wide">
            {step === 1 && (
              <>
                <WorldBookSelect
                  worldBooks={worldBooks}
                  selectedId={selectedWorldBookId}
                  onSelect={handleSelectWorldBook}
                  selectedKnowledgeMode={selectedWorldlineKnowledgeMode}
                  onKnowledgeModeChange={setSelectedWorldlineKnowledgeMode}
                />
                {worldBook && (
                  <StartBookmarkSelect bookmarks={bookmarks} selectedId={selectedBookmarkId} onSelect={handleSelectBookmark} worldBook={worldBook} />
                )}
              </>
            )}

            {step === 2 && worldBook && (
              <>
                <section className="setup-block">
                  <h2>主角类型</h2>
                  <p className="section-hint">选择你的乱世身份来源：自创一名无名之辈，从草莽、寒门或豪族旁支起步；或借用历史人物之名，由 AI 补全其出身、处境与时代牵连。两种路线都可以继续手动调整档案。</p>
                </section>
                <div className="mode-cards">
                  <button className={`mode-card ${playerMode === 'original' ? 'selected' : ''}`} aria-pressed={playerMode === 'original'} onClick={() => setPlayerMode('original')}>
                    <img className="mode-card-bg" src={customCharacterSilhouette} alt="" aria-hidden="true" />
                    <div className="mode-card-overlay" aria-hidden="true" />
                    {playerMode === 'original' && <em className="selected-mark">已选择</em>}
                    <div className="mode-card-content">
                      <strong>原创角色</strong>
                      <span>自定义姓名、出身、身份与起点。你可以从无名小卒、寒门士子、游侠、流民或豪族旁支开始，在乱世中一步步挣出自己的位置。</span>
                    </div>
                  </button>
                  <button className={`mode-card ${playerMode === 'historical' ? 'selected' : ''}`} aria-pressed={playerMode === 'historical'} onClick={() => setPlayerMode('historical')}>
                    <img className="mode-card-bg" src={historicalFiguresSilhouette} alt="" aria-hidden="true" />
                    <div className="mode-card-overlay" aria-hidden="true" />
                    {playerMode === 'historical' && <em className="selected-mark">已选择</em>}
                    <div className="mode-card-content">
                      <strong>历史人物</strong>
                      <span>填写一个三国人物姓名，由 AI 参考时代背景补全初始档案。适合想扮演名臣、猛将、诸侯或史书边缘人物的开局，生成后仍可手动修改。</span>
                    </div>
                  </button>
                </div>
              </>
            )}

            {step === 3 && worldBook && (
              <>
                {playerMode === 'historical' && (
                  <div className="historical-box">
                    <label>
                      历史人物姓名
                      <input value={historicalName} onChange={(event) => setHistoricalName(event.target.value)} placeholder="例如：曹操、孙策、张角、何皇后" />
                    </label>
                    <button className="nav-btn" onClick={handleAiCompleteHistoricalRole}>AI 补全人物档案</button>
                    {completionStatus && <p className="settings-status">{completionStatus}</p>}
                  </div>
                )}

                <div className="archive-grid">
                  <div className="archive-column">
                    <h2>基础档案</h2>
                    <div className="form-grid two">
                      <label>
                        姓名
                        <input
                          type="text"
                          value={playerMode === 'historical' ? historicalName : playerName}
                          onChange={(event) => playerMode === 'historical' ? setHistoricalName(event.target.value) : setPlayerName(event.target.value)}
                          placeholder="输入你的角色名"
                        />
                      </label>
                      <label>
                        字
                        <input
                          type="text"
                          value={playerCourtesyName}
                          onChange={(event) => setPlayerCourtesyName(event.target.value)}
                          placeholder="可选，如孟德、玄德"
                        />
                      </label>
                    </div>
                    <div className="form-grid opening-demographics-grid">
                      <label>
                        性别
                        <div className="sex-toggle">
                          {(['男', '女', '其他'] as const).map((sex) => (
                            <button key={sex} type="button" className={`sex-btn ${playerSex === sex ? 'selected' : ''}`} onClick={() => setPlayerSex(sex)}>{sex}</button>
                          ))}
                        </div>
                      </label>
                      <label>
                        年龄
                        <input type="number" min={1} max={120} value={playerAge} onChange={(event) => setPlayerAge(Number(event.target.value))} className="age-input" />
                      </label>
                      <label>
                        出生月
                        <select value={playerBirthMonth} onChange={(event) => setPlayerBirthMonth(Number(event.target.value))}>
                          {openingBirthMonths.map((month) => <option key={month} value={month}>{month}月</option>)}
                        </select>
                      </label>
                      <label>
                        出生日
                        <select value={playerBirthDay} onChange={(event) => setPlayerBirthDay(Number(event.target.value))}>
                          {openingBirthDays.map((day) => <option key={day} value={day}>{day}日</option>)}
                        </select>
                      </label>
                    </div>
                    <p className="opening-derived-birth-date">
                      推导出生日期：<strong>{derivedPlayerBirthDate ?? '请先选择有效年龄与开局剧本'}</strong>
                    </p>
                    <div className="setup-section">
                      <label>外貌</label>
                      <textarea value={playerAppearance} onChange={(event) => setPlayerAppearance(event.target.value)} className="story-textarea compact" placeholder="例：黑发黑眸，面容清秀，衣着朴素利落。" />
                    </div>
                    <div className="setup-section">
                      <label>性格</label>
                      <textarea value={playerPersonality} onChange={(event) => setPlayerPersonality(event.target.value)} className="story-textarea compact" placeholder="例：外冷内热，谨慎克制，遇事先观察再出手。" />
                    </div>

                    <div className="ability-panel">
                      <h2>能力</h2>
                      <div className="ability-presets">
                        {characterOptions.abilityPresets.map((preset) => (
                          <button
                            key={preset.id}
                            className={`origin-btn ${selectedAbilityPreset?.id === preset.id ? 'selected' : ''}`}
                            onClick={() => handleSelectAbilityPreset(preset.id)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <div className="ability-budget" data-testid="opening-ability-budget" aria-live="polite">
                        <span>可分配点数</span>
                        <strong>{remainingAbilityPoints}</strong>
                        <small>降低初始能力会返还点数；按住 + / − 可快速调整</small>
                      </div>
                      <div className="ability-grid">
                        {visibleAbilityEntries.map(([key, value]) => (
                          <div key={key} className="ability-item">
                            <strong>{value}</strong>
                            <span>{key}</span>
                            <div>
                              <PressAndHoldButton
                                label={`${key}减1`}
                                disabled={!canDecreaseOpeningAbility(
                                  abilityBaseScores,
                                  abilityScores,
                                  visibleAbilityKeys,
                                  key,
                                )}
                                onActivate={() => handleAdjustAbility(key, -1)}
                              >
                                −
                              </PressAndHoldButton>
                              <PressAndHoldButton
                                label={`${key}加1`}
                                disabled={!canIncreaseOpeningAbility(
                                  abilityBaseScores,
                                  abilityScores,
                                  visibleAbilityKeys,
                                  key,
                                )}
                                onActivate={() => handleAdjustAbility(key, 1)}
                              >
                                +
                              </PressAndHoldButton>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {customNotes && (
                      <div className="setup-section">
                        <label>AI 补全/补充档案</label>
                        <textarea value={customNotes} onChange={(event) => setCustomNotes(event.target.value)} className="story-textarea compact" />
                      </div>
                    )}
                  </div>
                  <div className="archive-column">
                    <div className="location-picker">
                      <h2>初始地点</h2>
                      <div className="setup-section">
                        <label>{worldBook.ontology.regionLevels[0] ?? '一级地区'}</label>
                        <div className="location-grid location-grid-large">
                          {locationSelection.regions.map((region) => (
                            <button key={region.id} className={`location-btn ${selectedRegionId === region.id ? 'selected' : ''}`} onClick={() => handleSelectRegion(region.id)}>
                              {region.name}
                              <span className="location-level">{region.level}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      {locationSelection.commanderies.length > 0 && (
                        <div className="setup-section">
                          <label>{worldBook.ontology.regionLevels[1] ?? '次级地区'}</label>
                          <div className="location-grid">
                            {locationSelection.commanderies.map((node) => (
                              <button key={node.id} className={`location-btn ${selectedCommanderyId === node.id ? 'selected' : ''}`} onClick={() => handleSelectCommandery(node.id)}>
                                {node.name}
                                <span className="location-level">{node.level}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {locationSelection.places.length > 0 && (
                        <div className="setup-section">
                          <label>县 / 城邑 / 据点</label>
                          <div className="location-grid">
                            {locationSelection.places.map((loc) => (
                              <button key={loc.id} className={`location-btn ${selectedLocationId === loc.id ? 'selected' : ''}`} onClick={() => handleSelectPlace(loc.id)}>
                                {loc.name}
                                <span className="location-level">{loc.level}</span>
                              </button>
                            ))}
                            <button className="location-btn add-location" onClick={() => setShowCustomPlaceForm(true)}>
                              + 自定义地点
                              <span className="location-level">开局输入</span>
                            </button>
                          </div>
                          {showCustomPlaceForm && (
                            <div className="custom-option-form">
                              <input
                                value={customPlaceDraft.label}
                                onChange={(event) => setCustomPlaceDraft((draft) => ({ ...draft, label: event.target.value }))}
                                placeholder="地点名称，如：隐谷村、破败坞堡、海边小港"
                              />
                              <textarea
                                value={customPlaceDraft.description}
                                onChange={(event) => setCustomPlaceDraft((draft) => ({ ...draft, description: event.target.value }))}
                                placeholder="地点描述，会进入开局 prompt。可写所属乡里、风貌、控制者、为什么适合开局。"
                              />
                              <div>
                                <button className="nav-btn" onClick={handleAddCustomOpeningPlace} disabled={!customPlaceDraft.label.trim() || !selectedCommanderyId}>保存地点</button>
                                <button className="nav-btn back" onClick={() => setShowCustomPlaceForm(false)}>取消</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {selectedLocationName && <div className="location-path-preview">起点：{selectedLocationName}</div>}
                    </div>
                  </div>
                </div>
              </>
            )}

            {step === 4 && worldBook && (
              <>
                <section className="setup-block">
                  <h2>开局特质</h2>
                  <p className="section-hint">最多选择三条。特质不会直接给六维加点，而是进入提示词，影响叙事机会、NPC 反应和条件判定。</p>
                </section>
                <div className="trait-panel">
                  <div className="trait-grid">
                    {(openingCharacterOptions.traits ?? []).map((trait) => {
                      const isTraitSelected = selectedTraitIds.includes(trait.id);
                      const isCustom = isCustomOpeningTrait(trait);
                      return (
                        <div key={trait.id} className={`trait-card-wrap ${isCustom ? 'custom-trait-card' : ''}`}>
                          <OpeningTraitButton
                            trait={trait}
                            selected={isTraitSelected}
                            onToggle={handleToggleTrait}
                          />
                          {isCustom && (
                            <div className="custom-card-actions">
                              <button type="button" onClick={() => beginCustomTraitEdit(trait)}>编辑</button>
                              <button type="button" className="danger" onClick={() => handleDeleteCustomTrait(trait)}>删除</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <button
                      className="trait-chip add-card trait-rarity-pending"
                      onClick={() => {
                        setEditingCustomTraitId(null);
                        setCustomTraitDraft({ label: '', description: '' });
                        setShowCustomTraitForm(true);
                      }}
                    >
                      + 自定义特质
                    </button>
                  </div>
                  {showCustomTraitForm && (
                    <div className="custom-option-form">
                      <input
                        value={customTraitDraft.label}
                        onChange={(event) => setCustomTraitDraft((draft) => ({ ...draft, label: event.target.value }))}
                        placeholder="特质名称，如：善辨形势"
                      />
                      <textarea
                        value={customTraitDraft.description}
                        onChange={(event) => setCustomTraitDraft((draft) => ({ ...draft, description: event.target.value }))}
                        placeholder="特质描述，会进入开局 prompt，并影响 LLM 如何理解主角。"
                      />
                      <div>
                        <button className="nav-btn" onClick={handleAddCustomTrait} disabled={!customTraitDraft.label.trim()}>{editingCustomTraitId ? '保存修改' : '保存特质'}</button>
                        <button className="nav-btn back" onClick={cancelCustomTraitEdit}>取消</button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {step === 5 && worldBook && (
              <>
                <div className="origin-identity-grid">
                  <section className="origin-panel">
                    <h2>出身</h2>
                    <p className="section-hint">出身是与生俱来的社会位置，会影响开局资源、人脉与旁人先入为主的看法。</p>
                    <div className="option-card-grid origin-options-scroll">
                      {openingCharacterOptions.birthOrigins.map((option) => {
                        const isCustom = isCustomBirthOption(option);
                        return (
                          <div key={option.id} className={`option-card-wrap ${isCustom ? 'custom-option-card' : ''}`}>
                            <button
                              type="button"
                              className={`option-card ${selectedBirthOrigin === option.id ? 'selected' : ''}`}
                              title={`${option.label}${option.description ? `?${option.description}` : ''}`}
                              onClick={() => setSelectedBirthOrigin(option.id)}
                            >
                              <strong>{option.label}</strong>
                              {option.description && <span>{option.description}</span>}
                            </button>
                            {isCustom && (
                              <div className="custom-card-actions">
                                <button type="button" onClick={() => beginCustomBirthOriginEdit(option)}>编辑</button>
                                <button type="button" className="danger" onClick={() => handleDeleteCustomBirthOrigin(option)}>删除</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <button
                        className="option-card add-card"
                        onClick={() => {
                          setEditingCustomBirthId(null);
                          setCustomBirthDraft({ label: '', description: '' });
                          setShowCustomBirthForm(true);
                        }}
                      >+ 自定义出身</button>
                    </div>
                    {showCustomBirthForm && (
                      <div className="custom-option-form">
                        <input value={customBirthDraft.label} onChange={(event) => setCustomBirthDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder="出身名称" />
                        <textarea value={customBirthDraft.description} onChange={(event) => setCustomBirthDraft((draft) => ({ ...draft, description: event.target.value }))} placeholder="出身描述，会进入开局 prompt" />
                        <div>
                          <button className="nav-btn" onClick={handleAddCustomBirthOrigin} disabled={!customBirthDraft.label.trim()}>{editingCustomBirthId ? '保存修改' : '保存出身'}</button>
                          <button className="nav-btn back" onClick={cancelCustomBirthOriginEdit}>取消</button>
                        </div>
                      </div>
                    )}
                  </section>
                  <section className="role-panel">
                    <h2>当前身份</h2>
                    <p className="section-hint">身份是当前正在以什么状态行动，会影响 NPC 如何理解你此刻的立场。</p>
                    <div className="option-card-grid role-options-scroll">
                      {openingCharacterOptions.identities.map((option) => {
                        const isCustom = isCustomIdentityOption(option);
                        return (
                          <div key={option.id} className={`option-card-wrap ${isCustom ? 'custom-option-card' : ''}`}>
                            <button
                              type="button"
                              className={`option-card ${selectedOrigin === option.id ? 'selected' : ''}`}
                              title={`${option.label}${option.description ? `?${option.description}` : ''}`}
                              onClick={() => {
                                setSelectedOrigin(option.id);
                              }}
                            >
                              <strong>{option.label}</strong>
                              {option.description && <span>{option.description}</span>}
                            </button>
                            {isCustom && (
                              <div className="custom-card-actions">
                                <button type="button" onClick={() => beginCustomIdentityEdit(option)}>编辑</button>
                                <button type="button" className="danger" onClick={() => handleDeleteCustomIdentity(option)}>删除</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <button
                        className="option-card add-card"
                        onClick={() => {
                          setEditingCustomIdentityId(null);
                          setCustomIdentityDraft({ label: '', description: '' });
                          setShowCustomIdentityForm(true);
                        }}
                      >+ 自定义身份</button>
                    </div>
                    {showCustomIdentityForm && (
                      <div className="custom-option-form">
                        <input value={customIdentityDraft.label} onChange={(event) => setCustomIdentityDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder="身份名称" />
                        <textarea value={customIdentityDraft.description} onChange={(event) => setCustomIdentityDraft((draft) => ({ ...draft, description: event.target.value }))} placeholder="身份描述，会进入开局 prompt" />
                        <div>
                          <button className="nav-btn" onClick={handleAddCustomIdentity} disabled={!customIdentityDraft.label.trim()}>{editingCustomIdentityId ? '保存修改' : '保存身份'}</button>
                          <button className="nav-btn back" onClick={cancelCustomIdentityEdit}>取消</button>
                        </div>
                      </div>
                    )}
                  </section>
                </div>
              </>
            )}

            {step === 6 && worldBook && (
              <div className="confirm-section">
                <section className="setup-section opening-difficulty-section">
                  <div className="opening-difficulty-heading">
                    <div>
                      <h2>选择本局难度</h2>
                      <p className="section-hint">
                        三项难度分别保存到本存档；只影响之后新发生的普通判定、个人战或战争，不会重算已有结果。
                      </p>
                    </div>
                    <span>默认：标准</span>
                  </div>
                  <h3 className="opening-difficulty-subtitle">普通判定难度</h3>
                  <div
                    className="opening-difficulty-grid"
                    role="radiogroup"
                    aria-label="本局游戏难度"
                  >
                    {gameDifficultyProfiles.map((profile) => (
                      <button
                        key={profile.id}
                        type="button"
                        role="radio"
                        aria-checked={profile.id === gameDifficulty}
                        className={`opening-difficulty-card${profile.id === gameDifficulty ? ' selected' : ''}`}
                        onClick={() => setGameDifficulty(profile.id)}
                      >
                        <span>
                          <strong>{profile.label}</strong>
                          <em>
                            Y{profile.difficultyOffset >= 0 ? '+' : ''}
                            {profile.difficultyOffset}
                          </em>
                        </span>
                        <small>{profile.summary}</small>
                      </button>
                    ))}
                  </div>
                  <h3 className="opening-difficulty-subtitle">个人战斗难度</h3>
                  <div className="opening-difficulty-grid" role="radiogroup" aria-label="本局个人战斗难度">
                    {combatDifficultyProfiles.map((profile) => (
                      <button
                        key={profile.id}
                        type="button"
                        role="radio"
                        aria-checked={profile.id === combatDifficulty}
                        className={`opening-difficulty-card${profile.id === combatDifficulty ? ' selected' : ''}`}
                        onClick={() => setCombatDifficulty(profile.id)}
                      >
                        <span><strong>{profile.label}</strong><em>×{profile.playerPowerMultiplier.toFixed(2)}</em></span>
                        <small>{profile.summary}</small>
                      </button>
                    ))}
                  </div>
                  <h3 className="opening-difficulty-subtitle">战争难度</h3>
                  <div className="opening-difficulty-grid" role="radiogroup" aria-label="本局战争难度">
                    {warDifficultyProfiles.map((profile) => (
                      <button
                        key={profile.id}
                        type="button"
                        role="radio"
                        aria-checked={profile.id === warDifficulty}
                        className={`opening-difficulty-card${profile.id === warDifficulty ? ' selected' : ''}`}
                        onClick={() => setWarDifficulty(profile.id)}
                      >
                        <span><strong>{profile.label}</strong><em>×{profile.playerPowerMultiplier.toFixed(2)}</em></span>
                        <small>{profile.summary}</small>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="setup-section opening-difficulty-section">
                  <div className="opening-difficulty-heading">
                    <div>
                      <h2>选择正文叙事人称</h2>
                      <p className="section-hint">
                        只改变【旁白】对主角的称呼；不会替主角补写对白、心理决定或额外行动。
                      </p>
                    </div>
                    <span>默认：第二人称</span>
                  </div>
                  <div
                    className="opening-difficulty-grid opening-perspective-grid"
                    role="radiogroup"
                    aria-label="开局正文叙事人称"
                  >
                    {narrativePerspectiveProfiles.map((profile) => (
                      <button
                        key={profile.id}
                        type="button"
                        role="radio"
                        aria-checked={profile.id === narrativePerspective}
                        className={`opening-difficulty-card${profile.id === narrativePerspective ? ' selected' : ''}`}
                        onClick={() => setNarrativePerspective(profile.id)}
                      >
                        <span>
                          <strong>{profile.label}</strong>
                          <em>{profile.marker}</em>
                        </span>
                        <small>{profile.summary}</small>
                      </button>
                    ))}
                  </div>
                </section>
                <div className="setup-section">
                  <label>开局额外要求</label>
                  <textarea
                    value={playerExtraRequest}
                    onChange={(event) => setPlayerExtraRequest(event.target.value)}
                    className="story-textarea compact"
                    placeholder="最高优先级。例如：不要一开局就当官；希望先从颍川乡里卷入黄巾暗流。"
                  />
                </div>
                <h2>确认开局设定</h2>
                {openingStartStatus && <p className="section-hint">{openingStartStatus}</p>}
                <div className="confirm-details">
                  <p><strong>世界书：</strong>{worldBook.manifest.name} v{worldBook.manifest.version}</p>
                  <p><strong>开局书签：</strong>{bookmarks.find((b) => b.id === selectedBookmarkId)?.label}</p>
                  <p><strong>角色姓名：</strong>{playerMode === 'historical' ? historicalName : playerName || '无名氏'}</p>
                  {playerCourtesyName && <p><strong>字：</strong>{playerCourtesyName}</p>}
                  <p><strong>性别年龄：</strong>{playerSex}，{playerAge}岁</p>
                  <p><strong>出生日期：</strong>{derivedPlayerBirthDate ?? '尚未推导'}</p>
                  <p><strong>出身：</strong>{selectedBirthLabel}</p>
                  <p><strong>身份：</strong>{selectedIdentityLabel}</p>
                  <p><strong>初始地点：</strong>{selectedLocationName}</p>
                  <p><strong>能力：</strong>{visibleAbilityEntries.map(([key, value]) => `${key}${value}`).join('、')}</p>
                  <p><strong>特质：</strong>{selectedTraits.length > 0 ? selectedTraits.map((trait) => trait.label).join('、') : '未选择'}</p>
                  <p>
                    <strong>本局难度：</strong>
                    {selectedGameDifficulty.label}
                    （普通判定难度 Y
                    {selectedGameDifficulty.difficultyOffset >= 0 ? '+' : ''}
                    {selectedGameDifficulty.difficultyOffset}）
                  </p>
                  <p><strong>个人战斗难度：</strong>{selectedCombatDifficulty.label}（我方修正 ×{selectedCombatDifficulty.playerPowerMultiplier.toFixed(2)}）</p>
                  <p><strong>战争难度：</strong>{selectedWarDifficulty.label}（我方有效战力 ×{selectedWarDifficulty.playerPowerMultiplier.toFixed(2)}）</p>
                  <p>
                    <strong>叙事人称：</strong>
                    {selectedNarrativePerspective.label}（{selectedNarrativePerspective.marker}）
                  </p>
                  <p><strong>行装：</strong>根据出身、身份、地点与额外要求，随开场剧情一并确定</p>
                  {playerExtraRequest.trim() && <p><strong>额外要求：</strong>{playerExtraRequest.trim()}</p>}
                </div>
                {openingPreview && (
                  <div className="opening-preview">
                    <h3>开局状态预览</h3>
                    <div className="preview-grid">
                      <div className="preview-card"><span>玩家</span><strong>{openingPreview.player.name}</strong><p>{openingPreview.player.summary}</p></div>
                      <div className="preview-card"><span>地点账本</span><strong>{openingPreview.locations?.[0]?.name ?? '未知地点'}</strong><p>{openingPreview.locations?.[0]?.summary ?? '尚无地点记录'}</p></div>
                      <div className="preview-card"><span>主角档案</span><strong>Lv.{openingPreview.player.level ?? 1} · 生命 {openingPreview.player.vitals?.hp ?? 100}/{openingPreview.player.vitals?.maxHp ?? 100}</strong><p>{openingPreview.player.traits?.map((trait) => trait.label).join('、') || '无特质'}</p></div>
                      <div className="preview-card"><span>行装</span><strong>随开场剧情生成</strong><p>钱财、装备与随身物品会结合人物身份和开局处境一并确定。</p></div>
                      <div className="preview-card"><span>当前局势</span><strong>{openingPreview.situationOverview?.immediateHooks[0] ?? '待生成'}</strong><p>{openingPreview.situationOverview?.currentPressure[0] ?? '尚无压力记录'}</p></div>
                    </div>
                    <div className="preview-list"><span>任务日志</span><strong>{openingPreview.activeQuests[0]?.title ?? '无任务'}</strong><p>{openingPreview.activeQuests[0]?.description ?? '尚无任务描述'}</p></div>
                  </div>
                )}
              </div>
            )}
          </div>
          {renderWizardFooter()}
        </div>
      )}
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeState } from '../engine/types';
import {
  attemptWarRetreat,
  chooseWarAiOrder,
  createSealedWarResult,
  executeWarRound,
  estimateWarTheaterStrength,
  offerWarSurrender,
  prepareWarEncounterForPlay,
  resolveWarDecision,
  resumeWarAfterAutoPause,
  shouldPauseAutoWar,
  type EncounterSession,
  type SealedEncounterResult,
  type UnsealedWarResult,
  type UniqueArtSemanticProfile,
  type WarEngineState,
  type WarRoundOrder,
  type WarTactic,
} from '../engine/encounterV2';
import type { BattleBriefingCard } from './battleBriefingQueueModel';
import type { BattleBriefingVisualAssets } from './combatVisualAssets';
import { formatTroopTypeForDisplay } from './troopPanelModel';

export interface WarResolvedPayload {
  session: EncounterSession;
  result: SealedEncounterResult<UnsealedWarResult>;
}

interface WarEncounterScreenProps {
  runtimeState: RuntimeState;
  locationLabel?: string;
  onResolved: (payload: WarResolvedPayload) => Promise<void>;
  onRequestNarrative: () => Promise<void>;
  narrativeBusy?: boolean;
  onCancelNarrative?: () => void;
  statusMessage?: string;
}

type PlaybackSpeed = 1 | 2 | 4;

const TACTIC_LABELS: Record<WarTactic, string> = {
  steady_advance: '稳步推进',
  all_out_assault: '全军强攻',
  hold_position: '固守阵线',
  flank: '侧翼迂回',
};

const TACTIC_DESCRIPTIONS: Record<WarTactic, string> = {
  steady_advance: '攻防均衡；伤亡暴露、疲劳和补给消耗都处于常规水平，不参与战术克制。',
  all_out_assault: '提高进攻强度，但自身暴露、疲劳和补给消耗显著增加；克制侧翼迂回。',
  hold_position: '降低进攻，显著减少自身暴露与消耗；克制全军强攻。',
  flank: '克制固守阵线；开阔地或水域且机动力足够时收益很高，复杂或设防地形下可能反受其害。',
};

const OBJECTIVE_LABELS: Record<UnsealedWarResult['objective'], string> = {
  defeat_enemy: '击溃敌军',
  capture_holding: '攻取领地',
  break_siege: '突围破围',
  relieve_siege: '驰援解围',
};

const COMMAND_SCOPE_LABELS = {
  overall_command: '统领全局',
  subordinate_sector: '奉命负责局部战线',
  independent: '独立作战',
} as const;

const WAR_MISSION_LABELS = {
  defeat_local_force: '击溃本场对手',
  hold_position: '守住阵位',
  assault_position: '攻取阵位',
  escort: '护送与接应',
  raid: '袭扰敌军',
  screen: '掩护主力',
  pursuit: '追击败军',
  breakout: '突破包围',
} as const;

function outcomeLabel(outcome?: UnsealedWarResult['outcome']): string {
  const labels: Record<UnsealedWarResult['outcome'], string> = {
    player_victory: '我方胜利',
    enemy_victory: '我方战败',
    draw: '战局未决',
    player_retreat: '我方撤退',
    enemy_retreat: '敌方撤退',
    surrender: '一方投降',
  };
  return outcome ? labels[outcome] : '等待结算';
}

function troopName(state: RuntimeState, troopId: string): string {
  return state.troops?.find((troop) => troop.troopId === troopId)?.name ?? troopId;
}

function troopTypeLabel(
  state: RuntimeState,
  force: {
    troopId: string;
    primaryClass?: string;
    tags?: readonly string[];
  },
): string {
  const troop = state.troops?.find((entry) => entry.troopId === force.troopId);
  return formatTroopTypeForDisplay(troop?.troopType ?? troop?.specialDesignation, {
    logisticsClass: troop?.logisticsClass,
    primaryClass: force.primaryClass,
    tags: force.tags,
  }) ?? '兵种未明';
}

function commanderName(state: RuntimeState, actorId: string | undefined): string {
  if (!actorId) return '无登记主将';
  if (state.player.id === actorId) return state.player.name;
  return state.npcs?.find((npc) => npc.npcId === actorId)?.name
    ?? state.knownActors.find((actor) => actor.id === actorId)?.name
    ?? actorId;
}

function sideSummary(state: WarEngineState | null, side: 'player' | 'enemy') {
  const forces = state?.forces.filter((force) => force.side === side) ?? [];
  const total = forces.reduce((sum, force) => sum + force.remainingStrength, 0);
  const initial = forces.reduce((sum, force) => sum + force.initialStrength, 0);
  const weighted = (pick: (force: WarEngineState['forces'][number]) => number) => (
    total > 0
      ? Math.round(forces.reduce((sum, force) => sum + pick(force) * force.remainingStrength, 0) / total)
      : 0
  );
  return {
    total,
    initial,
    morale: weighted((force) => force.morale),
    supply: weighted((force) => force.supply),
    fatigue: weighted((force) => force.fatigue),
  };
}

function eventMotionClass(state: WarEngineState | null): string {
  const last = state?.actionLog[state.actionLog.length - 1];
  if (!last) return '';
  if (last.actionType === 'war_pursuit') return 'is-pursuit';
  if (state?.forces.some((force) => force.lifecycleStatus === 'routed')) return 'is-rout';
  const order = String(last.values.playerOrder ?? '');
  if (order === 'all_out_assault') return 'is-assault';
  if (order === 'hold_position') return 'is-hold';
  if (order === 'flank') return 'is-flank';
  return 'is-advance';
}

function roundLogLabel(entry: WarEngineState['actionLog'][number]): string {
  if (entry.actionType === 'war_round') {
    const player = TACTIC_LABELS[String(entry.values.playerOrder) as WarTactic]
      ?? (String(entry.values.playerOrder).startsWith('war_art:') ? '施展战争绝艺' : String(entry.values.playerOrder));
    const enemy = TACTIC_LABELS[String(entry.values.enemyOrder) as WarTactic]
      ?? (String(entry.values.enemyOrder).startsWith('war_art:') ? '施展战争绝艺' : String(entry.values.enemyOrder));
    const playerFactor = typeof entry.values.playerCommanderFactor === 'number'
      ? `（统率系数 ×${entry.values.playerCommanderFactor.toFixed(2)}）`
      : '';
    const enemyFactor = typeof entry.values.enemyCommanderFactor === 'number'
      ? `（统率系数 ×${entry.values.enemyCommanderFactor.toFixed(2)}）`
      : '';
    const losses = typeof entry.values.playerCasualties === 'number'
      && typeof entry.values.enemyCasualties === 'number'
      ? `；战损我方 ${entry.values.playerCasualties}、敌方 ${entry.values.enemyCasualties}`
      : '';
    const shock = [
      typeof entry.values.enemyOpeningShock === 'number' && entry.values.enemyOpeningShock > 0
        ? `我方冲击令敌军士气 -${entry.values.enemyOpeningShock}`
        : '',
      typeof entry.values.playerOpeningShock === 'number' && entry.values.playerOpeningShock > 0
        ? `敌军冲击令我军士气 -${entry.values.playerOpeningShock}`
        : '',
    ].filter(Boolean).join('，');
    return `第 ${entry.values.round} 轮：我方${player}${playerFactor}，敌方${enemy}${enemyFactor}${losses}${shock ? `；${shock}` : ''}`;
  }
  if (entry.actionType === 'war_retreat') return entry.summaryKey === 'war_retreat_success' ? '撤退成功' : '撤退受阻';
  if (entry.actionType === 'war_pursuit') return entry.summaryKey === 'war_pursuit_resolved' ? '追击展开' : '停止追击';
  if (entry.actionType.includes('surrender')) return '处理投降';
  return entry.summaryKey;
}

function flankContext(snapshot: WarEngineState['snapshot'] | undefined, side: 'player' | 'enemy'): string {
  if (!snapshot) return '当前战场条件将在进入战争后冻结。';
  const forces = snapshot.forces.filter((force) => force.side === side);
  const total = forces.reduce((sum, force) => sum + force.initialStrength, 0);
  const mobile = forces.reduce((sum, force) => (
    force.tags.includes('mobile')
    || force.primaryClass === (snapshot.environmentTags.includes('water') ? 'naval' : 'cavalry')
      ? sum + force.initialStrength
      : sum
  ), 0);
  const share = total > 0 ? mobile / total : 0;
  const favorableTerrain = snapshot.environmentTags.includes('open') || snapshot.environmentTags.includes('water');
  const unfavorableTerrain = snapshot.environmentTags.includes('fortified') || snapshot.environmentTags.includes('difficult');
  if (favorableTerrain && share >= 0.35) return `当前有利：机动力占比约 ${Math.round(share * 100)}%。`;
  if (unfavorableTerrain && share < 0.5) return `当前不利：设防/复杂地形，机动力占比约 ${Math.round(share * 100)}%。`;
  return `当前中性：机动力占比约 ${Math.round(share * 100)}%。`;
}

function describeWarArt(profile: UniqueArtSemanticProfile): string {
  const labels: Record<string, string> = {
    modify_morale: '士气',
    modify_supply: '补给',
    modify_fatigue: '疲劳',
    modify_casualty_rate: '伤亡率',
    modify_effective_strength: '有效战力',
    apply_status: '施加状态',
    remove_status: '移除状态',
  };
  return profile.effects.map((effect) => {
    const target = effect.target === 'enemy_force' ? '敌军' : '我军';
    const sign = effect.value > 0 ? '+' : '';
    return `${target}${labels[effect.operation] ?? effect.operation}${sign}${effect.value}`;
  }).join('；') || '没有可执行战争效果';
}

function forceStatusLabel(status: WarEngineState['forces'][number]['lifecycleStatus'] | undefined): string {
  const labels: Record<WarEngineState['forces'][number]['lifecycleStatus'], string> = {
    active: '战中',
    routed: '溃败',
    surrendered: '已降',
    destroyed: '覆灭',
  };
  return status ? labels[status] : '备战';
}

function ForceColumn({
  runtimeState,
  snapshot,
  engineState,
  side,
}: {
  runtimeState: RuntimeState;
  snapshot: ReturnType<typeof prepareWarEncounterForPlay>['snapshot'] | null;
  engineState: WarEngineState | null;
  side: 'player' | 'enemy';
}) {
  const activeIntent = runtimeState.encounterV2?.active?.session.intent.kind === 'war'
    ? runtimeState.encounterV2.active.session.intent
    : null;
  const frozen = snapshot?.forces.filter((force) => force.side === side)
    ?? (activeIntent
      ? (side === 'player'
        ? activeIntent.playerForce.troopIds
        : activeIntent.enemyForce.troopIds)
        .map((troopId, stableOrder) => {
          const troop = runtimeState.troops?.find((entry) => entry.troopId === troopId);
          const commitment = (side === 'player'
            ? activeIntent.participation?.playerCommitments
            : activeIntent.participation?.enemyCommitments)
            ?.find((entry) => entry.troopId === troopId);
          const sourceStrength = troop?.size ?? 0;
          const initialStrength = commitment?.committedStrength ?? troop?.deployableSize ?? sourceStrength;
          return {
            troopId,
            name: troopName(runtimeState, troopId),
            initialStrength,
            morale: troop?.morale ?? 0,
            supply: 0,
            fatigue: 0,
            stableOrder,
            sourceStrength,
            commitmentKind: initialStrength < sourceStrength ? 'detachment' as const : 'whole_force' as const,
          };
        })
      : []);
  const summary = sideSummary(engineState, side);
  const initialTotal = frozen.reduce((sum, force) => sum + force.initialStrength, 0);
  return (
    <section
      className={`war-v2-side war-v2-side--${side}`}
      data-testid={`war-side-${side}`}
      aria-label={side === 'enemy' ? '敌方本场参战部队' : '我方直接参战部队'}
    >
      <header>
        <div>
          <small>{side === 'enemy' ? '敌方本场参战' : '我方直接参战'}</small>
          <strong>{engineState ? `${summary.total}/${summary.initial}` : initialTotal} 人</strong>
        </div>
        <span>士气 {engineState ? summary.morale : '—'} · 补给 {engineState ? summary.supply : '—'}</span>
      </header>
      <div className="war-v2-force-list" tabIndex={0}>
        {frozen.map((force) => {
          const live = engineState?.forces.find((entry) => entry.troopId === force.troopId);
          const remaining = live?.remainingStrength ?? force.initialStrength;
          return (
            <article
              key={force.troopId}
              className={`war-v2-force-card ${live?.lifecycleStatus && live.lifecycleStatus !== 'active' ? `is-${live.lifecycleStatus}` : ''}`}
              data-troop-id={force.troopId}
            >
              <div><strong>{force.name}</strong><em>{remaining} 人</em></div>
              <p className="war-v2-force-facts">
                {force.commitmentKind === 'detachment' && force.sourceStrength
                  ? <span>本场投入 {force.initialStrength} / 建制 {force.sourceStrength}</span>
                  : null}
                <span>兵种 {troopTypeLabel(runtimeState, force)}</span>
                <span>士 {live?.morale ?? force.morale}</span>
                <span>粮 {live?.supply ?? force.supply}</span>
                <span>疲 {live?.fatigue ?? force.fatigue}</span>
                {live?.casualties ? <span>伤 {live.casualties}</span> : null}
              </p>
              <small>{forceStatusLabel(live?.lifecycleStatus)}</small>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function WarEncounterScreen({
  runtimeState,
  locationLabel,
  onResolved,
  onRequestNarrative,
  narrativeBusy = false,
  onCancelNarrative,
  statusMessage = '',
}: WarEncounterScreenProps) {
  const active = runtimeState.encounterV2?.active;
  const intent = active?.session.intent.kind === 'war' ? active.session.intent : null;
  const [prepared, setPrepared] = useState<ReturnType<typeof prepareWarEncounterForPlay> | null>(null);
  const [engineState, setEngineState] = useState<WarEngineState | null>(null);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [autoMode, setAutoMode] = useState(false);
  const [localStatus, setLocalStatus] = useState('');
  const [resultSaveError, setResultSaveError] = useState('');
  const [failedVisuals, setFailedVisuals] = useState<string[]>([]);
  const [visualAssets, setVisualAssets] = useState<BattleBriefingVisualAssets | null>(null);
  const resolvedResultRef = useRef<SealedEncounterResult<UnsealedWarResult> | null>(null);

  useEffect(() => {
    setPrepared(null);
    setEngineState(null);
    setAutoMode(false);
    setLocalStatus('');
    setResultSaveError('');
    setFailedVisuals([]);
    setVisualAssets(null);
    resolvedResultRef.current = null;
  }, [active?.session.sessionId, intent?.encounterId]);

  const latestLog = engineState?.actionLog[engineState.actionLog.length - 1];
  const visualTags = [
    ...(intent?.environmentTags ?? []),
    intent?.objective,
    latestLog?.values.playerOrder,
    engineState?.forces.some((force) => force.lifecycleStatus === 'routed') ? 'rout' : undefined,
    latestLog?.actionType === 'war_pursuit' ? 'pursuit' : undefined,
  ].filter(Boolean).map(String);
  const visualTagKey = visualTags.join('|');
  const briefingCard: BattleBriefingCard | null = useMemo(() => intent ? {
    key: `war-v2:${intent.encounterId}`,
    kind: 'battle',
    recordId: intent.encounterId,
    title: intent.reason,
    eyebrow: 'War V2',
    summary: `目标：${OBJECTIVE_LABELS[intent.objective]}`,
    occurredAt: runtimeState.currentDate,
    location: locationLabel ?? intent.locationId,
    visualTags: visualTagKey ? visualTagKey.split('|') : [],
    openPanel: 'battles',
    selectedId: intent.encounterId,
    panelTab: 'playerRelated',
  } : null, [intent, locationLabel, runtimeState.currentDate, visualTagKey]);

  const participation = intent?.participation;
  const theaterContext = useMemo(() => {
    if (prepared?.snapshot.theaterContext) return prepared.snapshot.theaterContext;
    if (!participation) return undefined;
    const troopsById = new Map((runtimeState.troops ?? []).map((troop) => [troop.troopId, troop]));
    const total = (troopIds: readonly string[] | undefined) => (troopIds ?? [])
      .reduce((sum, troopId) => {
        const troop = troopsById.get(troopId);
        return sum + (troop ? estimateWarTheaterStrength(troop) : 0);
      }, 0);
    return {
      commandScope: participation.commandScope,
      mission: participation.mission,
      alliedMainForceIds: [...(participation.alliedMainForceIds ?? [])],
      enemyMainForceIds: [...(participation.enemyMainForceIds ?? [])],
      alliedEstimatedStrength: total(participation.alliedMainForceIds),
      enemyEstimatedStrength: total(participation.enemyMainForceIds),
      playerSupportFactor: 1,
      enemySupportFactor: 1,
      ...(participation.superiorCommanderActorId
        ? { superiorCommanderActorId: participation.superiorCommanderActorId }
        : {}),
    };
  }, [participation, prepared?.snapshot.theaterContext, runtimeState.troops]);

  useEffect(() => {
    let live = true;
    if (!briefingCard) {
      setVisualAssets(null);
      return () => { live = false; };
    }
    void import('./combatVisualAssets')
      .then(({ resolveBattleBriefingVisualAssets }) => {
        if (live) setVisualAssets(resolveBattleBriefingVisualAssets(briefingCard));
      })
      .catch(() => {
        if (live) setVisualAssets(null);
      });
    return () => { live = false; };
  }, [briefingCard]);
  const motionClass = [
    eventMotionClass(engineState),
    intent?.environmentTags.includes('water') ? 'is-water' : '',
    intent?.objective === 'capture_holding' ? 'is-siege' : '',
  ].filter(Boolean).join(' ');

  const beginWar = useCallback(() => {
    if (!intent) return;
    try {
      const next = prepareWarEncounterForPlay(runtimeState, { startedAt: new Date().toISOString() });
      setPrepared(next);
      setEngineState(next.engineState);
      setLocalStatus('战争开始。敌军由本地 AI 指挥，我军等待军令。');
    } catch (error) {
      setLocalStatus(error instanceof Error ? error.message : '无法开始战争。');
    }
  }, [intent, runtimeState]);

  const runOrder = useCallback((player: WarRoundOrder) => {
    if (!engineState || engineState.phase !== 'awaiting_round') return;
    try {
      const enemy = chooseWarAiOrder(engineState, 'enemy');
      const next = executeWarRound(engineState, { player, enemy });
      setEngineState(next);
      const entry = next.actionLog[next.actionLog.length - 1];
      setLocalStatus(entry ? roundLogLabel(entry) : '本轮结束。');
    } catch (error) {
      setAutoMode(false);
      setLocalStatus(error instanceof Error ? error.message : '本轮战争推进失败。');
    }
  }, [engineState]);

  useEffect(() => {
    if (!autoMode || !engineState || engineState.phase !== 'awaiting_round') return;
    const danger = shouldPauseAutoWar(engineState, 'player');
    if (danger) {
      setAutoMode(false);
      setLocalStatus(`危险状态 ${danger} 已触发，自动指挥暂停。`);
      return;
    }
    const timer = window.setTimeout(() => {
      try {
        const next = executeWarRound(engineState, {
          player: chooseWarAiOrder(engineState, 'player'),
          enemy: chooseWarAiOrder(engineState, 'enemy'),
        });
        const afterDanger = next.phase === 'awaiting_round' ? shouldPauseAutoWar(next, 'player') : undefined;
        setEngineState(afterDanger ? { ...next, phase: 'auto_paused', autoPauseReason: afterDanger } : next);
        if (afterDanger) {
          setAutoMode(false);
          setLocalStatus(`危险状态 ${afterDanger} 已触发，自动指挥暂停。`);
        }
      } catch (error) {
        setAutoMode(false);
        setLocalStatus(error instanceof Error ? error.message : '自动指挥失败。');
      }
    }, Math.round(900 / speed));
    return () => window.clearTimeout(timer);
  }, [autoMode, engineState, speed]);

  useEffect(() => {
    if (!engineState?.pendingDecision || engineState.pendingDecision.decidingSide !== 'enemy') return;
    const timer = window.setTimeout(() => {
      setEngineState(resolveWarDecision(engineState, {
        choice: engineState.pendingDecision?.kind === 'pursuit' ? 'pursue' : 'accept_surrender',
      }));
    }, Math.round(700 / speed));
    return () => window.clearTimeout(timer);
  }, [engineState, speed]);

  const persistResolvedResult = useCallback(async (result: SealedEncounterResult<UnsealedWarResult>) => {
    if (!prepared) return;
    try {
      setResultSaveError('');
      await onResolved({ session: prepared.session, result });
    } catch (error) {
      setResultSaveError(`战争战果保存失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [onResolved, prepared]);

  useEffect(() => {
    if (!engineState || engineState.phase !== 'resolved' || !prepared || resolvedResultRef.current) return;
    try {
      const result = createSealedWarResult(engineState, new Date().toISOString());
      resolvedResultRef.current = result;
      void persistResolvedResult(result);
    } catch (error) {
      setResultSaveError(error instanceof Error ? error.message : '无法封存战争战果。');
    }
  }, [engineState, persistResolvedResult, prepared]);

  if (!intent || !active) return null;
  const postResult = active.session.status === 'narrative_pending'
    && active.checkpoint.checkpointKind === 'post_result'
    && active.checkpoint.result.kind === 'war'
      ? active.checkpoint.result
      : null;
  const preStart = active.session.status === 'pending' && !prepared;
  const pendingDecision = engineState?.phase === 'awaiting_decision'
    && engineState.pendingDecision?.decidingSide === 'player'
      ? engineState.pendingDecision
      : null;
  const playerArts = (() => {
    const snapshot = prepared?.snapshot;
    if (!snapshot) return [];
    const roleLabels = { troop_leader: '带兵将领', deputy: '副将', strategist: '军师' } as const;
    const sources = [
      ...(snapshot.commanders.player
        ? [{ source: snapshot.commanders.player, roleLabel: '主将' }]
        : []),
      ...(snapshot.officers?.player ?? []).map((officer) => ({
        source: officer,
        roleLabel: roleLabels[officer.role],
      })),
    ];
    const options = new Map<string, {
      profile: UniqueArtSemanticProfile;
      name: string;
      ownerName: string;
      roleLabel: string;
    }>();
    for (const { source, roleLabel } of sources) {
      for (const profile of source.uniqueArtProfiles) {
        if (!options.has(profile.sourceId)) {
          options.set(profile.sourceId, {
            profile,
            name: source.uniqueArtLabels?.[profile.sourceId] ?? profile.sourceId,
            ownerName: source.name,
            roleLabel,
          });
        }
      }
    }
    return [...options.values()];
  })();

  const markVisualFailed = (url: string) => {
    setFailedVisuals((current) => current.includes(url) ? current : [...current, url]);
  };
  const picture = (desktop: string | undefined, mobile: string | undefined, className: string) => {
    if (!desktop || failedVisuals.includes(desktop)) return <div className={`${className} is-placeholder`} aria-hidden="true" />;
    return (
      <picture className={className} aria-hidden="true">
        {mobile && <source media="(max-width: 760px)" srcSet={mobile} />}
        <img src={desktop} alt="" decoding="async" onError={() => markVisualFailed(desktop)} />
      </picture>
    );
  };

  return (
    <section
      className={`war-v2-screen${preStart ? ' is-prestart' : ''}`}
      data-testid="war-v2-screen"
      aria-label="War V2 战争界面"
      style={{ '--war-v2-speed': speed } as React.CSSProperties}
    >
      <header className="war-v2-header">
        <div>
          <small>WAR ENGINE V2 · 第 {engineState?.round ?? 0} 轮</small>
          <h1>{intent.reason}</h1>
          <p>
            {locationLabel ?? intent.locationId} · 目标：{OBJECTIVE_LABELS[intent.objective]}
            {participation ? ` · ${COMMAND_SCOPE_LABELS[participation.commandScope]} · ${WAR_MISSION_LABELS[participation.mission]}` : ''}
          </p>
        </div>
        <div className="war-v2-speed-controls" aria-label="战争播放控制">
          {([1, 2, 4] as PlaybackSpeed[]).map((value) => (
            <button key={value} type="button" className={speed === value ? 'is-active' : ''} onClick={() => setSpeed(value)}>{value}×</button>
          ))}
          <button
            type="button"
            className={autoMode ? 'is-active' : ''}
            disabled={!engineState || !['awaiting_round', 'auto_paused'].includes(engineState.phase)}
            onClick={() => {
              if (engineState?.phase === 'auto_paused') setEngineState(resumeWarAfterAutoPause(engineState));
              setAutoMode((current) => !current);
            }}
          >{autoMode ? '暂停自动' : '自动指挥'}</button>
        </div>
      </header>

      <div className={`war-v2-stage ${motionClass}`} data-motion={motionClass || 'idle'}>
        {visualAssets && picture(visualAssets.backgroundUrl, visualAssets.backgroundMobileUrl, 'war-v2-background')}
        <div className="war-v2-stage-shade" aria-hidden="true" />
        {visualAssets && picture(visualAssets.forceLayerUrl, visualAssets.forceLayerMobileUrl, 'war-v2-force-art war-v2-force-art--enemy')}
        {visualAssets && picture(visualAssets.forceLayerUrl, visualAssets.forceLayerMobileUrl, 'war-v2-force-art war-v2-force-art--player')}
        <div className="war-v2-motion-layer" aria-hidden="true"><i /><b /><em /></div>
        <ForceColumn runtimeState={runtimeState} snapshot={prepared?.snapshot ?? null} engineState={engineState} side="enemy" />
        {preStart ? (
          <section className="war-v2-stage-start" data-testid="war-v2-stage-start" aria-label="战前军议">
            <small>战前军议</small>
            <h2>列阵</h2>
            <p>{participation ? `你的任务：${WAR_MISSION_LABELS[participation.mission]}（${COMMAND_SCOPE_LABELS[participation.commandScope]}）。` : '双方部队、主将和能力投影已冻结。'}</p>
            <p>我方主将：{commanderName(runtimeState, intent.playerForce.commanderActorId)} · 敌方主将：{commanderName(runtimeState, intent.enemyForce.commanderActorId)}</p>
            {theaterContext && (theaterContext.alliedEstimatedStrength > 0 || theaterContext.enemyEstimatedStrength > 0) ? (
              <p>
                战区背景：友军约 {theaterContext.alliedEstimatedStrength} 人 · 敌军主力约 {theaterContext.enemyEstimatedStrength} 人；
                主力只提供有限战区影响，不归你直接调遣，也不作为本场伤亡结算对象。
              </p>
            ) : null}
            <button type="button" className="war-v2-primary" onClick={beginWar}>进入战争</button>
          </section>
        ) : postResult && narrativeBusy ? (
          <section
            className="war-v2-stage-start war-v2-stage-narrative"
            data-testid="war-v2-stage-narrative"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <span className="war-v2-stage-wait-mark" aria-hidden="true" />
            <small>战争已经结算</small>
            <h2>正在生成战后正文</h2>
            <p>正在整理战果、伤亡与后续局势，请稍候。</p>
            {onCancelNarrative && <button type="button" className="war-v2-danger" onClick={onCancelNarrative}>中止生成</button>}
          </section>
        ) : (
          <div className="war-v2-center-seal" aria-hidden="true">战</div>
        )}
        <ForceColumn runtimeState={runtimeState} snapshot={prepared?.snapshot ?? null} engineState={engineState} side="player" />
      </div>

      {!preStart && <div className="war-v2-lower">
        <section className="war-v2-log" aria-label="战争轮次记录">
          <h2>战场纪要</h2>
          <ol>
            {(engineState?.actionLog ?? []).slice(-12).map((entry) => <li key={entry.sequence}>{roundLogLabel(entry)}</li>)}
          </ol>
        </section>
        <section className="war-v2-command" aria-label="战争指挥区">
          {engineState && !postResult && engineState.phase !== 'resolved' && (
            <>
              <h2>下达军令</h2>
              <div className="war-v2-command-grid">
                {(Object.keys(TACTIC_LABELS) as WarTactic[]).map((tactic) => (
                  <button
                    key={tactic}
                    type="button"
                    title={`${TACTIC_DESCRIPTIONS[tactic]}${tactic === 'flank' ? ` ${flankContext(prepared?.snapshot, 'player')}` : ''}`}
                    aria-label={`${TACTIC_LABELS[tactic]}：${TACTIC_DESCRIPTIONS[tactic]}`}
                    disabled={engineState.phase !== 'awaiting_round'}
                    onClick={() => runOrder({ type: 'tactic', tactic })}
                  >{TACTIC_LABELS[tactic]}</button>
                ))}
                {playerArts.map((art) => (
                  <button
                    key={art.profile.sourceId}
                    type="button"
                    title={`${art.roleLabel}${art.ownerName}施展；每方每场只能主动使用一次。${describeWarArt(art.profile)}`}
                    aria-label={`战争绝艺 ${art.name}，来源：${art.roleLabel}${art.ownerName}`}
                    disabled={engineState.phase !== 'awaiting_round' || Boolean(engineState.usedWarArt.player)}
                    onClick={() => runOrder({ type: 'war_art', artId: art.profile.sourceId })}
                  >计策 · {art.name}（{art.ownerName}）</button>
                ))}
                <button type="button" title="尝试脱离战场；能否成功由双方机动力、士气、疲劳与主将能力共同判定。" disabled={engineState.phase !== 'awaiting_round' || !intent.policy.allowRetreat} onClick={() => setEngineState(attemptWarRetreat(engineState, 'player'))}>撤退</button>
                <button type="button" title="向敌军提出投降并结束抵抗；是否允许取决于本场战争政策。" disabled={engineState.phase !== 'awaiting_round' || !intent.policy.allowSurrender} onClick={() => setEngineState(offerWarSurrender(engineState, 'player'))}>请降</button>
                <button type="button" className="war-v2-secondary" onClick={() => {
                  setPrepared(null);
                  setEngineState(null);
                  setAutoMode(false);
                  setLocalStatus('已中止本局演算，仍停留在开战前检查点。');
                }}>中止本局并返回战前</button>
              </div>
              {engineState.phase === 'auto_paused' && (
                <button type="button" className="war-v2-danger" onClick={() => setEngineState(resumeWarAfterAutoPause(engineState))}>确认风险并恢复手动指挥</button>
              )}
              {pendingDecision && (
                <div className="war-v2-decision">
                  <strong>{pendingDecision.kind === 'pursuit' ? '敌军正在溃退，是否追击？' : '敌军请求投降，是否接受？'}</strong>
                  {pendingDecision.kind === 'pursuit' ? (
                    <>
                      <button type="button" onClick={() => setEngineState(resolveWarDecision(engineState, { choice: 'pursue' }))}>追击</button>
                      <button type="button" onClick={() => setEngineState(resolveWarDecision(engineState, { choice: 'stop_pursuit' }))}>收兵</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => setEngineState(resolveWarDecision(engineState, { choice: 'accept_surrender' }))}>接受投降</button>
                      <button type="button" onClick={() => setEngineState(resolveWarDecision(engineState, { choice: 'reject_surrender' }))}>拒绝投降</button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
          {postResult && (
            <div className="war-v2-result">
              <small>封存战果 · {postResult.resultHash}</small>
              <h2>{outcomeLabel(postResult.outcome)}</h2>
              <p>{postResult.roundsCompleted} 轮 · 伤亡 {postResult.forces.reduce((sum, force) => sum + force.casualties, 0)} · 目标{postResult.objectiveAchieved ? '达成' : '未达成'} · 阅历 +{postResult.experienceAward ?? 0}</p>
              {narrativeBusy ? (
                <p className="war-v2-result-progress">生成进度已显示在战场中央。</p>
              ) : (
                <button type="button" className="war-v2-primary" onClick={() => void onRequestNarrative()}>生成战后正文</button>
              )}
            </div>
          )}
          {engineState?.phase === 'resolved' && !postResult && (
            <div className="war-v2-result">
              <h2>{outcomeLabel(engineState.outcome)}</h2>
              <p>正在封存本地战果；完成前不会调用叙事 API。</p>
              {resultSaveError && resolvedResultRef.current && <button type="button" className="war-v2-danger" onClick={() => void persistResolvedResult(resolvedResultRef.current!)}>重试保存战果</button>}
            </div>
          )}
        </section>
      </div>}
      {(statusMessage || localStatus || resultSaveError) && (
        <footer className="war-v2-status" role={resultSaveError ? 'alert' : 'status'}>{resultSaveError || statusMessage || localStatus}</footer>
      )}
    </section>
  );
}

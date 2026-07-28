import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeState } from '../engine/types';
import {
  advanceCombatToNextAction,
  chooseCombatAiAction,
  executeCombatAction,
  finalizeCombatResult,
  prepareCombatEncounterForPlay,
  resolveCombatDecision,
  shouldPauseAutoCombat,
  type CombatAction,
  type CombatEngineState,
  type CombatEncounterSnapshot,
  type EncounterSession,
  type SealedEncounterResult,
  type UnsealedCombatResult,
} from '../engine/encounterV2';
import type { BattleBriefingCard } from './battleBriefingQueueModel';
import { BattleBriefingVisual } from './BattleBriefingVisual';

export interface CombatResolvedPayload {
  session: EncounterSession;
  result: SealedEncounterResult<UnsealedCombatResult>;
}

interface CombatEncounterScreenProps {
  runtimeState: RuntimeState;
  locationLabel?: string;
  onResolved: (payload: CombatResolvedPayload) => Promise<void>;
  onRequestNarrative: () => Promise<void>;
  narrativeBusy?: boolean;
  onCancelNarrative?: () => void;
  statusMessage?: string;
}

type PlaybackSpeed = 1 | 2 | 4;

function actorName(state: RuntimeState, actorId: string): string {
  if (state.player.id === actorId) return state.player.name;
  return state.npcs?.find((npc) => npc.npcId === actorId)?.name
    ?? state.knownActors.find((actor) => actor.id === actorId)?.name
    ?? actorId;
}

function activeCombatants(state: CombatEngineState, side: 'player' | 'enemy') {
  return state.combatants.filter((combatant) => (
    combatant.side === side
    && combatant.hp > 0
    && !combatant.statuses.includes('dead')
    && !combatant.statuses.includes('captured')
    && !combatant.statuses.includes('surrendered')
  ));
}

function outcomeLabel(outcome?: UnsealedCombatResult['outcome']): string {
  const labels: Record<UnsealedCombatResult['outcome'], string> = {
    player_victory: '我方胜利',
    enemy_victory: '我方战败',
    draw: '胜负未分',
    player_retreat: '我方成功撤离',
    enemy_retreat: '敌方撤退',
    surrender: '战斗以投降结束',
  };
  return outcome ? labels[outcome] : '等待结算';
}

function logLabel(entry: CombatEngineState['actionLog'][number], state: RuntimeState): string {
  const actor = actorName(state, entry.actorId);
  const targets = entry.targetIds.map((id) => actorName(state, id)).join('、');
  const labels: Record<string, string> = {
    normal_attack: '发动普通攻击',
    defend: '采取防御',
    unique_art: '施展绝艺',
    use_item: '使用物品',
    stabilize: '救援同伴',
    retreat: '尝试撤退',
    surrender: '选择投降',
  };
  return `${actor}${labels[entry.actionType] ?? '采取行动'}${targets ? `，目标：${targets}` : ''}`;
}

function prepareArtTargets(
  state: CombatEngineState,
  actorId: string,
  targetId: string | undefined,
  artId: string,
): string[] {
  const actor = state.snapshot.combatants.find((entry) => entry.actorId === actorId);
  const art = actor?.uniqueArtProfiles.find((entry) => entry.sourceId === artId);
  if (!actor || !art) return [];
  const allies = activeCombatants(state, actor.side);
  const enemies = activeCombatants(state, actor.side === 'player' ? 'enemy' : 'player');
  if (art.targetMode === 'self') return [actorId];
  if (art.targetMode === 'all_allies') return allies.map((entry) => entry.actorId);
  if (art.targetMode === 'all_enemies') return enemies.map((entry) => entry.actorId);
  if (art.targetMode === 'single_ally') return [targetId && allies.some((entry) => entry.actorId === targetId) ? targetId : allies[0]?.actorId].filter(Boolean) as string[];
  return [targetId && enemies.some((entry) => entry.actorId === targetId) ? targetId : enemies[0]?.actorId].filter(Boolean) as string[];
}

function prepareItemTargets(
  state: CombatEngineState,
  actorId: string,
  targetId: string | undefined,
  itemId: string,
): string[] {
  const actor = state.snapshot.combatants.find((entry) => entry.actorId === actorId);
  const item = actor?.itemProfiles.find((entry) => entry.sourceId === itemId);
  const effect = item?.effects[0];
  if (!actor || !effect) return [];
  const allies = activeCombatants(state, actor.side);
  const enemies = activeCombatants(state, actor.side === 'player' ? 'enemy' : 'player');
  if (effect.target === 'self') return [actorId];
  if (effect.target === 'all_allies' || effect.target === 'own_force') return allies.map((entry) => entry.actorId);
  if (effect.target === 'all_enemies' || effect.target === 'enemy_force') return enemies.map((entry) => entry.actorId);
  if (effect.target === 'single_ally') return [targetId && allies.some((entry) => entry.actorId === targetId) ? targetId : allies[0]?.actorId].filter(Boolean) as string[];
  return [targetId && enemies.some((entry) => entry.actorId === targetId) ? targetId : enemies[0]?.actorId].filter(Boolean) as string[];
}

function CombatantSlot({
  runtimeState,
  snapshot,
  engineState,
  actorId,
  side,
  selected,
  acting,
  targeted,
  onSelect,
}: {
  runtimeState: RuntimeState;
  snapshot?: CombatEncounterSnapshot;
  engineState?: CombatEngineState;
  actorId?: string;
  side: 'player' | 'enemy';
  selected: boolean;
  acting: boolean;
  targeted: boolean;
  onSelect: () => void;
}) {
  if (!actorId) return <div className="combat-v2-slot is-empty" aria-hidden="true" />;
  const frozen = snapshot?.combatants.find((entry) => entry.actorId === actorId);
  const live = engineState?.combatants.find((entry) => entry.actorId === actorId);
  const hp = live?.hp ?? frozen?.hp ?? 100;
  const maxHp = live?.maxHp ?? frozen?.maxHp ?? 100;
  const stamina = live?.stamina ?? frozen?.stamina ?? 100;
  const maxStamina = live?.maxStamina ?? frozen?.maxStamina ?? 100;
  const gauge = live?.gauge ?? 0;
  const statuses = live?.statuses ?? [];
  return (
    <button
      type="button"
      className={[
        'combat-v2-slot',
        `combat-v2-slot--${side}`,
        selected ? 'is-selected' : '',
        acting ? 'is-acting' : '',
        targeted ? 'is-targeted' : '',
        hp <= 0 ? 'is-downed' : '',
      ].filter(Boolean).join(' ')}
      onClick={onSelect}
      aria-pressed={selected}
      data-actor-id={actorId}
    >
      <span className="combat-v2-slot-heading">
        <span className="combat-v2-slot-name">{actorName(runtimeState, actorId)}</span>
        <span className="combat-v2-slot-state">{statuses.length > 0 ? statuses.join(' · ') : (hp > 0 ? '备战' : '倒地')}</span>
      </span>
      <span className="combat-v2-slot-resource">
        <span className="combat-v2-slot-values">生命 {hp}/{maxHp}</span>
        <span className="combat-v2-slot-meter combat-v2-slot-meter--hp"><i style={{ width: `${Math.max(0, hp / maxHp) * 100}%` }} /></span>
      </span>
      <span className="combat-v2-slot-resource">
        <span className="combat-v2-slot-values">体力 {stamina}/{maxStamina}</span>
        <span className="combat-v2-slot-meter combat-v2-slot-meter--stamina"><i style={{ width: `${Math.max(0, stamina / maxStamina) * 100}%` }} /></span>
      </span>
      <span className="combat-v2-slot-gauge" aria-label={`行动槽 ${Math.min(100, Math.round(gauge / 10))}%`}>
        <i style={{ width: `${Math.min(100, gauge / 10)}%` }} />
      </span>
    </button>
  );
}

export function CombatEncounterScreen({
  runtimeState,
  locationLabel,
  onResolved,
  onRequestNarrative,
  narrativeBusy = false,
  onCancelNarrative,
  statusMessage = '',
}: CombatEncounterScreenProps) {
  const active = runtimeState.encounterV2?.active;
  const intent = active?.session.intent.kind === 'personal_combat' ? active.session.intent : null;
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>(() => intent?.playerParty.actorIds ?? []);
  const [prepared, setPrepared] = useState<ReturnType<typeof prepareCombatEncounterForPlay> | null>(null);
  const [engineState, setEngineState] = useState<CombatEngineState | null>(null);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [autoMode, setAutoMode] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const [lastAction, setLastAction] = useState<CombatEngineState['actionLog'][number] | null>(null);
  const [localStatus, setLocalStatus] = useState('');
  const [resultSaveError, setResultSaveError] = useState('');
  const resolvedResultRef = useRef<SealedEncounterResult<UnsealedCombatResult> | null>(null);

  useEffect(() => {
    setSelectedPlayerIds(intent?.playerParty.actorIds ?? []);
    setPrepared(null);
    setEngineState(null);
    setAutoMode(false);
    setSelectedTargetId(undefined);
    setLastAction(null);
    setLocalStatus('');
    setResultSaveError('');
    resolvedResultRef.current = null;
  }, [active?.session.sessionId, intent?.encounterId]);

  const briefingCard: BattleBriefingCard | null = useMemo(() => intent ? {
    key: `combat-v2:${intent.encounterId}`,
    kind: 'combat',
    recordId: intent.encounterId,
    title: intent.reason,
    eyebrow: 'Combat V2',
    summary: '本地规则正在裁定这场冲突。',
    occurredAt: runtimeState.currentDate,
    location: locationLabel ?? intent.locationId,
    visualTags: [],
    openPanel: 'combats',
    selectedId: intent.encounterId,
    panelTab: 'playerRelated',
  } : null, [intent, runtimeState.currentDate]);

  const beginCombat = useCallback(() => {
    if (!intent) return;
    try {
      const next = prepareCombatEncounterForPlay(runtimeState, {
        selectedPlayerActorIds: selectedPlayerIds,
        startedAt: new Date().toISOString(),
      });
      setPrepared(next);
      setEngineState(next.engineState);
      setSelectedTargetId(next.snapshot.combatants.find((entry) => entry.side === 'enemy')?.actorId);
      setLocalStatus('战斗开始。敌方行动由本地 AI 执行，我方由玩家操作。');
    } catch (error) {
      setLocalStatus(error instanceof Error ? error.message : '无法开始战斗。');
    }
  }, [intent, runtimeState, selectedPlayerIds]);

  const togglePlayerCandidate = (actorId: string) => {
    if (!intent || intent.partySelection === 'locked') return;
    setSelectedPlayerIds((current) => {
      if (current.includes(actorId)) return current.length > 1 ? current.filter((id) => id !== actorId) : current;
      return current.length < 3 ? [...current, actorId] : current;
    });
  };

  const runAction = useCallback((action: CombatAction) => {
    if (!engineState) return;
    try {
      const next = executeCombatAction(engineState, action);
      const entry = next.actionLog[next.actionLog.length - 1] ?? null;
      setLastAction(entry);
      setEngineState(next);
      setLocalStatus(entry ? logLabel(entry, runtimeState) : '行动完成。');
    } catch (error) {
      setLocalStatus(error instanceof Error ? error.message : '行动未能执行。');
    }
  }, [engineState, runtimeState]);

  useEffect(() => {
    if (!engineState || engineState.phase === 'resolved' || engineState.phase === 'awaiting_disposition') return;
    const delay = Math.round(680 / speed);
    const timer = window.setTimeout(() => {
      try {
        let next = engineState;
        if (next.phase !== 'awaiting_action') next = advanceCombatToNextAction(next);
        if (next.phase !== 'awaiting_action' || !next.currentActorId) {
          setEngineState(next);
          return;
        }
        const actor = next.combatants.find((entry) => entry.actorId === next.currentActorId);
        if (!actor) return;
        if (actor.side === 'player' && !autoMode) {
          setEngineState(next);
          return;
        }
        if (actor.side === 'player' && autoMode) {
          const pauseReason = shouldPauseAutoCombat(next);
          if (pauseReason) {
            setAutoMode(false);
            setEngineState(next);
            setLocalStatus('危险状态触发，自动战斗已暂停，请手动处置。');
            return;
          }
        }
        const acted = executeCombatAction(next, chooseCombatAiAction(next, actor.actorId));
        const entry = acted.actionLog[acted.actionLog.length - 1] ?? null;
        setLastAction(entry);
        setEngineState(acted);
        if (entry) setLocalStatus(logLabel(entry, runtimeState));
      } catch (error) {
        setAutoMode(false);
        setLocalStatus(error instanceof Error ? error.message : '本地战斗推进失败。');
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [autoMode, engineState, runtimeState, speed]);

  const persistResolvedResult = useCallback(async (result: SealedEncounterResult<UnsealedCombatResult>) => {
    if (!prepared) return;
    try {
      setResultSaveError('');
      await onResolved({ session: prepared.session, result });
    } catch (error) {
      setResultSaveError(error instanceof Error ? error.message : '战果保存失败。');
    }
  }, [onResolved, prepared]);

  useEffect(() => {
    if (!engineState || engineState.phase !== 'resolved' || !prepared || resolvedResultRef.current) return;
    try {
      const result = finalizeCombatResult(engineState, new Date().toISOString());
      resolvedResultRef.current = result;
      void persistResolvedResult(result);
    } catch (error) {
      setResultSaveError(error instanceof Error ? error.message : '战果封存失败。');
    }
  }, [engineState, persistResolvedResult, prepared]);

  if (!active || !intent) return null;

  const postResult = active.checkpoint.checkpointKind === 'post_result'
    && active.checkpoint.result.kind === 'personal_combat'
    ? active.checkpoint.result
    : null;
  const currentActor = engineState?.combatants.find((entry) => entry.actorId === engineState.currentActorId);
  const currentSnapshot = currentActor
    ? engineState?.snapshot.combatants.find((entry) => entry.actorId === currentActor.actorId)
    : undefined;
  const enemyIds = prepared?.snapshot.combatants.filter((entry) => entry.side === 'enemy').map((entry) => entry.actorId)
    ?? intent.enemyParty.actorIds;
  const playerIds = prepared?.snapshot.combatants.filter((entry) => entry.side === 'player').map((entry) => entry.actorId)
    ?? intent.playerParty.actorIds;
  const selectableTargetIds = engineState
    ? activeCombatants(engineState, currentActor?.side === 'enemy' ? 'player' : 'enemy').map((entry) => entry.actorId)
    : (currentActor?.side === 'enemy' ? playerIds : enemyIds);
  const selectedTarget = selectedTargetId && engineState?.combatants.some((entry) => (
    entry.actorId === selectedTargetId
    && entry.hp > 0
    && !entry.statuses.some((status) => ['dead', 'captured', 'surrendered'].includes(status))
  ))
    ? selectedTargetId
    : selectableTargetIds[0];
  const activeEnemyIds = engineState
    ? activeCombatants(engineState, 'enemy').map((entry) => entry.actorId)
    : enemyIds;
  const selectedEnemyTarget = selectedTargetId && activeEnemyIds.includes(selectedTargetId)
    ? selectedTargetId
    : activeEnemyIds[0];
  const isPlayerTurn = engineState?.phase === 'awaiting_action' && currentActor?.side === 'player';
  const activeLog = engineState?.actionLog.slice(-8).reverse() ?? [];
  const pendingDecision = engineState?.pendingDecision;

  return (
    <section
      className="combat-v2-screen"
      data-testid="combat-v2-screen"
      data-playback-speed={speed}
      aria-label="个人战"
      style={{ '--combat-v2-speed': `${speed}` } as React.CSSProperties}
    >
      <header className="combat-v2-header">
        <div>
          <small>COMBAT ENGINE V2</small>
          <h1>{intent.reason}</h1>
          <p>{locationLabel ?? intent.locationId} · 第 {intent.sourceTurnNumber} 回合后</p>
        </div>
        <div className="combat-v2-speed-controls" aria-label="战斗速度">
          {([1, 2, 4] as PlaybackSpeed[]).map((value) => (
            <button key={value} type="button" className={speed === value ? 'is-active' : ''} onClick={() => setSpeed(value)}>{value}×</button>
          ))}
          <button type="button" className={autoMode ? 'is-active' : ''} onClick={() => setAutoMode((value) => !value)} disabled={!engineState || Boolean(postResult)}>
            {autoMode ? '停止自动' : '自动战斗'}
          </button>
        </div>
      </header>

      <div className="combat-v2-timeline" aria-label="行动速度条">
        {(engineState?.combatants ?? []).slice().sort((left, right) => right.gauge - left.gauge || right.speed - left.speed).map((combatant) => (
          <span key={combatant.actorId} className={`combat-v2-timeline-token combat-v2-timeline-token--${combatant.side}`} style={{ left: `${Math.min(96, combatant.gauge / 10)}%` }}>
            {actorName(runtimeState, combatant.actorId).slice(0, 2)}
          </span>
        ))}
      </div>

      <div className="combat-v2-stage">
        {briefingCard && <BattleBriefingVisual card={briefingCard} label="个人战场" testId="combat-v2-stage-visual" />}
        <div className="combat-v2-side combat-v2-side--enemy" data-testid="combat-side-enemy">
          <h2>敌方</h2>
          <div className="combat-v2-slot-list">
            {[0, 1, 2].map((index) => {
              const actorId = enemyIds[index];
              return (
                <CombatantSlot
                  key={actorId ?? `enemy-empty-${index}`}
                  runtimeState={runtimeState}
                  snapshot={prepared?.snapshot}
                  engineState={engineState ?? undefined}
                  actorId={actorId}
                  side="enemy"
                  selected={selectedTarget === actorId}
                  acting={lastAction?.actorId === actorId}
                  targeted={Boolean(actorId && lastAction?.targetIds.includes(actorId))}
                  onSelect={() => actorId && setSelectedTargetId(actorId)}
                />
              );
            })}
          </div>
        </div>
        <div className="combat-v2-stage-seal" aria-hidden="true"><span>战</span></div>
        <div className="combat-v2-side combat-v2-side--player" data-testid="combat-side-player">
          <h2>我方</h2>
          <div className="combat-v2-slot-list">
            {[0, 1, 2].map((index) => {
              const actorId = playerIds[index];
              return (
                <CombatantSlot
                  key={actorId ?? `player-empty-${index}`}
                  runtimeState={runtimeState}
                  snapshot={prepared?.snapshot}
                  engineState={engineState ?? undefined}
                  actorId={actorId}
                  side="player"
                  selected={!prepared && Boolean(actorId && selectedPlayerIds.includes(actorId))}
                  acting={lastAction?.actorId === actorId}
                  targeted={Boolean(actorId && lastAction?.targetIds.includes(actorId))}
                  onSelect={() => {
                    if (!prepared && actorId) togglePlayerCandidate(actorId);
                    else if (actorId) setSelectedTargetId(actorId);
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="combat-v2-lower">
        <div className="combat-v2-log" aria-label="战斗记录">
          <h3>交锋记录</h3>
          {activeLog.length === 0 ? <p>双方尚未交手。</p> : (
            <ol>{activeLog.map((entry) => <li key={entry.actionId}>{logLabel(entry, runtimeState)}</li>)}</ol>
          )}
        </div>
        <div className="combat-v2-command" aria-label="战斗指令">
          {!prepared && !postResult && (
            <>
              <h3>出战准备</h3>
              <p>{intent.partySelection === 'locked' ? '本场阵容已经锁定。' : '选择 1—3 名我方角色同时上场。'}</p>
              <button type="button" className="combat-v2-primary" onClick={beginCombat}>进入战斗</button>
            </>
          )}
          {prepared && engineState && !postResult && engineState.phase !== 'resolved' && (
            <>
              <h3>{isPlayerTurn ? `${actorName(runtimeState, currentActor!.actorId)}行动` : '等待行动槽推进'}</h3>
              <div className="combat-v2-command-grid">
                <button type="button" disabled={!isPlayerTurn || !selectedEnemyTarget} onClick={() => selectedEnemyTarget && runAction({ type: 'normal_attack', actorId: currentActor!.actorId, targetId: selectedEnemyTarget })}>普通攻击</button>
                <button type="button" disabled={!isPlayerTurn} onClick={() => runAction({ type: 'defend', actorId: currentActor!.actorId })}>防御</button>
                {currentSnapshot?.uniqueArtProfiles.map((art) => (
                  <button
                    key={art.sourceId}
                    type="button"
                    disabled={!isPlayerTurn || currentActor!.stamina < art.staminaCost || (currentActor!.artUsage[art.sourceId] ?? 0) >= art.perEncounterLimit}
                    onClick={() => runAction({
                      type: 'unique_art',
                      actorId: currentActor!.actorId,
                      artId: art.sourceId,
                      targetIds: prepareArtTargets(engineState, currentActor!.actorId, selectedTarget, art.sourceId),
                    })}
                  >绝艺 · {art.sourceId}</button>
                ))}
                {currentSnapshot?.itemProfiles.map((item) => (
                  <button
                    key={item.sourceId}
                    type="button"
                    disabled={!isPlayerTurn || (currentActor!.itemQuantities[item.sourceId] ?? 0) < item.quantityPerUse}
                    onClick={() => runAction({
                      type: 'use_item',
                      actorId: currentActor!.actorId,
                      itemId: item.sourceId,
                      targetIds: prepareItemTargets(engineState, currentActor!.actorId, selectedTarget, item.sourceId),
                    })}
                  >物品 · {item.sourceId}</button>
                ))}
                {engineState.combatants.filter((entry) => entry.side === 'player' && entry.hp === 0 && entry.downCount === 1 && !entry.revivedOnce).map((target) => (
                  <button key={target.actorId} type="button" disabled={!isPlayerTurn} onClick={() => runAction({ type: 'stabilize', actorId: currentActor!.actorId, targetId: target.actorId })}>
                    救援 · {actorName(runtimeState, target.actorId)}
                  </button>
                ))}
                <button type="button" disabled={!isPlayerTurn || !intent.policy.allowRetreat} onClick={() => runAction({ type: 'retreat', actorId: currentActor!.actorId })}>撤退</button>
                <button type="button" disabled={!isPlayerTurn || !intent.policy.allowSurrender} onClick={() => runAction({ type: 'surrender', actorId: currentActor!.actorId })}>投降</button>
                <button type="button" className="combat-v2-secondary" onClick={() => {
                  setPrepared(null);
                  setEngineState(null);
                  setAutoMode(false);
                  setLastAction(null);
                  setLocalStatus('已中止本局演算，仍停留在开战前检查点。');
                }}>中止本局并重新布阵</button>
              </div>
              {pendingDecision && (
                <div className="combat-v2-decision">
                  <strong>{pendingDecision.kind === 'fatal_disposition' ? '决定敌方处置' : '敌方请求投降'}</strong>
                  {pendingDecision.kind === 'fatal_disposition' ? (
                    <>
                      <button type="button" onClick={() => setEngineState(resolveCombatDecision(engineState, { choice: 'spare' }))}>饶过</button>
                      {intent.policy.allowCapture && <button type="button" onClick={() => setEngineState(resolveCombatDecision(engineState, { choice: 'capture' }))}>俘虏</button>}
                      <button type="button" onClick={() => setEngineState(resolveCombatDecision(engineState, { choice: 'kill' }))}>处决</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => setEngineState(resolveCombatDecision(engineState, { choice: 'accept_surrender' }))}>接受</button>
                      <button type="button" onClick={() => setEngineState(resolveCombatDecision(engineState, { choice: 'reject_surrender' }))}>拒绝</button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
          {postResult && (
            <div className="combat-v2-result">
              <small>封存战果 · {postResult.resultHash}</small>
              <h3>{outcomeLabel(postResult.outcome)}</h3>
              <p>行动 {postResult.actionLog.length} 次 · 战斗耗时 {postResult.elapsedMinutes} 分钟 · 经验 {postResult.experienceAward}</p>
              <button
                type="button"
                className="combat-v2-primary"
                disabled={narrativeBusy}
                onClick={() => void onRequestNarrative()}
              >{narrativeBusy ? '战后正文生成中…' : '生成战后正文'}</button>
              {narrativeBusy && onCancelNarrative && <button type="button" className="combat-v2-danger" onClick={onCancelNarrative}>中止生成</button>}
            </div>
          )}
          {engineState?.phase === 'resolved' && !postResult && (
            <div className="combat-v2-result">
              <h3>{outcomeLabel(engineState.outcome)}</h3>
              <p>正在封存本地战果；完成前不会调用叙事 API。</p>
              {resultSaveError && resolvedResultRef.current && (
                <button type="button" className="combat-v2-danger" onClick={() => void persistResolvedResult(resolvedResultRef.current!)}>重试保存战果</button>
              )}
            </div>
          )}
        </div>
      </div>
      {(statusMessage || localStatus || resultSaveError) && (
        <footer className="combat-v2-status" role={resultSaveError ? 'alert' : 'status'}>
          {resultSaveError || statusMessage || localStatus}
        </footer>
      )}
    </section>
  );
}

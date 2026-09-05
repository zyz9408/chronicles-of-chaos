import { useEffect, useMemo, useState } from 'react';
import type { BattleBriefingCard } from './battleBriefingQueueModel';
import type { BattleBriefingVisualAssets } from './combatVisualAssets';

interface BattleBriefingVisualProps {
  card: BattleBriefingCard;
  label?: string;
  testId?: string;
  enemyCount?: number;
  playerCount?: number;
}

type VisualState = 'loading' | 'ready' | 'error';

export function normalizeBattleVisualCombatantCount(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(3, Math.trunc(value)));
}

interface BattleVisualCombatantLayer {
  url: string;
  mobileUrl: string;
}

export function buildBattleVisualCombatantLayers(
  visual: BattleBriefingVisualAssets | null,
  enemyCount?: number,
  playerCount?: number,
): { enemyLayers: BattleVisualCombatantLayer[]; playerLayers: BattleVisualCombatantLayer[] } {
  const repeatLayers = (
    url: string | undefined,
    mobileUrl: string | undefined,
    urls: string[] | undefined,
    mobileUrls: string[] | undefined,
    count: number,
  ): BattleVisualCombatantLayer[] => {
    if (!url || !mobileUrl || count === 0) return [];
    const displayCandidates = urls?.length ? urls : [url];
    const mobileCandidates = mobileUrls?.length ? mobileUrls : [mobileUrl];
    return Array.from({ length: count }, (_, index) => ({
      url: displayCandidates[index % displayCandidates.length] ?? url,
      mobileUrl: mobileCandidates[index % mobileCandidates.length] ?? mobileUrl,
    }));
  };

  return {
    enemyLayers: repeatLayers(
      visual?.enemyLayerUrl,
      visual?.enemyLayerMobileUrl,
      visual?.enemyLayerUrls,
      visual?.enemyLayerMobileUrls,
      normalizeBattleVisualCombatantCount(enemyCount),
    ),
    playerLayers: repeatLayers(
      visual?.playerLayerUrl,
      visual?.playerLayerMobileUrl,
      undefined,
      undefined,
      normalizeBattleVisualCombatantCount(playerCount),
    ),
  };
}

export function BattleBriefingVisual({
  card,
  label,
  testId,
  enemyCount,
  playerCount,
}: BattleBriefingVisualProps) {
  const [attempt, setAttempt] = useState(0);
  const [visual, setVisual] = useState<BattleBriefingVisualAssets | null>(null);
  const [state, setState] = useState<VisualState>('loading');
  const [, setLoadedLayers] = useState<string[]>([]);
  const identity = useMemo(() => JSON.stringify([
    card.kind,
    card.recordId,
    card.title,
    card.summary,
    card.location,
    card.imageKey,
    card.visualTags,
  ]), [card]);

  useEffect(() => {
    let active = true;
    setVisual(null);
    setLoadedLayers([]);
    setState('loading');
    void import('./combatVisualAssets')
      .then(({ resolveBattleBriefingVisualAssets }) => {
        if (!active) return;
        setVisual(resolveBattleBriefingVisualAssets(card));
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => {
      active = false;
    };
  }, [attempt, identity]);

  const { enemyLayers, playerLayers } = buildBattleVisualCombatantLayers(
    visual,
    enemyCount,
    playerCount,
  );
  const expectedLayerCount = visual
    ? 1 + Number(Boolean(visual.forceLayerUrl)) + enemyLayers.length + playerLayers.length
    : 0;
  const markLayerLoaded = (layer: string) => {
    setLoadedLayers((current) => {
      if (current.includes(layer)) return current;
      const next = [...current, layer];
      if (next.length >= expectedLayerCount) setState('ready');
      return next;
    });
  };
  const markLayerError = () => setState('error');
  const captionLabel = label ?? (card.kind === 'battle' ? '战场记录' : '个人战记录');
  const detailLabel = visual
    ? [
        visual.sceneLabel,
        visual.forceLabel,
        visual.enemyLabel,
        visual.playerLabel,
        visual.effectLabel,
      ].filter(Boolean).join(' / ')
    : '';
  const visualEffectStateClassNames = visual?.effects.map((effect) => `battle-briefing-has-effect--${effect.key}`) ?? [];

  return (
    <div
      className={[
        'battle-report-visual',
        'battle-briefing-visual',
        `battle-briefing-visual--${card.kind}`,
        ...visualEffectStateClassNames,
      ].join(' ')}
      data-testid={testId}
      data-visual-state={state}
      aria-busy={state === 'loading'}
    >
      {visual && (
        <>
          <img
            key={`background-${attempt}`}
            className="battle-briefing-visual-bg"
            src={visual.backgroundUrl}
            srcSet={`${visual.backgroundMobileUrl} 640w, ${visual.backgroundUrl} 1280w`}
            sizes="(max-width: 760px) 94vw, 896px"
            width={1280}
            height={720}
            decoding="async"
            alt=""
            aria-hidden="true"
            onLoad={() => markLayerLoaded('background')}
            onError={markLayerError}
          />
          {visual.forceLayerUrl && visual.forceLayerMobileUrl && (
            <img
              key={`force-${attempt}`}
              className="battle-briefing-visual-force"
              src={visual.forceLayerUrl}
              srcSet={`${visual.forceLayerMobileUrl} 640w, ${visual.forceLayerUrl} 1280w`}
              sizes="(max-width: 760px) 94vw, 896px"
              width={1280}
              height={720}
              decoding="async"
              alt=""
              aria-hidden="true"
              onLoad={() => markLayerLoaded('force')}
              onError={markLayerError}
            />
          )}
          {enemyLayers.map((layer, index) => (
            <img
              key={`enemy-${attempt}-${index}`}
              className="battle-briefing-visual-enemy"
              data-combatant-index={index}
              data-combatant-count={enemyLayers.length}
              src={layer.url}
              srcSet={`${layer.mobileUrl} 360w, ${layer.url} 768w`}
              sizes="(max-width: 760px) 36vw, 320px"
              width={768}
              height={1024}
              decoding="async"
              alt=""
              aria-hidden="true"
              onLoad={() => markLayerLoaded(`enemy-${index}`)}
              onError={markLayerError}
            />
          ))}
          {playerLayers.map((layer, index) => (
            <img
              key={`player-${attempt}-${index}`}
              className="battle-briefing-visual-player"
              data-combatant-index={index}
              data-combatant-count={playerLayers.length}
              src={layer.url}
              srcSet={`${layer.mobileUrl} 360w, ${layer.url} 768w`}
              sizes="(max-width: 760px) 44vw, 400px"
              width={768}
              height={1024}
              decoding="async"
              alt=""
              aria-hidden="true"
              onLoad={() => markLayerLoaded(`player-${index}`)}
              onError={markLayerError}
            />
          ))}
          {visual.effects.length > 0 && (
            <div className="battle-briefing-effect-layer" aria-hidden="true">
              {visual.effects.map((effect) => (
                <span key={effect.key} className={`battle-briefing-effect ${effect.className}`} />
              ))}
            </div>
          )}
          <div className="battle-briefing-visual-caption">
            <span>{captionLabel}</span>
            <strong>{detailLabel}</strong>
          </div>
        </>
      )}

      {state !== 'ready' && (
        <div
          className={`battle-briefing-visual-state battle-briefing-visual-state--${state}`}
          role={state === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <span>{state === 'error' ? '战场图像载入失败' : '正在载入战场图像…'}</span>
          {state === 'error' && (
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>重试载入</button>
          )}
        </div>
      )}
    </div>
  );
}

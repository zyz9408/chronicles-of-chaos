import { useEffect, useMemo, useState } from 'react';
import type { BattleBriefingCard } from './battleBriefingQueueModel';
import type { BattleBriefingVisualAssets } from './combatVisualAssets';

interface BattleBriefingVisualProps {
  card: BattleBriefingCard;
  label?: string;
  testId?: string;
}

type VisualState = 'loading' | 'ready' | 'error';

export function BattleBriefingVisual({ card, label, testId }: BattleBriefingVisualProps) {
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

  const expectedLayerCount = visual
    ? 1 + Number(Boolean(visual.forceLayerUrl)) + Number(Boolean(visual.enemyLayerUrl)) + Number(Boolean(visual.playerLayerUrl))
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
          {visual.enemyLayerUrl && visual.enemyLayerMobileUrl && (
            <img
              key={`enemy-${attempt}`}
              className="battle-briefing-visual-enemy"
              src={visual.enemyLayerUrl}
              srcSet={`${visual.enemyLayerMobileUrl} 360w, ${visual.enemyLayerUrl} 768w`}
              sizes="(max-width: 760px) 36vw, 320px"
              width={768}
              height={1024}
              decoding="async"
              alt=""
              aria-hidden="true"
              onLoad={() => markLayerLoaded('enemy')}
              onError={markLayerError}
            />
          )}
          {visual.playerLayerUrl && visual.playerLayerMobileUrl && (
            <img
              key={`player-${attempt}`}
              className="battle-briefing-visual-player"
              src={visual.playerLayerUrl}
              srcSet={`${visual.playerLayerMobileUrl} 360w, ${visual.playerLayerUrl} 768w`}
              sizes="(max-width: 760px) 44vw, 400px"
              width={768}
              height={1024}
              decoding="async"
              alt=""
              aria-hidden="true"
              onLoad={() => markLayerLoaded('player')}
              onError={markLayerError}
            />
          )}
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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeState, TurnDisplayMeta, TurnLogEntry } from '../engine/types';
import {
  AVG_VISUAL_OVERRIDES_CHANGED_EVENT,
  IndexedDbAvgVisualOverrideRepository,
  createAvgActorTarget,
  createAvgSceneTarget,
  validateAvgImage,
  type AvgUserOutfit,
  type ValidatedAvgImage,
  type AvgVisualTarget,
} from '../engine/avg/AvgVisualOverrideRepository';
import type { AvgPlayerPortraitMode } from '../engine/settings/DisplaySettings';
import { AVG_RESOURCE_PACK_CHANGED_EVENT, AvgResourcePackManager } from '../engine/avg/AvgResourcePackManager';
import {
  resolveThreeKingdomsPortraitSet,
  resolveThreeKingdomsSceneResource,
  type ThreeKingdomsPortraitSubject,
} from '../engine/avg/ThreeKingdomsAvgResolver';
import { freezeAvgSpeakerBindings } from './AvgSpeakerBinding';
import { parseNarrativeTextSegments } from './narrativeTextSegments';
import { AvgOutfitManager } from './AvgOutfitManager';
import { AvgImageCandidateControl } from './AvgImageCandidateControl';
import { buildAvgActorImagePrompt, buildAvgSceneImagePrompt } from '../engine/avg/AvgImagePrompt';
import { deriveActorCurrentAge, deriveNpcCurrentAge } from '../engine/time/npcAge';

export interface AvgNarrativeStageProps {
  entryKey: string;
  narrativeText: string;
  displayMeta?: TurnDisplayMeta;
  visualSnapshot?: TurnLogEntry['avgVisualSnapshot'];
  avgPresentation?: TurnLogEntry['avgPresentation'];
  runtimeState: RuntimeState;
  saveId: string;
  worldBookId: string;
  playerPortraitMode: AvgPlayerPortraitMode;
  onReturnClassic: () => void;
  onOpenAvgSettings?: () => void;
}

type LoadedOverride = { target?: AvgVisualTarget; url?: string; status: 'idle' | 'loading' | 'found' | 'missing' | 'error' };
const repository = new IndexedDbAvgVisualOverrideRepository();
const resourcePacks = new AvgResourcePackManager();

function partitionId(state: RuntimeState, saveId: string): string {
  return state.avgPresentation?.visualPartitionId?.trim() || saveId.trim();
}

function actorName(state: RuntimeState, actorId?: string): string | undefined {
  if (!actorId) return undefined;
  if (actorId === state.player.id) return state.player.name;
  return state.npcs?.find((npc) => npc.npcId === actorId)?.name
    ?? state.knownActors.find((actor) => actor.id === actorId)?.name;
}

function portraitSubject(state: RuntimeState, actorId: string): ThreeKingdomsPortraitSubject | undefined {
  if (actorId === state.player.id) return {
    actorId,
    name: state.player.name,
    aliases: state.player.aliases,
    roleType: state.player.roleType,
    sex: state.player.sex,
  };
  const npc = state.npcs?.find((candidate) => candidate.npcId === actorId);
  if (npc) return { actorId, name: npc.name, aliases: npc.aliases, roleType: npc.role, sex: npc.sex };
  const actor = state.knownActors.find((candidate) => candidate.id === actorId);
  return actor ? { actorId, name: actor.name, aliases: actor.aliases, roleType: actor.roleType, sex: actor.sex } : undefined;
}

export function AvgNarrativeStage(props: AvgNarrativeStageProps): React.ReactElement {
  const { entryKey, narrativeText, displayMeta, visualSnapshot, avgPresentation, runtimeState, saveId, worldBookId,
    playerPortraitMode, onReturnClassic, onOpenAvgSettings } = props;
  const segments = useMemo(() => parseNarrativeTextSegments(narrativeText), [narrativeText]);
  const bindingResult = useMemo(() => freezeAvgSpeakerBindings(
    narrativeText, runtimeState, displayMeta?.presentationSpeakerFacts ?? [], avgPresentation?.speakerBindings ?? [],
  ), [avgPresentation?.speakerBindings, displayMeta?.presentationSpeakerFacts, narrativeText, runtimeState]);
  const bindingBySegment = useMemo(
    () => new Map(bindingResult.bindings.map((binding) => [binding.segmentIndex, binding])),
    [bindingResult.bindings],
  );
  const [frameIndex, setFrameIndex] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [background, setBackground] = useState<LoadedOverride>({ status: 'idle' });
  const [portrait, setPortrait] = useState<LoadedOverride>({ status: 'idle' });
  const [notice, setNotice] = useState('');
  const [isOutfitManagerOpen, setIsOutfitManagerOpen] = useState(false);
  const [isVisualManagerOpen, setIsVisualManagerOpen] = useState(false);
  const [pendingVisual, setPendingVisual] = useState<ValidatedAvgImage>();
  const [pendingVisualUrl, setPendingVisualUrl] = useState('');
  const [selectedOutfit, setSelectedOutfit] = useState<AvgUserOutfit>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sceneTarget = useMemo(() => {
    const frozenResourceId = avgPresentation?.sceneBinding?.sceneResourceId.trim();
    if (frozenResourceId) return createAvgSceneTarget(partitionId(runtimeState, saveId), worldBookId, {
      kind: 'frozen-scene-resource', id: frozenResourceId,
    });
    const sceneId = visualSnapshot?.runtimeSceneId?.trim();
    if (sceneId) return createAvgSceneTarget(partitionId(runtimeState, saveId), worldBookId, {
      kind: 'runtime-scene', id: sceneId,
    });
    const placeId = visualSnapshot?.runtimePlaceId?.trim() || runtimeState.currentPlaceId?.trim() || runtimeState.currentLocationId.trim();
    return placeId ? createAvgSceneTarget(partitionId(runtimeState, saveId), worldBookId, { kind: 'runtime-place', id: placeId }) : undefined;
  }, [avgPresentation?.sceneBinding?.sceneResourceId, runtimeState, saveId, visualSnapshot?.runtimePlaceId, visualSnapshot?.runtimeSceneId, worldBookId]);
  const builtInSceneResourceId = useMemo(() => avgPresentation?.sceneBinding?.sceneResourceId
    ?? (worldBookId === 'threeKingdoms'
      ? resolveThreeKingdomsSceneResource({
        runtimeSceneId: visualSnapshot?.runtimeSceneId ?? runtimeState.currentSceneId,
        runtimePlaceId: visualSnapshot?.runtimePlaceId ?? runtimeState.currentPlaceId,
        locationId: runtimeState.currentLocationId,
        labels: visualSnapshot?.structuredSceneAliases,
      })?.sceneResourceId
      : undefined),
  [avgPresentation?.sceneBinding?.sceneResourceId, runtimeState.currentLocationId, runtimeState.currentPlaceId, runtimeState.currentSceneId, visualSnapshot, worldBookId]);
  const currentSegment = segments[Math.min(frameIndex, Math.max(segments.length - 1, 0))];
  const currentBinding = currentSegment?.type === 'dialogue' ? bindingBySegment.get(frameIndex) : undefined;
  const isPlayer = currentBinding?.actorId === runtimeState.player.id;
  const showPortrait = currentSegment?.type === 'dialogue' && (!isPlayer || playerPortraitMode === 'show');
  const actorTarget = useMemo(() => currentBinding?.actorId && showPortrait
    ? createAvgActorTarget(partitionId(runtimeState, saveId), worldBookId, currentBinding.actorId)
    : undefined,
  [currentBinding?.actorId, runtimeState, saveId, showPortrait, worldBookId]);

  useEffect(() => { setFrameIndex(0); setShowAll(false); }, [entryKey]);
  useEffect(() => { setIsOutfitManagerOpen(false); setIsVisualManagerOpen(false); setPendingVisual(undefined); }, [actorTarget?.kind === 'actor' ? actorTarget.actorId : '', sceneTarget?.kind === 'scene' ? sceneTarget.anchor.id : '']);
  useEffect(() => {
    const onChanged = () => setRefresh((value) => value + 1);
    window.addEventListener(AVG_VISUAL_OVERRIDES_CHANGED_EVENT, onChanged);
    window.addEventListener(AVG_RESOURCE_PACK_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(AVG_VISUAL_OVERRIDES_CHANGED_EVENT, onChanged);
      window.removeEventListener(AVG_RESOURCE_PACK_CHANGED_EVENT, onChanged);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let url: string | undefined;
    if (!sceneTarget) { setBackground({ status: 'idle' }); return; }
    setBackground({ target: sceneTarget, status: 'loading' });
    repository.lookup(sceneTarget).then(async (result) => {
      if (!active) return;
      if (result.status === 'found') {
        url = URL.createObjectURL(result.blob);
        setBackground({ target: sceneTarget, url, status: 'found' });
      } else {
        const sceneId = builtInSceneResourceId
          ?? `avg:${worldBookId}:scene:${sceneTarget.kind === 'scene' ? sceneTarget.anchor.id : ''}`;
        const blob = await resourcePacks.lookupActiveAsset(worldBookId, `${sceneId}:base`)
          ?? await resourcePacks.lookupActiveResource(worldBookId, 'scene', sceneId);
        if (!active) return;
        if (blob) {
          url = URL.createObjectURL(blob);
          setBackground({ target: sceneTarget, url, status: 'found' });
        } else setBackground({ target: sceneTarget, status: 'missing' });
      }
    }).catch(() => active && setBackground({ target: sceneTarget, status: 'error' }));
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [builtInSceneResourceId, refresh, sceneTarget, worldBookId]);

  useEffect(() => {
    let active = true;
    let url: string | undefined;
    if (!actorTarget) { setPortrait({ status: 'idle' }); return; }
    setPortrait({ target: actorTarget, status: 'loading' });
    repository.lookup(actorTarget).then(async (result) => {
      if (!active) return;
      if (result.status === 'found') {
        url = URL.createObjectURL(result.blob);
        setPortrait({ target: actorTarget, url, status: 'found' });
      } else {
        const binding = runtimeState.avgPresentation?.portraitBindings?.find(
          (item) => item.actorId === (actorTarget.kind === 'actor' ? actorTarget.actorId : ''),
        );
        const speakerFact = displayMeta?.presentationSpeakerFacts?.find(
          (fact) => fact.speakerActorId === (actorTarget.kind === 'actor' ? actorTarget.actorId : ''),
        );
        const actorId = actorTarget.kind === 'actor' ? actorTarget.actorId : '';
        const acceptedPortrait = worldBookId === 'threeKingdoms'
          ? resolveThreeKingdomsPortraitSet(portraitSubject(runtimeState, actorId) ?? {
              actorId,
              sex: speakerFact?.sex,
            })
          : undefined;
        const portraitSetId = binding?.portraitSetId ?? acceptedPortrait?.portraitSetId;
        const variant = acceptedPortrait?.defaultVariant ?? 'default';
        const blob = portraitSetId ? await resourcePacks.lookupActiveAsset(worldBookId, `${portraitSetId}:${variant}`)
          ?? await resourcePacks.lookupActiveResource(
            worldBookId,
            portraitSetId.includes(':fixed:') ? 'fixed-portrait' : 'generic-portrait',
            portraitSetId,
            variant,
          ) : actorTarget.kind === 'actor'
            ? await resourcePacks.lookupActivePortrait(worldBookId, actorTarget.actorId, speakerFact?.sex)
            : undefined;
        if (!active) return;
        if (blob) {
          url = URL.createObjectURL(blob);
          setPortrait({ target: actorTarget, url, status: 'found' });
        } else setPortrait({ target: actorTarget, status: 'missing' });
      }
    }).catch(() => active && setPortrait({ target: actorTarget, status: 'error' }));
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [actorTarget, displayMeta?.presentationSpeakerFacts, refresh, runtimeState.avgPresentation?.portraitBindings, worldBookId]);

  useEffect(() => {
    let active = true;
    if (!actorTarget || actorTarget.kind !== 'actor') { setSelectedOutfit(undefined); return; }
    repository.getSelectedUserOutfit(actorTarget).then((outfit) => { if (active) setSelectedOutfit(outfit); }).catch(() => { if (active) setSelectedOutfit(undefined); });
    return () => { active = false; };
  }, [actorTarget, refresh]);

  const advance = () => {
    if (!showAll) setFrameIndex((value) => Math.min(Math.max(segments.length - 1, 0), value + 1));
  };
  const currentTarget = currentSegment?.type === 'dialogue' && actorTarget ? actorTarget : sceneTarget;
  const imagePrompt = useMemo(() => {
    const speakerName = currentSegment?.type === 'dialogue'
      ? actorName(runtimeState, currentBinding?.actorId) ?? currentSegment.speaker
      : '旁白';
    if (currentTarget?.kind === 'actor') {
      if (currentTarget.actorId === runtimeState.player.id) {
        const player = runtimeState.player;
        return buildAvgActorImagePrompt({ name: player.name, sex: player.sex, age: deriveActorCurrentAge(player, runtimeState.currentDate), identity: player.currentIdentity, occupation: player.roleType, appearance: player.appearance, outfit: selectedOutfit ? { name: selectedOutfit.name, note: selectedOutfit.note } : undefined });
      }
      const npc = runtimeState.npcs?.find((candidate) => candidate.npcId === currentTarget.actorId);
      if (npc) return buildAvgActorImagePrompt({ name: npc.name, sex: npc.sex, age: deriveNpcCurrentAge(npc, runtimeState.currentDate), identity: npc.currentIdentity, occupation: npc.role, appearance: npc.appearance, outfit: selectedOutfit ? { name: selectedOutfit.name, note: selectedOutfit.note } : undefined });
      const known = runtimeState.knownActors.find((candidate) => candidate.id === currentTarget.actorId);
      return buildAvgActorImagePrompt({ name: known?.name ?? speakerName, sex: known?.sex, occupation: known?.roleType, appearance: known?.appearance, outfit: selectedOutfit ? { name: selectedOutfit.name, note: selectedOutfit.note } : undefined });
    }
    return buildAvgSceneImagePrompt({ name: visualSnapshot?.runtimePlaceId?.trim() || runtimeState.currentPlaceId?.trim() || runtimeState.currentLocationId });
  }, [currentBinding?.actorId, currentSegment, currentTarget, runtimeState, selectedOutfit, visualSnapshot?.runtimePlaceId]);
  const replaceCurrentVisual = async (file: File) => {
    if (!currentTarget) return;
    setNotice('正在校验图片…');
    try {
      setPendingVisual(await validateAvgImage(file));
      setNotice('图片已通过校验；预览不会自动写入，请明确应用。');
    } catch (error) {
      setNotice(`视觉替换失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };
  const applyPendingVisual = async () => {
    if (!currentTarget || !pendingVisual) return;
    try {
      if (currentTarget.kind === 'actor' && selectedOutfit) await repository.replaceOutfitImage(currentTarget, selectedOutfit.outfitId, pendingVisual);
      else await repository.replace(currentTarget, pendingVisual);
      setPendingVisual(undefined);
      setNotice('当前视觉已保存到本存档。');
      setRefresh((value) => value + 1);
    } catch (error) {
      setNotice(`视觉替换失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };
  const restoreDefaultVisual = async () => {
    if (!currentTarget) return;
    try {
      if (currentTarget.kind === 'actor' && selectedOutfit) await repository.removeOutfitImage(currentTarget, selectedOutfit.outfitId);
      else await repository.remove(currentTarget);
      setNotice('已恢复外置美术包或中性回退。');
      setRefresh((value) => value + 1);
    } catch (error) {
      setNotice(`恢复默认图失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };
  useEffect(() => {
    if (!pendingVisual) { setPendingVisualUrl(''); return; }
    const url = URL.createObjectURL(pendingVisual.blob); setPendingVisualUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingVisual]);
  const visibleSegments = showAll ? segments : currentSegment ? [currentSegment] : [];
  const activeSpeaker = currentSegment?.type === 'dialogue'
    ? actorName(runtimeState, currentBinding?.actorId) ?? currentSegment.speaker : '旁白';

  return (
    <section className="avg-narrative-stage" data-testid="avg-narrative-stage"
      data-avg-background={background.status === 'found' ? 'registered' : 'neutral'}
      data-avg-portrait={showPortrait ? (portrait.status === 'found' ? 'registered' : 'silhouette') : 'hidden'}
      aria-label="AVG 正文演出">
      {background.url && <img className="avg-stage-background-image" src={background.url} alt="" aria-hidden="true" />}
      <div className="avg-stage-advance-surface" role="group" tabIndex={0} aria-label="推进 AVG 正文" onClick={advance}
        onKeyDown={(event) => {
          if (['Enter', ' ', 'ArrowRight'].includes(event.key)) { event.preventDefault(); advance(); }
          if (event.key === 'ArrowLeft') { event.preventDefault(); setShowAll(false); setFrameIndex((value) => Math.max(0, value - 1)); }
        }}>
        {showPortrait && <div className="avg-stage-portrait" aria-label={activeSpeaker}>
          {portrait.url ? <img src={portrait.url} alt={activeSpeaker} />
            : <div className="avg-stage-silhouette" aria-hidden="true"><span>{activeSpeaker.slice(0, 1) || '人'}</span></div>}
        </div>}
        <div className="avg-stage-bottom-scrim" aria-hidden="true" />
        <article className="avg-stage-copy" data-testid="avg-stage-dialogue">
          <header className="avg-stage-dialogue-header" onClick={(event) => event.stopPropagation()}>
            <div className="avg-stage-dialogue-meta"><strong>{showAll ? '显示全部' : activeSpeaker}</strong>
              <span data-testid="avg-stage-frame-progress">第 {segments.length ? frameIndex + 1 : 0} / {segments.length} 帧</span></div>
            <div className="avg-stage-controls" role="group" aria-label="AVG 演出控制">
              <button type="button" onClick={() => { setShowAll(false); setFrameIndex(0); }} disabled={!segments.length}>↺</button>
              <button type="button" onClick={() => { setShowAll(false); setFrameIndex((value) => Math.max(0, value - 1)); }} disabled={frameIndex === 0}>←</button>
              <button type="button" onClick={advance} disabled={showAll || frameIndex >= segments.length - 1}>→</button>
              <button type="button" onClick={() => setShowAll(true)} disabled={!segments.length || showAll}>全部</button>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
                onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void replaceCurrentVisual(file); }} />
              <button type="button" onClick={() => setIsVisualManagerOpen(true)} disabled={!currentTarget}>视觉</button>
              <button type="button" onClick={() => setIsOutfitManagerOpen(true)} disabled={!actorTarget}>造型</button>
              {onOpenAvgSettings && <button type="button" onClick={onOpenAvgSettings}>设置</button>}
              <button type="button" onClick={onReturnClassic}>原文</button>
            </div>
          </header>
          <div className="avg-stage-copy-body">{visibleSegments.map((segment, index) => (
            <div className={`avg-stage-block avg-stage-block--${segment.type}`} key={`${showAll ? index : frameIndex}-${segment.type}`}>
              {showAll && segment.type === 'dialogue' && <span>{segment.speaker}</span>}<p>{segment.text}</p>
            </div>
          ))}</div>
        </article>
      </div>
      <div className="avg-stage-resource-status" role="status" aria-live="polite">
        {background.status !== 'found' && <span>场景未匹配，已使用中性背景</span>}
        {showPortrait && portrait.status !== 'found' && <span>人物立绘未匹配，已使用中性剪影</span>}
        {currentSegment?.type === 'dialogue' && currentBinding?.status !== 'frozen' && <span>人物身份未绑定，未自动选择立绘</span>}
        {notice && <span>{notice}</span>}
      </div>
      {isOutfitManagerOpen && actorTarget?.kind === 'actor' && <AvgOutfitManager
        repository={repository}
        owner={{ visualPartitionId: actorTarget.visualPartitionId, worldBookId, actorId: actorTarget.actorId }}
        actorName={activeSpeaker}
        onClose={() => setIsOutfitManagerOpen(false)}
      />}
      {isVisualManagerOpen && currentTarget && <div className="avg-ai-modal" role="dialog" aria-modal="true" aria-label="AVG 视觉管理" onClick={(event) => event.stopPropagation()}>
        <header><strong>{currentTarget.kind === 'actor' ? activeSpeaker : '当前场景'} · 视觉管理</strong><button type="button" onClick={() => setIsVisualManagerOpen(false)} aria-label="关闭视觉管理">×</button></header>
        <section className="avg-local-visual-candidate" aria-label="本机图片候选"><h4>本机图片</h4><p>上传后先在本机预览，只有明确点击应用才会替换当前目标。</p><div className="avg-ai-generation-actions"><button type="button" onClick={() => fileInputRef.current?.click()}>选择本机图片</button><button type="button" onClick={() => void restoreDefaultVisual()}>恢复默认图</button></div>
          {pendingVisual && pendingVisualUrl && <figure className="avg-visual-pending-preview"><img src={pendingVisualUrl} alt="本机候选图预览" /><figcaption>{pendingVisual.width}×{pendingVisual.height} · {pendingVisual.mediaType}</figcaption><div className="avg-ai-generation-actions"><button type="button" onClick={() => void applyPendingVisual()}>应用此图</button><button type="button" onClick={() => { setPendingVisual(undefined); setNotice('本机候选图已丢弃；未写入视觉仓库。'); }}>丢弃候选</button></div></figure>}
        </section>
        <AvgImageCandidateControl targetSignature={currentTarget.kind === 'actor' ? selectedOutfit ? `outfit:${currentTarget.actorId}:${selectedOutfit.outfitId}` : `actor:${currentTarget.actorId}` : `scene:${currentTarget.anchor.kind}:${currentTarget.anchor.id}`}
          targetLabel={currentTarget.kind === 'actor' ? selectedOutfit ? `${activeSpeaker} · ${selectedOutfit.name}专属图` : `${activeSpeaker} · 默认人物图` : '当前场景'} prompt={imagePrompt}
          onOpenSettings={onOpenAvgSettings}
          onApply={async (file) => {
            if (currentTarget.kind === 'actor' && selectedOutfit) await repository.replaceOutfitImage(currentTarget, selectedOutfit.outfitId, file);
            else await repository.replace(currentTarget, file);
            setRefresh((value) => value + 1);
          }} />
      </div>}
    </section>
  );
}

import React, { useEffect, useState } from 'react';
import type { RuntimeState } from '../engine/types';
import type { AvgVisualPartitionSnapshot } from '../engine/avg/AvgVisualOverrideRepository';

function localActorName(id?: string): string | undefined {
  if (!id?.startsWith('avg-local:')) return undefined;
  try { return decodeURIComponent(id.slice(id.lastIndexOf(':') + 1)); } catch { return undefined; }
}

export function AvgPortraitLibraryPanel({ snapshot, state }: { snapshot: AvgVisualPartitionSnapshot; state: RuntimeState }): React.ReactElement {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const actorAssets = new Set(snapshot.records.filter((record) => record.kind === 'actor').map((record) => record.assetId));
    const next = new Map(snapshot.assets.filter((asset) => actorAssets.has(asset.assetId)).map((asset) => [asset.assetId, URL.createObjectURL(asset.blob)]));
    setUrls(next);
    return () => next.forEach((url) => URL.revokeObjectURL(url));
  }, [snapshot]);
  const records = snapshot.records.filter((record) => record.kind === 'actor' && record.portraitScope !== 'adaptive-candidate' && record.worldBookId === state.worldBookId);
  const candidates = snapshot.records.filter((record) => record.portraitScope === 'adaptive-candidate' && record.worldBookId === state.worldBookId);
  const nameFor = (id?: string) => id === state.player.id ? state.player.name
    : state.npcs?.find((npc) => npc.npcId === id)?.name
      ?? state.knownActors.find((actor) => actor.id === id)?.name
      ?? state.avgPresentation?.speakerActors?.find((actor) => actor.actorId === id)?.labels[0]
      ?? localActorName(id)
      ?? '已存人物';
  return <section aria-label="AVG 人物图库" className="avg-portrait-library">
    <h3>AVG 人物图库</h3>
    <p>已绑定 {records.length} 人 · 通用人物图 {candidates.length} 张。图片和绑定随存档 ZIP 一起导出，保存在当前浏览器。</p>
    {!records.length && <p>在 AVG 主页点击“生成人物图”，预览并确认后会出现在这里。</p>}
    <div className="avg-portrait-library-grid">{records.map((record) => <figure key={record.key}>
      {urls.get(record.assetId) && <img src={urls.get(record.assetId)} alt={`${nameFor(record.actorId)}的人物图`} loading="lazy" />}
      <figcaption><strong>{nameFor(record.actorId)}</strong><span>{candidates.some((candidate) => candidate.sourceActorId === record.actorId)
        ? '人物绑定 · 允许相似人物复用' : record.sourceActorId && record.sourceActorId !== record.actorId ? '相似匹配 · 已固定' : '人物专属绑定'}</span></figcaption>
    </figure>)}</div>
    {candidates.length > 0 && <section aria-label="通用候选图库">
      <h4>通用候选图库</h4><p>新人物从相近候选中首次随机选图并固定；添加候选不会改变已有绑定。</p>
      <div className="avg-portrait-library-grid">{candidates.map((record) => <figure key={record.key}>
        {urls.get(record.assetId) && <img src={urls.get(record.assetId)} alt={`${nameFor(record.sourceActorId)}的通用候选图`} loading="lazy" />}
        <figcaption>{record.portraitProfile?.roleFamily || '同类人物'} · {nameFor(record.sourceActorId)}</figcaption>
      </figure>)}</div>
    </section>}
  </section>;
}

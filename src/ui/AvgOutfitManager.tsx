import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IndexedDbAvgVisualOverrideRepository,
  validateAvgImage,
  type AvgUserOutfit,
} from '../engine/avg/AvgVisualOverrideRepository';

interface AvgOutfitManagerProps {
  repository: IndexedDbAvgVisualOverrideRepository;
  owner: { visualPartitionId: string; worldBookId: string; actorId: string };
  actorName: string;
  onClose: () => void;
}

export function AvgOutfitManager({ repository, owner, actorName, onClose }: AvgOutfitManagerProps): React.ReactElement {
  const stableOwner = useMemo(() => ({ ...owner }), [owner.actorId, owner.visualPartitionId, owner.worldBookId]);
  const [outfits, setOutfits] = useState<AvgUserOutfit[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [imageOutfitId, setImageOutfitId] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    const [items, selected] = await Promise.all([
      repository.listUserOutfits(stableOwner),
      repository.getSelectedUserOutfit(stableOwner),
    ]);
    setOutfits(items);
    setSelectedId(selected?.outfitId);
  }, [repository, stableOwner]);

  useEffect(() => { void refresh().catch(() => setStatus('人物造型暂时无法读取。')); }, [refresh]);

  const run = async (operation: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(true);
    try { await operation(); await refresh(); setStatus(success); }
    catch (error) { setStatus(error instanceof Error ? error.message : '造型操作失败。'); }
    finally { setBusy(false); }
  };

  return <div className="avg-outfit-modal" role="dialog" aria-modal="true" aria-label={`${actorName} 人物造型`} onClick={(event) => event.stopPropagation()}>
    <header><div><strong>{actorName} · 人物造型</strong><p>造型和图片只保存在本机当前存档的视觉分区。</p></div><button type="button" onClick={onClose} aria-label="关闭人物造型">×</button></header>
    <div className="avg-outfit-create">
      <input aria-label="新造型名称" maxLength={40} value={name} placeholder="例如：夜战披风" onChange={(event) => setName(event.target.value)} />
      <input aria-label="新造型备注" maxLength={240} value={note} placeholder="可选备注" onChange={(event) => setNote(event.target.value)} />
      <button type="button" disabled={busy || !name.trim()} onClick={() => void run(async () => {
        const created = await repository.createUserOutfit(stableOwner, { name, note });
        await repository.selectUserOutfit(stableOwner, created.outfitId);
        setName(''); setNote('');
      }, '已创建并选中新造型。')}>创建造型</button>
    </div>
    <div className="avg-outfit-list">
      <button type="button" className={!selectedId ? 'active' : ''} disabled={busy} onClick={() => void run(() => repository.clearUserOutfitSelection(stableOwner), '已恢复基础立绘。')}>基础立绘</button>
      {outfits.map((outfit) => <article key={outfit.outfitId} className={selectedId === outfit.outfitId ? 'active' : ''}>
        <div><strong>{outfit.name}</strong>{outfit.note && <small>{outfit.note}</small>}</div>
        <div>
          <button type="button" disabled={busy || selectedId === outfit.outfitId} onClick={() => void run(() => repository.selectUserOutfit(stableOwner, outfit.outfitId), `已选中“${outfit.name}”。`)}>选用</button>
          <button type="button" disabled={busy} onClick={() => { setImageOutfitId(outfit.outfitId); fileRef.current?.click(); }}>替换图片</button>
          <button type="button" disabled={busy} onClick={() => void run(async () => { await repository.deleteUserOutfit(stableOwner, outfit.outfitId); }, `已删除“${outfit.name}”。`)}>删除</button>
        </div>
      </article>)}
    </div>
    <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      const outfitId = imageOutfitId;
      event.currentTarget.value = '';
      if (file && outfitId) void run(async () => {
        await repository.replaceOutfitImage(stableOwner, outfitId, await validateAvgImage(file));
        await repository.selectUserOutfit(stableOwner, outfitId);
      }, '造型图片已校验、保存并选中。');
    }} />
    {status && <p role="status">{status}</p>}
  </div>;
}

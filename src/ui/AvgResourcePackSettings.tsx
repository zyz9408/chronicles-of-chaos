import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AvgResourcePackManager,
  type AvgResourcePackProgress,
  type InstalledAvgResourcePack,
} from '../engine/avg/AvgResourcePackManager';

const DOWNLOAD_URL = 'https://pan.quark.cn/s/8f2ec2b76069';

function sizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MiB`;
}

function progressLabel(progress: AvgResourcePackProgress): string {
  if (progress.phase === 'validating') return `正在逐项校验 ${progress.entriesRead} 个文件…`;
  if (progress.phase === 'committing') return '校验通过，正在原子切换资源包…';
  return `正在读取 ZIP：${progress.archiveByteLength ? Math.round(progress.archiveBytesRead / progress.archiveByteLength * 100) : 0}%`;
}

export function AvgResourcePackSettings({ manager: providedManager }: { manager?: AvgResourcePackManager }): React.ReactElement {
  const manager = useMemo(() => providedManager ?? new AvgResourcePackManager(), [providedManager]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [packs, setPacks] = useState<InstalledAvgResourcePack[]>([]);
  const [activePackId, setActivePackId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('正在读取本机 AVG 资源包状态…');
  const [progress, setProgress] = useState<AvgResourcePackProgress>();
  const refresh = useCallback(async () => {
    try {
      const [installed, active] = await Promise.all([manager.list('threeKingdoms'), manager.getActive('threeKingdoms')]);
      setPacks(installed.sort((a, b) => a.manifest.displayName.localeCompare(b.manifest.displayName, 'zh-CN')));
      setActivePackId(active?.manifest.packId);
      setStatus(active ? `当前已启用：${active.manifest.displayName} ${active.manifest.version}` : '尚未安装并启用三国 AVG 美术包；正文会完整显示。');
    } catch { setStatus('本机 AVG 资源包状态暂时无法读取。'); }
  }, [manager]);
  useEffect(() => { void refresh(); }, [refresh]);

  const install = async (file: File) => {
    setBusy(true); setProgress(undefined); setStatus('正在准备本地 ZIP…');
    try {
      const installed = await manager.install(file, { archiveLabel: file.name, onProgress: setProgress });
      setStatus(`资源包已校验并保存：${installed.manifest.displayName} ${installed.manifest.version}`);
      await refresh();
    } catch (error) { setStatus(`导入失败，原有资源包未改变：${error instanceof Error ? error.message : '未知错误'}`); }
    finally { setBusy(false); setProgress(undefined); if (inputRef.current) inputRef.current.value = ''; }
  };

  return <section className="avg-resource-pack-settings" aria-label="外置 AVG 美术包" data-testid="avg-resource-pack-settings">
    <h3>外置 AVG 美术包</h3>
    <p className="gs-setting-desc">主程序不内置 1122 张立绘与场景，资源包不会自动下载。下载 ZIP 后返回此处导入；文件只在本机校验，不会上传。</p>
    <p className="gs-setting-desc">完整包含 319 组具名人物、603 组一般人物和 200 个场景，约 345 MiB；校验时需要额外临时空间。</p>
    <div className="gs-setting-actions">
      <a className="nav-btn primary" data-testid="avg-resource-pack-download" href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">下载官方 AVG 美术资源包（夸克网盘）</a>
      <input ref={inputRef} type="file" accept=".zip,application/zip" hidden data-testid="avg-resource-pack-file"
        onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void install(file); }} />
      <button type="button" className="nav-btn" disabled={busy} onClick={() => inputRef.current?.click()}>{packs.length ? '导入或替换本地 ZIP' : '导入本地 ZIP'}</button>
    </div>
    {progress && <p role="status" data-testid="avg-resource-pack-progress">{progressLabel(progress)}</p>}
    <p role="status" data-testid="avg-resource-pack-status">{status}</p>
    {packs.length > 0 && <div className="avg-resource-pack-list" data-testid="avg-resource-pack-list">{packs.map((pack) => <article key={pack.manifest.packId} className="avg-resource-pack-card">
      <div><strong>{pack.manifest.displayName}</strong><p className="gs-setting-desc">版本 {pack.manifest.version} · {pack.manifest.assetCount} 个 WebP · {sizeLabel(pack.manifest.totalByteLength)} · {pack.storageBackend.toUpperCase()}</p><p className="gs-setting-desc">校验状态：已通过</p></div>
      <div className="gs-setting-actions">
        <button type="button" className="nav-btn" disabled={busy || activePackId === pack.manifest.packId} onClick={() => void (async () => { setBusy(true); try { await manager.select('threeKingdoms', pack.manifest.packId); await refresh(); } catch (error) { setStatus(`切换失败：${error instanceof Error ? error.message : '未知错误'}`); } finally { setBusy(false); } })()}>{activePackId === pack.manifest.packId ? '当前启用' : '切换到此包'}</button>
        <button type="button" className="nav-btn danger" disabled={busy} onClick={() => void (async () => { if (!window.confirm(`确认从本机移除“${pack.manifest.displayName} ${pack.manifest.version}”？人物绑定和玩家自定义视觉会保留。`)) return; setBusy(true); try { await manager.uninstall(pack.manifest.packId); await refresh(); } catch (error) { setStatus(`移除失败：${error instanceof Error ? error.message : '未知错误'}`); } finally { setBusy(false); } })()}>从本机移除</button>
      </div>
    </article>)}</div>}
  </section>;
}

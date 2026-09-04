import React, { useEffect, useMemo, useState } from 'react';
import type { RuntimeState } from '../engine/types';
import type { AvgPlayerPortraitMode, NarrativePresentationPreference } from '../engine/settings/DisplaySettings';
import { IndexedDbAvgVisualOverrideRepository, type AvgVisualPartitionSnapshot } from '../engine/avg/AvgVisualOverrideRepository';
import { THREE_KINGDOMS_AVG_REGISTRY_MANIFEST_ID } from '../engine/avg/AvgResourcePackManager';
import registry from '../engine/avg/ThreeKingdomsAvgRegistry.generated.json';
import { AvgResourcePackSettings } from './AvgResourcePackSettings';
import { AvgImageGenerationSettings } from './AvgImageGenerationSettings';

function bytes(value: number): string { return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 / 1024).toFixed(1)} MiB`; }

export function AvgPlayerGuide(): React.ReactElement {
  return <section className="avg-player-guide" data-testid="avg-player-guide" aria-labelledby="avg-player-guide-title">
    <header className="avg-player-guide-heading"><div><h3 id="avg-player-guide-title">AVG 使用说明</h3><p>主程序不再内置 1122 个 WebP；先在下方导入本机外置美术包，校验通过后即可演出。</p></div><span className="avg-player-guide-badge">本机功能</span></header>
    <h4>三步快速开始</h4><ol className="avg-player-guide-steps"><li><strong>导入外置美术包</strong><span>点击“导入本地 ZIP”，浏览器会完整校验后再启用，不会联网下载。</span></li><li><strong>选择显示方式</strong><span>在“正文显示模式”选择自动、传统正文或 AVG 演出；舞台可切换沉浸式。</span></li><li><strong>按需替换与备份</strong><span>从舞台“视觉”管理玩家图片；首页导出存档 + 本地 AVG 视觉会自动带上这些覆盖。</span></li></ol>
    <p className="avg-player-guide-reassurance">模式切换不会改变剧情或存档事实；主角立绘默认隐藏。</p>
    <details className="avg-player-guide-details"><summary>查看完整说明</summary><div className="avg-player-guide-detail-grid"><section><h4>演出与安全退路</h4><p>整个正文栏在舞台与原正文之间互斥显示。资源未就绪时不会吞掉正文。</p></section><section><h4>视觉与 AI</h4><p>本机上传与 AI 都先预览，再由你明确应用。打开页面、保存设置或切换目标都不会自动请求。</p></section><section><h4>备份与隐私</h4><p>存档 ZIP 自动携带相关非空玩家视觉，但不携带约 345 MiB 的外置美术包。图片与 AI Key 留在当前浏览器，本机保存不等于加密。</p></section></div></details>
  </section>;
}

export function AvgSettingsPanel({ runtimeState, saveId, narrativePresentation, playerPortraitMode, onNarrativePresentationChange, onPlayerPortraitModeChange }: { runtimeState?: RuntimeState | null; saveId?: string | null; narrativePresentation: NarrativePresentationPreference; playerPortraitMode: AvgPlayerPortraitMode; onNarrativePresentationChange: (value: unknown) => void; onPlayerPortraitModeChange: (value: unknown) => void }): React.ReactElement {
  const visualRepository = useMemo(() => new IndexedDbAvgVisualOverrideRepository(), []);
  const partitionId = runtimeState?.avgPresentation?.visualPartitionId?.trim() || saveId?.trim();
  const [summary, setSummary] = useState<AvgVisualPartitionSnapshot | null>(); const [notice, setNotice] = useState('');
  useEffect(() => { let active = true; if (!partitionId) { setSummary(null); return; } setSummary(undefined); visualRepository.exportPartition(partitionId).then((value) => { if (active) setSummary(value); }).catch(() => { if (active) setSummary(null); }); return () => { active = false; }; }, [partitionId, visualRepository]);
  const assets = registry.assets; const fixed = registry.fixedPortraitSets; const generic = registry.genericPortraitSets; const scenes = registry.scenes;
  return <div className="game-settings-section" data-testid="avg-settings-panel" role="region" aria-label="AVG 演出设置">
    <div className="game-settings-heading"><h2>AVG 演出资源</h2><p className="game-settings-subtitle">管理正文呈现、本机外置美术包与玩家视觉；不修改游戏事实或存档正文。</p></div><div className="gs-divider-thick" />{notice && <p className="settings-status feature-notice">{notice}</p>}<AvgPlayerGuide /><div className="gs-divider-thick" />
    <div className="gs-setting-row"><div className="gs-setting-left"><label className="gs-setting-label" htmlFor="narrative-presentation-setting">正文显示模式</label><select id="narrative-presentation-setting" aria-label="正文显示模式" value={narrativePresentation} onChange={(event) => onNarrativePresentationChange(event.target.value)}><option value="auto">自动（资源可用时 AVG）</option><option value="classic">传统正文</option><option value="avg">AVG 演出</option></select></div><p className="gs-setting-desc">只改变呈现，不改变存档正文或 AI 上下文；流式生成、记忆、判定和状态写回也保持原有流程。</p></div><div className="gs-divider-thin" />
    <div className="gs-setting-row"><div className="gs-setting-left"><label className="gs-checkbox-control"><input aria-label="正文演出显示主角立绘" type="checkbox" checked={playerPortraitMode === 'show'} onChange={(event) => onPlayerPortraitModeChange(event.target.checked ? 'show' : 'hidden')} /><span className="gs-setting-label">正文演出显示主角立绘</span></label></div><p className="gs-setting-desc">仅影响主角对白；关闭时不显示主角立绘或剪影，NPC 不受影响。</p></div><div className="gs-divider-thin" />
    <div className="gs-setting-row"><div className="gs-setting-left"><button type="button" className="nav-btn" onClick={() => { onNarrativePresentationChange('auto'); onPlayerPortraitModeChange('hidden'); setNotice('已恢复推荐显示；人物与场景绑定未删除。'); }}>恢复推荐显示</button></div><p className="gs-setting-desc">恢复“自动正文呈现 + 隐藏主角立绘”。人物与场景绑定未删除。</p></div><div className="gs-divider-thick" />
    <AvgResourcePackSettings /><div className="gs-divider-thick" />
    <div aria-label="AVG 本地覆盖摘要" data-testid="avg-local-override-summary"><h3>本地覆盖摘要</h3><p className="game-settings-subtitle">仅统计当前视觉分区在本机保存的人物、结构化场景、人物造型与服装专属立绘；不会上传。</p>{!partitionId ? <p className="gs-setting-desc">进入存档后可查看本地覆盖。</p> : summary === undefined ? <p className="gs-setting-desc" role="status">正在读取本地覆盖…</p> : !summary ? <p className="gs-setting-desc" role="status">本地覆盖摘要暂时无法读取，AVG 将继续使用默认资源。</p> : <div className="gs-setting-row"><div className="gs-setting-left"><span className="gs-setting-label">本机图片覆盖</span><strong>人物 {summary.actorCount} · 场景 {summary.sceneCount} · 造型 {summary.outfitCount} · 服装专属立绘 {summary.outfitOverrideCount}</strong></div><p className="gs-setting-desc">合计 {bytes(summary.totalBytes)}{summary.missingAssetCount ? ` · 缺失文件 ${summary.missingAssetCount}` : ' · 文件完整'}</p></div>}</div><div className="gs-divider-thick" />
    <AvgImageGenerationSettings /><div className="gs-divider-thick" />
    <div aria-label="AVG 资源清单基线"><h3>资源清单基线</h3><p className="game-settings-subtitle">主程序只保留轻量身份与校验元数据；这不表示图片已安装。</p><div className="gs-setting-row"><div className="gs-setting-left"><span className="gs-setting-label">外置包期望 WebP</span><strong>{assets.length} 项清单</strong></div><p className="gs-setting-desc">具名人物组 {fixed.length} · 一般人物组 {generic.length} · 场景 {scenes.length}</p></div><div className="gs-setting-row"><div className="gs-setting-left"><span className="gs-setting-label">清单标识</span></div><p className="gs-setting-desc">{THREE_KINGDOMS_AVG_REGISTRY_MANIFEST_ID}</p></div></div>
  </div>;
}

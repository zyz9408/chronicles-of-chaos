import { useMemo, useState } from 'react';
import type { RuntimeState } from '../engine/types';
import {
  countStoryExportTurns,
  createStoryExport,
  type StoryExportArtifact,
  type StoryExportFormat,
  type StoryExportOptions,
  type StoryExportRange,
} from '../engine/turn/storyExport';
import { PanelNotice, SystemModalFrame } from './SystemPanelPrimitives';

const DEFAULT_OPTIONS: StoryExportOptions = {
  range: 'latestTurn',
  format: 'markdown',
  includeDates: true,
  includePlayerActions: true,
};

export function downloadStoryExport(artifact: StoryExportArtifact): void {
  const blob = new Blob(['\ufeff', artifact.content], { type: artifact.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function StoryExportPanel({
  runtimeState,
  onClose,
  onDownload = downloadStoryExport,
}: {
  runtimeState: RuntimeState;
  onClose: () => void;
  onDownload?: (artifact: StoryExportArtifact) => void;
}): React.ReactElement {
  const [options, setOptions] = useState<StoryExportOptions>(DEFAULT_OPTIONS);
  const [status, setStatus] = useState('');
  const turnCount = useMemo(
    () => countStoryExportTurns(runtimeState, options.range),
    [options.range, runtimeState],
  );

  const setRange = (range: StoryExportRange) => {
    setOptions((current) => ({ ...current, range }));
    setStatus('');
  };
  const setFormat = (format: StoryExportFormat) => {
    setOptions((current) => ({ ...current, format }));
    setStatus('');
  };
  const handleDownload = () => {
    const artifact = createStoryExport(runtimeState, options);
    onDownload(artifact);
    setStatus(`已生成 ${artifact.fileName}`);
  };

  return (
    <SystemModalFrame
      title="导出剧情"
      subtitle="STORY EXPORT"
      ariaLabel="导出剧情"
      onClose={onClose}
      className="story-export-modal"
      testId="story-export-panel"
    >
      <PanelNotice className="story-export-intro">
        只导出玩家已经看到的正文与行动，不包含 API 配置、提示词、状态补丁或诊断资料。
      </PanelNotice>

      <fieldset className="story-export-group">
        <legend>导出范围</legend>
        <div className="story-export-option-grid story-export-option-grid--range">
          <label>
            <input
              type="radio"
              name="story-export-range"
              checked={options.range === 'latestTurn'}
              onChange={() => setRange('latestTurn')}
            />
            <span><strong>最近回合</strong><small>导出最近一个完整回合。</small></span>
          </label>
          <label>
            <input
              type="radio"
              name="story-export-range"
              checked={options.range === 'all'}
              onChange={() => setRange('all')}
            />
            <span><strong>当前存档全部正文</strong><small>导出本存档保存的所有完整正文。</small></span>
          </label>
        </div>
      </fieldset>

      <fieldset className="story-export-group">
        <legend>文件格式</legend>
        <div className="story-export-option-grid story-export-option-grid--format">
          {([
            ['markdown', 'Markdown', '便于整理与分享'],
            ['text', '纯文本', '兼容多数编辑器'],
            ['html', '离线 HTML', '浏览器直接阅读'],
          ] as Array<[StoryExportFormat, string, string]>).map(([format, label, description]) => (
            <label key={format}>
              <input
                type="radio"
                name="story-export-format"
                checked={options.format === format}
                onChange={() => setFormat(format)}
              />
              <span><strong>{label}</strong><small>{description}</small></span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="story-export-group">
        <legend>附加内容</legend>
        <div className="story-export-toggle-grid">
          <label>
            <input
              type="checkbox"
              checked={options.includeDates}
              onChange={() => setOptions((current) => ({ ...current, includeDates: !current.includeDates }))}
            />
            包含回合日期
          </label>
          <label>
            <input
              type="checkbox"
              checked={options.includePlayerActions}
              onChange={() => setOptions((current) => ({ ...current, includePlayerActions: !current.includePlayerActions }))}
            />
            包含玩家行动
          </label>
        </div>
      </fieldset>

      <div className="story-export-footer">
        <div>
          <strong>{turnCount > 0 ? `将导出 ${turnCount} 个回合` : '当前没有可导出的完整正文'}</strong>
          {status && <span role="status">{status}</span>}
        </div>
        <button type="button" className="primary-btn" disabled={turnCount === 0} onClick={handleDownload}>
          生成并下载
        </button>
      </div>
    </SystemModalFrame>
  );
}

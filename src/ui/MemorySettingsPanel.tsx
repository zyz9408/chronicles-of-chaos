import React, { useEffect, useMemo, useState } from 'react';
import type { MemoryProjectionSettings, RuntimeState } from '../engine/types';
import { saveCurrentState } from '../engine/save/SaveManager';
import {
  applyMemorySettingsPatch,
  buildMemorySettingsPanelModel,
  type MemorySettingControl,
  type MemorySettingField,
} from './memorySettingsPanelModel';

interface MemorySettingsPanelProps {
  runtimeState?: RuntimeState | null;
  saveId?: string | null;
  onRuntimeStateChange?: (runtimeState: RuntimeState) => void;
}

export const MemorySettingsPanel: React.FC<MemorySettingsPanelProps> = ({
  runtimeState,
  saveId,
  onRuntimeStateChange,
}) => {
  const model = useMemo(() => buildMemorySettingsPanelModel(runtimeState), [runtimeState]);
  const [draft, setDraft] = useState<MemoryProjectionSettings | null>(model.settings);
  const [status, setStatus] = useState('');

  useEffect(() => {
    setDraft(model.settings);
    setStatus('');
  }, [model.settings]);

  if (!model.available || !draft) {
    return (
      <div className="memory-settings-panel memory-settings-empty">
        <h3>记忆配置</h3>
        <p>{model.emptyReason}</p>
      </div>
    );
  }

  const updateDraft = (field: MemorySettingField, value: number | boolean) => {
    setDraft((current) => current ? { ...current, [field]: value } : current);
  };

  const handleSave = async () => {
    if (!runtimeState || !draft) return;

    const nextState = applyMemorySettingsPatch(runtimeState, draft);
    onRuntimeStateChange?.(nextState);
    if (saveId) {
      await saveCurrentState(saveId, nextState);
      setStatus('记忆配置已保存到当前存档。');
      return;
    }
    setStatus('记忆配置已应用到当前运行状态。');
  };

  return (
    <div className="memory-settings-panel">
      <div className="memory-settings-overview">
        <h3>记忆分层状态</h3>
        <div className="memory-settings-stats" aria-label="记忆分层状态">
          <span>近期摘要 {model.archiveStats.recentTurnSummaries}</span>
          <span>中期摘要 {model.archiveStats.midTermSummaries}</span>
          <span>长期生平 {model.archiveStats.longTermStorySummaries}</span>
          <span>长期事实 {model.archiveStats.longTermFacts}</span>
          <span>NPC 中期 {model.archiveStats.npcMidTermSummaries}</span>
          <span>NPC 长期 {model.archiveStats.npcLongTermSummaries}</span>
          <span>旧版 NPC 摘要 {model.archiveStats.npcInteractionSummaries}</span>
          <span>地点摘要 {model.archiveStats.locationMemorySummaries}</span>
        </div>
      </div>

      {model.sections.map((section) => (
        <section className="memory-settings-section" key={section.id}>
          <div className="memory-settings-section-head">
            <h3>{section.title}</h3>
            <p>{section.description}</p>
          </div>
          <div className="memory-settings-grid">
            {section.controls.map((control) => (
              <MemorySettingInput
                key={control.field}
                control={control}
                value={draft[control.field]}
                onChange={(value) => updateDraft(control.field, value)}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="memory-settings-actions">
        <button className="nav-btn primary" onClick={() => void handleSave()}>
          保存记忆配置
        </button>
        {status && <p className="settings-status">{status}</p>}
      </div>
    </div>
  );
};

function MemorySettingInput({
  control,
  value,
  onChange,
}: {
  control: MemorySettingControl;
  value: MemoryProjectionSettings[MemorySettingField];
  onChange: (value: number | boolean) => void;
}) {
  if (control.kind === 'boolean') {
    return (
      <label className="memory-setting-card memory-setting-toggle">
        <span>
          <strong>{control.label}</strong>
          <small>{control.description}</small>
        </span>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    );
  }

  return (
    <label className="memory-setting-card">
      <span>
        <strong>{control.label}</strong>
        <small>{control.description}</small>
      </span>
      <input
        type="number"
        min={control.min}
        max={control.max}
        step={control.step ?? 1}
        value={Number(value)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

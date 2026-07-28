import React, { useState } from 'react';
import {
  loadNpcSimulationSettings,
  saveNpcSimulationSettings,
  type NpcSimulationSettings,
} from '../engine/npc/NpcSimulationSettings';

export const NpcSimulationSettingsPanel: React.FC = () => {
  const [settings, setSettings] = useState<NpcSimulationSettings>(() => loadNpcSimulationSettings());

  const savePatch = (patch: Partial<NpcSimulationSettings>) => {
    setSettings(saveNpcSimulationSettings(patch));
  };

  return (
    <div className="npc-simulation-settings-panel feature-settings-panel">
      <div className="feature-settings-card">
        <div>
          <h3>动态模拟开关</h3>
          <p>开启后，仅当本页选择了 NPC 动态模拟 API 时，回合前才会额外批量调用一次辅助模型。</p>
        </div>
        <label className="feature-toggle-row">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => savePatch({ enabled: event.target.checked })}
          />
          启用 NPC 动态模拟
        </label>
      </div>

      <div className="feature-settings-card">
        <label>
          每回合最多模拟 NPC 数
          <input
            type="number"
            min={1}
            max={12}
            value={settings.maxNpcCount}
            onChange={(event) => savePatch({ maxNpcCount: Number(event.target.value) })}
          />
        </label>
        <p>相关 NPC 会按在场、关注、被玩家输入点名的顺序批量选择；不会按 NPC 分别多次调用。</p>
      </div>

      <div className="feature-settings-card muted">
        <h3>失败时自动跳过</h3>
        <p>NPC 动态模拟失败、未配置 API 或返回格式无效时，本回合会继续交给主剧情模型处理，不阻塞游玩、不写入状态。</p>
      </div>
    </div>
  );
};

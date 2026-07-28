import React from 'react';
import type { OpeningCrisisTemplate } from '../engine/types';

interface Props {
  origin: string;
  locationId: string;
  locations: Array<{ id: string; name: string; level: string }>;
  crises: OpeningCrisisTemplate[];
  selectedCrisisId: string | null;
  onSelectOrigin: (origin: string) => void;
  onSelectLocation: (locId: string) => void;
  onSelectCrisis: (crisisId: string) => void;
  showOrigin?: boolean;
  showLocation?: boolean;
  showCrisis?: boolean;
  title?: string;
}

const ORIGINS = ['寒门士子', '县中小吏', '游侠', '豪族旁支', '流民', '黄巾信众'];

export const CharacterSetup: React.FC<Props> = ({
  origin,
  locationId,
  locations,
  crises,
  selectedCrisisId,
  onSelectOrigin,
  onSelectLocation,
  onSelectCrisis,
  showOrigin = true,
  showLocation = true,
  showCrisis = true,
  title = '角色设定',
}) => {
  return (
    <div className="character-setup">
      <h2>{title}</h2>

      {showOrigin && (
        <div className="setup-section">
          <label>选择身份</label>
          <div className="origin-grid">
            {ORIGINS.map((o) => (
              <button
                key={o}
                className={`origin-btn ${origin === o ? 'selected' : ''}`}
                onClick={() => onSelectOrigin(o)}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      )}

      {showLocation && (
        <div className="setup-section">
          <label>选择初始地点</label>
          <div className="location-grid">
            {locations.map((loc) => (
              <button
                key={loc.id}
                className={`location-btn ${locationId === loc.id ? 'selected' : ''}`}
                onClick={() => onSelectLocation(loc.id)}
              >
                {loc.name}
                <span className="location-level">{loc.level}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showCrisis && (
        <div className="setup-section">
          <label>开局危机</label>
          {crises.length === 0 ? (
            <p className="empty-hint">当前选择下没有匹配的危机模板，将使用通用危机。</p>
          ) : (
            <div className="crisis-list">
              {crises.map((c) => (
                <div
                  key={c.id}
                  className={`crisis-card ${selectedCrisisId === c.id ? 'selected' : ''}`}
                  onClick={() => onSelectCrisis(c.id)}
                >
                  <div className="crisis-header">
                    <span className="crisis-label">{c.label}</span>
                    <span className={`risk-level ${c.riskLevel}`}>
                      {c.riskLevel === 'high' ? '高风险' : c.riskLevel === 'medium' ? '中风险' : '低风险'}
                    </span>
                  </div>
                  <p className="crisis-summary">{c.crisisSummary}</p>
                  <p className="crisis-hint">开场场景：{c.firstSceneHint}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

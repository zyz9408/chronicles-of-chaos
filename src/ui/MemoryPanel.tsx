import { useMemo, useState } from 'react';
import type { MemoryRecallTrace, MemoryRecallTraceEntry } from '../engine/types';
import type { PlayerProfileMemorySection, PlayerProfileRow } from './playerProfilePanelModel';

export type PlayerMemoryTabKey = 'short' | 'mid' | 'long';

export interface PlayerMemoryTab {
  key: PlayerMemoryTabKey;
  label: string;
  description: string;
  sections: PlayerProfileMemorySection[];
  rowCount: number;
}

const memoryTabDefinitions: ReadonlyArray<{
  key: PlayerMemoryTabKey;
  label: string;
  description: string;
  sectionTitles: readonly string[];
}> = [
  {
    key: 'short',
    label: '短期记忆',
    description: '最近回合与尚未压缩的直接经历',
    sectionTitles: ['近期记忆', '每回合摘要'],
  },
  {
    key: 'mid',
    label: '中期记忆',
    description: '由近期经历压缩形成的阶段摘要',
    sectionTitles: ['中期摘要'],
  },
  {
    key: 'long',
    label: '长期记忆',
    description: '生平概括、关键事迹与长期事实',
    sectionTitles: ['过往概括', '长期生平', '关键事迹', '长期事实'],
  },
];

const knownSectionTitles = new Set(memoryTabDefinitions.flatMap((definition) => definition.sectionTitles));

export function buildPlayerMemoryTabs(sections: PlayerProfileMemorySection[]): PlayerMemoryTab[] {
  const unknownSections = sections.filter((section) => !knownSectionTitles.has(section.title));

  return memoryTabDefinitions.map((definition) => {
    const groupedSections = definition.sectionTitles.flatMap((title) => (
      sections.filter((section) => section.title === title)
    ));
    if (definition.key === 'long') groupedSections.push(...unknownSections);

    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      sections: groupedSections,
      rowCount: groupedSections.reduce((total, section) => total + section.rows.length, 0),
    };
  });
}

export function resolveInitialMemoryTabKey(tabs: PlayerMemoryTab[]): PlayerMemoryTabKey {
  return tabs.find((tab) => tab.rowCount > 0)?.key ?? 'short';
}

function memoryRowTitle(row: PlayerProfileRow): string | undefined {
  return [row.value, row.detail, row.tooltip]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join('\n') || undefined;
}

export interface MemoryPanelProps {
  sections: PlayerProfileMemorySection[];
  recall?: MemoryRecallTrace;
  onClose: () => void;
}

export interface MemoryRecallDiagnosticModel {
  query: string;
  candidateCount: number;
  omittedCount: number;
  strong: MemoryRecallTraceEntry[];
  weak: MemoryRecallTraceEntry[];
}

export function buildMemoryRecallDiagnosticModel(
  recall?: MemoryRecallTrace,
): MemoryRecallDiagnosticModel | null {
  if (!recall) return null;
  return {
    query: recall.query,
    candidateCount: Math.max(0, recall.candidateCount),
    omittedCount: Math.max(0, recall.omittedCount),
    strong: Array.isArray(recall.strong) ? recall.strong : [],
    weak: Array.isArray(recall.weak) ? recall.weak : [],
  };
}

export function MemoryPanel({ sections, recall, onClose }: MemoryPanelProps) {
  const tabs = useMemo(() => buildPlayerMemoryTabs(sections), [sections]);
  const recallDiagnostic = useMemo(() => buildMemoryRecallDiagnosticModel(recall), [recall]);
  const [activeTabKey, setActiveTabKey] = useState<PlayerMemoryTabKey>(() => resolveInitialMemoryTabKey(tabs));
  const activeTab = tabs.find((tab) => tab.key === activeTabKey) ?? tabs[0];

  return (
    <div className="system-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="system-modal ui-system-workspace memory-panel-modal"
        data-testid="memory-panel"
        role="dialog"
        aria-label="回忆"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="system-modal-head memory-panel-head">
          <div>
            <span>回忆</span>
            <small>近期、阶段与生平记忆</small>
          </div>
          <button type="button" className="system-modal-close" onClick={onClose}>关闭</button>
        </div>

        <div className="memory-panel-tabs" role="tablist" aria-label="记忆层级">
          {tabs.map((tab) => {
            const isActive = tab.key === activeTab.key;
            return (
              <button
                key={tab.key}
                id={`memory-tab-${tab.key}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`memory-tabpanel-${tab.key}`}
                className={isActive ? 'active' : ''}
                data-testid={`memory-tab-${tab.key}`}
                onClick={() => setActiveTabKey(tab.key)}
              >
                <span>{tab.label}</span>
                <strong aria-label={`${tab.rowCount}条`}>{tab.rowCount}</strong>
              </button>
            );
          })}
        </div>

        {recallDiagnostic && (
          <details className="memory-recall-diagnostic" data-testid="memory-recall-diagnostic">
            <summary>
              <span>本回合召回</span>
              <strong>强 {recallDiagnostic.strong.length} · 弱 {recallDiagnostic.weak.length}</strong>
              <small>候选 {recallDiagnostic.candidateCount} · 省略 {recallDiagnostic.omittedCount}</small>
            </summary>
            <div className="memory-recall-diagnostic-body">
              <p className="memory-recall-query">检索依据：{recallDiagnostic.query || '本回合行动与场景锚点'}</p>
              {recallDiagnostic.strong.length + recallDiagnostic.weak.length === 0 ? (
                <p className="memory-recall-empty">本回合没有额外召回；正文仍使用常规分层记忆。</p>
              ) : (
                <div className="memory-recall-list">
                  {[...recallDiagnostic.strong, ...recallDiagnostic.weak].map((entry) => (
                    <article key={`${entry.strength}-${entry.sourceType}-${entry.sourceId}`}>
                      <div>
                        <strong>{entry.strength === 'strong' ? '强召回' : '弱召回'}</strong>
                        <span>{entry.contentMode === 'original' ? (entry.truncated ? '原文节选' : '原文') : '摘要'}</span>
                        <small>{formatRecallSource(entry)}</small>
                      </div>
                      <p>{entry.text}</p>
                      <footer>
                        <span>{entry.time ?? '时间缺失'}</span>
                        <span>相关度 {entry.score.toFixed(2)}</span>
                        <span>{entry.reason}</span>
                      </footer>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </details>
        )}

        <div
          id={`memory-tabpanel-${activeTab.key}`}
          className="memory-panel-content"
          role="tabpanel"
          aria-labelledby={`memory-tab-${activeTab.key}`}
          data-testid={`memory-tabpanel-${activeTab.key}`}
          tabIndex={0}
        >
          <div className="memory-panel-layer-head">
            <strong>{activeTab.label}</strong>
            <span>{activeTab.description}</span>
          </div>

          {activeTab.sections.length === 0 ? (
            <div className="memory-panel-empty">
              <strong>此层级尚无记忆</strong>
              <p>继续游玩后，对应层级的经历会在这里沉淀。</p>
            </div>
          ) : (
            <div className="player-memory-list">
              {activeTab.sections.map((section) => (
                <section key={section.title} className="player-memory-section">
                  <div className="player-memory-section-title">
                    <strong>{section.title}</strong>
                    <span>{section.description}</span>
                    <small>{section.rows.length}条</small>
                  </div>
                  {section.rows.map((row, index) => (
                    <article
                      key={`${section.title}-${row.label}-${row.value}-${index}`}
                      className="player-profile-note memory-panel-note"
                      title={memoryRowTitle(row)}
                    >
                      <span>{row.label}</span>
                      <p>{row.value}</p>
                      {row.detail && <small>{row.detail}</small>}
                    </article>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function formatRecallSource(entry: MemoryRecallTraceEntry): string {
  const sourceLabels: Record<MemoryRecallTraceEntry['sourceType'], string> = {
    recentTurn: '回合记忆',
    midTermSummary: '中期摘要',
    longTermStorySummary: '长期生平',
    longTermFact: '长期事实',
    npcInteractionSummary: 'NPC互动',
    npcMidTermSummary: 'NPC中期',
    npcLongTermSummary: 'NPC长期',
    locationMemorySummary: '地点记忆',
    npcMemory: 'NPC原始记忆',
  };
  const title = entry.title?.trim();
  return title ? `${sourceLabels[entry.sourceType]} · ${title}` : sourceLabels[entry.sourceType];
}

import React, { useMemo } from 'react';
import {
  getPromptTokenEstimatePanelModel,
  type PromptTokenEstimateRow,
} from './promptTokenEstimatePanelModel';

interface PromptTokenEstimatePanelProps {
  storage?: Storage;
}

function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN');
}

function formatEstimateRange(row: { lowerBound: number; upperBound: number }): string {
  return `${formatNumber(row.lowerBound)} - ${formatNumber(row.upperBound)}`;
}

const PromptTokenRow: React.FC<{ row: PromptTokenEstimateRow }> = ({ row }) => (
  <div
    className={`prompt-token-row ${row.isCustomized ? 'customized' : ''} ${row.isHighRisk ? 'high-risk' : ''}`}
    data-token-prompt-id={row.promptId}
  >
    <div className="prompt-token-row-head">
      <div>
        <strong>{row.title}</strong>
        <span>{row.promptId}</span>
      </div>
      <div className="prompt-entry-badges">
        {row.isCustomized && <span className="prompt-customized-badge">已自定义</span>}
        {row.isHighRisk && <span className="prompt-risk-badge risk-high">高风险</span>}
        {row.isLocked && <span className="prompt-edit-badge edit-locked">协议锁定</span>}
      </div>
    </div>
    <div className="prompt-token-row-stats">
      <span>分类：{row.categoryZh}</span>
      <span>字符数：{formatNumber(row.chars)}</span>
      <span>估算 tokens：约 {formatNumber(row.estimatedTokens)}</span>
      <span>范围：{formatEstimateRange(row)}</span>
    </div>
    {row.estimatedTokens >= 4000 && (
      <p className="prompt-token-warning">该自定义提示词较长，可能显著增加每回合上下文成本。</p>
    )}
  </div>
);

export const PromptTokenEstimatePanel: React.FC<PromptTokenEstimatePanelProps> = ({ storage }) => {
  const model = useMemo(() => getPromptTokenEstimatePanelModel({ storage }), [storage]);

  return (
    <div className="prompt-token-estimate-panel">
      <div className="settings-heading">
        <div>
          <h2>提示词 Token 估算</h2>
          <p>
            当前页面只做本地估算，用于观察提示词模板和用户自定义覆盖内容的大致上下文成本。
          </p>
        </div>
      </div>

      <div className="prompt-readonly-notice">
        当前估算只统计提示词模板与自定义覆盖内容，不包含每回合动态注入的 NPC、地图、记忆、玩家输入和世界状态。
        实际 API 消耗以服务商返回 usage 为准。
      </div>

      <div className="prompt-token-overview">
        <div className="prompt-token-stat-card emphasis">
          <span>总估算</span>
          <strong>约 {formatNumber(model.effectiveTotals.estimatedTokens)} tokens</strong>
          <small>范围：{formatEstimateRange(model.effectiveTotals)}</small>
        </div>
        <div className="prompt-token-stat-card">
          <span>默认模板</span>
          <strong>{formatNumber(model.defaultTotals.chars)} 字符</strong>
          <small>约 {formatNumber(model.defaultTotals.estimatedTokens)} tokens</small>
        </div>
        <div className="prompt-token-stat-card">
          <span>用户 override</span>
          <strong>{formatNumber(model.overrideTotals.chars)} 字符</strong>
          <small>约 {formatNumber(model.overrideTotals.estimatedTokens)} tokens</small>
        </div>
        <div className="prompt-token-stat-card">
          <span>已自定义提示词</span>
          <strong>{formatNumber(model.customizedCount)} 条</strong>
          <small>高风险自定义：{formatNumber(model.highRiskCustomizedCount)} 条</small>
        </div>
      </div>

      {model.isTotalHigh && (
        <p className="prompt-token-warning">
          当前提示词模板较长。注意：实际回合还会加入 NPC、地图、记忆与玩家输入，真实 prompt token 会更高。
        </p>
      )}

      <section className="prompt-token-section">
        <h3>分类统计</h3>
        <div className="prompt-token-category-list">
          {model.categorySummaries.map((summary) => (
            <div key={summary.category} className="prompt-token-category-card">
              <div>
                <strong>{summary.categoryZh}</strong>
                <span>{summary.category}</span>
              </div>
              <p>
                约 {formatNumber(summary.estimatedTokens)} tokens · {formatNumber(summary.entryCount)} 条 ·
                自定义 {formatNumber(summary.customizedCount)} 条 · 高风险 / 锁定 {formatNumber(summary.highOrLockedCount)} 条
              </p>
              <small>范围：{formatEstimateRange(summary)} · 字符数：{formatNumber(summary.chars)}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="prompt-token-section">
        <h3>条目估算</h3>
        <div className="prompt-token-row-list">
          {model.rows.map((row) => (
            <PromptTokenRow key={row.promptId} row={row} />
          ))}
        </div>
      </section>
    </div>
  );
};

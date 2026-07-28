import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { savePromptOverride } from '../engine/prompts/PromptOverrideStore';
import { PromptTokenEstimatePanel } from './PromptTokenEstimatePanel';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('PromptTokenEstimatePanel', () => {
  it('renders local-only prompt token estimates and dynamic-content disclaimer', () => {
    const markup = renderToStaticMarkup(<PromptTokenEstimatePanel />);

    expect(markup).toContain('prompt-token-estimate-panel');
    expect(markup).toContain('提示词 Token 估算');
    expect(markup).toContain('本地估算');
    expect(markup).toContain('不包含每回合动态注入的 NPC、地图、记忆、玩家输入和世界状态');
    expect(markup).toContain('实际 API 消耗以服务商返回 usage 为准');
  });

  it('marks customized and high-risk locked entries in the list', () => {
    const storage = new MemoryStorage();
    savePromptOverride('main.userPrompt', 'CUSTOM_HIGH_RISK_PROTOCOL_TOKEN_ESTIMATE_CONTENT', storage);

    const markup = renderToStaticMarkup(<PromptTokenEstimatePanel storage={storage} />);

    expect(markup).toContain('data-token-prompt-id="main.userPrompt"');
    expect(markup).toContain('已自定义');
    expect(markup).toContain('高风险');
    expect(markup).toContain('协议锁定');
  });

  it('does not render prompt edit, save, import, or export actions', () => {
    const markup = renderToStaticMarkup(<PromptTokenEstimatePanel />);

    expect(markup).not.toContain('data-prompt-action="edit"');
    expect(markup).not.toContain('data-prompt-action="save"');
    expect(markup).not.toContain('data-prompt-global-action="import"');
    expect(markup).not.toContain('data-prompt-global-action="export"');
    expect(markup).not.toContain('<textarea');
  });
});

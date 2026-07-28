import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { savePromptOverride } from '../engine/prompts/PromptOverrideStore';
import { PromptRegistryPanel } from './PromptRegistryPanel';

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

function countMatches(value: string, pattern: string): number {
  return value.split(pattern).length - 1;
}

describe('PromptRegistryPanel', () => {
  it('renders the prompt registry as a user-facing content manager', () => {
    const markup = renderToStaticMarkup(<PromptRegistryPanel />);

    expect(markup).toContain('prompt-registry-panel');
    expect(markup).toContain('worldbook.prompts');
    expect(markup).toContain('main.userProtocol');
    expect(markup).toContain('高风险');
    expect(markup).toContain('协议锁定');
  });

  it('renders prompt body templates before advanced engineering metadata in category detail', () => {
    const markup = renderToStaticMarkup(<PromptRegistryPanel initialCategory="main.userProtocol" />);

    expect(markup).toContain('data-prompt-id="main.userPrompt"');
    expect(markup).toContain('{playerInput}');
    expect(markup).toContain('{memoryContext}');
    expect(markup).toContain('sourceFile');
    expect(markup.indexOf('{playerInput}')).toBeLessThan(markup.indexOf('sourceFile'));
  });

  it('does not render edit controls for locked protocol prompts before high-risk editing is enabled', () => {
    const markup = renderToStaticMarkup(<PromptRegistryPanel initialCategory="main.userProtocol" />);

    expect(markup).not.toContain('data-prompt-action="edit"');
    expect(markup).not.toContain('data-prompt-action="save"');
    expect(markup).not.toContain('data-prompt-action="restore-default"');
    expect(markup).not.toContain('<textarea');
  });

  it('renders edit entries for low and medium runtime prompts by default', () => {
    const markup = renderToStaticMarkup(<PromptRegistryPanel initialCategory="worldbook.prompts" />);

    expect(markup).toContain('data-prompt-id="worldbook.toneGuide"');
    expect(markup).toContain('data-prompt-id="worldbook.narrativeBaseline"');
    expect(markup).toContain('data-prompt-editable="true"');
    expect(countMatches(markup, 'data-prompt-action="edit"')).toBeGreaterThanOrEqual(2);
  });

  it('renders edit controls for locked protocol prompts when high-risk editing is enabled', () => {
    const markup = renderToStaticMarkup(
      <PromptRegistryPanel initialCategory="main.userProtocol" initialHighRiskEditingEnabled />,
    );

    expect(markup).toContain('data-prompt-id="main.userPrompt"');
    expect(markup).toContain('data-prompt-editable="true"');
    expect(markup).toContain('data-prompt-action="edit"');
  });

  it('shows customized toneGuide content when an override exists', () => {
    const storage = new MemoryStorage();
    savePromptOverride('worldbook.toneGuide', 'USER_TONE_GUIDE_RENDERED_CONTENT', storage);

    const markup = renderToStaticMarkup(
      <PromptRegistryPanel initialCategory="worldbook.prompts" storage={storage} />,
    );

    expect(markup).toContain('USER_TONE_GUIDE_RENDERED_CONTENT');
    expect(markup).toContain('data-prompt-customized="true"');
  });

  it('renders global high-risk, restore, import, and export actions', () => {
    const markup = renderToStaticMarkup(<PromptRegistryPanel />);

    expect(markup).toContain('data-prompt-global-action="toggle-high-risk"');
    expect(markup).toContain('data-prompt-global-action="restore-all"');
    expect(markup).toContain('data-prompt-global-action="import"');
    expect(markup).toContain('data-prompt-global-action="export"');
  });
});

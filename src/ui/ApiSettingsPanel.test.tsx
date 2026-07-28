import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { ensureLuanShiState } from '../engine/state/createInitialRuntimeState';
import {
  ApiSettingsPanel,
  getRemoteHttpBaseUrlWarning,
  parseApiModelNames,
} from './ApiSettingsPanel';

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

describe('ApiSettingsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('groups common settings before AI configuration and advanced tools', () => {
    const markup = renderToStaticMarkup(<ApiSettingsPanel onClose={() => undefined} />);

    expect(markup).toContain('常用设置');
    expect(markup).toContain('AI 与内容');
    expect(markup).toContain('高级工具');
    expect(markup.indexOf('存档管理')).toBeLessThan(markup.indexOf('API 配置'));
    expect(markup).toContain('酒馆预设与 CoT');
    expect(markup.indexOf('API 配置')).toBeLessThan(markup.indexOf('酒馆预设与 CoT'));
    expect(markup.indexOf('酒馆预设与 CoT')).toBeLessThan(markup.indexOf('提示词管理'));
    expect(markup).toContain('提示词管理');
    expect(markup).toContain('Token 估算');
    expect(markup.indexOf('提示词管理')).toBeLessThan(markup.indexOf('Token 估算'));
  });

  it('renders narrative length word count hint in game settings', () => {
    const markup = renderToStaticMarkup(<ApiSettingsPanel onClose={() => undefined} initialTab="game" />);

    expect(markup).toContain('正文篇幅');
    expect(markup).toContain('当前目标：约 600-1000 字');
    expect(markup).toContain('标准（约 600-1000 字）');
  });

  it('turns the save-management placeholder into active autosave settings', () => {
    const markup = renderToStaticMarkup(<ApiSettingsPanel onClose={() => undefined} initialTab="save" />);

    expect(markup).toContain('每隔多少回合自动存档');
    expect(markup).toContain('自动存档保留数量');
    expect(markup).toContain('ZIP 导入导出');
    expect(markup).toContain('旧版 JSON 仍可导入');
  });

  it('provides local-only reading controls and categorized data management', () => {
    const displayMarkup = renderToStaticMarkup(
      <ApiSettingsPanel onClose={() => undefined} initialTab="display" />,
    );
    const dataMarkup = renderToStaticMarkup(
      <ApiSettingsPanel onClose={() => undefined} initialTab="data" />,
    );

    expect(displayMarkup).toContain('正文字号');
    expect(displayMarkup).toContain('正文行距');
    expect(displayMarkup).toContain('减少动态');
    expect(dataMarkup).toContain('全部本地数据（保留 API）');
    expect(dataMarkup).toContain('每项都需要再次确认');
  });

  it('renders effective memory configuration controls when opened from a running save', () => {
    const runtimeState = ensureLuanShiState({
      engineVersion: '0.1.0',
      worldBookId: 'test',
      worldBookVersion: '1',
      worldBookSource: 'official',
      startDate: '公元189年01月01日',
      currentDate: '公元189年01月02日',
      player: { id: 'player', name: '刘达', roleType: '游侠' } as RuntimeState['player'],
      currentLocationId: 'loc_gate',
      knownActors: [],
      knownFactions: [],
      relationships: [],
      knownRumors: [],
      activeQuests: [],
      playerResources: {},
      worldStateDelta: {},
      turnLog: [],
      localSituationNotes: [],
    });

    const markup = renderToStaticMarkup(
      <ApiSettingsPanel
        onClose={() => undefined}
        initialTab="memory"
        runtimeState={runtimeState}
        saveId="save_test"
        onRuntimeStateChange={() => undefined}
      />,
    );

    expect(markup).toContain('自动记忆压缩');
    expect(markup).toContain('近期正文回放回合数');
    expect(markup).toContain('最大记忆投喂 Token');
    expect(markup).not.toContain('NPC 记忆压缩阈值');
  });

  it('explains that memory configuration requires an open save outside gameplay', () => {
    const markup = renderToStaticMarkup(<ApiSettingsPanel onClose={() => undefined} initialTab="memory" />);

    expect(markup).toContain('进入存档');
    expect(markup).toContain('记忆配置');
  });

  it('renders NPC dynamic simulation cost controls when opened from feature config', () => {
    const markup = renderToStaticMarkup(<ApiSettingsPanel onClose={() => undefined} initialTab="npcSimulation" />);

    expect(markup).toContain('NPC动态模拟配置');
    expect(markup).toContain('启用 NPC 动态模拟');
    expect(markup).toContain('每回合最多模拟 NPC 数');
    expect(markup).toContain('失败时自动跳过');
  });

  it('warns only for non-local HTTP API base URLs', () => {
    expect(getRemoteHttpBaseUrlWarning('http://api.example.com/v1')).toContain('远程 HTTP');
    expect(getRemoteHttpBaseUrlWarning('https://api.example.com/v1')).toBe('');
    expect(getRemoteHttpBaseUrlWarning('http://localhost:11434/v1')).toBe('');
    expect(getRemoteHttpBaseUrlWarning('http://127.0.0.1:1234/v1')).toBe('');
    expect(getRemoteHttpBaseUrlWarning('http://[::1]:1234/v1')).toBe('');
    expect(getRemoteHttpBaseUrlWarning('')).toBe('');
    expect(getRemoteHttpBaseUrlWarning('not a url')).toBe('');
  });

  it('keeps API settings export visibly separate and marked as containing keys', () => {
    const markup = renderToStaticMarkup(<ApiSettingsPanel onClose={() => undefined} initialTab="api" />);

    expect(markup).toContain('导出设置');
    expect(markup).toContain('API 设置导出文件包含密钥');
    expect(markup).toContain('同一接口只需保存一次');
    expect(markup).toContain('模型列表');
  });

  it('accepts newline and comma separated model lists without duplicates', () => {
    expect(parseApiModelNames(' narrative-model\nfast-model, embedding-model，fast-model ')).toEqual([
      'narrative-model',
      'fast-model',
      'embedding-model',
    ]);
  });
});

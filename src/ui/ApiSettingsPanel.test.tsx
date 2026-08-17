import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiConfigArchive, ApiTaskRoutes } from '../engine/settings/ApiConfigManager';
import type { RuntimeState } from '../engine/types';
import { ensureLuanShiState } from '../engine/state/createInitialRuntimeState';
import {
  ApiSettingsPanel,
  getRemoteHttpBaseUrlWarning,
  parseApiModelNames,
  pickApiEditorConfig,
  persistCurrentEncounterDifficulty,
  persistCurrentGameDifficulty,
  persistCurrentNarrativePerspective,
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

function makeApiConfig(id: string, name: string): ApiConfigArchive {
  return {
    id,
    name,
    provider: 'openai_compatible',
    baseUrl: `https://${id}.example/v1`,
    apiKey: `key-${id}`,
    model: `model-${id}`,
    models: [`model-${id}`],
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  };
}

function makeApiTaskRoutes(): ApiTaskRoutes {
  return {
    mainNarrative: null,
    stateWriteback: null,
    stateWritebackFallback: null,
    quickInteraction: null,
    letterPolish: null,
    memorySummary: null,
    embedding: null,
    npcSimulation: null,
    npcCompletion: null,
    npcCompletionFallback: null,
    worldEvolution: null,
    imagePrompt: null,
  };
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
    expect(markup).toContain('字数不足时自动重写');
    expect(markup).toContain('目标下限的 90%');
    expect(markup).toContain('关闭后仍保留目标字数要求');
  });

  it('renders current-save difficulty only in game settings and does not present it as a local display preference', () => {
    const runtimeState = ensureLuanShiState({
      engineVersion: '0.1.0',
      worldBookId: 'test',
      worldBookVersion: '1',
      worldBookSource: 'official',
      gameDifficulty: 'hard',
      combatDifficulty: 'easy',
      warDifficulty: 'brutal',
      narrativePerspective: 'third_person',
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
    const gameMarkup = renderToStaticMarkup(
      <ApiSettingsPanel
        onClose={() => undefined}
        initialTab="game"
        runtimeState={runtimeState}
        saveId="save_test"
        onRuntimeStateChange={() => undefined}
      />,
    );
    const displayMarkup = renderToStaticMarkup(
      <ApiSettingsPanel onClose={() => undefined} initialTab="display" runtimeState={runtimeState} />,
    );

    expect(gameMarkup).toContain('当前游戏难度');
    expect(gameMarkup).toContain('困难（普通判定难度 Y+5）');
    expect(gameMarkup).toContain('调整本局难度');
    expect(gameMarkup).toContain('个人战斗难度');
    expect(gameMarkup).toContain('轻松（我方修正 ×1.50）');
    expect(gameMarkup).toContain('调整个人战难度');
    expect(gameMarkup).toContain('战争难度');
    expect(gameMarkup).toContain('严酷（我方有效战力 ×0.50）');
    expect(gameMarkup).toContain('调整战争难度');
    expect(gameMarkup).toContain('本局叙事人称');
    expect(gameMarkup).toContain('第三人称（姓名 / 他 / 她）');
    expect(gameMarkup).toContain('调整叙事人称');
    expect(displayMarkup).not.toContain('当前游戏难度');
    expect(displayMarkup).not.toContain('个人战斗难度');
    expect(displayMarkup).not.toContain('战争难度');
    expect(displayMarkup).not.toContain('本局叙事人称');
  });

  it('persists encounter difficulty to only the selected save field', async () => {
    const runtimeState = ensureLuanShiState({
      engineVersion: '0.1.0',
      worldBookId: 'test',
      worldBookVersion: '1',
      worldBookSource: 'official',
      startDate: '公元189年01月01日',
      currentDate: '公元189年01月02日',
      player: { id: 'player', name: '刘达', roleType: '游侠' } as RuntimeState['player'],
    } as RuntimeState);
    const persistState = vi.fn(async (_saveId: string, nextState: RuntimeState) => nextState);

    const changed = await persistCurrentEncounterDifficulty(
      runtimeState,
      'save-test',
      'combat',
      'story',
      persistState,
    );

    expect(changed.combatDifficulty).toBe('story');
    expect(changed.warDifficulty).toBe('standard');
    expect(changed.gameDifficulty).toBe('standard');
    expect(runtimeState.combatDifficulty).toBe('standard');
  });

  it('does not publish a perspective change when the target save no longer exists', async () => {
    const runtimeState = ensureLuanShiState({
      engineVersion: '0.1.0',
      worldBookId: 'test',
      worldBookVersion: '1',
      worldBookSource: 'official',
      narrativePerspective: 'second_person',
      startDate: '公元189年01月01日',
      currentDate: '公元189年01月02日',
      player: { id: 'player', name: '刘达', roleType: '游侠' } as RuntimeState['player'],
    } as RuntimeState);
    const persistState = vi.fn(async () => null);

    await expect(persistCurrentNarrativePerspective(
      runtimeState,
      'missing-save',
      'first_person',
      persistState,
    )).rejects.toThrow('当前存档不存在或已被移除');
    expect(persistState).toHaveBeenCalledWith(
      'missing-save',
      expect.objectContaining({ narrativePerspective: 'first_person' }),
    );
    expect(runtimeState.narrativePerspective).toBe('second_person');
  });

  it('does not publish a difficulty change when the target save no longer exists', async () => {
    const runtimeState = ensureLuanShiState({
      engineVersion: '0.1.0',
      worldBookId: 'test',
      worldBookVersion: '1',
      worldBookSource: 'official',
      gameDifficulty: 'standard',
      startDate: '公元189年01月01日',
      currentDate: '公元189年01月02日',
      player: { id: 'player', name: '刘达', roleType: '游侠' } as RuntimeState['player'],
    } as RuntimeState);
    const persistState = vi.fn(async () => null);

    await expect(persistCurrentGameDifficulty(
      runtimeState,
      'missing-save',
      'brutal',
      persistState,
    )).rejects.toThrow('当前存档不存在或已被移除');
    expect(persistState).toHaveBeenCalledWith(
      'missing-save',
      expect.objectContaining({ gameDifficulty: 'brutal' }),
    );
    expect(runtimeState.gameDifficulty).toBe('standard');
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
    expect(displayMarkup).toContain('界面主题');
    expect(displayMarkup).toContain('夜幕玄金');
    expect(displayMarkup).toContain('宣纸明卷');
    expect(displayMarkup).toContain('不做颜色反转');
    expect(displayMarkup).toContain('正文行距');
    expect(displayMarkup).toContain('减少动态');
    expect(displayMarkup).toContain('显示正则替换');
    expect(displayMarkup).toContain('存档原文、AI 上下文、记忆、判定、战斗识别和状态写回均不会改变');
    expect(displayMarkup).toContain('添加规则');
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

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="功能配置分类"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('记忆配置');
    expect(markup).toContain('向量检索配置');
    expect(markup).toContain('NPC建档配置');
    expect(markup).toContain('状态写回配置');
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
    expect(markup).toContain('最大输出 Token 快捷档位');
    expect(markup).toContain('>8K</button>');
    expect(markup).toContain('>32K</button>');
    expect(markup).toContain('>64K</button>');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('自定义最大输出 Token');
    expect(markup).toContain('通常足够普通回合和辅助任务');
  });

  it('selects an existing routed API instead of replacing it with a blank draft on open', () => {
    const mainConfig = makeApiConfig('main', '主剧情接口');
    const memoryConfig = makeApiConfig('memory', '记忆接口');
    const routes = makeApiTaskRoutes();
    routes.mainNarrative = { configId: mainConfig.id, model: mainConfig.model };
    routes.memorySummary = { configId: memoryConfig.id, model: memoryConfig.model };

    expect(pickApiEditorConfig([memoryConfig, mainConfig], routes, 'api', 'missing-draft').id)
      .toBe(mainConfig.id);
    expect(pickApiEditorConfig([mainConfig, memoryConfig], routes, 'memory', 'missing-draft').id)
      .toBe(memoryConfig.id);
    expect(pickApiEditorConfig([mainConfig, memoryConfig], routes, 'api', memoryConfig.id).id)
      .toBe(memoryConfig.id);
  });

  it('only creates a new API draft when no saved configuration exists', () => {
    const firstConfig = makeApiConfig('first', '首个接口');
    const routes = makeApiTaskRoutes();

    expect(pickApiEditorConfig([firstConfig], routes, 'api', 'missing-draft').id).toBe(firstConfig.id);
    expect(pickApiEditorConfig([], routes, 'api', 'missing-draft').id).not.toBe('missing-draft');
  });

  it('accepts newline and comma separated model lists without duplicates', () => {
    expect(parseApiModelNames(' narrative-model\nfast-model, embedding-model，fast-model ')).toEqual([
      'narrative-model',
      'fast-model',
      'embedding-model',
    ]);
  });
});

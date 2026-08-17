import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TAVERN_SETTINGS_STORAGE_KEY } from '../engine/prompts/TavernPresetStore';
import { TavernManagementPanel } from './TavernManagementPanel';

describe('TavernManagementPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the required library, editor, CoT and preview tabs', () => {
    const markup = renderToStaticMarkup(<TavernManagementPanel />);
    expect(markup).toContain('酒馆预设与 CoT');
    expect(markup).toContain('预设库');
    expect(markup).toContain('提示词开关');
    expect(markup).toContain('自定义 CoT');
    expect(markup).toContain('注入预览');
    expect(markup).toContain('启用当前酒馆预设');
    expect(markup).toContain('tavern-import-trigger');
    expect(markup).toContain('tavern-import-input');
    expect(markup).toContain('application/octet-stream');
    expect(markup).not.toContain('aria-label="选择酒馆预设文件" hidden');
  });

  it('offers an obvious mobile-safe route from an imported preset to its switches', () => {
    const storedSettings = {
      version: 1,
      enabled: true,
      activePresetId: 'mobile-preset',
      entries: [{
        id: 'mobile-preset',
        name: '手机预设',
        importedAt: '2026-08-07T00:00:00.000Z',
        sourceHash: 'fnv1a-mobile',
        selectedCharacterId: 100001,
        preset: {
          prompts: [{
            identifier: 'style',
            name: '主文风',
            role: 'system',
            content: '测试正文。',
            systemPrompt: true,
          }],
          promptOrder: [{
            characterId: 100001,
            order: [{ identifier: 'style', enabled: true }],
          }],
        },
        customization: { version: 1, itemOverrides: {} },
      }],
      customCot: {
        enabled: false,
        scope: 'all',
        content: '',
        templateId: 'natural-planning',
      },
    };
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === TAVERN_SETTINGS_STORAGE_KEY
        ? JSON.stringify(storedSettings)
        : null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });

    const markup = renderToStaticMarkup(<TavernManagementPanel />);
    expect(markup).toContain('管理 1 项提示词开关');
    expect(markup).toContain('可逐项启用、关闭并设置开局、普通回合或战斗适用范围');
  });
});

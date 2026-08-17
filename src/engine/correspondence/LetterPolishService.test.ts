import { describe, expect, it, vi } from 'vitest';
import { LlmEmptyContentError, type LlmClient, type LlmGenerateRequest } from '../llm/LlmClient';
import type { ApiConfigArchive } from '../settings/ApiConfigManager';
import { buildLetterPolishMessages, polishLetterDraft, resolveLetterPolishConfig } from './LetterPolishService';

const config: ApiConfigArchive = {
  id: 'letter-polish-api',
  name: '轻量书信模型',
  provider: 'openai_compatible',
  baseUrl: 'https://example.test/v1',
  apiKey: 'test-key',
  model: 'fast-model',
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
};

describe('LetterPolishService', () => {
  it('uses only the explicitly configured route and makes one request', async () => {
    const generate = vi.fn(async (_request: LlmGenerateRequest) => ({
      content: '烦请于八月十五日前，调拨粮草二百石至襄阳。',
      provider: config.provider,
      model: config.model,
    }));
    const result = await polishLetterDraft({
      body: '请八月十五日前调拨粮草二百石到襄阳。',
      senderName: '林砚',
      recipientName: '蔡琰',
    }, {
      resolveConfig: async () => config,
      llmClient: { generate } as LlmClient,
    });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]?.[0].retryCount).toBe(0);
    expect(result.body).toContain('二百石');
    expect(result.configName).toBe('轻量书信模型');
    expect(result.routeLabel).toBe('书信润色 API');
  });

  it('rejects without either the dedicated or NPC completion route', async () => {
    const generate = vi.fn();
    await expect(polishLetterDraft({
      body: '近日可安好？',
      senderName: '林砚',
      recipientName: '蔡琰',
    }, {
      resolveConfig: async () => null,
      llmClient: { generate } as unknown as LlmClient,
    })).rejects.toThrow('尚未配置');
    expect(generate).not.toHaveBeenCalled();
  });

  it('prefers the dedicated route and otherwise reuses only NPC completion', async () => {
    const npcConfig = { ...config, id: 'npc-api', name: 'NPC 建档轻量模型' };
    const dedicated = await resolveLetterPolishConfig(async (taskId) => (
      taskId === 'letterPolish' ? config : npcConfig
    ));
    expect(dedicated).toMatchObject({ taskId: 'letterPolish', config });

    const fallback = await resolveLetterPolishConfig(async (taskId) => (
      taskId === 'npcCompletion' ? npcConfig : null
    ));
    expect(fallback).toMatchObject({
      taskId: 'npcCompletion',
      routeLabel: 'NPC建档主要 API',
      config: npcConfig,
    });
  });

  it('keeps facts and asks for readable half-classical prose', () => {
    const messages = buildLetterPolishMessages({
      body: '请调拨三百石粮草。',
      senderName: '林砚',
      recipientName: '皇甫嵩',
      context: {
        worldSummary: '东汉末年至三国乱世；当前为黄巾初起。',
        senderProfile: '林砚，男，20岁，羽林郎。',
        recipientProfile: '皇甫嵩，男，朝廷将领。',
        relationshipSummary: '上下级；往来度 24；近期态度为信任。',
      },
    });
    expect(messages[0]?.content).toContain('半文半白');
    expect(messages[0]?.content).toContain('不得新增');
    expect(messages[0]?.content).toContain('只用于选择合适的称谓与语气');
    expect(messages[1]?.content).toContain('三百石');
    expect(messages[1]?.content).toContain('数量/日期数值（必须逐项出现在正文中）：300');
    expect(messages[1]?.content).toContain('轻量背景：');
    expect(messages[1]?.content).toContain('世界：东汉末年至三国乱世；当前为黄巾初起。');
    expect(messages[1]?.content).toContain('写信人：林砚，男，20岁，羽林郎。');
    expect(messages[1]?.content).toContain('收信人：皇甫嵩，男，朝廷将领。');
    expect(messages[1]?.content).toContain('双方关系：上下级；往来度 24；近期态度为信任。');
  });

  it('trims only background fields while preserving the complete original draft', () => {
    const original = `请查收。${'甲'.repeat(1_200)}`;
    const messages = buildLetterPolishMessages({
      body: original,
      senderName: '林砚',
      recipientName: '蔡琰',
      context: {
        worldSummary: '世'.repeat(1_000),
        senderProfile: '写'.repeat(1_000),
        recipientProfile: '收'.repeat(1_000),
        relationshipSummary: '关'.repeat(1_000),
      },
    });
    const userPrompt = messages[1]?.content ?? '';
    expect(userPrompt).toContain(original);
    expect(userPrompt.length).toBeLessThan(3_000);
  });

  it('accepts equivalent Arabic and Chinese quantity/date forms', async () => {
    const generate = vi.fn(async () => ({
      content: '烦请于四月二十五日前，将粮草二百石送抵南郑城。',
      provider: config.provider,
      model: config.model,
    }));

    const result = await polishLetterDraft({
      body: '请在4月25日前把粮草200石送到南郑城。',
      senderName: '林砚',
      recipientName: '蔡琰',
    }, {
      resolveConfig: async () => config,
      llmClient: { generate } as LlmClient,
    });

    expect(result.body).toContain('四月二十五日');
    expect(result.body).toContain('二百石');
  });

  it('does not treat an ordinary single Chinese numeral as a protected quantity', async () => {
    const generate = vi.fn(async () => ({
      content: '此务关系重大，万望妥为安排。',
      provider: config.provider,
      model: config.model,
    }));

    await expect(polishLetterDraft({
      body: '此事关系一方军民，请妥善安排。',
      senderName: '林砚',
      recipientName: '蔡琰',
    }, {
      resolveConfig: async () => config,
      llmClient: { generate } as LlmClient,
    })).resolves.toMatchObject({ body: '此务关系重大，万望妥为安排。' });
  });

  it('extracts the正文 from common JSON wrappers', async () => {
    const generate = vi.fn(async () => ({
      content: '```json\n{"polishedText":"烦请调拨粮草二百石至襄阳。"}\n```',
      provider: config.provider,
      model: config.model,
    }));

    const result = await polishLetterDraft({
      body: '请调拨200石粮草到襄阳。',
      senderName: '林砚',
      recipientName: '蔡琰',
    }, {
      resolveConfig: async () => config,
      llmClient: { generate } as LlmClient,
    });

    expect(result.body).toBe('烦请调拨粮草二百石至襄阳。');
  });

  it('retries once only when the provider returns empty content', async () => {
    const generate = vi.fn()
      .mockRejectedValueOnce(new LlmEmptyContentError('API 返回缺少正文内容'))
      .mockResolvedValueOnce({
        content: '烦请调拨粮草二百石至襄阳。',
        provider: config.provider,
        model: config.model,
      });

    const result = await polishLetterDraft({
      body: '请调拨200石粮草到襄阳。',
      senderName: '林砚',
      recipientName: '蔡琰',
    }, {
      resolveConfig: async () => config,
      llmClient: { generate } as LlmClient,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.retriedAfterEmptyContent).toBe(true);
  });

  it('does not retry an API error or a fact validation failure', async () => {
    const apiFailure = vi.fn().mockRejectedValue(new Error('invalid request'));
    await expect(polishLetterDraft({
      body: '请调拨200石粮草。',
      senderName: '林砚',
      recipientName: '蔡琰',
    }, {
      resolveConfig: async () => config,
      llmClient: { generate: apiFailure } as LlmClient,
    })).rejects.toThrow('invalid request');
    expect(apiFailure).toHaveBeenCalledOnce();

    const changedFacts = vi.fn(async () => ({
      content: '烦请调拨粮草三百石。',
      provider: config.provider,
      model: config.model,
    }));
    await expect(polishLetterDraft({
      body: '请调拨200石粮草。',
      senderName: '林砚',
      recipientName: '蔡琰',
    }, {
      resolveConfig: async () => config,
      llmClient: { generate: changedFacts } as LlmClient,
    })).rejects.toThrow('数量或日期');
    expect(changedFacts).toHaveBeenCalledOnce();
  });
});

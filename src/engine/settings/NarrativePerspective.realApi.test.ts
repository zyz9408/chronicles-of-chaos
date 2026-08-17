import { describe, expect, it } from 'vitest';
import { BrowserLlmClient } from '../llm/LlmClient';
import type { NarrativePerspective } from '../types/runtimeState';
import type { ApiConfigArchive, ApiProviderId } from './ApiConfigManager';
import { formatNarrativePerspectiveForPrompt } from './NarrativePerspective';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_NARRATIVE_PERSPECTIVE_REAL_API === '1';

type NarrativeRoute = 'opening' | 'ordinary' | 'combat_result' | 'war_result';

interface NarrativeSample {
  perspective: NarrativePerspective;
  route: NarrativeRoute;
  premise: string;
}

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`叙事人称真实 API 验收缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_narrative_perspective_acceptance',
    name: '叙事人称真实 API 验收',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0.15,
    maxOutputTokens: 480,
    createdAt: '2026-08-01T16:00:00.000Z',
    updatedAt: '2026-08-01T16:00:00.000Z',
  };
}

const ROUTE_LABELS: Record<NarrativeRoute, string> = {
  opening: '开局正文',
  ordinary: '普通回合正文',
  combat_result: '个人战斗结算正文',
  war_result: '战争结算正文',
};

const ROUTE_PREMISES: Record<NarrativeRoute, string> = {
  opening: '初春清晨，主角林砚站在阳翟县城南门外，亲眼看见城门刚刚开启。',
  ordinary: '主角林砚已经把核验完毕的军粮簿册放到案上，等待书吏接收。',
  combat_result: '个人战斗已由底层结算为主角林砚获胜；主角收刀站稳，伤势没有加重。',
  war_result: '战争已由底层结算为主角林砚所率部队守住营门；主角在旗下看见敌军退去。',
};

const SAMPLES: NarrativeSample[] = (
  ['first_person', 'second_person', 'third_person'] as const
).flatMap((perspective) => (
  ['opening', 'ordinary', 'combat_result', 'war_result'] as const
).map((route) => ({
  perspective,
  route,
  premise: ROUTE_PREMISES[route],
})));

function parseNarrativeText(content: string): string {
  const parsed = JSON.parse(content) as { narrativeText?: unknown };
  if (typeof parsed.narrativeText !== 'string' || !parsed.narrativeText.trim()) {
    throw new Error(`真实 API 未返回有效 narrativeText：${content.slice(0, 300)}`);
  }
  return parsed.narrativeText.trim();
}

function expectPerspectiveCompliance(
  perspective: NarrativePerspective,
  narrativeText: string,
): void {
  expect(narrativeText).toContain('【旁白】');
  expect(narrativeText).not.toContain('子衡');

  if (perspective === 'first_person') {
    expect(narrativeText).toContain('我');
    expect(narrativeText).not.toMatch(/你|林砚|他|她/);
    return;
  }
  if (perspective === 'second_person') {
    expect(narrativeText).toContain('你');
    expect(narrativeText).not.toMatch(/我|林砚|他|她/);
    return;
  }
  expect(narrativeText).toContain('林砚');
  expect(narrativeText).not.toMatch(/我|你/);
}

describe.skipIf(!REAL_API_ENABLED)('Narrative perspective real API matrix', () => {
  it.each(SAMPLES)(
    '$perspective × $route obeys the save-level narration contract',
    async ({ perspective, route, premise }) => {
      const guide = formatNarrativePerspectiveForPrompt(perspective, {
        playerName: '林砚',
        playerSex: '男',
      });
      const generated = await new BrowserLlmClient().generate({
        config: makeApiConfig(),
        messages: [{
          role: 'system',
          content: [
            '你是《乱世风云录》的正文生成器。',
            guide,
            '只输出 JSON 对象，唯一字段为 narrativeText。',
          ].join('\n\n'),
        }, {
          role: 'user',
          content: [
            `路由：${ROUTE_LABELS[route]}`,
            `已确认事实：${premise}`,
            '写 60 至 100 个汉字，只写一个 `【旁白】` 段落，不写人物对白。',
            '不得增加玩家对白、心理决定、立场承诺、额外行动、未知信息、情绪或身体感受。',
          ].join('\n'),
        }],
        responseFormat: 'json_object',
        maxOutputTokens: 480,
        timeoutMs: 180_000,
        retryCount: 1,
      });
      const narrativeText = parseNarrativeText(generated.content);

      expect(narrativeText.length).toBeGreaterThanOrEqual(30);
      expectPerspectiveCompliance(perspective, narrativeText);
    },
    240_000,
  );
});

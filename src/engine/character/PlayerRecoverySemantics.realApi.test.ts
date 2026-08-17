import { describe, expect, it } from 'vitest';
import { BrowserLlmClient } from '../llm/LlmClient';
import type { ApiConfigArchive, ApiProviderId } from '../settings/ApiConfigManager';
import { ensureLuanShiState } from '../state/createInitialRuntimeState';
import type { RuntimeState, StatePatch } from '../types';
import { interpretAction } from '../turn/ActionInterpreter';
import { parseNarratorResponse } from '../turn/NarratorResponseParser';
import { applyPatches } from '../turn/StatePatchApplier';
import { applyPlayerVitalsAfterTurn } from './PlayerStaminaRuntime';
import type { PlayerRecoveryKind } from './PlayerRecoveryContracts';

const TEST_ENV = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};
const REAL_API_ENABLED = TEST_ENV.COC_V2_RECOVERY_REAL_API === '1';

function requireEnvironment(name: string): string {
  const value = TEST_ENV[name]?.trim();
  if (!value) throw new Error(`真实 API 休整矩阵缺少环境变量 ${name}。`);
  return value;
}

function makeApiConfig(): ApiConfigArchive {
  return {
    id: 'api_real_player_recovery_matrix',
    name: '玩家休整语义真实 API 矩阵',
    provider: requireEnvironment('COC_V2_TEST_API_PROVIDER') as ApiProviderId,
    baseUrl: requireEnvironment('COC_V2_TEST_API_BASE_URL'),
    apiKey: requireEnvironment('COC_V2_TEST_API_KEY'),
    model: requireEnvironment('COC_V2_TEST_API_MODEL'),
    temperature: 0,
    maxOutputTokens: 2_500,
    createdAt: '2026-07-30T08:00:00.000Z',
    updatedAt: '2026-07-30T08:00:00.000Z',
  };
}

function makeState(hp = 40): RuntimeState {
  return ensureLuanShiState({
    engineVersion: '0.1.0',
    worldBookId: 'recovery-real-api-test',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    startDate: '公元194年05月03日 20:00',
    currentDate: '公元194年05月03日 20:00',
    currentTime: { year: 194, month: 5, day: 3, hour: 20, minute: 0 },
    player: {
      id: 'player_recovery_test',
      name: '刘平',
      roleType: '游侠',
      summary: '正在验证休整语义。',
      vitals: { hp, maxHp: 100, stamina: 20, maxStamina: 100 },
    },
    currentLocationId: 'place_recovery_inn',
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
}

const scenarios: ReadonlyArray<{
  label: string;
  input: string;
  expected: PlayerRecoveryKind;
  hp?: number;
}> = [
  { label: '自然睡眠', input: '我在客栈睡了一觉，醒来已是次日清晨。', expected: 'rest' },
  { label: '投宿过夜', input: '我投宿客栈，和衣而卧直到天亮。', expected: 'rest' },
  { label: '含蓄休整', input: '我在安全山洞养足精神，翌日再走。', expected: 'rest' },
  { label: '包扎静养', input: '医者为我包扎伤口，我随后卧床静养两小时。', expected: 'treatment' },
  { label: '昏迷救治', input: '我昏迷后被军医救治半日，醒来时伤口已经重新处理。', expected: 'treatment' },
  { label: '询问休息', input: '我只询问店家能否住下休息，尚未决定是否投宿。', expected: 'none' },
  { label: '计划休息', input: '我计划明日再休息，今天继续与众人议事。', expected: 'none' },
  { label: '被动等待', input: '我坐在营门等待斥候回来，没有睡觉，也没有接受治疗。', expected: 'none' },
  { label: '休息被打断', input: '我准备睡一觉，却被紧急军报打断，最终未能休息。', expected: 'none' },
  {
    label: '零生命治疗',
    input: '我已重伤得无法起身，接受医官连续治疗六小时。',
    expected: 'treatment',
    hp: 0,
  },
];

function collectTimeAdvancePatches(patches: StatePatch[] | undefined): StatePatch[] {
  return (patches ?? []).filter((patch) => patch.type === 'timeAdvance');
}

describe.runIf(REAL_API_ENABLED)('玩家休整语义真实 API 矩阵', () => {
  const client = new BrowserLlmClient();
  let lastRequestStartedAt = 0;

  for (const scenario of scenarios) {
    it(scenario.label, async () => {
      const waitMs = Math.max(0, 12_500 - (Date.now() - lastRequestStartedAt));
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      lastRequestStartedAt = Date.now();
      const result = await client.generate({
        config: makeApiConfig(),
        messages: [
          {
            role: 'system',
            content: [
              '你是《乱世风云录》的主叙事模型。只返回 JSON 对象，不要 Markdown。',
              '必须返回 narrativeText、suggestedActions、statePatches、statePatch、writeback。',
              'writeback.playerRecoveryKind 只能是 none、rest、treatment：',
              'rest=正文已经实际完成睡眠、休息、留宿或非医疗静养；',
              'treatment=正文已经实际完成包扎、治疗、疗伤或医疗休养；',
              'none=询问、计划、准备、等待、被打断、失败或没有实际完成恢复。',
              '不得只看输入关键词，必须按最终正文是否完成判断。',
              '不得返回生命、体力、恢复量或休息分钟数字段。',
              '每回合 statePatches 必须且只能包含一个正向 timeAdvance，严格使用：',
              '{"type":"timeAdvance","payload":{"minutesAdvanced":正整数,"reason":"经过时间原因","category":"rest|treatment|conversation|other"},"reason":"时间推进说明"}',
              '不要使用 duration、durationMinutes、elapsedMinutes、hours、days 或其他时间字段。rest/treatment 的 minutesAdvanced 必须与正文一致。',
              'statePatch 返回 null；不得返回其他状态变化。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: `当前时间：公元194年05月03日 20:00\n玩家行动：${scenario.input}`,
          },
        ],
        temperature: 0,
        maxOutputTokens: 2_500,
        responseFormat: 'json_object',
      });
      const parsed = parseNarratorResponse(result.content);
      const timePatches = collectTimeAdvancePatches(parsed.statePatches);
      expect(parsed.writeback?.playerRecoveryKind).toBe(scenario.expected);
      expect(timePatches).toHaveLength(1);
      expect(timePatches[0].payload?.minutesAdvanced).toEqual(expect.any(Number));
      expect(timePatches[0].payload?.minutesAdvanced).toBeGreaterThan(0);

      const before = makeState(scenario.hp);
      const after = applyPatches(
        before,
        timePatches,
        1,
        scenario.input,
        parsed.narrativeText,
      );
      expect(after.currentTime).not.toEqual(before.currentTime);
      const settlement = applyPlayerVitalsAfterTurn(after, {
        previousState: before,
        playerInput: scenario.input,
        actionIntent: interpretAction(scenario.input),
        recoveryKind: parsed.writeback?.playerRecoveryKind,
      });

      if (scenario.expected === 'rest') {
        expect(settlement.state.player.vitals?.stamina).toBeGreaterThan(20);
      } else if (scenario.expected === 'treatment') {
        expect(settlement.state.player.vitals?.stamina).toBeGreaterThan(20);
        expect(settlement.state.player.vitals?.hp).toBeGreaterThan(scenario.hp ?? 40);
      } else {
        expect(settlement.state.player.vitals?.hp).toBe(scenario.hp ?? 40);
        expect(settlement.state.player.vitals?.stamina).toBeLessThanOrEqual(20);
      }
    }, 90_000);
  }
});

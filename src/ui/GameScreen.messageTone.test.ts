import { describe, expect, it } from 'vitest';
import { classifyGameMessageTone } from './GameScreen';

describe('GameScreen message tone', () => {
  it('marks warnings, failures, and timeouts as errors', () => {
    expect(classifyGameMessageTone('地图写回存在警告')).toBe('error');
    expect(classifyGameMessageTone('辅助 API 请求失败')).toBe('error');
    expect(classifyGameMessageTone('LLM 响应超时')).toBe('error');
  });

  it('keeps completed saves distinct from neutral progress information', () => {
    expect(classifyGameMessageTone('AI 回合已生成并自动保存')).toBe('success');
    expect(classifyGameMessageTone('正在等待辅助 API 响应')).toBe('info');
  });
});

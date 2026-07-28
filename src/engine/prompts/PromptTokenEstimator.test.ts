import { describe, expect, it } from 'vitest';
import { estimatePromptTokens } from './PromptTokenEstimator';

function expectValidEstimate(text: string): void {
  const result = estimatePromptTokens(text);

  expect(result.chars).toBe(Array.from(text).length);
  expect(result.estimatedTokens).toBeGreaterThan(0);
  expect(result.lowerBound).toBeGreaterThanOrEqual(0);
  expect(result.upperBound).toBeGreaterThanOrEqual(result.estimatedTokens);
  expect(result.lowerBound).toBeLessThanOrEqual(result.estimatedTokens);
}

describe('PromptTokenEstimator', () => {
  it('returns zero for empty text', () => {
    expect(estimatePromptTokens('')).toEqual({
      chars: 0,
      estimatedTokens: 0,
      lowerBound: 0,
      upperBound: 0,
    });
  });

  it('estimates non-zero token usage for Chinese text', () => {
    expectValidEstimate('乱世之中，人物关系、地图、记忆与写回协议都需要稳定承接。');
  });

  it('estimates non-zero token usage for English text', () => {
    expectValidEstimate('Use the current prompt registry templates and local overrides only.');
  });

  it('estimates non-zero token usage for mixed Chinese and English text', () => {
    expectValidEstimate('提示词 template uses {playerInput}, NPC context, memory context, and JSON writeback.');
  });
});

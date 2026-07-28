import { describe, expect, it } from 'vitest';
import { buildTurnOutputRequirements, buildTurnUserMessage } from './TurnPromptMessages';

describe('buildTurnOutputRequirements', () => {
  it('requires temporary speakers to use explicit dialogue labels', () => {
    const requirements = buildTurnOutputRequirements();

    expect(requirements).toContain('narrativeText 显示格式');
    expect(requirements).toContain('临时出现的军士、门吏、仆从、路人等人物');
    expect(requirements).toContain('不要把直接台词塞进 `【旁白】` 段');
  });

  it('moves the adult runtime reminder behind state writeback and output requirements', () => {
    const adultRuntimeReminder = [
      '## 关系沉浸最终复核',
      '需要点明部位时，使用直接、清楚、可辨认的身体词汇。',
    ].join('\n');
    const message = buildTurnUserMessage(
      `## 玩家行动\n继续当前回合\n\n${adultRuntimeReminder}`,
      'STATE_WRITER_CONTEXT_SENTINEL',
      adultRuntimeReminder,
    );

    expect(message).toContain('STATE_WRITER_CONTEXT_SENTINEL');
    expect(message.indexOf(adultRuntimeReminder)).toBeGreaterThan(message.indexOf('## 回合输出要求'));
    expect(message.endsWith(adultRuntimeReminder)).toBe(true);
    expect(message.split(adultRuntimeReminder)).toHaveLength(2);
  });

  it('places the same-generation prose review after output requirements but before the adult reminder', () => {
    const proseFinalReview = [
      '## 正文提交前静默终检',
      '同一次生成内静默复核，不输出检查过程。',
    ].join('\n');
    const adultRuntimeReminder = [
      '## 关系沉浸最终复核',
      '成人门禁和最终风格仍为末尾最高优先级。',
    ].join('\n');
    const message = buildTurnUserMessage(
      `## 玩家行动\n继续当前回合\n\n${proseFinalReview}\n\n${adultRuntimeReminder}`,
      'STATE_WRITER_CONTEXT_SENTINEL',
      adultRuntimeReminder,
      proseFinalReview,
    );

    expect(message.indexOf(proseFinalReview)).toBeGreaterThan(message.indexOf('## 回合输出要求'));
    expect(message.indexOf(adultRuntimeReminder)).toBeGreaterThan(message.indexOf(proseFinalReview));
    expect(message.endsWith(adultRuntimeReminder)).toBe(true);
    expect(message.split(proseFinalReview)).toHaveLength(2);
    expect(message.split(adultRuntimeReminder)).toHaveLength(2);
  });
});

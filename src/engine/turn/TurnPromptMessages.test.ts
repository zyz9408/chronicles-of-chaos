import { describe, expect, it } from 'vitest';
import {
  buildTurnOutputRequirements,
  buildTurnUserMessage,
  resolveTurnPromptCacheLayout,
  stripStateWriterStableProtocolMarker,
  STATE_WRITER_STABLE_PROTOCOL_MARKER,
  TURN_DYNAMIC_CONTEXT_MARKER,
} from './TurnPromptMessages';

describe('buildTurnOutputRequirements', () => {
  it('keeps reusable output requirements before per-turn dynamic context', () => {
    const message = buildTurnUserMessage(
      'STATIC_PROTOCOL_SENTINEL\n\n## 本回合动态上下文\nDYNAMIC_CONTEXT_SENTINEL',
      'STATE_WRITER_CONTEXT_SENTINEL',
    );

    expect(message.indexOf('## 回合输出要求')).toBeLessThan(message.indexOf('STATIC_PROTOCOL_SENTINEL'));
    expect(message.indexOf('STATIC_PROTOCOL_SENTINEL')).toBeLessThan(message.indexOf('DYNAMIC_CONTEXT_SENTINEL'));
    expect(message.indexOf('DYNAMIC_CONTEXT_SENTINEL')).toBeLessThan(message.indexOf('STATE_WRITER_CONTEXT_SENTINEL'));
  });

  it('keeps the non-DeepSeek message layout byte-for-byte compatible', () => {
    const userPrompt = `STATIC_PROTOCOL_SENTINEL\n\n${TURN_DYNAMIC_CONTEXT_MARKER}\nDYNAMIC_CONTEXT_SENTINEL`;
    const stateWriterContext = `DYNAMIC_STATE_SENTINEL\n${STATE_WRITER_STABLE_PROTOCOL_MARKER}\nSTABLE_RULE_SENTINEL`;

    expect(buildTurnUserMessage(userPrompt, stateWriterContext, '', '', '', 'default')).toBe([
      buildTurnOutputRequirements(),
      '',
      userPrompt,
      '',
      '## 状态写入上下文',
      stripStateWriterStableProtocolMarker(stateWriterContext),
    ].join('\n'));
    expect(buildTurnUserMessage(userPrompt, stateWriterContext)).not
      .toContain(STATE_WRITER_STABLE_PROTOCOL_MARKER);
  });

  it('moves only stable state-writeback rules into the DeepSeek cacheable prefix', () => {
    const proseReview = 'PROSE_REVIEW_SENTINEL';
    const lengthReminder = 'LENGTH_REMINDER_SENTINEL';
    const finalReminder = 'FINAL_REMINDER_SENTINEL';
    const message = buildTurnUserMessage(
      [
        'STATIC_MAIN_PROTOCOL_SENTINEL',
        TURN_DYNAMIC_CONTEXT_MARKER,
        'DYNAMIC_MAIN_CONTEXT_SENTINEL',
        proseReview,
        lengthReminder,
        finalReminder,
      ].join('\n\n'),
      [
        'DYNAMIC_STATE_SNAPSHOT_SENTINEL',
        STATE_WRITER_STABLE_PROTOCOL_MARKER,
        'STABLE_STATE_PROTOCOL_SENTINEL',
      ].join('\n'),
      finalReminder,
      proseReview,
      lengthReminder,
      'deepseek_prefix',
    );

    expect(message.indexOf('STATIC_MAIN_PROTOCOL_SENTINEL'))
      .toBeLessThan(message.indexOf('STABLE_STATE_PROTOCOL_SENTINEL'));
    expect(message.indexOf('STABLE_STATE_PROTOCOL_SENTINEL'))
      .toBeLessThan(message.indexOf(TURN_DYNAMIC_CONTEXT_MARKER));
    expect(message.indexOf(TURN_DYNAMIC_CONTEXT_MARKER))
      .toBeLessThan(message.indexOf('DYNAMIC_STATE_SNAPSHOT_SENTINEL'));
    for (const sentinel of [
      'STATIC_MAIN_PROTOCOL_SENTINEL',
      'DYNAMIC_MAIN_CONTEXT_SENTINEL',
      'DYNAMIC_STATE_SNAPSHOT_SENTINEL',
      'STABLE_STATE_PROTOCOL_SENTINEL',
      proseReview,
      lengthReminder,
      finalReminder,
    ]) {
      expect(message.split(sentinel)).toHaveLength(2);
    }
    expect(message.indexOf('DYNAMIC_STATE_SNAPSHOT_SENTINEL')).toBeLessThan(message.indexOf(proseReview));
    expect(message.indexOf(proseReview)).toBeLessThan(message.indexOf(lengthReminder));
    expect(message.endsWith(finalReminder)).toBe(true);
  });

  it('keeps custom prompts unchanged when the cache-layout boundaries are unavailable', () => {
    const message = buildTurnUserMessage(
      'CUSTOM_MAIN_PROMPT_SENTINEL',
      `${STATE_WRITER_STABLE_PROTOCOL_MARKER}\nSTABLE_STATE_PROTOCOL_SENTINEL`,
      '',
      '',
      '',
      'deepseek_prefix',
    );

    expect(message.indexOf('CUSTOM_MAIN_PROMPT_SENTINEL'))
      .toBeLessThan(message.indexOf('STABLE_STATE_PROTOCOL_SENTINEL'));
    expect(message).toContain('## 状态写入上下文');
    expect(message).not.toContain(STATE_WRITER_STABLE_PROTOCOL_MARKER);
  });

  it('selects the prefix layout only for explicit DeepSeek configurations', () => {
    expect(resolveTurnPromptCacheLayout({ provider: 'deepseek', model: 'chat' }))
      .toBe('deepseek_prefix');
    expect(resolveTurnPromptCacheLayout({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
    })).toBe('default');
    expect(resolveTurnPromptCacheLayout({
      provider: 'openai_compatible',
      model: 'vendor/deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com/v1',
    })).toBe('default');
    expect(resolveTurnPromptCacheLayout({
      provider: 'openai_compatible',
      model: 'deepseek-v4-pro',
    })).toBe('deepseek_prefix');
    expect(resolveTurnPromptCacheLayout({
      provider: 'openai_compatible',
      model: 'provider-alias',
      baseUrl: 'https://api.deepseek.com/v1',
    })).toBe('deepseek_prefix');
    expect(resolveTurnPromptCacheLayout({
      provider: 'openai_compatible',
      model: 'gemini-3.1-pro-preview',
      baseUrl: 'https://example.invalid/v1',
    })).toBe('default');
  });

  it('requires recovery semantics without model-authored vitality numbers', () => {
    const requirements = buildTurnOutputRequirements();

    expect(requirements).toContain('writeback.playerRecoveryKind');
    expect(requirements).toContain('none/rest/treatment');
    expect(requirements).toContain('不得返回生命、体力、恢复量或时长数值');
  });

  it('requires temporary speakers to use explicit dialogue labels', () => {
    const requirements = buildTurnOutputRequirements();

    expect(requirements).toContain('narrativeText 显示格式');
    expect(requirements).toContain('临时出现的军士、门吏、仆从、路人等人物');
    expect(requirements).toContain('不要把直接台词塞进 `【旁白】` 段');
  });

  it('keeps terminal troop encounters in narrative instead of War V2', () => {
    const requirements = buildTurnOutputRequirements();

    expect(requirements).toContain('lifecycleStatus=active/unknown');
    expect(requirements).toContain('追击、收拢、招降、押解或清剿零散溃兵继续开放剧情');
    expect(requirements).toContain('不得复活旧 troopId');
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

  it('places the non-overridable narrative length check after prose pruning', () => {
    const proseFinalReview = [
      '## 正文提交前静默终检',
      '删去无效重复。'
    ].join('\n');
    const lengthFinalReminder = [
      '## 正文篇幅提交前检查',
      'narrativeText 仍必须不少于 1000 个非空白字符。'
    ].join('\n');
    const adultRuntimeReminder = [
      '## 关系沉浸最终复核',
      '成人门禁和最终风格仍为末尾最高优先级。',
    ].join('\n');
    const message = buildTurnUserMessage(
      [
        '## 玩家行动',
        '继续当前回合',
        proseFinalReview,
        lengthFinalReminder,
        adultRuntimeReminder,
      ].join('\n\n'),
      'STATE_WRITER_CONTEXT_SENTINEL',
      adultRuntimeReminder,
      proseFinalReview,
      lengthFinalReminder,
    );

    expect(message.indexOf(proseFinalReview)).toBeGreaterThan(message.indexOf('## 回合输出要求'));
    expect(message.indexOf(lengthFinalReminder)).toBeGreaterThan(message.indexOf(proseFinalReview));
    expect(message.indexOf(adultRuntimeReminder)).toBeGreaterThan(message.indexOf(lengthFinalReminder));
    expect(message.split(lengthFinalReminder)).toHaveLength(2);
    expect(message.endsWith(adultRuntimeReminder)).toBe(true);
  });
});

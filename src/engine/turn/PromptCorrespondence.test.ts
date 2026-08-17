import { describe, expect, it } from 'vitest';
import {
  CORRESPONDENCE_NON_BLOCKING_UI_RULE,
  CORRESPONDENCE_REPLY_WRITEBACK_RULE,
  insertRuntimeContextBeforeStableProtocol,
} from './PromptComposer';
import { STATE_WRITER_STABLE_PROTOCOL_MARKER } from './TurnPromptMessages';

describe('Prompt correspondence placement', () => {
  it('inserts changing letter content once before the stable protocol marker', () => {
    const runtime = '## Correspondence\nletterId=letter_1 | 正文=近来可安';
    const result = insertRuntimeContextBeforeStableProtocol(
      `dynamic state\n\n${STATE_WRITER_STABLE_PROTOCOL_MARKER}\nstable rules`,
      runtime,
    );
    expect(result.indexOf(runtime)).toBeGreaterThan(result.indexOf('dynamic state'));
    expect(result.indexOf(runtime)).toBeLessThan(result.indexOf(STATE_WRITER_STABLE_PROTOCOL_MARKER));
    expect(result.split(runtime)).toHaveLength(2);
  });

  it('requires ordinary greetings to receive a non-blocking structured reply', () => {
    expect(CORRESPONDENCE_REPLY_WRITEBACK_RULE).toContain('普通问候也要结合人物关系与处境礼貌问候');
    expect(CORRESPONDENCE_REPLY_WRITEBACK_RULE).toContain('不能用 acknowledge 把“稍后回复”伪装成已处理');
    expect(CORRESPONDENCE_REPLY_WRITEBACK_RULE).toContain('绝不能复用 sourceLetterId');
    expect(CORRESPONDENCE_REPLY_WRITEBACK_RULE).toContain('deliveryState');
    expect(CORRESPONDENCE_REPLY_WRITEBACK_RULE).toContain('正文已读过的来信仍写成 sent');
    expect(CORRESPONDENCE_NON_BLOCKING_UI_RULE).toContain('正文继续响应玩家当前行动');
    expect(CORRESPONDENCE_NON_BLOCKING_UI_RULE).toContain('只在书信入口显示未读红点');
    expect(CORRESPONDENCE_NON_BLOCKING_UI_RULE).toContain('deliveryState=received');
  });
});

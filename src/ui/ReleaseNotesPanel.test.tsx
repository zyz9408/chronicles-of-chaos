import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReleaseNotesPanel } from './ReleaseNotesPanel';

describe('ReleaseNotesPanel', () => {
  it('renders the newest patch release with its explicit local time', () => {
    const markup = renderToStaticMarkup(<ReleaseNotesPanel onClose={() => undefined} />);

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('2026年9月5日');
    expect(markup).toContain('dateTime="2026-09-05T01:45:00+08:00"');
    expect(markup).toContain('>01:45</time>');
    expect(markup).toContain('v1.8.4');
    expect(markup).toContain('战斗属性与玩家权威能力完善');
    expect(markup).toContain('本地确定性规则');
    expect(markup).toContain('查看2026年9月3日更新，共1项');
    expect(markup).toContain('查看2026年9月2日更新，共2项');
    expect(markup).toContain('查看2026年8月17日更新，共1项');
    expect(markup).toContain('查看2026年8月12日更新，共2项');
    expect(markup).toContain('查看2026年8月11日更新，共2项');
    expect(markup).toContain('查看2026年8月10日更新，共2项');
    expect(markup).toContain('查看2026年8月9日更新，共1项');
    expect(markup).toContain('查看2026年8月8日更新，共6项');
    expect(markup).toContain('查看2026年8月7日更新，共6项');
    expect(markup).toContain('查看2026年8月6日更新，共8项');
    expect(markup).toContain('查看2026年8月5日更新，共8项');
    expect(markup).toContain('查看2026年8月4日更新，共7项');
    expect(markup).toContain('查看2026年8月3日更新，共5项');
    expect(markup).toContain('查看2026年8月2日更新，共6项');
    expect(markup).toContain('查看2026年8月1日更新，共10项');
    expect(markup).not.toContain('社区公开测试与匿名运行统计');
    expect(markup).not.toContain('上线便利性与数据管理');
    expect(markup).not.toContain('开局能力点预算');
    expect(markup).toContain('更新日志页码');
    expect(markup).toContain('aria-label="关闭更新日志"');
  });
});

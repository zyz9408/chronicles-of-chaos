import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReleaseNotesPanel } from './ReleaseNotesPanel';

describe('ReleaseNotesPanel', () => {
  it('renders the sole official-release entry with an explicit local time', () => {
    const markup = renderToStaticMarkup(<ReleaseNotesPanel onClose={() => undefined} />);

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('2026年7月27日');
    expect(markup).toContain('dateTime="2026-07-27T13:34:00+08:00"');
    expect(markup).toContain('>13:34</time>');
    expect(markup).toContain('游戏正式上线');
    expect(markup).toContain('三国乱世叙事游戏');
    expect(markup).toContain('1500 条');
    expect(markup).not.toContain('社区公开测试与匿名运行统计');
    expect(markup).not.toContain('上线便利性与数据管理');
    expect(markup).not.toContain('开局能力点预算');
    expect(markup).not.toContain('更新日志页码');
    expect(markup).toContain('aria-label="关闭更新日志"');
  });
});

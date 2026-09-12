import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AdminAnalyticsScreen,
  isAdminAnalyticsPasscode
} from './AdminAnalyticsScreen';

describe('AdminAnalyticsScreen', () => {
  it('accepts a secret for server-side verification without embedding it in the client', () => {
    expect(isAdminAnalyticsPasscode('test-admin-secret-123')).toBe(true);
    expect(isAdminAnalyticsPasscode('coc3')).toBe(false);
    expect(isAdminAnalyticsPasscode('wrong')).toBe(false);

    const markup = renderToStaticMarkup(<AdminAnalyticsScreen />);
    expect(markup).toContain('《乱世风云录》运行统计');
    expect(markup).not.toContain('混沌编年史');
    expect(markup).not.toContain('混沌纪年');
    expect(markup).toContain('查看匿名统计');
    expect(markup).toContain('请输入管理员口令');
    expect(markup).toContain('data-testid="admin-analytics-passcode"');
    expect(markup).not.toContain('value="coc3"');
  });
});

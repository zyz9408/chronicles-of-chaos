import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_ANALYTICS_PASSCODE,
  AdminAnalyticsScreen,
  isAdminAnalyticsPasscode
} from './AdminAnalyticsScreen';

describe('AdminAnalyticsScreen', () => {
  it('uses the agreed lightweight passcode without presenting it as security', () => {
    expect(ADMIN_ANALYTICS_PASSCODE).toBe('coc3');
    expect(isAdminAnalyticsPasscode('coc3')).toBe(true);
    expect(isAdminAnalyticsPasscode(' coc3 ')).toBe(true);
    expect(isAdminAnalyticsPasscode('wrong')).toBe(false);

    const markup = renderToStaticMarkup(<AdminAnalyticsScreen />);
    expect(markup).toContain('《乱世风云录》运行统计');
    expect(markup).not.toContain('混沌编年史');
    expect(markup).not.toContain('混沌纪年');
    expect(markup).toContain('查看匿名统计');
    expect(markup).toContain('不是安全认证');
    expect(markup).toContain('data-testid="admin-analytics-passcode"');
    expect(markup).not.toContain('value="coc3"');
  });
});

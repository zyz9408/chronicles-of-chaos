import { describe, expect, it } from 'vitest';
import {
  ADMIN_ANALYTICS_PASSCODE,
  dayKeyFor,
  hasAdminPasscode,
  hashAnalyticsId,
  parseHeartbeatPayload,
  readCloudflareRegion
} from './analytics.js';

describe('Cloudflare analytics privacy boundary', () => {
  it('accepts only bounded anonymous heartbeat fields', () => {
    expect(parseHeartbeatPayload({
      event: 'page_view',
      visitorId: 'visitor_1234567890abcdef',
      sessionId: 'session_1234567890abcdef',
      language: 'zh-CN',
      deviceClass: 'desktop',
      viewportWidth: 1440,
      referrerHost: 'example.com',
      appVersion: '0.1.0',
      story: 'must be ignored',
      apiKey: 'must be ignored'
    })).toEqual({
      event: 'page_view',
      visitorId: 'visitor_1234567890abcdef',
      sessionId: 'session_1234567890abcdef',
      language: 'zh-CN',
      deviceClass: 'desktop',
      viewportWidth: 1440,
      referrerHost: 'example.com',
      appVersion: '0.1.0'
    });
    expect(parseHeartbeatPayload({ event: 'heartbeat', visitorId: 'short', sessionId: 'short' })).toBeNull();
  });

  it('uses the requested timezone for daily aggregation', () => {
    const instant = new Date('2026-07-19T16:30:00.000Z');
    expect(dayKeyFor(instant, 'Asia/Shanghai')).toBe('2026-07-20');
    expect(dayKeyFor(instant, 'UTC')).toBe('2026-07-19');
  });

  it('reads aggregate Cloudflare geography without raw IP', () => {
    const region = readCloudflareRegion({
      cf: { country: 'CN', region: 'Shanghai', regionCode: 'SH', city: 'Shanghai' },
      headers: new Headers({ 'cf-connecting-ip': '203.0.113.10' })
    });
    expect(region).toEqual({
      countryCode: 'CN',
      region: 'Shanghai',
      regionCode: 'SH',
      city: 'Shanghai'
    });
    expect(JSON.stringify(region)).not.toContain('203.0.113.10');
  });

  it('hashes identifiers and uses coc3 only as the agreed anti-misentry passcode', async () => {
    const salt = 'test-only-salt-with-at-least-24-characters';
    const visitorHash = await hashAnalyticsId('same-random-id', salt, 'visitor');
    const sessionHash = await hashAnalyticsId('same-random-id', salt, 'session');
    expect(visitorHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sessionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(visitorHash).not.toBe(sessionHash);

    expect(ADMIN_ANALYTICS_PASSCODE).toBe('coc3');
    expect(hasAdminPasscode(new Request('https://example.com', {
      headers: { 'x-coc-admin-passcode': 'coc3' }
    }))).toBe(true);
    expect(hasAdminPasscode(new Request('https://example.com'))).toBe(false);
  });
});

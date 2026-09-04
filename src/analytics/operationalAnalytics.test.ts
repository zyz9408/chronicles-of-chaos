import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PUBLIC_APP_VERSION,
  buildOperationalAnalyticsPayload,
  isOperationalAnalyticsEnabled,
  resolveDeviceClass,
  resolveReferrerHost
} from './operationalAnalytics';

describe('operationalAnalytics', () => {
  it('uses the public release version by default', () => {
      expect(DEFAULT_PUBLIC_APP_VERSION).toBe('1.8.4');
  });

  it('uses stable coarse device classes', () => {
    expect(resolveDeviceClass(390)).toBe('mobile');
    expect(resolveDeviceClass(800)).toBe('tablet');
    expect(resolveDeviceClass(1440)).toBe('desktop');
  });

  it('keeps only the source host and never the source path or query', () => {
    expect(resolveReferrerHost('', 'game.example')).toBe('direct');
    expect(resolveReferrerHost('https://game.example/private/path', 'game.example')).toBe('internal');
    expect(resolveReferrerHost('https://search.example/query?q=secret', 'game.example')).toBe('search.example');
    expect(resolveReferrerHost('not a url', 'game.example')).toBe('unknown');
  });

  it('builds a bounded operational payload without gameplay or API fields', () => {
    const payload = buildOperationalAnalyticsPayload({
      event: 'page_view',
      visitorId: 'visitor_1234567890abcdef',
      sessionId: 'session_1234567890abcdef',
      language: 'zh-CN',
      viewportWidth: 390,
      referrer: 'https://discord.com/channels/private?token=secret',
      currentHost: 'game.example',
      appVersion: '0.1.0'
    });

    expect(payload).toEqual({
      event: 'page_view',
      visitorId: 'visitor_1234567890abcdef',
      sessionId: 'session_1234567890abcdef',
      language: 'zh-CN',
      deviceClass: 'mobile',
      viewportWidth: 390,
      referrerHost: 'discord.com',
      appVersion: '0.1.0'
    });
    expect(JSON.stringify(payload)).not.toMatch(/story|save|apiKey|prompt|model|secret/);
  });

  it('is disabled in local development unless explicitly enabled', () => {
    expect(isOperationalAnalyticsEnabled(false, undefined)).toBe(false);
    expect(isOperationalAnalyticsEnabled(false, 'true')).toBe(true);
    expect(isOperationalAnalyticsEnabled(true, undefined)).toBe(true);
  });
});

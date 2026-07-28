import { describe, expect, it } from 'vitest';
import { onRequestGet as getAdminAnalytics } from '../admin/analytics.js';
import { onRequestPost as postAnalyticsHeartbeat } from './heartbeat.js';

function createFakeD1() {
  const calls = [];
  const database = {
    calls,
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          this.values = values;
          calls.push({ sql, values });
          return this;
        },
        async first() {
          if (sql.includes('AS current_online')) {
            return {
              current_online: 2,
              total_visitors: 9,
              total_sessions: 12,
              returning_visitors: 3,
              active_7d: 6,
              active_30d: 9,
              average_session_minutes: 18.5,
              last_event_at: '2026-07-27T05:00:00.000Z'
            };
          }
          if (sql.includes('heartbeat_count, peak_online')) {
            return {
              day: '2026-07-27',
              page_views: 7,
              sessions_started: 4,
              unique_visitors: 3,
              heartbeat_count: 12,
              peak_online: 2
            };
          }
          if (sql.includes('COUNT(*) AS count')) return { count: 2 };
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { success: true };
        }
      };
      return statement;
    },
    async batch(statements) {
      return statements.map(() => ({ success: true }));
    }
  };
  return database;
}

describe('analytics endpoints', () => {
  it('requires coc3 for the low-sensitivity admin endpoint', async () => {
    const unauthorized = await getAdminAnalytics({
      request: new Request('https://example.com/api/admin/analytics'),
      env: {}
    });
    expect(unauthorized.status).toBe(401);

    const unconfigured = await getAdminAnalytics({
      request: new Request('https://example.com/api/admin/analytics', {
        headers: { 'x-coc-admin-passcode': 'coc3' }
      }),
      env: {}
    });
    expect(unconfigured.status).toBe(503);
  });

  it('returns only aggregate admin metrics with the agreed passcode', async () => {
    const response = await getAdminAnalytics({
      request: new Request('https://example.com/api/admin/analytics', {
        headers: { 'x-coc-admin-passcode': 'coc3' }
      }),
      env: { ANALYTICS_DB: createFakeD1(), ANALYTICS_TIMEZONE: 'Asia/Shanghai' }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toMatchObject({
      currentOnline: 2,
      totalVisitors: 9,
      totalSessions: 12,
      returningVisitors: 3
    });
    expect(JSON.stringify(payload)).not.toMatch(/story|save|apiKey|prompt|model|rawIp/);
  });

  it('fails closed when analytics storage or its HMAC salt is absent', async () => {
    const response = await postAnalyticsHeartbeat({
      request: new Request('https://example.com/api/analytics/heartbeat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      }),
      env: {}
    });
    expect(response.status).toBe(503);
  });

  it('stores only hashes and bounded aggregate metadata on a valid heartbeat', async () => {
    const database = createFakeD1();
    const visitorId = 'visitor_1234567890abcdef';
    const sessionId = 'session_1234567890abcdef';
    const request = new Request('https://example.com/api/analytics/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'page_view',
        visitorId,
        sessionId,
        language: 'zh-CN',
        deviceClass: 'desktop',
        viewportWidth: 1440,
        referrerHost: 'discord.com',
        appVersion: '0.1.0',
        story: 'must never be persisted',
        apiKey: 'must never be persisted'
      })
    });
    request.cf = { country: 'CN', region: 'Shanghai', regionCode: 'SH', city: 'Shanghai' };

    const response = await postAnalyticsHeartbeat({
      request,
      env: {
        ANALYTICS_DB: database,
        ANALYTICS_HASH_SALT: 'test-only-salt-with-at-least-24-characters',
        ANALYTICS_TIMEZONE: 'Asia/Shanghai'
      }
    });
    const payload = await response.json();
    const storedValues = JSON.stringify(database.calls);

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, currentOnline: 2, onlineWindowSeconds: 120 });
    expect(storedValues).not.toContain(visitorId);
    expect(storedValues).not.toContain(sessionId);
    expect(storedValues).not.toContain('must never be persisted');
    expect(storedValues).toMatch(/[a-f0-9]{64}/);
  });
});

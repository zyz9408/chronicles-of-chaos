import { APP_VERSION } from '../ui/releaseNotes';

export const ANALYTICS_VISITOR_STORAGE_KEY = 'chronicles-of-chaos-v2-anonymous-visitor';
export const ANALYTICS_SESSION_STORAGE_KEY = 'chronicles-of-chaos-v2-anonymous-session';
export const DEFAULT_PUBLIC_APP_VERSION = APP_VERSION;
export const ANALYTICS_HEARTBEAT_INTERVAL_MS = 45_000;

export type AnalyticsDeviceClass = 'mobile' | 'tablet' | 'desktop';

export interface OperationalAnalyticsPayload {
  event: 'page_view' | 'heartbeat';
  visitorId: string;
  sessionId: string;
  language: string;
  deviceClass: AnalyticsDeviceClass;
  viewportWidth: number;
  referrerHost: string;
  appVersion: string;
}

function createAnonymousId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function getOrCreateId(storage: Storage, key: string, prefix: string): string {
  try {
    const stored = storage.getItem(key);
    if (stored && stored.length >= 16 && stored.length <= 128) return stored;
    const created = createAnonymousId(prefix);
    storage.setItem(key, created);
    return created;
  } catch {
    return createAnonymousId(prefix);
  }
}

export function resolveDeviceClass(width: number): AnalyticsDeviceClass {
  if (width <= 620) return 'mobile';
  if (width <= 1024) return 'tablet';
  return 'desktop';
}

export function resolveReferrerHost(referrer: string, currentHost: string): string {
  if (!referrer) return 'direct';
  try {
    const host = new URL(referrer).host.toLowerCase();
    return !host || host === currentHost.toLowerCase() ? 'internal' : host.slice(0, 160);
  } catch {
    return 'unknown';
  }
}

export function isOperationalAnalyticsEnabled(
  isProduction = import.meta.env.PROD,
  explicitSetting = import.meta.env.VITE_ENABLE_ANALYTICS
): boolean {
  return isProduction || explicitSetting === 'true';
}

export function buildOperationalAnalyticsPayload(input: {
  event: OperationalAnalyticsPayload['event'];
  visitorId: string;
  sessionId: string;
  language: string;
  viewportWidth: number;
  referrer: string;
  currentHost: string;
  appVersion: string;
}): OperationalAnalyticsPayload {
  const viewportWidth = Math.max(320, Math.min(10_000, Math.round(input.viewportWidth)));
  return {
    event: input.event,
    visitorId: input.visitorId,
    sessionId: input.sessionId,
    language: input.language || 'zh-CN',
    deviceClass: resolveDeviceClass(viewportWidth),
    viewportWidth,
    referrerHost: resolveReferrerHost(input.referrer, input.currentHost),
    appVersion: input.appVersion
  };
}

function sendPayload(payload: OperationalAnalyticsPayload): void {
  void fetch('/api/analytics/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
    credentials: 'same-origin'
  }).catch(() => {
    // Anonymous operational analytics must never interrupt or report errors to gameplay.
  });
}

export function startOperationalAnalytics(): () => void {
  if (
    !isOperationalAnalyticsEnabled()
    || typeof window === 'undefined'
    || window.location.pathname.replace(/\/+$/, '').startsWith('/admin/analytics')
  ) {
    return () => undefined;
  }

  const visitorId = getOrCreateId(window.localStorage, ANALYTICS_VISITOR_STORAGE_KEY, 'visitor');
  const sessionId = getOrCreateId(window.sessionStorage, ANALYTICS_SESSION_STORAGE_KEY, 'session');
  const appVersion = import.meta.env.VITE_APP_VERSION || DEFAULT_PUBLIC_APP_VERSION;

  const createPayload = (event: OperationalAnalyticsPayload['event']): OperationalAnalyticsPayload =>
    buildOperationalAnalyticsPayload({
      event,
      visitorId,
      sessionId,
      language: document.documentElement.lang || navigator.language || 'zh-CN',
      viewportWidth: window.innerWidth,
      referrer: document.referrer,
      currentHost: window.location.host,
      appVersion
    });

  sendPayload(createPayload('page_view'));

  const sendHeartbeat = () => {
    if (document.visibilityState === 'visible') sendPayload(createPayload('heartbeat'));
  };
  const intervalId = window.setInterval(sendHeartbeat, ANALYTICS_HEARTBEAT_INTERVAL_MS);
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') sendHeartbeat();
  };

  window.addEventListener('focus', sendHeartbeat);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    window.clearInterval(intervalId);
    window.removeEventListener('focus', sendHeartbeat);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

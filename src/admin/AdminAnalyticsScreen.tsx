import { useCallback, useEffect, useMemo, useState } from 'react';
import './admin-analytics.css';

export const ADMIN_ANALYTICS_PASSCODE = 'coc3';

interface AnalyticsSummary {
  currentOnline: number;
  todayPeakOnline: number;
  todayUniqueVisitors: number;
  todayPageViews: number;
  todaySessions: number;
  totalVisitors: number;
  totalSessions: number;
  returningVisitors: number;
  active7d: number;
  active30d: number;
  averageSessionMinutes: number;
  lastEventAt: string | null;
}

interface DailyMetric {
  day: string;
  page_views: number;
  sessions_started: number;
  unique_visitors: number;
  peak_online: number;
}

export interface AnalyticsResponse {
  ok: true;
  generatedAt: string;
  timezone: string;
  onlineWindowSeconds: number;
  summary: AnalyticsSummary;
  daily: DailyMetric[];
  regions: Array<{ country_code: string; region: string; city: string; visitors: number }>;
  languages: Array<{ language: string; visitors: number }>;
  devices: Array<{ device_class: string; visitors: number; average_width: number }>;
  versions: Array<{ app_version: string; visitors: number }>;
  referrers: Array<{ referrer_host: string; sessions: number }>;
}

export function isAdminAnalyticsPasscode(value: string): boolean {
  return value.trim() === ADMIN_ANALYTICS_PASSCODE;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
}

function formatMinutes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 分钟';
  if (value < 60) return `${value.toFixed(1)} 分钟`;
  return `${(value / 60).toFixed(1)} 小时`;
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article className="coc-admin-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function DistributionList({
  rows
}: {
  rows: Array<{ key: string; label: string; value: number; detail?: string }>;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="coc-admin-distribution-list">
      {rows.length ? rows.map((row) => (
        <div key={row.key} className="coc-admin-distribution-row">
          <div>
            <strong>{row.label}</strong>
            {row.detail ? <small>{row.detail}</small> : null}
          </div>
          <span>{formatNumber(row.value)}</span>
          <i style={{ width: `${Math.max(3, (row.value / max) * 100)}%` }} />
        </div>
      )) : <p className="coc-admin-muted">暂无数据</p>}
    </div>
  );
}

export function AdminAnalyticsScreen() {
  const [passcode, setPasscode] = useState('');
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAnalytics = useCallback(async (activePasscode = passcode) => {
    if (!isAdminAnalyticsPasscode(activePasscode)) {
      setError('口令不正确。');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/analytics', {
        headers: { 'x-coc-admin-passcode': activePasscode.trim() },
        cache: 'no-store'
      });
      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? '口令不正确。'
            : `统计服务暂不可用（${response.status}）。`
        );
      }
      setData(await response.json() as AnalyticsResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取统计失败。');
    } finally {
      setIsLoading(false);
    }
  }, [passcode]);

  useEffect(() => {
    if (!data || !isAdminAnalyticsPasscode(passcode)) return;
    const intervalId = window.setInterval(() => void loadAnalytics(passcode), 30_000);
    return () => window.clearInterval(intervalId);
  }, [data, passcode, loadAnalytics]);

  const returningRate = data && data.summary.totalVisitors > 0
    ? `${((data.summary.returningVisitors / data.summary.totalVisitors) * 100).toFixed(1)}%`
    : '0%';
  const dailyMax = useMemo(
    () => Math.max(1, ...(data?.daily.map((row) => Number(row.unique_visitors)) ?? [])),
    [data]
  );

  return (
    <main className="coc-admin-analytics-screen">
      <header className="coc-admin-analytics-header">
        <div>
          <p>PRIVATE OPERATIONS VIEW</p>
        <h1>《乱世风云录》运行统计</h1>
          <span>匿名聚合 · 不读取游戏存档与 API 配置</span>
        </div>
        <a href="/">返回游戏首页</a>
      </header>

      {!data ? (
        <form
          className="coc-admin-auth-card"
          aria-label="后台口令"
          onSubmit={(event) => {
            event.preventDefault();
            void loadAnalytics();
          }}
        >
          <h2>查看匿名统计</h2>
          <p>请输入约定口令。它只用于避免玩家误入，不是安全认证，也不保护敏感数据。</p>
          <label>
            后台口令
            <input
              data-testid="admin-analytics-passcode"
              type="password"
              autoComplete="off"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
            />
          </label>
          {error ? <p className="coc-admin-error" role="alert">{error}</p> : null}
          <button type="submit" disabled={isLoading}>
            {isLoading ? '正在连接…' : '进入后台'}
          </button>
        </form>
      ) : (
        <div className="coc-admin-analytics-content" data-testid="admin-analytics-dashboard">
          <section className="coc-admin-status-strip">
            <span>统计时区：{data.timezone}</span>
            <span>在线窗口：{data.onlineWindowSeconds} 秒</span>
            <span>最近刷新：{new Date(data.generatedAt).toLocaleString('zh-CN')}</span>
            <button type="button" disabled={isLoading} onClick={() => void loadAnalytics()}>
              {isLoading ? '刷新中…' : '立即刷新'}
            </button>
          </section>
          {error ? <p className="coc-admin-error" role="alert">{error}</p> : null}

          <section className="coc-admin-metric-grid" aria-label="核心统计">
            <MetricCard label="同时在线" value={formatNumber(data.summary.currentOnline)} note="最近两分钟仍有心跳的会话" />
            <MetricCard label="今日峰值在线" value={formatNumber(data.summary.todayPeakOnline)} note="按同一在线口径计算" />
            <MetricCard label="今日独立访客" value={formatNumber(data.summary.todayUniqueVisitors)} note={`${formatNumber(data.summary.todayPageViews)} 次页面访问`} />
            <MetricCard label="累计独立访客" value={formatNumber(data.summary.totalVisitors)} note="匿名浏览器标识去重" />
            <MetricCard label="累计会话" value={formatNumber(data.summary.totalSessions)} note={`今日 ${formatNumber(data.summary.todaySessions)} 次`} />
            <MetricCard label="近 7 日活跃" value={formatNumber(data.summary.active7d)} note={`近 30 日 ${formatNumber(data.summary.active30d)}`} />
            <MetricCard label="跨日回访占比" value={returningRate} note={`${formatNumber(data.summary.returningVisitors)} 名跨日回访`} />
            <MetricCard label="平均会话时长" value={formatMinutes(data.summary.averageSessionMinutes)} note="按可见页心跳近似计算" />
          </section>

          <section className="coc-admin-dashboard-grid">
            <article className="coc-admin-dashboard-panel coc-admin-dashboard-panel--wide">
              <header><div><h2>近 30 日趋势</h2><p>独立访客、页面访问与峰值在线</p></div></header>
              <div className="coc-admin-daily-chart">
                {data.daily.length ? data.daily.map((row) => (
                  <div key={row.day} className="coc-admin-daily-row">
                    <time>{row.day.slice(5)}</time>
                    <div><i style={{ width: `${Math.max(2, (Number(row.unique_visitors) / dailyMax) * 100)}%` }} /></div>
                    <span>{formatNumber(row.unique_visitors)} 人</span>
                    <small>{formatNumber(row.page_views)} PV · 峰值 {formatNumber(row.peak_online)}</small>
                  </div>
                )) : <p className="coc-admin-muted">暂无数据</p>}
              </div>
            </article>

            <article className="coc-admin-dashboard-panel">
              <header><div><h2>访问地区</h2><p>托管平台推断后聚合，不保存原始 IP</p></div></header>
              <DistributionList rows={data.regions.map((row) => ({
                key: `${row.country_code}-${row.region}-${row.city}`,
                label: `${row.country_code} · ${row.region}`,
                detail: row.city,
                value: Number(row.visitors)
              }))} />
            </article>
            <article className="coc-admin-dashboard-panel">
              <header><div><h2>界面语言</h2><p>近 30 日独立访客</p></div></header>
              <DistributionList rows={data.languages.map((row) => ({
                key: row.language,
                label: row.language,
                value: Number(row.visitors)
              }))} />
            </article>
            <article className="coc-admin-dashboard-panel">
              <header><div><h2>设备类别</h2><p>仅按视口宽度粗分，不做设备指纹</p></div></header>
              <DistributionList rows={data.devices.map((row) => ({
                key: row.device_class,
                label: row.device_class,
                detail: `平均宽度 ${formatNumber(row.average_width)}px`,
                value: Number(row.visitors)
              }))} />
            </article>
            <article className="coc-admin-dashboard-panel">
              <header><div><h2>版本分布</h2><p>用于判断旧版仍在使用的比例</p></div></header>
              <DistributionList rows={data.versions.map((row) => ({
                key: row.app_version,
                label: row.app_version,
                value: Number(row.visitors)
              }))} />
            </article>
            <article className="coc-admin-dashboard-panel">
              <header><div><h2>访问来源</h2><p>只保存来源域名，不保存路径或查询内容</p></div></header>
              <DistributionList rows={data.referrers.map((row) => ({
                key: row.referrer_host,
                label: row.referrer_host,
                value: Number(row.sessions)
              }))} />
            </article>
            <article className="coc-admin-dashboard-panel coc-admin-privacy-panel">
              <header><div><h2>采集边界</h2><p>轻量口令只防误入，所以后台不得存放敏感数据</p></div></header>
              <ul>
                <li>不保存原始 IP，只展示托管平台提供的国家、地区和城市聚合。</li>
                <li>不收集玩家输入、剧情、存档、人物关系、API 配置、密钥、提示词、模型名或响应。</li>
                <li>访客与会话随机标识只在服务端保存加盐 HMAC 摘要。</li>
                <li>口令固定为项目约定值，不是账号系统，也不能抵抗主动查看源码。</li>
              </ul>
            </article>
          </section>
        </div>
      )}
    </main>
  );
}

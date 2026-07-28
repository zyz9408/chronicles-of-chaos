import React from 'react';
import { StartScreen } from './ui/StartScreen';
import { startOperationalAnalytics } from './analytics/operationalAnalytics';
import './App.css';

const AdminAnalyticsScreen = React.lazy(() =>
  import('./admin/AdminAnalyticsScreen').then((module) => ({
    default: module.AdminAnalyticsScreen
  }))
);

export type ApplicationSurface = 'game' | 'admin-analytics';

export function resolveApplicationSurface(pathname: string): ApplicationSurface {
  return pathname.replace(/\/+$/, '') === '/admin/analytics' ? 'admin-analytics' : 'game';
}

const App: React.FC = () => {
  React.useEffect(() => startOperationalAnalytics(), []);

  if (resolveApplicationSurface(window.location.pathname) === 'admin-analytics') {
    return (
      <React.Suspense fallback={<div className="app-route-loading">正在载入统计后台…</div>}>
        <AdminAnalyticsScreen />
      </React.Suspense>
    );
  }
  return <StartScreen />;
};

export default App;

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { markDedicatedE2eOrigin } from './engine/storage/E2eStorageGuard';
import { applyDisplayPreferencesToDocument } from './engine/settings/DisplaySettings';

markDedicatedE2eOrigin();
applyDisplayPreferencesToDocument();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

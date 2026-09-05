import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const playwrightPort = process.env.PLAYWRIGHT_PORT ?? '41731';
const playwrightBaseUrl = `http://127.0.0.1:${playwrightPort}`;
const defaultWindowsChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROME_PATH
  || (process.platform === 'win32' && existsSync(defaultWindowsChrome) ? defaultWindowsChrome : undefined);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'output/playwright/html-report', open: 'never' }],
  ],
  outputDir: 'output/playwright/test-results',
  use: {
    baseURL: playwrightBaseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run dev -- --mode e2e --host 127.0.0.1 --port ${playwrightPort} --strictPort`,
    url: playwrightBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumExecutablePath ? { launchOptions: { executablePath: chromiumExecutablePath } } : {}),
      },
    },
  ],
});

import { defineConfig, devices } from '@playwright/test';

const playwrightPort = process.env.PLAYWRIGHT_PORT ?? '41731';
const playwrightBaseUrl = `http://127.0.0.1:${playwrightPort}`;
const currentLocalDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
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
    storageState: {
      cookies: [],
      origins: [
        {
          origin: playwrightBaseUrl,
          localStorage: [
            {
              name: 'coc_v2_changelog_daily_view',
              value: JSON.stringify({
                localDate: currentLocalDate,
                latestUpdateId: '2026-07-27-v1.0.0-official-release',
              }),
            },
          ],
        },
      ],
    },
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
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

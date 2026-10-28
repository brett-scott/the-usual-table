import { defineConfig, devices } from '@playwright/test';
const webPort = process.env.E2E_WEB_PORT || '5173';
const apiPort = process.env.E2E_API_PORT || '8787';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: true,
  use: { baseURL: `http://127.0.0.1:${webPort}${process.env.E2E_BASE_PATH || '/'}`, trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} },
  projects: [
    { name: 'desktop', testIgnore: '**/mobile-fit.spec.ts', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', testIgnore: '**/mobile-fit.spec.ts', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', viewport: { width: 360, height: 780 } } },
    { name: 'iphone16', use: { ...devices['iPhone 16'], defaultBrowserType: 'chromium', viewport: { width: 393, height: 852 } } },
    { name: 'landscape', testIgnore: '**/mobile-fit.spec.ts', use: { ...devices['Desktop Chrome'], viewport: { width: 740, height: 360 } } },
  ],
  webServer: [{
    cwd: './apps/web',
    command: `node ../../node_modules/vite/bin/vite.js ${process.env.E2E_PREVIEW ? 'preview' : ''} --host 127.0.0.1 --port ${webPort} --strictPort`,
    env: { VITE_BASE_PATH: process.env.E2E_BASE_PATH || '/', VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}` },
    url: `http://127.0.0.1:${webPort}${process.env.E2E_BASE_PATH || '/'}`,
    reuseExistingServer: !process.env.CI && !process.env.E2E_PREVIEW,
  }, {
    cwd: './apps/server',
    command: `node ../../node_modules/wrangler/bin/wrangler.js dev --local --ip 127.0.0.1 --port ${apiPort} --persist-to .wrangler/e2e-state --var ALLOWED_ORIGINS:http://127.0.0.1:${webPort},http://localhost:${webPort}`,
    url: `http://127.0.0.1:${apiPort}/api/v1/health`,
    reuseExistingServer: !process.env.CI && !process.env.E2E_PREVIEW,
    timeout: 60_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  }],
});

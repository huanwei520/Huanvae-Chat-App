import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/test-results',
  snapshotDir: './e2e/snapshots',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['html', { outputFolder: 'playwright-report' }], ['github']]
    : [['html', { outputFolder: 'playwright-report' }]],

  // Increase timeout for screenshot stability checks (default 5s too short for first-run baseline generation)
  expect: {
    toHaveScreenshot: {
      timeout: 15_000,
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    },
  },

  use: {
    // 用 'localhost' 让 OS 自动选 IPv4/IPv6，避免 vite 仅绑 IPv6 [::1] 时探测 127.0.0.1 失败
    baseURL: 'http://localhost:1420',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // Vite dev server auto-start
  webServer: {
    command: 'npx vite dev --port 1420',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: 'animation-health.spec.ts',
    },
    // Animation health tests — Chromium only (requires CDP)
    {
      name: 'animation-health',
      use: { ...devices['Desktop Chrome'] },
      testMatch: 'animation-health.spec.ts',
    },
  ],
});

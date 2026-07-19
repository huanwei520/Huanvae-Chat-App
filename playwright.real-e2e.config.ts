import { defineConfig, devices } from '@playwright/test';

/**
 * real-e2e(L2.5-web) 专用 Playwright 配置 —— 与主 playwright.config.ts 完全隔离：
 * 存量 CI 的 `pnpm test:e2e`（裸 playwright test，默认主 config）永远看不到本项目，
 * 需本地 e2e 集群（nginx 18801/18802 钉双后端实例）在位，用 `pnpm e2e:real` 显式运行。
 * 双 vite dev（14301→钉A、14302→钉B）经 env 注入 VITE_E2E_BASE_URL，两个 browser context
 * 分别指向两个 origin，实现用户A/用户B 钉不同后端实例的跨实例语义。
 */
export default defineConfig({
  testDir: './e2e-real',
  globalSetup: './e2e-real/helpers/global-warmup.ts',
  outputDir: './e2e-real/test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-real', open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npx vite dev --port 14301 --strictPort',
      url: 'http://localhost:14301',
      reuseExistingServer: false,
      timeout: 30_000,
      env: { VITE_E2E_BASE_URL: 'http://127.0.0.1:18801' },
    },
    {
      command: 'npx vite dev --port 14302 --strictPort',
      url: 'http://localhost:14302',
      reuseExistingServer: false,
      timeout: 30_000,
      env: { VITE_E2E_BASE_URL: 'http://127.0.0.1:18802' },
    },
  ],
  projects: [
    {
      name: 'real-e2e',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            // 流程8 WebRTC：双 context 回环 ICE 需真实本地 IP 候选，禁用 mDNS 主机候选混淆
            // （仅影响 WebRTC 本地 IP 暴露，与流程 1-7/10 无关）
            '--disable-features=WebRtcHideLocalIpsWithMdns',
          ],
        },
      },
    },
  ],
});

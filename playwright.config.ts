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

  // 每条用例的时间预算（Playwright 顶层 `timeout`，默认 30_000）。
  //
  // 为什么必须显式放大到 120s：本仓开发机的工作树在 virtiofs 共享盘上，IO 比本地盘慢一到两个数量级。
  // 冷态（`node_modules/.vite` 依赖预打包缓存被清掉、模块图尚未转译过）下 vite dev 要现场转译整张
  // 模块图，而 `fullyParallel` + 4 workers 会让最先起跑的 4 条用例同时 `page.goto` 抢这一次转译 ——
  // 单条 goto 实测卡在 `navigating to "http://localhost:1420/", waiting until "load"` 超过 30s 而被
  // 判超时，报文即 `Test timeout of 30000ms exceeded`。
  //
  // 2026-08-12 冷态 A/B 实测（同机、同盘、每轮前均清 node_modules/.vite 并确认 1420 端口空闲）：
  //   - 改前（顶层 timeout 缺省 30s）：8 failed / 23 passed / 2 skipped，整轮 2:10.76，
  //     12 次 `Test timeout of 30000ms exceeded`，`Timed out waiting .* from config.webServer` 命中 0 次
  //   - 改后（本处 120s）：1 failed / 30 passed / 2 skipped，整轮 2:14.58，
  //     超时类报文 **0 次**；唯一的 failed 是 visual-regression.spec.ts:85 那条 register 截图
  //     （与本项无关的既有 flaky，A 轮同样条件下反而通过，详见下方 expect.timeout 注释与交付记录）
  //   - 暖态（模块图已转译过）：0 failed / 31 passed / 2 skipped，整轮 1:36.69
  //   - vite dev server 自身就绪只要 ~4s —— 所以瓶颈不在 webServer 启动，而在首次转译，
  //     即"每条用例"的预算，不是"等 server 起来"的预算。
  // 取 120s 的依据：30s 实测不够（冷态必超），120s 实测够（冷态零超时）。
  // ⚠️ goto 的真实耗时上界并未测得 —— 它在 30s 就被判超时杀掉了，故 120s 是"够用且留余量"的
  // 工程取值，不是"实测上界 ×4"。这是放宽"等待"的预算，不放宽任何断言强度。
  timeout: 120_000,

  expect: {
    // 自动重试型断言（含 toHaveScreenshot）的"等画面稳定"重试窗。
    //
    // 🔴 2026-08-12 查实并顺手修正的既有缺陷：原配置把 `timeout: 15_000` 写在下面的
    // `toHaveScreenshot` 块里，并配注释 "default 5s too short for first-run baseline generation"。
    // 但 Playwright 1.60 的 `expect.toHaveScreenshot` 配置**根本没有 `timeout` 这个键**
    // ——合法键只有 threshold / maxDiffPixels / maxDiffPixelRatio / animations / caret /
    // scale / stylePath / pathTemplate（见 playwright/types/test.d.ts:191-240）。
    // 该键被静默忽略，真正生效的一直是本层 `expect.timeout` 的默认值 **5000ms**：
    // 也就是说那条注释想解决的问题，实际上从未被解决过。
    // 正确的键是本层的 `expect.timeout`，故在此显式放宽到 30s（冷态首帧渲染 + 首次基线生成更慢）。
    //
    // ⚠️ 只放宽"等稳定"的时间，不放宽任何断言强度：更长的重试窗只是给页面更多机会渲染到稳定态，
    // 最终仍按同样的 maxDiffPixelRatio 比对像素 —— 真实的 UI 回归照样会失败，不会被洗白。
    timeout: 30_000,
    toHaveScreenshot: {
      animations: 'disabled',
      // 注：各 spec 多以 per-call opts 覆盖本项（visual-regression.spec.ts 用 0.02 / 0.15）
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
    // 纵深防御，非本次故障的触发项：2026-08-12 冷态实测本机 vite dev ~4s 就绪，
    // 30s 从未被触到（A 轮 `Timed out waiting .* from config.webServer` 命中 0 次）。
    // 但更冷的机器上 vite 首次依赖预打包（esbuild optimizeDeps）可能远超 30s，
    // 届时报文会是完全不同的一句、且在任何用例开跑前就中止整轮 —— 放宽到 180s 兜住这一形态。
    timeout: 180_000,
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

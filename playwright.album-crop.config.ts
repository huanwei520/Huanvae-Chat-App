import { defineConfig, devices } from '@playwright/test';

/**
 * 相册 / 查找记录九宫格「每一张都要完整可见」的**真实浏览器像素判据**专用配置。
 *
 * 为什么必须单开一份 config（不是往 playwright.config.ts 里加 project）：
 * 存量 `.github/workflows/test.yml` 的 e2e-tests job 裸跑 `pnpm test:e2e`（= `playwright test`，
 * 主 config）。往主 config 的 projects 里加东西 = 公开仓 CI 会去跑它。
 * 见 .claude/rules/frontend-test.md 末节「与存量 GitHub CI 的隔离（红线，勿破坏）」。
 *
 * 隔离靠两件事，缺一不可：
 *   1. 主 config 的 `testDir` 是 './e2e'，本 config 是 './e2e-album' —— 两棵目录树不相交，
 *      主 config 扫不到本目录下的 spec（自检：`npx playwright test --list` 里 grep 不到 album-crop）。
 *   2. **不动 package.json** —— `test:e2e` / `test:animation` / `e2e:real` 三个脚本一个字未改，
 *      没有任何既有入口会跑到这里。本套用例的入口只有一条显式命令：
 *      `npx playwright test --config playwright.album-crop.config.ts`
 *
 * 不需要 webServer：用例全部靠 `page.setContent` 直接注入真实 CSS + 固定 DOM，
 * 不加载 App，也就不依赖 vite dev（顺带让它在无 dev server 的机器上也能跑）。
 *
 * 产物落仓外 /private/tmp，避免污染工作树（本仓 .gitignore 没有对应条目，
 * 落仓内就得改 .gitignore，而那不在本单的文件边界内）。
 */
export default defineConfig({
  testDir: './e2e-album',
  outputDir: '/private/tmp/app-album-crop/pw-out',

  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],

  // 本机工作树在 virtiofs 共享盘上，冷态 IO 比本地盘慢一到两个数量级；
  // 与主 config 同口径放到 120s（那边有实测依据，见其 timeout 注释）。
  timeout: 120_000,

  use: {
    ...devices['Desktop Chrome'],
    // 像素判据要按 CSS px 取样，缩放必须锁死
    deviceScaleFactor: 1,
  },
});

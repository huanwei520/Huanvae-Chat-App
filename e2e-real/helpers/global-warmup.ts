/**
 * real-e2e(L2.5-web) globalSetup —— 预热两个 vite dev origin 的「按需源码转译」内存缓存。
 *
 * 背景：本 VM 共享盘(virtiofs)冷 IO 下,每次 `pnpm e2e:real` 起 fresh vite server,首个页面
 * 加载要按需转译整张静态模块图(main.tsx → App + StockPage + 全部静态 import),耗时约 35s;
 * 并发管线负载下偶发把页面加载顶到超时 / 触发 vite `504 (Outdated Optimize Dep)` → 首个真跑
 * 用例(尤其隔离 `--grep` 时的唯一用例)不稳。预热把这一次性冷启成本移到 globalSetup(受控、
 * 带 reload 重试),之后所有用例命中暖转译缓存 → 快且稳。**不改任何 src/ 产品代码,不改断言。**
 *
 * best-effort：预热失败仅 warn 不抛(不阻断整套);失败时用例回退到自付冷启(与加本文件前一致)。
 */
import { chromium, expect, type FullConfig } from '@playwright/test';
import { tauriE2EBridgeScript } from '../../e2e/helpers/tauri-e2e-bridge';

/** 双 vite dev origin：14301 钉实例A、14302 钉实例B（与 spec 中一致） */
const ORIGINS = ['http://localhost:14301', 'http://localhost:14302'];

async function warmOrigin(browser: import('@playwright/test').Browser, origin: string): Promise<void> {
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  // 注入 Tauri 桥,让 app 能 boot 到登录页(#user-id)——与真跑用例同一启动路径,确保静态模块图被转译。
  await page.addInitScript(tauriE2EBridgeScript());
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // 冷启转译期偶发 vite 504 → reload 后 vite 已完成转译,重试可恢复。
      await page.goto('/', { timeout: 60_000, waitUntil: 'commit' });
      await expect(page.locator('#user-id')).toBeVisible({ timeout: 90_000 });
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      await page.waitForTimeout(1_000);
    }
  }
  await context.close();
  if (lastErr) {
    // best-effort：不抛,只 warn(用例回退自付冷启)
    console.warn(`[global-warmup] 预热 ${origin} 未完成(用例将回退自付冷启): ${String(lastErr)}`);
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const browser = await chromium.launch();
  try {
    // 两个 origin 是各自独立的 vite 进程(独立转译缓存),并行预热省时。
    await Promise.all(ORIGINS.map((origin) => warmOrigin(browser, origin)));
  } finally {
    await browser.close();
  }
}

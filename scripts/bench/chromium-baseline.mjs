/**
 * 浏览器对照组：用 Playwright 的 Chromium 单连接拉同一个 URL，与 download-bench 同机同 URL 对照。
 *
 * 为什么要它：download-bench 量的是「我们的 reqwest 客户端」；只有拿一个**独立实现**
 * （浏览器自己的网络栈）在同一条链路上做对照，才能判断「慢」是我们的问题还是链路的上限。
 * 这正是 .claude/rules/downloader-decision.md 那张表里 Chromium 那一列的来源。
 *
 * 用法：
 *   BENCH_URL='https://<公开更新源>/<产物>' node scripts/bench/chromium-baseline.mjs [轮数]
 *
 * 🔴 PUBLIC 仓：URL 只经 BENCH_URL 注入，脚本内不写任何默认地址。
 * 🔴 拿不到浏览器时**显式报错退出（rc=3）**，绝不静默跳过 —— 「没跑」不许伪装成「跑过了」。
 */
import { chromium } from '@playwright/test';

const url = process.env.BENCH_URL;
if (!url) {
  console.error('错误：必须设 BENCH_URL（本仓公开，脚本不内置任何默认 URL）');
  process.exit(2);
}
const rounds = Number(process.argv[2] ?? 5);

let browser;
try {
  browser = await chromium.launch();
} catch (e) {
  console.error(`拿不到 Chromium（未 install 或环境不支持）：${e instanceof Error ? e.message : e}`);
  console.error('这是「未执行」，不是「通过」。装浏览器：pnpm exec playwright install chromium');
  process.exit(3);
}

const page = await browser.newPage();
// 用 about:blank 起页面，再在页面上下文里 fetch —— 走的是 Chromium 自己的网络栈（h2 + 它自己的流控）
await page.goto('about:blank');

const samples = [];
for (let i = 0; i < rounds; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  const r = await page.evaluate(async (u) => {
    const t0 = performance.now();
    const resp = await fetch(u, { cache: 'no-store' });
    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}` };
    }
    const reader = resp.body.getReader();
    let bytes = 0;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
    }
    return { ok: true, bytes, ms: performance.now() - t0 };
  }, url);

  if (!r.ok) {
    console.error(`round ${i}: FAILED ${r.error}`);
    continue;
  }
  const mbps = r.bytes / 1048576 / (r.ms / 1000);
  samples.push({ round: i, bytes: r.bytes, ms: r.ms, mbps });
  console.error(`round ${i}: ${mbps.toFixed(2)} MB/s (${r.ms.toFixed(0)}ms, ${r.bytes} B)`);
  // eslint-disable-next-line no-await-in-loop
  await new Promise((resolve) => { setTimeout(resolve, 800); });
}

await browser.close();

if (samples.length === 0) {
  console.error('全部轮次失败，无对照数字');
  process.exit(1);
}
const sorted = samples.map((s) => s.mbps).sort((a, b) => a - b);
const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
  : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
console.error(`\n===== Chromium 单连接对照（中位数）=====\n  ${median.toFixed(2)} MB/s（${samples.length} 轮）`);
console.log(JSON.stringify({ variant: 'chromium-single', rounds: samples.length, median_mbps: median, samples }, null, 2));

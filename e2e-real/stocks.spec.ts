/**
 * real-e2e(L2.5-web) 流程10 股票只读 —— 种子灌 stock_ 表 + /stocks 路由直开 + 精确值渲染 + 404 优雅降级. 非 L3 真机.
 *
 * 数据面：/stocks 是 pathname 子窗口（main.tsx 仅 ThemeProvider 包裹 StockPage，无 Session/WS），
 * 经 page.goto('/stocks?userId&serverUrl&accessToken&refreshToken')（后三者 base64）在 ORIGIN_A 直开；
 * StockPage 自建 ApiClient(baseUrl=serverUrl) 经原生 fetch 打 INSTANCE_A 的 /api/stocks/*（e2e 模式）。
 *
 * 种子（beforeAll）经 psql 写本地隔离栈 PG 的 stock_market_regime / stock_rankings /
 * stock_quote_snapshots / stock_kline_snapshots（列名双引号 kebab-case），固定业务日 2099-12-31 保证"最新"，
 * 每次运行用唯一 symbol（TA…/TB…）。E2E_PG_URL 缺失即抛错（不硬编码任何库凭据——PUBLIC 仓）。
 *
 * 运行：`pnpm e2e:real`（需本地集群 + PG 在位，且注入 E2E_PG_URL）。Reviewer 跑，本文件只创建不运行。
 */

import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { setupTauriE2EBridge } from '../e2e/helpers/tauri-e2e-bridge';
import { INSTANCE_A, registerUser, loginUser } from './helpers/backend-api';

/** vite dev origin：14301 钉实例A(18801=INSTANCE_A)，e2e 模式 HTTP 走原生 fetch 直打集群 */
const ORIGIN_A = 'http://localhost:14301';
const PASSWORD = 'pw123456';

/** 每次运行唯一 symbol（TA…=有 quote+kline / TB…=有排名但无 quote/kline → 详情 K 线走 404 降级） */
const STAMP = Date.now().toString(36).slice(-6).toUpperCase();
const SYM1 = `TA${STAMP}`;
const SYM2 = `TB${STAMP}`;

/** beforeAll 里注册用户 + 编码后得到的 /stocks 子窗口路径（含 4 个必需 query 参数） */
let stocksPath = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // ① PG 连接串必须由运行时注入（PUBLIC 仓不硬编码库凭据）；缺失 = 无法种子 → fail-loud
  const pgUrl = process.env.E2E_PG_URL;
  if (!pgUrl) {
    throw new Error(
      'E2E_PG_URL 未注入，无法种子 stock_ 表；请运行时注入本地隔离栈 PG 连接串',
    );
  }

  // ② 种子 stock_ 四表（列名双引号 kebab-case；固定 as-of=2099-12-31 保证 latest）。
  //    stock_rankings 先 DELETE 当日再 INSERT，保证榜单恰为本次两条；其余 ON CONFLICT 幂等更新。
  const seedSql = `
DELETE FROM "stock_rankings" WHERE "as-of"='2099-12-31';
INSERT INTO "stock_market_regime"("as-of","market","index-symbol","regime","weather-label","confidence","hmm-state","posterior","features","breadth","sentiment","flags","model","disclaimer","generated-at")
VALUES ('2099-12-31','cn','000300','bear','阴雨',0.72,0,
 '{"bull":0.08,"range":0.20,"bear":0.72}'::jsonb,'{"ret":-0.0123}'::jsonb,
 '{"adv":1818,"dec":3398,"unchanged":93,"limit_up":21,"limit_down":8,"breadth_pct":0.342,"adr":0.535}'::jsonb,
 '{"fear_greed":28.0,"label":"恐惧","drivers":["外围扰动"],"model":"m"}'::jsonb,
 '[{"code":"divergence","text":"指数跌但普跌"}]'::jsonb,'hmm@v1','市场天气仅供参考',NOW())
ON CONFLICT ("as-of","market") DO UPDATE SET "regime"=EXCLUDED."regime","weather-label"=EXCLUDED."weather-label","confidence"=EXCLUDED."confidence","breadth"=EXCLUDED."breadth","sentiment"=EXCLUDED."sentiment","flags"=EXCLUDED."flags";
INSERT INTO "stock_rankings"("as-of","symbol","rank","name","market","score","reasons","price-at-ranking","model","generated-at")
VALUES ('2099-12-31','${SYM1}',1,'种子茅台X','cn',92.0,'["种子测试"]'::jsonb,10.0,'m',NOW()),
       ('2099-12-31','${SYM2}',2,'种子无K线X','cn',88.0,'[]'::jsonb,NULL,'m',NOW());
INSERT INTO "stock_quote_snapshots"("market","symbol","payload","as-of","fetched-at")
VALUES ('cn','${SYM1}','{"symbol":"${SYM1}","name":"种子茅台X","market":"cn","price":1194.45,"prev_close":1190.0,"change":4.45,"change_pct":0.3739,"volume":4520000.0,"amount":5395740017.05,"bid_ask":{"available":true,"bids":[{"price":1194.4,"volume":12}],"asks":[{"price":1194.5,"volume":15}]},"timestamp":"2099-12-31 15:00:00"}'::jsonb,NOW(),NOW())
ON CONFLICT ("market","symbol") DO UPDATE SET "payload"=EXCLUDED."payload";
INSERT INTO "stock_kline_snapshots"("market","symbol","period","adjust","payload","as-of","fetched-at")
VALUES ('cn','${SYM1}','daily','qfq','{"symbol":"${SYM1}","market":"cn","name":"种子茅台X","currency":"CNY","candles":[{"timestamp":1751500800000,"open":1190.0,"high":1200.5,"low":1188.0,"close":1194.45,"volume":4520000.0,"amount":5395740017.05}],"indicators":{"ma":{"ma5":[null]}}}'::jsonb,NOW(),NOW())
ON CONFLICT ("market","symbol","period","adjust") DO UPDATE SET "payload"=EXCLUDED."payload";
`;

  try {
    execSync(`psql "${pgUrl}" -v ON_ERROR_STOP=1`, {
      input: seedSql,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
  } catch (e) {
    // 停 PG / 连不上 / SQL 出错 → psql 非零退出 → execSync 抛 → 整测 FAIL（fail-loud）
    const err = e as { stderr?: string; stdout?: string; message?: string };
    throw new Error(
      `[stocks.spec] psql 种子 stock_ 表失败（PG 不可达或 SQL 出错）: ${err.stderr || err.message || String(e)}`,
    );
  }

  // ③ 注册 + 登录一个新用户于 INSTANCE_A，token 带入子窗口（serverUrl/token/refreshToken 均 base64）
  const uid = `st${Date.now().toString(36)}`;
  await registerUser(INSTANCE_A, uid, `昵称${uid}`, PASSWORD);
  const token = await loginUser(INSTANCE_A, uid, PASSWORD);

  const params = new URLSearchParams({
    userId: uid,
    serverUrl: btoa(INSTANCE_A),
    accessToken: btoa(token),
    refreshToken: btoa('x'),
  });
  stocksPath = `/stocks?${params.toString()}`;
});

test('流程10 股票只读：市场天气/榜单/K线 精确值渲染', async ({ page }) => {
  // 自证：改 close/price 种子值或错断言即 FAIL；停 PG 则 seed beforeAll 抛错整测 FAIL
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log(`[flow10][console.error] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => console.log(`[flow10][pageerror] ${err.message}`));

  await setupTauriE2EBridge(page); // 必须在 goto 前注入 Tauri 桥
  await page.goto(ORIGIN_A + stocksPath);

  // —— 市场天气：精确种子值 —— //
  await expect(page.locator('.market-weather-label')).toHaveText('阴雨', { timeout: 15_000 });
  await expect(page.locator('.market-weather-hero')).toHaveAttribute('data-regime', 'bear');
  await expect(page.locator('.market-weather-confidence')).toContainText('72%');
  // 广度：涨家数 adv=1818（同块内另有"涨停 21"故 filter 到确切文案）
  await expect(
    page
      .locator('.market-weather-breadth .stock-dir--up.stock-num')
      .filter({ hasText: '涨 1818' }),
  ).toBeVisible();

  // —— 榜单：rank1 卡（SYM1）精确种子值 —— //
  const rank1 = page.locator('.stock-rank-card', { hasText: SYM1 });
  await expect(rank1).toBeVisible({ timeout: 15_000 });
  await expect(rank1.locator('.stock-rank-title')).toHaveText('种子茅台X');
  await expect(rank1.locator('.stock-rank-symbol')).toHaveText(SYM1);
  await expect(rank1.locator('.stock-score-value')).toHaveText('92.0');

  // —— 详情：点开 rank1 → quote 精确价（GSAP 写入 .stock-price）+ K 线 canvas —— //
  await rank1.click();
  await expect(page.locator('.stock-price')).toHaveText('1194.45', { timeout: 15_000 });
  await expect(page.locator('.stock-kline-canvas')).toBeVisible();
});

test('流程10b K线 404 优雅降级', async ({ page }) => {
  // 自证：SYM2 无 kline 快照 → 后端 404 → 优雅灰字空态，非红字错误
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log(`[flow10b][console.error] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => console.log(`[flow10b][pageerror] ${err.message}`));

  await setupTauriE2EBridge(page);
  await page.goto(ORIGIN_A + stocksPath);

  // rank2 卡（SYM2）：有排名、无 quote/kline 快照
  const rank2 = page.locator('.stock-rank-card', { hasText: SYM2 });
  await expect(rank2).toBeVisible({ timeout: 15_000 });
  await rank2.click();

  // K 线端点 404「快照不存在」→ gracefulNotFound → 灰字空态「暂无 K 线数据」（重试耗尽约 10s，给足 15s）
  await expect(
    page.locator('.list-empty .conv-text', { hasText: '暂无 K 线数据' }),
  ).toBeVisible({ timeout: 15_000 });
});

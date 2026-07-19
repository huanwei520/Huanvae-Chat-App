/**
 * real-e2e(L2.5-web) 流程 1/2/3 —— 真前端 React + 真 HTTP/WS 直打本地集群 nginx
 * （18801 钉后端实例A / 18802 钉实例B），Tauri 本地面由 tauri-e2e-bridge 桩。
 *
 * - 流程2：注册/登录黄金路径（UI 驱动，ORIGIN_A）
 * - 流程1：WS 跨实例推送（A 经实例A API 发消息 → Redis 总线 → 实例B → B 的原生 WS）
 * - 流程3：好友消息收发/撤回/删除闭环（双页面 UI 驱动，C 钉A / D 钉B）
 *
 * 运行：`pnpm e2e:real`（需本地集群在位）。账号随机生成，非真实凭据，不清理。
 */

import { test, expect, Browser, Page, BrowserContext } from '@playwright/test';
import { setupTauriE2EBridge } from '../e2e/helpers/tauri-e2e-bridge';
import {
  INSTANCE_A,
  INSTANCE_B,
  registerUser,
  loginUser,
  sendFriendRequest,
  approveFriendRequest,
  sendTextMessage,
} from './helpers/backend-api';

/** 双 vite dev origin：14301 钉实例A(18801)、14302 钉实例B(18802) */
const ORIGIN_A = 'http://localhost:14301';
const ORIGIN_B = 'http://localhost:14302';

const PASSWORD = 'pw123456';

/** 每次运行随机的账号后缀（字母数字） */
const run = Date.now().toString(36);

interface AppPage {
  context: BrowserContext;
  page: Page;
}

/**
 * 新开 context+page：先注入 Tauri 桥（必须在 goto 前），并把 console error /
 * pageerror 打到 stdout 便于分辨 spec 问题 vs 基建问题（bridge fail-loud 抛错）。
 */
async function newAppPage(browser: Browser, origin: string, tag: string): Promise<AppPage> {
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log(`[${tag}][console.error] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    console.log(`[${tag}][pageerror] ${err.message}`);
  });
  await setupTauriE2EBridge(page);
  return { context, page };
}

interface WsWatch {
  /** 捕获到的数据面 WS url（含 /ws?token=） */
  url: () => string | null;
  /** 等到服务器首帧 "type":"connected" */
  waitConnected: () => Promise<void>;
}

/** 监听页面原生 WebSocket：捕获 /ws?token= 连接 + 等 "type":"connected" 首帧。goto 前调用。 */
function watchDataPlaneWs(page: Page): WsWatch {
  let capturedUrl: string | null = null;
  let resolved = false;
  let resolveConnected: () => void;
  const connected = new Promise<void>((resolve) => {
    resolveConnected = resolve;
  });
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/ws?token=')) {
      return;
    }
    capturedUrl = ws.url();
    ws.on('framereceived', (frame) => {
      const payload =
        typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf-8');
      if (!resolved && payload.includes('"type":"connected"')) {
        resolved = true;
        resolveConnected();
      }
    });
  });
  return {
    url: () => capturedUrl,
    waitConnected: () => connected,
  };
}

/** UI 登录（已注册账号）：填表 → 登陆 → 等主界面 */
async function loginViaUI(page: Page, userId: string, password: string): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#user-id')).toBeVisible({ timeout: 60_000 });
  await page.locator('#user-id').fill(userId);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: '登陆' }).click();
  await expect(page.locator('.chat-app')).toBeVisible({ timeout: 30_000 });
}

/** 切到好友 tab 并点开与 peer 的聊天（等输入框出现） */
async function openFriendChat(page: Page, peerUserId: string): Promise<void> {
  await page.locator(`.nav-btn[title="好友"]`).click();
  const card = page.locator(`[data-conv-key="friend-${peerUserId}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.click();
  await expect(page.locator('textarea[placeholder^="输入消息"]')).toBeVisible({
    timeout: 15_000,
  });
}

/** 在已打开的聊天里用输入框 + Enter 发文本消息 */
async function sendMessageViaUI(page: Page, content: string): Promise<void> {
  const input = page.locator('textarea[placeholder^="输入消息"]');
  await input.fill(content);
  await input.press('Enter');
}

/** 右键自己的消息气泡 → 点上下文菜单项（撤回 / 删除；无确认弹窗，点击即执行） */
async function clickOwnMessageMenuItem(
  page: Page,
  content: string,
  itemText: '撤回' | '删除',
): Promise<void> {
  const bubble = page
    .locator('.message-row.own', { hasText: content })
    .locator('.message-bubble');
  const item = page
    .locator('.message-context-menu .context-menu-item')
    .filter({ hasText: itemText });
  // 右键菜单在页面滚动时会自动关闭（产品行为：MessageContextMenu 的 document 级 scroll 监听）。
  // 消息列表偶发自动滚动（WS 重连补同步 / 列表高度变化）会与「打开菜单→点击项」竞态，使菜单在点击
  // 落地前 detach。这里把「右键打开 → 等菜单项可见 → 点击」作为一个整体有界重试：菜单若在点中前被
  // 关掉，则重新右键再点。不改任何断言语义（撤回/删除结果仍由调用方原样校验），仅让交互对该竞态健壮。
  await expect(async () => {
    // 源气泡已不在（上一轮点击其实已触发撤回/删除，菜单关闭前动作已生效）→ 视为成功，避免空转到超时。
    if ((await bubble.count()) === 0) {
      return;
    }
    await bubble.click({ button: 'right' });
    await expect(item).toBeVisible({ timeout: 3_000 });
    await item.click({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

test.describe.configure({ mode: 'serial' });

test('流程2：注册/登录黄金路径（UI 驱动，ORIGIN_A）', async ({ browser }) => {
  const userC = `w2c${run}`;
  const { context, page } = await newAppPage(browser, ORIGIN_A, 'flow2');
  const ws = watchDataPlaneWs(page);

  await page.goto('/');

  // 无保存账号 → 登录页；进注册两步表单
  await page.getByRole('button', { name: '注册新账号' }).click({ timeout: 60_000 });
  await expect(page.locator('#reg-user-id')).toBeVisible({ timeout: 10_000 });
  await page.locator('#reg-user-id').fill(userC);
  await page.locator('#reg-nickname').fill(`昵称${userC}`);
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.locator('#reg-password')).toBeVisible({ timeout: 10_000 });
  await page.locator('#reg-password').fill(PASSWORD);
  await page.locator('#reg-confirm-password').fill(PASSWORD);
  await page.getByRole('button', { name: '注册', exact: true }).click();

  // 注册成功 → 自动登录进主界面
  await expect(page.locator('.chat-app')).toBeVisible({ timeout: 30_000 });

  // 原生数据面 WS 已建（url 含 /ws?token=）且收到服务器首帧 "type":"connected"
  await ws.waitConnected();
  expect(ws.url()).toContain('/ws?token=');

  // 列表渲染成功：AI 助手置顶卡可见
  await expect(page.locator('[data-conv-key="ai-assistant"]')).toBeVisible({
    timeout: 10_000,
  });

  await context.close();
});

test('流程1：WS 跨实例推送 — A(实例A) API 发消息，B(实例B) 未开聊天收到未读+1 与消息', async ({
  browser,
}) => {
  const userA = `w1a${run}`;
  const userB = `w1b${run}`;
  const MSG1 = `cross-instance-msg-${run}-${Math.random().toString(36).slice(2, 8)}`;

  // API setup：A 注册于实例A、B 注册于实例B；建立好友关系（A→B 请求，B 同意）
  await registerUser(INSTANCE_A, userA, `昵称${userA}`, PASSWORD);
  await registerUser(INSTANCE_B, userB, `昵称${userB}`, PASSWORD);
  const tokenA = await loginUser(INSTANCE_A, userA, PASSWORD);
  const tokenB = await loginUser(INSTANCE_B, userB, PASSWORD);
  await sendFriendRequest(INSTANCE_A, tokenA, userA, userB);
  await approveFriendRequest(INSTANCE_B, tokenB, userB, userA);

  // B 在 ORIGIN_B UI 登录，等主界面 + WS connected；不打开与 A 的聊天
  const { context, page } = await newAppPage(browser, ORIGIN_B, 'flow1-B');
  const ws = watchDataPlaneWs(page);
  await loginViaUI(page, userB, PASSWORD);
  await ws.waitConnected();

  // A 经实例A API 发消息 → Redis 总线 → 实例B → B 的 WS
  await sendTextMessage(INSTANCE_A, tokenA, userB, MSG1);

  // ① 消息 tab（默认 tab）出现会话卡且未读徽章为 1
  const convCard = page.locator(`[data-conv-key="friend-${userA}"]`);
  await expect(convCard).toBeVisible({ timeout: 15_000 });
  await expect(convCard.locator('.conv-unread.visible')).toHaveText('1', {
    timeout: 15_000,
  });

  // ② 点开会话卡 → 消息气泡区出现 MSG1
  await convCard.click();
  await expect(
    page.locator('.message-row .bubble-text', { hasText: MSG1 }),
  ).toBeVisible({ timeout: 15_000 });

  await context.close();
});

test('流程3：好友消息收发/撤回/删除闭环（C 钉实例A / D 钉实例B，双页面 UI 驱动）', async ({
  browser,
}) => {
  const userC = `w3c${run}`;
  const userD = `w3d${run}`;
  const rand = () => Math.random().toString(36).slice(2, 8);
  const MSG_CD = `msg-c-to-d-${run}-${rand()}`;
  const MSG_DC = `msg-d-to-c-${run}-${rand()}`;
  const MSG_DEL = `msg-c-del-${run}-${rand()}`;

  // API setup：C(实例A) / D(实例B) 注册并互为好友
  await registerUser(INSTANCE_A, userC, `昵称${userC}`, PASSWORD);
  await registerUser(INSTANCE_B, userD, `昵称${userD}`, PASSWORD);
  const tokenC = await loginUser(INSTANCE_A, userC, PASSWORD);
  const tokenD = await loginUser(INSTANCE_B, userD, PASSWORD);
  await sendFriendRequest(INSTANCE_A, tokenC, userC, userD);
  await approveFriendRequest(INSTANCE_B, tokenD, userD, userC);

  // 双页面 UI 登录 + 各自打开彼此聊天
  const appC = await newAppPage(browser, ORIGIN_A, 'flow3-C');
  const appD = await newAppPage(browser, ORIGIN_B, 'flow3-D');
  const wsC = watchDataPlaneWs(appC.page);
  const wsD = watchDataPlaneWs(appD.page);
  await loginViaUI(appC.page, userC, PASSWORD);
  await loginViaUI(appD.page, userD, PASSWORD);
  await wsC.waitConnected();
  await wsD.waitConnected();
  await openFriendChat(appC.page, userD);
  await openFriendChat(appD.page, userC);

  // ① C → D 第一腿：C own 气泡 + D 实时收到
  await sendMessageViaUI(appC.page, MSG_CD);
  await expect(
    appC.page.locator('.message-row.own .bubble-text', { hasText: MSG_CD }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    appD.page.locator('.message-row.other .bubble-text', { hasText: MSG_CD }),
  ).toBeVisible({ timeout: 15_000 });

  // ② D → C 第二腿：两侧可见
  await sendMessageViaUI(appD.page, MSG_DC);
  await expect(
    appD.page.locator('.message-row.own .bubble-text', { hasText: MSG_DC }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    appC.page.locator('.message-row.other .bubble-text', { hasText: MSG_DC }),
  ).toBeVisible({ timeout: 15_000 });

  // ③ C 撤回 MSG_CD：C 侧出现撤回占位、气泡区原文消失；D 侧经 WS 推送同样撤回
  //    （消失断言收窄到气泡区 .bubble-text —— 会话列表预览是另一套渲染，不属本断言目标）
  await clickOwnMessageMenuItem(appC.page, MSG_CD, '撤回');
  await expect(
    appC.page.locator('.recall-system-text', { hasText: '消息已撤回' }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    appC.page.locator('.message-row .bubble-text', { hasText: MSG_CD }),
  ).toHaveCount(0, { timeout: 15_000 });
  await expect(
    appD.page.locator('.recall-system-text', { hasText: '消息已撤回' }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    appD.page.locator('.message-row .bubble-text', { hasText: MSG_CD }),
  ).toHaveCount(0, { timeout: 15_000 });

  // ④ C 发 MSG_DEL 再本地删除：C 侧消失，D 侧仍在（本地删除语义）
  await sendMessageViaUI(appC.page, MSG_DEL);
  await expect(
    appC.page.locator('.message-row.own .bubble-text', { hasText: MSG_DEL }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    appD.page.locator('.message-row.other .bubble-text', { hasText: MSG_DEL }),
  ).toBeVisible({ timeout: 15_000 });
  await clickOwnMessageMenuItem(appC.page, MSG_DEL, '删除');
  await expect(
    appC.page.locator('.message-row .bubble-text', { hasText: MSG_DEL }),
  ).toHaveCount(0, { timeout: 15_000 });
  await expect(
    appD.page.locator('.message-row.other .bubble-text', { hasText: MSG_DEL }),
  ).toBeVisible();

  await appC.context.close();
  await appD.context.close();
});

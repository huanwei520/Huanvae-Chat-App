/**
 * real-e2e(L2.5-web) 共享 UI helper —— 从 real-flows.spec.ts(W3 流程 1/2/3) 原样抽出，
 * 供 real-flows-w4.spec.ts(流程 4/5/6/7) 复用而不改动 W3 文件。
 *
 * 选择器/超时与 W3 逐字一致：数据面（HTTP/WS）走浏览器原生直打本地集群 nginx，
 * Tauri 本地面由 tauri-e2e-bridge 桩。账号随机生成，非真实凭据。
 */

import { expect, Browser, Page, BrowserContext } from '@playwright/test';
import { setupTauriE2EBridge } from '../../e2e/helpers/tauri-e2e-bridge';

/** 双 vite dev origin：14301 钉实例A(18801)、14302 钉实例B(18802) */
export const ORIGIN_A = 'http://localhost:14301';
export const ORIGIN_B = 'http://localhost:14302';

export const PASSWORD = 'pw123456';

export interface AppPage {
  context: BrowserContext;
  page: Page;
}

/**
 * 新开 context+page：先注入 Tauri 桥（必须在 goto 前），并把 console error /
 * pageerror 打到 stdout 便于分辨 spec 问题 vs 基建问题（bridge fail-loud 抛错）。
 */
export async function newAppPage(browser: Browser, origin: string, tag: string): Promise<AppPage> {
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

export interface WsWatch {
  /** 捕获到的数据面 WS url（含 /ws?token=） */
  url: () => string | null;
  /** 等到服务器首帧 "type":"connected" */
  waitConnected: () => Promise<void>;
}

/** 监听页面原生 WebSocket：捕获 /ws?token= 连接 + 等 "type":"connected" 首帧。goto 前调用。 */
export function watchDataPlaneWs(page: Page): WsWatch {
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
export async function loginViaUI(page: Page, userId: string, password: string): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#user-id')).toBeVisible({ timeout: 60_000 });
  await page.locator('#user-id').fill(userId);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: '登陆' }).click();
  await expect(page.locator('.chat-app')).toBeVisible({ timeout: 30_000 });
}

/** 切到好友 tab 并点开与 peer 的聊天（等输入框出现） */
export async function openFriendChat(page: Page, peerUserId: string): Promise<void> {
  await page.locator(`.nav-btn[title="好友"]`).click();
  const card = page.locator(`[data-conv-key="friend-${peerUserId}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.click();
  await expect(page.locator('textarea[placeholder^="输入消息"]')).toBeVisible({
    timeout: 15_000,
  });
}

/** 在已打开的聊天里用输入框 + Enter 发文本消息 */
export async function sendMessageViaUI(page: Page, content: string): Promise<void> {
  const input = page.locator('textarea[placeholder^="输入消息"]');
  await input.fill(content);
  await input.press('Enter');
}

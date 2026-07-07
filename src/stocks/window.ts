/**
 * 股票研究独立窗口 — 开窗器 + URL 编解码纯函数
 *
 * 复用 lowcode / HuanvaeGuard 独立窗口范式：
 *   - isMobile() 门控（仅桌面端）
 *   - getByLabel 聚焦已有窗口 → new WebviewWindow
 *   - 初始 token 经 URL query（base64）带入；子窗口页面自建 ApiClient
 *
 * URL 编解码抽成纯函数（buildStockWindowUrl / parseStockWindowData），
 * 避开 WebviewWindow 静态方法的测试 mock 缺口，单测零 Tauri 依赖。
 */

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isMobile } from '../utils/platform';

/** 窗口初始数据（从 URL query 解出） */
export interface StockWindowData {
  userId: string;
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
}

/** 窗口 label（getByLabel 聚焦复用） */
export const STOCK_WINDOW_LABEL = 'stocks-research';

/**
 * 构建 `/stocks` 窗口 URL（token 经 base64 编码避免特殊字符）。
 * 纯函数，便于单测。
 */
export function buildStockWindowUrl(data: StockWindowData): string {
  const params = new URLSearchParams({
    userId: data.userId,
    serverUrl: btoa(data.serverUrl),
    accessToken: btoa(data.accessToken),
    refreshToken: btoa(data.refreshToken),
  });
  return `/stocks?${params.toString()}`;
}

/**
 * 从窗口 location.search 解析初始数据；缺任一字段或解码失败返回 null。
 * 纯函数（入参为 search 串），便于单测。
 */
export function parseStockWindowData(search: string): StockWindowData | null {
  try {
    const params = new URLSearchParams(search);
    const userId = params.get('userId');
    const serverUrlB64 = params.get('serverUrl');
    const accessTokenB64 = params.get('accessToken');
    const refreshTokenB64 = params.get('refreshToken');
    if (!userId || !serverUrlB64 || !accessTokenB64 || !refreshTokenB64) {
      return null;
    }
    return {
      userId,
      serverUrl: atob(serverUrlB64),
      accessToken: atob(accessTokenB64),
      refreshToken: atob(refreshTokenB64),
    };
  } catch {
    return null;
  }
}

/**
 * 打开股票研究窗口（仅桌面端）。已有窗口则聚焦。
 */
export async function openStocksWindow(
  userId: string,
  serverUrl: string,
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  // 移动端不支持，静默返回
  if (isMobile()) {
    console.warn('[Stocks] 移动端不支持股票研究窗口');
    return;
  }

  // 已有窗口直接聚焦
  const existing = await WebviewWindow.getByLabel(STOCK_WINDOW_LABEL);
  if (existing) {
    await existing.setFocus();
    return;
  }

  const url = buildStockWindowUrl({ userId, serverUrl, accessToken, refreshToken });

  const win = new WebviewWindow(STOCK_WINDOW_LABEL, {
    url,
    title: '股票研究',
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    center: true,
    decorations: true,
    resizable: true,
    focus: true,
  });

  win.once('tauri://error', (e) => {
    console.error('[Stocks] 创建股票研究窗口失败:', e);
  });
}

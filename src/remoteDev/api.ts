/**
 * 远程开发窗口 API
 *
 * 使用 URL 查询参数在主窗口和远程开发窗口之间传递数据
 * （同 lowcode 模块，避免 Tauri WebviewWindow 间 localStorage 不共享）
 *
 * @module remoteDev/api
 */

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isMobile } from '../utils/platform';
import type { RemoteDevWindowData } from './types/remoteDev';

/**
 * 从 URL 查询参数解析窗口数据
 */
export function parseWindowDataFromUrl(): RemoteDevWindowData | null {
  try {
    const params = new URLSearchParams(window.location.search);
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
    console.error('[RemoteDev] URL 参数解析失败');
    return null;
  }
}

/**
 * 打开远程开发窗口（仅桌面端）
 */
export async function openRemoteDevWindow(
  userId: string,
  serverUrl: string,
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  if (isMobile()) {
    console.warn('[RemoteDev] 移动端不支持远程开发');
    return;
  }

  const existing = await WebviewWindow.getByLabel('remote-dev');
  if (existing) {
    await existing.setFocus();
    return;
  }

  const params = new URLSearchParams({
    userId,
    serverUrl: btoa(serverUrl),
    accessToken: btoa(accessToken),
    refreshToken: btoa(refreshToken),
  });

  const rdWindow = new WebviewWindow('remote-dev', {
    url: `/remote-dev?${params.toString()}`,
    title: '远程开发',
    width: 1300,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    center: true,
    decorations: true,
    resizable: true,
    focus: true,
  });

  rdWindow.once('tauri://error', (e) => {
    console.error('[RemoteDev] 创建窗口失败:', e);
  });
}

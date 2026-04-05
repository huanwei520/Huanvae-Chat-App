/**
 * HuanvaeGuard VPN 模块
 *
 * 功能：通过 localhost:19198 控制 Windows Service 管理 WireGuard 隧道
 * 架构：独立 Tauri 窗口运行
 */

export { default as HuanvaeGuardPage } from './HuanvaeGuardPage';
export { createHgApiClient } from './serverApi';
export { getOrCreateKeyPair, clearKeyPair } from './crypto';

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { platform } from '@tauri-apps/plugin-os';

/**
 * 打开 HuanvaeGuard 窗口（仅 Windows 桌面端）
 */
export async function openHuanvaeGuardWindow(
  userId: string,
  serverUrl: string,
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  const p = platform();
  if (p !== 'windows') {
    console.warn('[HuanvaeGuard] Only available on Windows');
    return;
  }

  const existing = await WebviewWindow.getByLabel('huanvae-guard');
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

  const win = new WebviewWindow('huanvae-guard', {
    url: `/huanvae-guard?${params.toString()}`,
    title: 'HuanvaeGuard VPN',
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    center: true,
    decorations: true,
    resizable: true,
    focus: true,
  });

  win.once('tauri://error', (e) => {
    console.error('[HuanvaeGuard] Window creation failed:', e);
  });
}

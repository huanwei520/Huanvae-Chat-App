/**
 * HuanvaeGuard VPN 模块
 *
 * 功能：通过 localhost:19198 控制 Windows Service 管理 WireGuard 隧道
 * 架构：独立 Tauri 窗口运行
 *
 * ## 窗口生命周期
 *   - Tauri 进程 setup() 时异步启动 HG Windows Service（src-tauri 侧 huanvaeguard.rs）
 *   - 用户从 Main.tsx 触发 openHuanvaeGuardWindow() 创建独立 WebviewWindow
 *   - 进程 RunEvent::Exit 时同步停止服务（释放 svc.exe 文件锁）
 *
 * ## Token 传递
 *   初值通过 URL query（base64）带入窗口；之后靠 Tauri 事件同步：
 *     - `session:tokens-updated` （主应用 SessionContext 广播，HG 监听）
 *     - `session:request-tokens` （HG 挂载时主动索要一次最新 token）
 *   注：此处仍沿用 URL query 作为初始载荷，后续迭代建议改为 Tauri IPC（P0-1）。
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

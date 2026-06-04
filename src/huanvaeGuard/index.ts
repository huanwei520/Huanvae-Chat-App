/**
 * HuanvaeGuard VPN 模块
 *
 * 功能：通过 localhost:19198 控制本机 HG 守护进程管理 WireGuard 隧道
 *   - Windows：HuanvaeGuard Windows Service（sc.exe 控制，src-tauri 侧 huanvaeguard.rs）
 *   - macOS：hg-macos LaunchDaemon（launchctl 控制，src-tauri 侧 huanvaeguard_macos.rs）
 * 架构：独立 Tauri 窗口运行
 *
 * ## 窗口生命周期
 *   - Windows：Tauri setup() 异步启动 Service；RunEvent::Exit 同步停止（释放 svc.exe 文件锁）
 *   - macOS：守护进程由 launchd 常驻托管（RunAtLoad+KeepAlive），App 仅首次触发安装
 *   - 用户从 Main.tsx 触发 openHuanvaeGuardWindow() 创建独立 WebviewWindow
 *
 * ## Token 传递
 *   初值通过 URL query（base64）带入窗口；之后靠 Tauri 事件同步：
 *     - `session:tokens-updated` （主应用 SessionContext 广播，HG 监听）
 *     - `session:request-tokens` （HG 挂载时主动索要一次最新 token）
 *   注：此处仍沿用 URL query 作为初始载荷，后续迭代建议改为 Tauri IPC（P0-1）。
 */

export { default as HuanvaeGuardPage } from './HuanvaeGuardPage';

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { platform } from '@tauri-apps/plugin-os';
import { invoke } from '@tauri-apps/api/core';

/**
 * 打开 HuanvaeGuard 窗口（Windows / macOS 桌面端）
 */
export async function openHuanvaeGuardWindow(
  userId: string,
  serverUrl: string,
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  const p = platform();
  if (p !== 'windows' && p !== 'macos') {
    console.warn('[HuanvaeGuard] Only available on Windows and macOS');
    return;
  }

  // 已有窗口直接聚焦（先于安装逻辑，避免重开窗口时重跑安装/重弹授权）
  const existing = await WebviewWindow.getByLabel('huanvae-guard');
  if (existing) {
    await existing.setFocus();
    return;
  }

  // macOS：仅在确实要新建窗口时确保 LaunchDaemon 已安装（已装瞬时返回；未装弹一次管理员授权）
  if (p === 'macos') {
    try {
      await invoke<boolean>('hg_ensure_installed');
    } catch (e) {
      // 安装失败 / 用户取消授权：仍打开窗口，HG 页可点「安装/修复服务」重试
      console.warn('[HuanvaeGuard] LaunchDaemon 安装未完成:', e);
    }
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

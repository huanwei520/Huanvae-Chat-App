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

/** invoke 抛出的错误统一转成可展示文本（Tauri command 的 Err(String) 会以 string 抛出）。*/
export function describeInvokeError(e: unknown): string {
  if (typeof e === 'string') { return e; }
  if (e instanceof Error) { return e.message; }
  return String(e);
}

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
  // 安装失败 / 用户取消授权时仍然开窗（HG 页才是重试入口），但失败原因**不再被吞掉**：
  // 随窗口 URL 带进去，由 HG 页显示成错误横幅 + 日志。此前只 console.warn，
  // 普通用户看不到控制台，界面上只剩一句"服务未运行"，无从判断该重试授权还是查日志。
  let installError = '';
  if (p === 'macos') {
    try {
      await invoke<boolean>('hg_ensure_installed');
    } catch (e) {
      installError = describeInvokeError(e);
    }
  }

  const params = new URLSearchParams({
    userId,
    serverUrl: btoa(serverUrl),
    accessToken: btoa(accessToken),
    refreshToken: btoa(refreshToken),
  });
  // 明文传递：报错含中文，btoa 会抛（非 Latin1）。URLSearchParams 自动百分号编码，
  // 页面侧 params.get() 自动解码。无错误时不带该参数。
  if (installError !== '') {
    params.set('installError', installError);
  }

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

/**
 * HuanvaeGuard VPN 模块
 *
 * 功能：通过回环控制端口（127.0.0.1，端口由 Rust 侧解析给出、默认 19198，见 localApi.ts）
 *      控制本机 HG 守护进程管理 WireGuard 隧道
 *   - Windows：HuanvaeGuard Windows Service（sc.exe 控制，src-tauri 侧 huanvaeguard.rs）
 *   - macOS：hg-macos LaunchDaemon（launchctl 控制，src-tauri 侧 huanvaeguard_macos.rs）
 * 架构：独立 Tauri 窗口运行
 *   - Android：单窗口全屏覆盖页（MobileGuardPage，经 openHuanvaeGuardWindow 的 android
 *     分支派发 `huanvae-guard:open` 事件）；取数走插件命令面（guardAndroid.ts），
 *     与桌面回环 HTTP 轨（localApi.ts）双轨分流，见 HuanvaeGuardPage.tsx 平台分支
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
 * 安卓开页事件：openHuanvaeGuardWindow 的 android 分支派发，MobileMain 监听后以
 * 全屏覆盖页承载（MobileGuardPage）。同 JS 上下文内的 window 级事件，零 IPC。
 */
export const HUANVAE_GUARD_OPEN_EVENT = 'huanvae-guard:open';

/** 安卓覆盖页的凭据载荷（与桌面 URL query 同一四元组；内存传递，不落盘） */
export interface HuanvaeGuardOverlayData {
  userId: string;
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * 打开 HuanvaeGuard（Windows / macOS = 独立 WebviewWindow；android = 单窗口覆盖页事件）
 *
 * ## 安卓形态选型（任务卡要求实证选型，理由）
 * 选**单窗口全屏覆盖页**，不选独立 WebviewWindow：
 * 1. 桌面式「独立 WebviewWindow 子窗口」在安卓没有同屏对应物：tauri 的移动端窗口面是
 *    「每窗口一个 Activity」语义（tauri-runtime-wry 安卓窗口配置带 activity_name、wry
 *    WryActivity 单 mWebView 槽位），运行时建窗=另起 Activity 整屏切换、原页面入后台，
 *    且窗口生命周期命令面（close/hide/show…）在 tauri 源码整组 #[cfg(desktop)]；App 安卓
 *    壳本身也是单 Activity（manifest launchMode=singleTask）单 WebView。本仓同裁决先例：
 *    MobileMiniAppsPage「Tauri Android 不支持多窗口」/ MobileMediaPreview、MobileFilesPage
 *    「移动端不支持 WebviewWindow」/ MobileDrawer「不使用 WebviewWindow」。（file:line 级
 *    双端查测清单见阶段 2b 交付 §1.1）
 * 2. App 安卓侧的全屏页面全部是单窗口内覆盖页（MobileFilesPage / MobileLanTransferPage /
 *    MobileMeetingPage …，均由 MobileMain state + AnimatePresence 承载，无一路走 WebviewWindow）；
 *    桌面专属的 openLanTransferWindow/openStocksWindow 在移动壳里也从不被调用。Guard 页沿用
 *    该既有形态，行为与 App 安卓整体一致。
 * 3. 数据面差异（localApi 回环 HTTP → 插件命令面）与载体无关，页面组件复用同一份
 *    （HuanvaeGuardPage 接 initialData 直传，桌面子窗口仍走 URL query，见 HuanvaeGuardPage.tsx）。
 */
export async function openHuanvaeGuardWindow(
  userId: string,
  serverUrl: string,
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  const p = platform();
  if (p !== 'windows' && p !== 'macos' && p !== 'android') {
    console.warn('[HuanvaeGuard] Only available on Windows, macOS and Android');
    return;
  }

  // 安卓：见上方形态选型注释。开页意图经 CustomEvent 交给移动层宿主（MobileMain）。
  if (p === 'android') {
    window.dispatchEvent(new CustomEvent<HuanvaeGuardOverlayData>(HUANVAE_GUARD_OPEN_EVENT, {
      detail: { userId, serverUrl, accessToken, refreshToken },
    }));
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

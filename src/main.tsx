/**
 * Huanvae Chat 应用入口
 *
 * 路由逻辑：
 * - /meeting: 会议页面（独立窗口，不需要 Session）
 * - /media: 媒体预览页面（独立窗口，认证信息通过 localStorage 传递）
 * - /lan-transfer: 局域网传输页面（独立窗口，用户信息通过 localStorage 传递）
 * - /theme-editor: 主题编辑页面（独立窗口）
 * - 其他路径: 主应用
 *
 * 窗口大小策略：
 * - 首次启动：按屏幕 60%×75% 设置窗口大小
 * - 后续启动：window-state 插件自动恢复用户上次的窗口位置和大小
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { SessionProvider } from './contexts/SessionContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { ThemeProvider, ThemeEditorPage } from './theme';
import App from './App';
import { MeetingPage } from './meeting';
import { MediaPreviewPage } from './media';
import { LanTransferPage } from './lanTransfer';
import { HuanvaeGuardPage } from './huanvaeGuard';
import { StockPage } from './stocks';
import { discoverEndpoints } from './services/discovery';
import { initSecureProxy } from './services/secureProxy';
import { initSafeAreaFallback } from './utils/safeAreaFallback';
import './index.css';

// 根据路径判断渲染哪个页面
const pathname = window.location.pathname;

function RootApp() {
  // 会议页面（独立窗口，不需要 Session）
  if (pathname === '/meeting') {
    return <MeetingPage />;
  }

  // 媒体预览页面（独立窗口，认证信息通过 localStorage 传递）
  if (pathname === '/media') {
    return <MediaPreviewPage />;
  }

  // 局域网传输页面（独立窗口，用户信息通过 localStorage 传递）
  if (pathname === '/lan-transfer') {
    return <LanTransferPage />;
  }

  // 主题编辑页面（独立窗口）
  if (pathname === '/theme-editor') {
    return <ThemeEditorPage />;
  }

  // HuanvaeGuard VPN 页面（独立窗口，仅 Windows，包裹 ThemeProvider 以继承主题）
  if (pathname === '/huanvae-guard') {
    return (
      <ThemeProvider>
        <HuanvaeGuardPage />
      </ThemeProvider>
    );
  }

  // 股票研究页面（独立窗口，仅桌面端，包裹 ThemeProvider 以继承主题）
  if (pathname === '/stocks') {
    return (
      <ThemeProvider>
        <StockPage />
      </ThemeProvider>
    );
  }

  // 主应用
  return (
    <ThemeProvider>
      <SessionProvider>
        <WebSocketProvider>
          <App />
        </WebSocketProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}

function renderApp() {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <RootApp />
    </React.StrictMode>,
  );
}

// 独立子窗口是独立 JS context → discovery 的内存 active 端点不跨窗口共享。
// 做后端数据面调用的子窗口必须先从共享磁盘缓存(discovery.json,父窗口登录时已落盘)载入 active,
// 否则 resolveForSecureHttp() 返回 null → URL 主机不被改写为 IP → 连逻辑域名(发 SNI)→ 被阿里云 ICP 拦。
// 缓存新鲜时仅一次磁盘读(无网络),阻塞渲染极短;主窗口由 App.tsx 登录/恢复链路自行发现,不在此列。
const DATA_PLANE_SUBWINDOWS = new Set(['/meeting', '/media', '/huanvae-guard', '/stocks']);

async function bootstrap(): Promise<void> {
  // 安全区兜底:老旧移动端 WebView 的 env(safe-area-inset-*) 失效时(上下同时为 0)注入固定高度
  // 到 :root --sai-top/--sai-bottom(各处 mobile CSS 用 max(env(...), var(--sai-*, 0px)) 消费)。
  // 同步执行、渲染前设好,避免首帧顶/底贴系统栏的闪烁。
  initSafeAreaFallback();
  // 所有窗口都需回环安全反代:头像/图片等 webview 原生加载经 http://127.0.0.1:<port> 中转(验不过私有 CA
  // 自签 leaf,必须走反代)。Rust 侧端口进程级共享 + 幂等,但每个 JS context 需各自取一次端口缓存到本地。
  await initSecureProxy();
  // 数据面子窗口:载入 active 端点(同时把 target 同步给反代);主窗口由 App.tsx 自行发现。
  if (DATA_PLANE_SUBWINDOWS.has(pathname)) {
    try {
      await discoverEndpoints();
    } catch (err) {
      console.error('[Main] 子窗口发现端点失败:', err);
    }
  }
  renderApp();
}

void bootstrap();

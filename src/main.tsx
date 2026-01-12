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
import { initWindowSize } from './services/windowSize';
import './index.css';

// 根据路径判断渲染哪个页面
const pathname = window.location.pathname;

// 主窗口初始化窗口大小
if (pathname === '/' || pathname === '') {
  initWindowSize().catch((err) => {
    console.error('[Main] 窗口大小初始化失败:', err);
  });
}

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

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>,
);

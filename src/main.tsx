/**
 * Huanvae Chat 应用入口
 *
 * 路由逻辑：
 * - /meeting: 会议页面（独立窗口，不需要 Session）
 * - /media: 媒体预览页面（独立窗口，需要 Session 获取文件 URL）
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
import App from './App';
import { MeetingPage } from './meeting';
import { MediaPreviewPage } from './media';
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

  // 主应用
  return (
    <SessionProvider>
      <WebSocketProvider>
        <App />
      </WebSocketProvider>
    </SessionProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>,
);

/**
 * Huanvae Chat 应用入口
 *
 * 路由逻辑：
 * - /meeting: 会议页面（独立窗口）
 * - 其他路径: 主应用
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { SessionProvider } from './contexts/SessionContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import App from './App';
import { MeetingPage } from './meeting';
import './index.css';

// 根据路径判断渲染哪个页面
const isMeetingPage = window.location.pathname === '/meeting';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isMeetingPage ? (
      // 会议页面不需要 Session/WebSocket Provider
      <MeetingPage />
    ) : (
      <SessionProvider>
        <WebSocketProvider>
          <App />
        </WebSocketProvider>
      </SessionProvider>
    )}
  </React.StrictMode>,
);

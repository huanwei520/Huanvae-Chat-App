/**
 * 股票研究页面（独立 Tauri WebviewWindow，仅桌面端）
 *
 * 窗口内三视图（总览 / 个股详情 / ETF 详情）经 useStockNav 切换，不引 router。
 *
 * ## 数据接入
 *   初始 token 经 URL query（base64）带入 → 本页自建 ApiClient（子窗口不在 SessionProvider 内）；
 *   之后靠 Tauri 事件与主窗口同步 token（避免长驻窗口 token 陈旧 → 401）：
 *     - `session:tokens-updated`（listen，主窗口刷新时广播）
 *     - `session:request-tokens`（mount 时 emit，主窗口立即回发最新 token）
 *
 * 样式经全局 styles/index.css барrel（@import './pages/stocks.css'）加载；主题由 main.tsx 的
 * ThemeProvider 注入。纯 JSON 展示，无远程资源（不触反代收口点）。
 */

import { useEffect, useMemo, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { createApiClient } from '../api/client';
import { ListLoading } from '../components/common/ListStates';
import { parseStockWindowData, type StockWindowData } from './window';
import { useStockNav } from './store';
import { OverviewView } from './views/OverviewView';
import { StockDetailView } from './views/StockDetailView';
import { EtfDetailView } from './views/EtfDetailView';

export default function StockPage() {
  const [windowData, setWindowData] = useState<StockWindowData | null>(null);
  const view = useStockNav((s) => s.view);
  const selection = useStockNav((s) => s.selection);

  // 初始化：解析 URL query
  useEffect(() => {
    setWindowData(parseStockWindowData(window.location.search));
  }, []);

  // 跨窗口 token 同步（同 HuanvaeGuard 模式）
  useEffect(() => {
    const unlistenPromise = listen<{ accessToken: string; refreshToken: string }>(
      'session:tokens-updated',
      (event) => {
        setWindowData((prev) => (prev ? {
          ...prev,
          accessToken: event.payload.accessToken,
          refreshToken: event.payload.refreshToken,
        } : prev));
      },
    );
    void emit('session:request-tokens');
    return () => { void unlistenPromise.then((fn) => fn()); };
  }, []);

  // 构建 ApiClient（token 变化时重建）
  const api = useMemo(() => {
    if (!windowData) { return null; }
    return createApiClient({
      baseUrl: windowData.serverUrl,
      accessToken: windowData.accessToken,
      refreshToken: windowData.refreshToken,
      onTokenRefresh: (accessToken, refreshToken) => {
        setWindowData((prev) => (prev ? { ...prev, accessToken, refreshToken } : prev));
      },
    });
  }, [windowData]);

  if (!windowData || !api) {
    return (
      <div className="stock-page">
        <ListLoading message="加载中..." />
      </div>
    );
  }

  return (
    <div className="stock-page">
      <header className="stock-page-header">
        <h2 className="stock-page-title">股票研究</h2>
      </header>
      <main className="stock-page-body">
        {view === 'overview' && <OverviewView api={api} />}
        {view === 'stock' && selection && <StockDetailView api={api} selection={selection} />}
        {view === 'etf' && selection && <EtfDetailView api={api} selection={selection} />}
      </main>
    </div>
  );
}

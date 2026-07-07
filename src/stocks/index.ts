/**
 * 股票研究模块
 *
 * - StockPage：独立 WebviewWindow 页面（default export）
 * - openStocksWindow：主窗口触发开窗（仅桌面端）
 */

export { default as StockPage } from './StockPage';
export { openStocksWindow, STOCK_WINDOW_LABEL } from './window';

/**
 * 股票研究窗口 — 视图导航状态（Zustand）
 *
 * 窗口内三视图切换不引 router，用轻量 store 管理（同 HuanvaeGuard 的窗口内切换模式）：
 *   - overview：总览
 *   - stock：个股详情（需 selected symbol+market）
 *   - etf：ETF 详情（需 selected symbol）
 *
 * 仅管导航状态；各视图数据由各自 fetch hook 持有，不进全局 store（避免跨视图脏读）。
 */

import { create } from 'zustand';
import type { StockMarket } from '../api/stocks';

export type StockView = 'overview' | 'stock' | 'etf';

/** 当前选中的标的 */
export interface StockSelection {
  symbol: string;
  market: StockMarket;
  name: string;
}

interface StockNavState {
  view: StockView;
  selection: StockSelection | null;
  /** 打开个股详情 */
  openStock: (selection: StockSelection) => void;
  /** 打开 ETF 详情（ETF 恒为 A 股口径，market 固定 cn） */
  openEtf: (symbol: string, name: string) => void;
  /** 返回总览 */
  backToOverview: () => void;
}

export const useStockNav = create<StockNavState>((set) => ({
  view: 'overview',
  selection: null,
  openStock: (selection) => set({ view: 'stock', selection }),
  openEtf: (symbol, name) =>
    set({ view: 'etf', selection: { symbol, name, market: 'cn' } }),
  backToOverview: () => set({ view: 'overview', selection: null }),
}));

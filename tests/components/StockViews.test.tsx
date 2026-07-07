/**
 * 股票研究 视图 / 图表 / 搜索 / 页面 测试
 *
 * - klinecharts：mock（jsdom 无 canvas）；断言 init/applyNewData 被调。
 * - useStockIntro：mock no-op（不跑 GSAP）。
 * - @tauri-apps/api/event：本地 mock（setup.ts 未全局 mock，见 frontend-test.md）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ApiClient } from '../../src/api/client';

const chartMocks = vi.hoisted(() => {
  const chart = { createIndicator: vi.fn(), applyNewData: vi.fn() };
  return { chart, init: vi.fn(() => chart), dispose: vi.fn() };
});
vi.mock('klinecharts', () => ({ init: chartMocks.init, dispose: chartMocks.dispose }));
vi.mock('../../src/stocks/animations', () => ({ useStockIntro: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { KLineChart } from '../../src/stocks/components/KLineChart';
import { StockSearchBox } from '../../src/stocks/components/StockSearchBox';
import StockPage from '../../src/stocks/StockPage';
import { OverviewView } from '../../src/stocks/views/OverviewView';
import { StockDetailView } from '../../src/stocks/views/StockDetailView';
import { EtfDetailView } from '../../src/stocks/views/EtfDetailView';
import { useStockNav } from '../../src/stocks/store';
import { searchOptionId } from '../../src/stocks/components/searchNav';

/** 按 path 分流的假 ApiClient */
function fakeApi(overrides: Record<string, unknown> = {}): ApiClient {
  // 形状对齐生产真实响应（阶段二实核）：ranking 键、bid_ask 嵌套、statements/sections 对象
  const table: Record<string, unknown> = {
    '/api/stocks/home': { policy: { summary: '', items: [], sources: [], model: '', generated_at: null }, news: { count: 0, items: [] }, as_of: null, fetched_at: null },
    '/api/stocks/ranking': { as_of: '', ranking: [], model: null, policy_context: '', universe_size: null, candidate_count: 0, generated_at: null, disclaimer: '仅供研究参考，不构成投资建议', fetched_at: null },
    '/api/stocks/track/accuracy': { windows: [], overall: {}, top5_vs_all: {}, benchmark: '沪深300', records_evaluated: 0, note: '前向涨幅用真实历史收盘价计算', hint: '暂无已满窗口的追踪记录', as_of: '2026-07-05T13:00:00Z', fetched_at: null },
    '/api/stocks/track/history': { records: [], fetched_at: null, as_of: null },
    '/api/stocks/etf/list': { categories: [], fetched_at: null },
    '/api/stocks/kline': { symbol: 's', market: 'cn', name: 'n', currency: 'CNY', candles: [{ timestamp: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }], as_of: null, fetched_at: null },
    '/api/stocks/etf/kline': { symbol: 's', market: 'etf', name: 'n', currency: 'CNY', candles: [{ timestamp: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }], as_of: null, fetched_at: null, adjust_note: '不复权' },
    '/api/stocks/quote': { symbol: 's', market: 'cn', name: 'n', price: 10, change: 0.1, change_pct: 1, open: 10, high: 11, low: 9, prev_close: 9.9, volume: 1, amount: 1, currency: 'CNY', bid_ask: { available: true, bids: [{ price: 10, volume: 1 }], asks: [{ price: 10.1, volume: 1 }] }, timestamp: null, as_of: null, fetched_at: null },
    '/api/stocks/etf/quote': { symbol: 's', market: 'etf', name: 'n', price: 10, change: 0.1, change_pct: 1, open: 10, high: 11, low: 9, prev_close: 9.9, volume: 1, amount: 1, currency: 'CNY', bid_ask: { available: true, bids: [{ price: 10, volume: 1 }], asks: [{ price: 10.1, volume: 1 }] }, nav: 10.05, timestamp: null, as_of: null, fetched_at: null },
    '/api/stocks/intel': { symbol: 's', market: 'cn', name: 'n', summary: '', sections: { hotspots: [], policy: [], risks: [], news: [] }, sources: [], article_count: 0, model: '', generated_at: null, as_of: null, fetched_at: null },
    '/api/stocks/financials': { symbol: 's', market: 'cn', currency: 'CNY', periods: [], highlights: [], statements: { income: [], balance: [], cashflow: [] }, source: '', as_of: null, fetched_at: null },
    ...overrides,
  };
  const get = vi.fn((path: string) => {
    const key = Object.keys(table).find((k) => path.startsWith(k));
    return Promise.resolve(key ? table[key] : {});
  });
  return { get, post: vi.fn().mockResolvedValue({}) } as unknown as ApiClient;
}

beforeEach(() => {
  // 重置视图导航（zustand 单例跨测试）
  useStockNav.setState({ view: 'overview', selection: null });
  chartMocks.init.mockClear();
  chartMocks.chart.applyNewData.mockClear();
  chartMocks.dispose.mockClear();
});

describe('KLineChart', () => {
  it('渲染：init + createIndicator + applyNewData（映射 amount→turnover）', () => {
    render(<KLineChart candles={[{ timestamp: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100, amount: 999 }]} adjustNote="不复权" />);
    expect(chartMocks.init).toHaveBeenCalledTimes(1);
    expect(chartMocks.chart.createIndicator).toHaveBeenCalledWith('MA', true);
    expect(chartMocks.chart.applyNewData).toHaveBeenCalledWith([
      { timestamp: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100, turnover: 999 },
    ]);
    expect(screen.getByText('不复权')).toBeInTheDocument();
  });

  it('交互/行为：candles 变化时再次 applyNewData', () => {
    const { rerender } = render(<KLineChart candles={[{ timestamp: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }]} />);
    expect(chartMocks.chart.applyNewData).toHaveBeenCalledTimes(1);
    rerender(<KLineChart candles={[{ timestamp: 2, open: 2, high: 3, low: 1, close: 2.5, volume: 2 }]} />);
    expect(chartMocks.chart.applyNewData).toHaveBeenCalledTimes(2);
  });
});

describe('StockSearchBox', () => {
  it('渲染搜索输入', () => {
    render(<StockSearchBox api={fakeApi()} onSelect={vi.fn()} />);
    expect(screen.getByPlaceholderText('搜索股票 / ETF')).toBeInTheDocument();
  });

  it('交互：输入后防抖出结果并可选中', async () => {
    const api = fakeApi({ '/api/stocks/search': { results: [{ symbol: '600519', name: '贵州茅台', market: 'cn', display: '贵州茅台' }] } });
    const onSelect = vi.fn();
    render(<StockSearchBox api={api} onSelect={onSelect} />);
    fireEvent.change(screen.getByPlaceholderText('搜索股票 / ETF'), { target: { value: '茅台' } });
    const item = await screen.findByText('贵州茅台', {}, { timeout: 2000 });
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith({ symbol: '600519', name: '贵州茅台', market: 'cn', display: '贵州茅台' });
  });

  it('键盘：↑/↓ 移动高亮 + aria-activedescendant，Enter 打开当前项', async () => {
    const results = [
      { symbol: '600519', name: '贵州茅台', market: 'cn' as const, display: '贵州茅台' },
      { symbol: '000001', name: '平安银行', market: 'cn' as const, display: '平安银行' },
    ];
    const api = fakeApi({ '/api/stocks/search': { results } });
    const onSelect = vi.fn();
    render(<StockSearchBox api={api} onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '9' } });
    await screen.findByText('平安银行', {}, { timeout: 2000 });

    // 无高亮 → ↓ 落首项，再 ↓ 到第二项；aria-activedescendant 指向该项
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', searchOptionId(0));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', searchOptionId(1));
    // 末项再 ↓ 停在末项（夹紧不循环）
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', searchOptionId(1));
    // ↑ 回到首项
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveAttribute('aria-activedescendant', searchOptionId(0));

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(results[0]);
  });

  it('键盘：Esc 关闭下拉、输入框保留焦点', async () => {
    const api = fakeApi({ '/api/stocks/search': { results: [{ symbol: '600519', name: '贵州茅台', market: 'cn', display: '贵州茅台' }] } });
    render(<StockSearchBox api={api} onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '茅台' } });
    await screen.findByRole('listbox', {}, { timeout: 2000 });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('键盘：空结果时 ↓/Enter 均 no-op（不打开、不选中）', async () => {
    const get = vi.fn().mockResolvedValue({ results: [] });
    const api = { get, post: vi.fn().mockResolvedValue({}) } as unknown as ApiClient;
    const onSelect = vi.fn();
    render(<StockSearchBox api={api} onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'zzz' } });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('详情视图 Esc 返回总览', () => {
  it('StockDetailView：按 Esc 调用 backToOverview（view→overview）', () => {
    useStockNav.setState({ view: 'stock', selection: { symbol: '600519', market: 'cn', name: '贵州茅台' } });
    render(<StockDetailView api={fakeApi()} selection={{ symbol: '600519', market: 'cn', name: '贵州茅台' }} />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(useStockNav.getState().view).toBe('overview');
    expect(useStockNav.getState().selection).toBeNull();
  });

  it('EtfDetailView：按 Esc 调用 backToOverview（view→overview）', () => {
    useStockNav.setState({ view: 'etf', selection: { symbol: '510300', market: 'cn', name: '沪深300ETF' } });
    render(<EtfDetailView api={fakeApi()} selection={{ symbol: '510300', market: 'cn', name: '沪深300ETF' }} />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(useStockNav.getState().view).toBe('overview');
  });
});

describe('StockDetailView 指数隐藏情报/财报面板（gap #2）', () => {
  it('指数（^IXIC）→ 不渲染 AI 情报 + 财报摘要面板（K线/盘口仍在）', () => {
    render(<StockDetailView api={fakeApi()} selection={{ symbol: '^IXIC', market: 'us', name: '纳斯达克综合指数' }} />);
    // 指数详情保留 K 线 + 盘口，隐藏情报 + 财报
    expect(screen.getByText('K 线')).toBeInTheDocument();
    expect(screen.getByText('盘口五档')).toBeInTheDocument();
    expect(screen.queryByText('AI 情报')).toBeNull();
    expect(screen.queryByText('财报摘要')).toBeNull();
  });

  it('美股个股（AAPL）→ 仍渲染 AI 情报 + 财报摘要面板（不回归）', () => {
    render(<StockDetailView api={fakeApi()} selection={{ symbol: 'AAPL', market: 'us', name: '苹果' }} />);
    expect(screen.getByText('AI 情报')).toBeInTheDocument();
    expect(screen.getByText('财报摘要')).toBeInTheDocument();
  });
});

describe('StockPage', () => {
  it('无 URL 参数时显示加载态', () => {
    render(<StockPage />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });
});

describe('总览搜索结果按 market 路由分流（回归：ETF 曾被误开个股详情）', () => {
  it('ETF item 选中 → openEtf（view=etf，market 归一为 cn）', async () => {
    const api = fakeApi({ '/api/stocks/search': { results: [{ symbol: '161226', name: '国投白银LOF', market: 'etf', display: '国投白银LOF' }] } });
    render(<OverviewView api={api} />);
    fireEvent.change(screen.getByPlaceholderText('搜索股票 / ETF'), { target: { value: '161226' } });
    const item = await screen.findByText('国投白银LOF', {}, { timeout: 2000 });
    fireEvent.click(item);
    expect(useStockNav.getState().view).toBe('etf');
    expect(useStockNav.getState().selection).toEqual({ symbol: '161226', name: '国投白银LOF', market: 'cn' });
  });

  it('A 股 item 选中 → openStock（view=stock，market=cn）', async () => {
    const api = fakeApi({ '/api/stocks/search': { results: [{ symbol: '600519', name: '贵州茅台', market: 'cn', display: '贵州茅台' }] } });
    render(<OverviewView api={api} />);
    fireEvent.change(screen.getByPlaceholderText('搜索股票 / ETF'), { target: { value: '600519' } });
    const item = await screen.findByText('贵州茅台', {}, { timeout: 2000 });
    fireEvent.click(item);
    expect(useStockNav.getState().view).toBe('stock');
    expect(useStockNav.getState().selection).toEqual({ symbol: '600519', name: '贵州茅台', market: 'cn' });
  });

  it('美股 item 选中 → openStock（view=stock，market=us 透传，非 etf 分支）', async () => {
    const api = fakeApi({ '/api/stocks/search': { results: [{ symbol: 'AAPL', name: '苹果', market: 'us', display: '苹果 AAPL' }] } });
    render(<OverviewView api={api} />);
    fireEvent.change(screen.getByPlaceholderText('搜索股票 / ETF'), { target: { value: 'AAPL' } });
    const item = await screen.findByText('苹果 AAPL', {}, { timeout: 2000 });
    fireEvent.click(item);
    expect(useStockNav.getState().view).toBe('stock');
    expect(useStockNav.getState().selection).toEqual({ symbol: 'AAPL', name: '苹果', market: 'us' });
  });
});

describe('总览手动排序触发失败反馈（Info-2：POST /ranking/run 失败不再静默）', () => {
  it('点击 ⟳ 触发 runRanking(POST) 失败 → 展示 ErrorToast（面板 error 态不覆盖触发链路）', async () => {
    // 复用 fakeApi 的 get 分流，但让 post 拒绝以模拟触发失败
    const api = { ...fakeApi(), post: vi.fn().mockRejectedValue(new Error('触发排序失败')) } as unknown as ApiClient;
    render(<OverviewView api={api} />);
    fireEvent.click(screen.getByLabelText('手动触发排序'));
    // ErrorToast 复用 App 现有组件，POST 失败后 runError 置位 → 提示出现
    expect(await screen.findByText('触发排序失败', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/api/stocks/ranking/run', {});
  });
});

describe('视图冒烟', () => {
  it('OverviewView 挂载：显示搜索框', async () => {
    render(<OverviewView api={fakeApi()} />);
    expect(screen.getByPlaceholderText('搜索股票 / ETF')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/暂无/i).length).toBeGreaterThan(0));
  });

  it('StockDetailView 挂载：显示返回 + K线（init 被调）', async () => {
    render(<StockDetailView api={fakeApi()} selection={{ symbol: '600519', market: 'cn', name: '贵州茅台' }} />);
    expect(screen.getByLabelText('返回总览')).toBeInTheDocument();
    await waitFor(() => expect(chartMocks.init).toHaveBeenCalled());
  });

  it('EtfDetailView 挂载：显示不复权信息卡', async () => {
    render(<EtfDetailView api={fakeApi()} selection={{ symbol: '510300', market: 'cn', name: '沪深300ETF' }} />);
    expect(screen.getByLabelText('返回总览')).toBeInTheDocument();
    await waitFor(() => expect(chartMocks.init).toHaveBeenCalled());
  });
});

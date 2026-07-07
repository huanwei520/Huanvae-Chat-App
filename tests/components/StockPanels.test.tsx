/**
 * 股票研究面板组件测试（渲染 + 交互）
 *
 * 夹具形状 = 生产 /api/stocks/* 真实响应（阶段二真数据联调实核对齐）：
 *   quote 五档嵌 bid_ask、financials.statements 为对象三表、intel.sections 为四维对象、
 *   policy.items 为 {point,tag}、ranking 数组键为 ranking、accuracy overall 按窗口 keyed、
 *   etf category 键为 name。数值用中性占位（不含后端模型/数据源真实字串，PUBLIC 仓红线）。
 *
 * useStockIntro（GSAP）在测试中 mock 为 no-op —— 与项目「vitest 不做运行时动画测试」一致，
 * 动画冲突由 tests/animation-conflict.test.ts 静态门禁把关。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// 中和 GSAP 动画钩子
vi.mock('../../src/stocks/animations', () => ({ useStockIntro: vi.fn() }));

import { PanelBody } from '../../src/stocks/components/PanelBody';
import { RankingPanel } from '../../src/stocks/components/RankingPanel';
import { PolicyPanel } from '../../src/stocks/components/PolicyPanel';
import { NewsPanel } from '../../src/stocks/components/NewsPanel';
import { AccuracyPanel } from '../../src/stocks/components/AccuracyPanel';
import { EtfListPanel } from '../../src/stocks/components/EtfListPanel';
import { IntelPanel } from '../../src/stocks/components/IntelPanel';
import { FinancialsPanel } from '../../src/stocks/components/FinancialsPanel';
import { DepthPanel } from '../../src/stocks/components/DepthPanel';
import { PriceTicker } from '../../src/stocks/components/PriceTicker';
import type {
  StockRankingData, StockPolicyBlock, StockNewsBlock, StockAccuracyData,
  StockTrackHistoryData, StockEtfListData, StockIntelData, StockFinancialsData, StockQuoteData,
} from '../../src/api/stocks';

const rankingFx: StockRankingData = {
  as_of: '2026-07-03',
  ranking: [
    { rank: 1, symbol: '300750', name: '宁德时代', market: 'cn', score: 98, reasons: ['盈利能力极强'], policy_link: '规划关联', key_financials: { 营业总收入: 129131041000, 归母净利润: 20737710000 }, float_mktcap: 1618818824820, avg_amount: 13677408925, price_at_ranking: 380 },
    { rank: 2, symbol: '600519', name: '贵州茅台', market: 'cn', score: 80, reasons: [], policy_link: null, key_financials: {}, float_mktcap: null, avg_amount: null, price_at_ranking: null },
  ],
  model: 'test-model',
  policy_context: 'ctx',
  universe_size: 1395,
  candidate_count: 25,
  generated_at: '2026-07-05T13:22:05Z',
  disclaimer: '仅供研究参考，不构成投资建议',
};

/** 空榜（model=null / ranking 空）：证明空态不崩 */
const rankingEmptyFx: StockRankingData = {
  as_of: '',
  ranking: [],
  model: null,
  policy_context: '',
  universe_size: null,
  candidate_count: 0,
  generated_at: null,
  disclaimer: '仅供研究参考，不构成投资建议',
};

/** 榜内项 score=null / name=null：证明可空字段占位渲染不崩 */
const rankingNullItemFx: StockRankingData = {
  as_of: '2026-07-03',
  ranking: [
    { rank: 1, symbol: '300750', name: null, market: 'cn', score: null, reasons: [], policy_link: null, key_financials: {}, float_mktcap: null, avg_amount: null, price_at_ranking: null },
  ],
  model: null,
  policy_context: '',
  universe_size: null,
  candidate_count: 0,
  generated_at: null,
  disclaimer: '仅供研究参考，不构成投资建议',
};

const policyFx: StockPolicyBlock = {
  summary: '整体偏暖',
  items: [
    { point: '扶持新能源产业发展', tag: '产业' },
    { point: '加快十五五规划编制', tag: '宏观' },
  ],
  sources: [{ title: '来源A', url: 'https://a', source: '渠道X', published: '2026-07-01 10:00' }],
  model: 'test-model',
  generated_at: '2026-07-04 12:00',
};

const newsFx: StockNewsBlock = {
  count: 1,
  items: [{ title: '大盘收红', source: '财经社', published: null, url: 'https://n' }],
};

const stat = (hit: number | null, ret: number | null, exc: number | null, n: number) =>
  ({ hit_rate: hit, avg_return: ret, avg_excess: exc, n });

const accuracyFx: StockAccuracyData = {
  windows: ['1d', '5d', '20d'],
  overall: {
    '1d': stat(0.6, 0.012, 0.005, 10),
    '5d': stat(null, null, null, 0),
    '20d': stat(null, null, null, 0),
  },
  top5_vs_all: {
    '1d': { all: stat(0.5, 0.01, 0.003, 20), top5: stat(0.7, 0.02, 0.008, 5) },
    '5d': { all: stat(null, null, null, 0), top5: stat(null, null, null, 0) },
    '20d': { all: stat(null, null, null, 0), top5: stat(null, null, null, 0) },
  },
  benchmark: '沪深300',
  records_evaluated: 10,
  note: '前向涨幅用真实历史收盘价计算',
  hint: '暂无已满窗口的追踪记录',
  as_of: '2026-07-05T13:00:00Z',
  fetched_at: null,
};

const accuracyEmptyFx: StockAccuracyData = {
  windows: ['1d', '5d', '20d'],
  overall: {
    '1d': stat(null, null, null, 0),
    '5d': stat(null, null, null, 0),
    '20d': stat(null, null, null, 0),
  },
  top5_vs_all: {},
  benchmark: '沪深300',
  records_evaluated: 0,
  note: '前向涨幅用真实历史收盘价计算',
  hint: '暂无已满窗口的追踪记录；运行回填或等每日排序积累后再看',
  as_of: '2026-07-05T13:00:00Z',
  fetched_at: null,
};

const historyFx: StockTrackHistoryData = {
  records: [{ as_of: '2026-07-03', rank: 1, symbol: '300750', name: '宁德时代', price_at_ranking: 380, ret_1d: null, ret_5d: null, ret_20d: null, excess_1d: 0.005, excess_5d: null, excess_20d: null, returns_updated_at: null, is_backfill: true }],
  fetched_at: null,
  as_of: null,
};

const etfFx: StockEtfListData = {
  categories: [{ name: '贵金属', items: [{ symbol: '518880', name: '黄金ETF华安', price: 8.672, change_pct: 2.32, change: 0.197, prev_close: 8.475, currency: 'CNY', latest_date: '2026-07-03', market: 'etf', sub: '黄金' }] }],
  fetched_at: null,
};

const intelFx: StockIntelData = {
  symbol: '600519', market: 'cn', name: '贵州茅台', summary: '经营稳健',
  sections: {
    hotspots: ['AI算力概念火热'],
    policy: ['公开渠道暂无明显信号'],
    risks: ['估值偏高风险'],
    news: ['大额分红落地'],
  },
  sources: [{ title: '研报X', url: 'https://r', source: '渠道X', published: null }],
  article_count: 3, model: 'test-model', generated_at: null, as_of: null, fetched_at: null,
};

const finFx: StockFinancialsData = {
  symbol: '600519', market: 'cn', currency: 'CNY',
  periods: ['20260331', '20251231'],
  highlights: [{ label: '营业总收入', period: '20260331', value: 54702912385.23 }],
  statements: {
    income: [{ item: '营业总收入', values: { '20260331': 54702912385.23, '20251231': 172054171890.91 } }],
    balance: [{ item: '资产总计', values: { '20260331': 319918844905.58, '20251231': 303834844021.44 } }],
    cashflow: [{ item: '经营活动现金流量净额', values: { '20260331': 26909891269.13, '20251231': 61522204989.35 } }],
  },
  source: '交易所', as_of: null, fetched_at: null,
};

/** 五档 depth 齐全的行情（bid_ask 嵌套，available:true） */
const quoteFx: StockQuoteData = {
  symbol: '600519', market: 'cn', name: '贵州茅台',
  price: 1194.45, change: 12.3, change_pct: 0.74,
  open: 1205.24, high: 1210.14, low: 1185, prev_close: 1203,
  volume: 3426755, amount: 4099266243, currency: 'CNY',
  bid_ask: {
    available: true,
    bids: [{ price: 1194.45, volume: 29 }, { price: 1194.44, volume: 600 }, { price: 1194.41, volume: 100 }, { price: 1194.32, volume: 100 }, { price: 1194.31, volume: 200 }],
    asks: [{ price: 1194.47, volume: 500 }, { price: 1194.49, volume: 100 }, { price: 1194.5, volume: 300 }, { price: 1194.59, volume: 100 }, { price: 1194.6, volume: 200 }],
  },
  timestamp: '2026-07-03 15:00:03', as_of: null, fetched_at: null,
};

/** 美股无五档（available:false，bids/asks 空） */
const quoteNoDepthFx: StockQuoteData = {
  ...quoteFx, symbol: 'NVDA', market: 'us', name: 'NVIDIA', currency: 'USD',
  bid_ask: { available: false, bids: [], asks: [] },
};

describe('PanelBody 四态', () => {
  it('loading 显示加载', () => {
    render(<PanelBody loading error={null} isEmpty={false} loadingMessage="LOADING"><div>C</div></PanelBody>);
    expect(screen.getByText('LOADING')).toBeInTheDocument();
  });
  it('error 显示错误', () => {
    render(<PanelBody loading={false} error="ERR" isEmpty={false}><div>C</div></PanelBody>);
    expect(screen.getByText(/ERR/)).toBeInTheDocument();
  });
  it('empty 显示空态', () => {
    render(<PanelBody loading={false} error={null} isEmpty emptyMessage="EMPTY"><div>C</div></PanelBody>);
    expect(screen.getByText('EMPTY')).toBeInTheDocument();
  });
  it('正常显示 children', () => {
    render(<PanelBody loading={false} error={null} isEmpty={false}><div>CONTENT</div></PanelBody>);
    expect(screen.getByText('CONTENT')).toBeInTheDocument();
  });
});

describe('PanelBody gracefulNotFound（gap #1：404 优雅空态 vs 真错误红字）', () => {
  it('gracefulNotFound + 404「快照不存在」→ 灰字空态（非红字"加载失败"）', () => {
    render(
      <PanelBody loading={false} error="K线快照不存在" isEmpty gracefulNotFound emptyMessage="暂无 K 线数据">
        <div>C</div>
      </PanelBody>,
    );
    expect(screen.getByText('暂无 K 线数据')).toBeInTheDocument();
    expect(screen.queryByText(/加载失败/)).toBeNull();
  });

  it('gracefulNotFound + 真错误（网络/500）→ 仍红字"加载失败"', () => {
    render(
      <PanelBody loading={false} error="HTTP 500" isEmpty gracefulNotFound emptyMessage="暂无 K 线数据">
        <div>C</div>
      </PanelBody>,
    );
    expect(screen.getByText(/加载失败: HTTP 500/)).toBeInTheDocument();
    expect(screen.queryByText('暂无 K 线数据')).toBeNull();
  });

  it('默认（不传 gracefulNotFound）→「快照不存在」仍红字（总览类不回归）', () => {
    render(
      <PanelBody loading={false} error="快照不存在" isEmpty emptyMessage="EMPTY">
        <div>C</div>
      </PanelBody>,
    );
    expect(screen.getByText(/加载失败: 快照不存在/)).toBeInTheDocument();
    expect(screen.queryByText('EMPTY')).toBeNull();
  });
});

describe('RankingPanel', () => {
  it('渲染排行榜卡片（读 data.ranking）', () => {
    render(<RankingPanel data={rankingFx} loading={false} error={null} running={false} onRun={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByText('宁德时代')).toBeInTheDocument();
    expect(screen.getByText('贵州茅台')).toBeInTheDocument();
  });
  it('交互：点击卡片触发 onSelect（传对应 ranking 条目）', () => {
    const onSelect = vi.fn();
    render(<RankingPanel data={rankingFx} loading={false} error={null} running={false} onRun={vi.fn()} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('宁德时代'));
    expect(onSelect).toHaveBeenCalledWith(rankingFx.ranking[0]);
  });
  it('交互：点击 ⟳ 触发 onRun', () => {
    const onRun = vi.fn();
    render(<RankingPanel data={rankingFx} loading={false} error={null} running={false} onRun={onRun} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('手动触发排序'));
    expect(onRun).toHaveBeenCalledTimes(1);
  });
  it('空榜（model=null / ranking 空）：显示空态、不渲染卡片、不崩', () => {
    render(<RankingPanel data={rankingEmptyFx} loading={false} error={null} running={false} onRun={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByText('暂无排行榜数据')).toBeInTheDocument();
    expect(screen.queryByText('宁德时代')).not.toBeInTheDocument();
  });
  it('榜内项 score=null / name=null：name/score 均占位 —，symbol 仍显示，不崩', () => {
    render(<RankingPanel data={rankingNullItemFx} loading={false} error={null} running={false} onRun={vi.fn()} onSelect={vi.fn()} />);
    // name 与 score 两处可空各渲染一个占位 —
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    // symbol 非空字段照常显示，证明该条目已渲染而非整体崩溃
    expect(screen.getByText('300750')).toBeInTheDocument();
  });
});

describe('PolicyPanel', () => {
  it('渲染政策条目（point + tag）', () => {
    render(<PolicyPanel data={policyFx} loading={false} error={null} />);
    expect(screen.getByText('扶持新能源产业发展')).toBeInTheDocument();
    expect(screen.getByText('产业')).toBeInTheDocument();
  });
  it('交互：块级来源折叠展开', () => {
    render(<PolicyPanel data={policyFx} loading={false} error={null} />);
    expect(screen.queryByText('来源A')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/来源 \(1\)/));
    expect(screen.getByText('来源A')).toBeInTheDocument();
  });
});

describe('NewsPanel', () => {
  it('渲染新闻行', () => {
    render(<NewsPanel data={newsFx} loading={false} error={null} />);
    expect(screen.getByText('大盘收红')).toBeInTheDocument();
    expect(screen.getByText('无日期')).toBeInTheDocument();
  });
});

describe('AccuracyPanel', () => {
  it('有样本：渲染窗口表（读 overall[window]）+ 历史回填徽章', () => {
    render(<AccuracyPanel accuracy={accuracyFx} history={historyFx} loading={false} error={null} />);
    expect(screen.getByText(/沪深300/)).toBeInTheDocument();
    expect(screen.getByText('回填')).toBeInTheDocument();
    // 1d 命中率 0.6 → 60.00%
    expect(screen.getByText('60.00%')).toBeInTheDocument();
  });
  it('无满窗样本（records_evaluated=0）：显示 hint、不渲染窗口表', () => {
    render(<AccuracyPanel accuracy={accuracyEmptyFx} history={null} loading={false} error={null} />);
    expect(screen.getByText(/运行回填或等每日排序积累/)).toBeInTheDocument();
    expect(screen.queryByText('命中率')).not.toBeInTheDocument();
  });
});

describe('EtfListPanel', () => {
  it('渲染 ETF 品类（读 cat.name）', () => {
    render(<EtfListPanel data={etfFx} loading={false} error={null} onSelect={vi.fn()} />);
    expect(screen.getByText('贵金属')).toBeInTheDocument();
    expect(screen.getByText('黄金ETF华安')).toBeInTheDocument();
  });
  it('交互：点击行触发 onSelect', () => {
    const onSelect = vi.fn();
    render(<EtfListPanel data={etfFx} loading={false} error={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('黄金ETF华安'));
    expect(onSelect).toHaveBeenCalledWith(etfFx.categories[0].items[0]);
  });
  it('键盘：行 role=button 可聚焦，Enter/Space 触发 onSelect', () => {
    const onSelect = vi.fn();
    render(<EtfListPanel data={etfFx} loading={false} error={null} onSelect={onSelect} />);
    const row = screen.getByRole('button', { name: /黄金ETF华安/ });
    expect(row).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(etfFx.categories[0].items[0]);
    fireEvent.keyDown(row, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
  it('键盘：行聚焦加 --kbd-active 焦点环类，失焦移除', () => {
    render(<EtfListPanel data={etfFx} loading={false} error={null} onSelect={vi.fn()} />);
    const row = screen.getByRole('button', { name: /黄金ETF华安/ });
    expect(row.className).not.toContain('stock-etf-row--kbd-active');
    fireEvent.focus(row);
    expect(row.className).toContain('stock-etf-row--kbd-active');
    fireEvent.blur(row);
    expect(row.className).not.toContain('stock-etf-row--kbd-active');
  });
});

describe('IntelPanel', () => {
  it('渲染情报分节（sections 四维对象 → 标题 + 要点）', () => {
    render(<IntelPanel data={intelFx} loading={false} error={null} />);
    expect(screen.getByText('经营稳健')).toBeInTheDocument();
    expect(screen.getByText('热点')).toBeInTheDocument();
    expect(screen.getByText('AI算力概念火热')).toBeInTheDocument();
    expect(screen.getByText('风险')).toBeInTheDocument();
    expect(screen.getByText('估值偏高风险')).toBeInTheDocument();
  });

  it('gap #1：404「情报快照不存在」→ 灰字"暂无情报"（非红字"加载失败"）', () => {
    render(<IntelPanel data={null} loading={false} error="情报快照不存在" />);
    expect(screen.getByText('暂无情报')).toBeInTheDocument();
    expect(screen.queryByText(/加载失败/)).toBeNull();
  });

  it('真错误（网络/500）→ 仍红字"加载失败"', () => {
    render(<IntelPanel data={null} loading={false} error="HTTP 500" />);
    expect(screen.getByText(/加载失败: HTTP 500/)).toBeInTheDocument();
  });
});

describe('FinancialsPanel', () => {
  it('渲染财报指标（number 格式化）与三表（statements 对象 → item + 各期值）', () => {
    render(<FinancialsPanel data={finFx} loading={false} error={null} />);
    // highlight number 经 formatAmount → 「亿」
    expect(screen.getByText('营业总收入', { selector: '.stock-highlight-label' })).toBeInTheDocument();
    expect(screen.getByText('利润表')).toBeInTheDocument();
    expect(screen.getByText('资产负债表')).toBeInTheDocument();
    expect(screen.getByText('现金流量表')).toBeInTheDocument();
    expect(screen.getByText('资产总计')).toBeInTheDocument();
  });

  it('gap #1：404「财报快照不存在」→ 灰字"暂无财报"（非红字"加载失败"）', () => {
    render(<FinancialsPanel data={null} loading={false} error="财报快照不存在" />);
    expect(screen.getByText('暂无财报')).toBeInTheDocument();
    expect(screen.queryByText(/加载失败/)).toBeNull();
  });

  it('真错误（网络/500）→ 仍红字"加载失败"', () => {
    render(<FinancialsPanel data={null} loading={false} error="HTTP 500" />);
    expect(screen.getByText(/加载失败: HTTP 500/)).toBeInTheDocument();
  });
});

describe('DepthPanel', () => {
  it('渲染五档（读 bid_ask.bids/asks，买一卖一标签）', () => {
    render(<DepthPanel quote={quoteFx} />);
    expect(screen.getByText('买1')).toBeInTheDocument();
    expect(screen.getByText('卖1')).toBeInTheDocument();
    expect(screen.getByText('卖5')).toBeInTheDocument();
  });
  it('available=false（美股无五档）：显示暂无五档盘口', () => {
    render(<DepthPanel quote={quoteNoDepthFx} />);
    expect(screen.getByText('暂无五档盘口')).toBeInTheDocument();
    expect(screen.queryByText('买1')).not.toBeInTheDocument();
  });
});

describe('PriceTicker', () => {
  it('渲染涨跌额/涨跌幅（React 受控文本部分）', () => {
    render(<PriceTicker quote={quoteFx} />);
    expect(screen.getByText('+12.30')).toBeInTheDocument();
    expect(screen.getByText('+0.74%')).toBeInTheDocument();
  });
});

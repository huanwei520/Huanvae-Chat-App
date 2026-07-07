/**
 * 市场天气面板测试（渲染 + 空态 + 可空/透传字段守卫）
 *
 * 夹具形状 = 生产 /api/stocks/market-weather 真实响应（与后端 struct 18/18 核对一致）：
 *   breadth/features/posterior 为透传对象、flags 为 [{code,text}]、history 升序色带、
 *   fear_greed_score/sentiment_label/model 可空、note 仅无数据时出现。
 *   数值用中性占位（不含后端模型/服务/表名等内幕，PUBLIC 仓红线）。
 *
 * useStockIntro（GSAP）在测试中 mock 为 no-op —— 与项目「vitest 不做运行时动画测试」一致，
 * 动画冲突由 tests/animation-conflict.test.ts 静态门禁把关。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// 中和 GSAP 动画钩子
vi.mock('../../src/stocks/animations', () => ({ useStockIntro: vi.fn() }));

import { MarketWeatherPanel } from '../../src/stocks/components/MarketWeatherPanel';
import type { MarketWeatherData } from '../../src/api/stocks';

/** 有数据态（regime=bear/阴雨，含情绪/广度/两个 flags/三日色带/免责） */
const weatherFx: MarketWeatherData = {
  as_of: '2026-07-06',
  market: 'cn',
  index_symbol: '000300',
  regime: 'bear',
  weather_label: '阴雨',
  confidence: 0.72,
  fear_greed_score: 28,
  sentiment_label: '恐惧',
  breadth: { adv: 1818, dec: 3398, unchanged: 93, limit_up: 21, limit_down: 8, breadth_pct: 0.342, adr: 0.535 },
  drivers: ['外围扰动', '成交缩量'],
  flags: [
    { code: 'divergence', text: '指数跌但普跌，量价背离' },
    { code: 'trend_conflict', text: '趋势与情绪冲突' },
  ],
  features: { ret: -0.0123, rv20: 0.0211 },
  posterior: { bull: 0.08, range: 0.2, bear: 0.72 },
  model: 'test-model',
  disclaimer: '市场天气为决策支持/风险语境参考，非投资建议、非涨跌预测。',
  history: [
    { as_of: '2026-06-30', regime: 'range', confidence: 0.61 },
    { as_of: '2026-07-03', regime: 'range', confidence: 0.58 },
    { as_of: '2026-07-06', regime: 'bear', confidence: 0.72 },
  ],
  fetched_at: '2026-07-06T10:47:00Z',
};

/** 无数据态（as_of 空 / note 存在 / history 空 / fetched_at null；仍带 disclaimer） */
const weatherEmptyFx: MarketWeatherData = {
  as_of: '', market: 'cn', index_symbol: '', regime: '', weather_label: '',
  confidence: 0, fear_greed_score: null, sentiment_label: null,
  breadth: {}, drivers: [], flags: [], features: {}, posterior: {},
  model: null,
  disclaimer: '市场天气为决策支持/风险语境参考，非投资建议、非涨跌预测。',
  history: [], note: '暂无市场天气数据', fetched_at: null,
};

/** fear_greed=null / sentiment_label=null：证明情绪行整块不渲染（可空守卫） */
const weatherNoSentimentFx: MarketWeatherData = {
  ...weatherFx,
  fear_greed_score: null,
  sentiment_label: null,
};

/** breadth 透传含垃圾值（dec 为字符串、flags 空、history 空）：readNum 守卫 + 空区块不渲染 */
const weatherGarbageBreadthFx: MarketWeatherData = {
  ...weatherFx,
  breadth: { adv: 2000, dec: 'x' as unknown as number, limit_up: null as unknown as number },
  flags: [],
  history: [],
};

describe('MarketWeatherPanel 有数据渲染', () => {
  it('天气标签大字 + 置信度百分比 + regime 配色属性', () => {
    const { container } = render(<MarketWeatherPanel data={weatherFx} loading={false} error={null} />);
    expect(screen.getByText('阴雨')).toBeInTheDocument();
    expect(screen.getByText(/置信度\s*72%/)).toBeInTheDocument();
    // regime 配色靠 data-regime 属性驱动（bull 暖 / range 中性 / bear 冷）
    const hero = container.querySelector('.market-weather-hero');
    expect(hero).toHaveAttribute('data-regime', 'bear');
  });

  it('市场情绪：fear_greed 分值 + 情绪标签', () => {
    render(<MarketWeatherPanel data={weatherFx} loading={false} error={null} />);
    expect(screen.getByText('市场情绪')).toBeInTheDocument();
    expect(screen.getByText('恐惧')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();
  });

  it('广度摘要：涨/跌家数 + 涨停/跌停（防御访问透传对象）', () => {
    render(<MarketWeatherPanel data={weatherFx} loading={false} error={null} />);
    expect(screen.getByText('市场广度')).toBeInTheDocument();
    expect(screen.getByText(/涨\s*1818/)).toBeInTheDocument();
    expect(screen.getByText(/跌\s*3398/)).toBeInTheDocument();
    expect(screen.getByText(/涨停\s*21/)).toBeInTheDocument();
    expect(screen.getByText(/跌停\s*8/)).toBeInTheDocument();
  });

  it('flags 渲染成提示 chips（code+text）', () => {
    render(<MarketWeatherPanel data={weatherFx} loading={false} error={null} />);
    expect(screen.getByText('指数跌但普跌，量价背离')).toBeInTheDocument();
    const chip = screen.getByText('趋势与情绪冲突');
    expect(chip).toHaveClass('market-weather-chip');
    // code 挂 title（便于溯源，非 UI 文案硬编码算法）
    expect(chip).toHaveAttribute('title', 'trend_conflict');
  });

  it('近 30 日 regime 色带：每日一格，按 regime 着色（data-regime）', () => {
    const { container } = render(<MarketWeatherPanel data={weatherFx} loading={false} error={null} />);
    const cells = container.querySelectorAll('.market-weather-band-cell');
    expect(cells).toHaveLength(3);
    expect(Array.from(cells).map((c) => c.getAttribute('data-regime'))).toEqual(['range', 'range', 'bear']);
  });

  it('disclaimer 恒展示，原样透传 API 文案（不硬编码算法描述）', () => {
    render(<MarketWeatherPanel data={weatherFx} loading={false} error={null} />);
    const el = screen.getByText(weatherFx.disclaimer);
    expect(el).toHaveClass('market-weather-disclaimer');
  });
});

describe('MarketWeatherPanel regime 配色分支 + 色带 title 映射', () => {
  it('hero data-regime 随 regime 变（bull / range 配色分支）', () => {
    const bull = render(
      <MarketWeatherPanel data={{ ...weatherFx, regime: 'bull', weather_label: '晴' }} loading={false} error={null} />,
    );
    expect(bull.container.querySelector('.market-weather-hero')).toHaveAttribute('data-regime', 'bull');
    bull.unmount();

    const range = render(
      <MarketWeatherPanel data={{ ...weatherFx, regime: 'range', weather_label: '多云' }} loading={false} error={null} />,
    );
    expect(range.container.querySelector('.market-weather-hero')).toHaveAttribute('data-regime', 'range');
  });

  it('regime 空串时 hero data-regime 兜底为 range（regime || range 分支）', () => {
    // as_of 非空 + 无 note → hasData=true；regime 为空串 → data-regime 走兜底 'range'
    const { container } = render(
      <MarketWeatherPanel data={{ ...weatherFx, regime: '' }} loading={false} error={null} />,
    );
    expect(container.querySelector('.market-weather-hero')).toHaveAttribute('data-regime', 'range');
  });

  it('色带 cell title 映射 regime → 天气词（晴 / 多云 / 阴雨）', () => {
    const fx: MarketWeatherData = {
      ...weatherFx,
      history: [
        { as_of: '2026-06-30', regime: 'bull', confidence: 0.7 },
        { as_of: '2026-07-03', regime: 'range', confidence: 0.6 },
        { as_of: '2026-07-06', regime: 'bear', confidence: 0.72 },
      ],
    };
    const { container } = render(<MarketWeatherPanel data={fx} loading={false} error={null} />);
    const titles = Array.from(container.querySelectorAll('.market-weather-band-cell')).map((c) =>
      c.getAttribute('title'),
    );
    expect(titles).toEqual(['2026-06-30 · 晴', '2026-07-03 · 多云', '2026-07-06 · 阴雨']);
  });
});

describe('MarketWeatherPanel 空态', () => {
  it('note 存在 / as_of 空 → 优雅空态文案，不渲染天气标签/色带', () => {
    const { container } = render(<MarketWeatherPanel data={weatherEmptyFx} loading={false} error={null} />);
    expect(screen.getByText('暂无市场天气数据')).toBeInTheDocument();
    expect(screen.queryByText('阴雨')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.market-weather-band-cell')).toHaveLength(0);
  });

  it('loading → 加载态；error → 错误态（PanelBody 收口）', () => {
    const { rerender } = render(<MarketWeatherPanel data={null} loading error={null} />);
    expect(screen.getByText('加载市场天气...')).toBeInTheDocument();
    rerender(<MarketWeatherPanel data={null} loading={false} error="HTTP 500" />);
    expect(screen.getByText(/加载失败: HTTP 500/)).toBeInTheDocument();
  });
});

describe('MarketWeatherPanel 可空/透传字段守卫', () => {
  it('fear_greed_score=null → 情绪整行不渲染（其余照常）', () => {
    render(<MarketWeatherPanel data={weatherNoSentimentFx} loading={false} error={null} />);
    expect(screen.queryByText('市场情绪')).not.toBeInTheDocument();
    expect(screen.queryByText('恐惧')).not.toBeInTheDocument();
    // 天气标签/广度仍在，证明是"这一行"不渲染而非整体崩
    expect(screen.getByText('阴雨')).toBeInTheDocument();
    expect(screen.getByText('市场广度')).toBeInTheDocument();
  });

  it('breadth 含垃圾值 + flags/history 空：readNum 守卫仅渲染有效项、空区块整块不渲染，不崩', () => {
    const { container } = render(<MarketWeatherPanel data={weatherGarbageBreadthFx} loading={false} error={null} />);
    // adv=2000 有效渲染；dec 为字符串 / limit_up null → 不渲染
    expect(screen.getByText(/涨\s*2000/)).toBeInTheDocument();
    expect(screen.queryByText(/跌\s/)).not.toBeInTheDocument();
    // flags 空 → 无 chip；history 空 → 无色带格
    expect(container.querySelectorAll('.market-weather-chip')).toHaveLength(0);
    expect(container.querySelectorAll('.market-weather-band-cell')).toHaveLength(0);
  });

  it('null 穿透守卫：data 为空对象 {}（如未命中的 fakeApi）→ 空态、不崩', () => {
    render(<MarketWeatherPanel data={{} as MarketWeatherData} loading={false} error={null} />);
    expect(screen.getByText('暂无市场天气数据')).toBeInTheDocument();
  });
});

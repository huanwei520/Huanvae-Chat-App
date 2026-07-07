/**
 * K 线图组件（klinecharts@9 封装）
 *
 * klinecharts 是无框架依赖的 canvas 图表：init 到 div、applyNewData 推数据、dispose 清理。
 * 图表内部动画由 klinecharts 自绘（canvas），不占用 DOM 动画系统 → 单一所有权天然满足，
 * 不登记 animation-conflict 注册表。
 *
 * 指标：图表内置 MA/MACD/KDJ 仅作视觉叠加（原版口径）；后端下发的指标数组是真值，
 * 详情视图可另行展示。
 *
 * 复权：ETF 恒不复权（adjustNote="不复权"），由调用方传入并展示在图表角标。
 */

import { useEffect, useRef } from 'react';
import { init, dispose, type Chart, type KLineData } from 'klinecharts';
import type { StockCandle } from '../../api/stocks';

interface KLineChartProps {
  candles: StockCandle[];
  /** 复权/口径角标文案（如"不复权"）；空则不显示 */
  adjustNote?: string;
  /** 图表高度（px），默认 460 */
  height?: number;
}

/** StockCandle → klinecharts KLineData */
function toKLineData(candles: StockCandle[]): KLineData[] {
  return candles.map((c) => ({
    timestamp: c.timestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    turnover: c.amount,
  }));
}

export function KLineChart({ candles, adjustNote, height = 460 }: KLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);

  // init / dispose 只在挂载/卸载各一次
  useEffect(() => {
    const el = containerRef.current;
    if (!el) { return; }
    const chart = init(el);
    chartRef.current = chart;
    // 内置指标视觉叠加：MA 叠加主图，MACD / KDJ 独立副图
    chart?.createIndicator('MA', true);
    chart?.createIndicator('MACD');
    chart?.createIndicator('KDJ');
    return () => {
      dispose(el);
      chartRef.current = null;
    };
  }, []);

  // 数据变化时推入（日/周切换、复权切换、标的切换共用此路径）
  useEffect(() => {
    chartRef.current?.applyNewData(toKLineData(candles));
  }, [candles]);

  return (
    <div className="stock-kline">
      {adjustNote && <span className="stock-kline-badge">{adjustNote}</span>}
      <div ref={containerRef} className="stock-kline-canvas" style={{ height }} />
    </div>
  );
}

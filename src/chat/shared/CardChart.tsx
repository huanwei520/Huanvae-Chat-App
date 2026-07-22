/**
 * 卡片图表节点(S4)— klinecharts 封装。
 *
 * 声明式 spec 驱动:卡片只给 chart_type + data,不接任意代码。数据行逐一校验
 * (timestamp/open/high/low/close 均为有限 number 才保留,非法行丢弃),无有效行渲染惰性占位。
 *
 * klinecharts 是无框架依赖的 canvas 图表:init 到 div、applyNewData 推数据、dispose 清理。
 * 图表内部动画由 klinecharts 自绘(canvas),不占用 DOM 动画系统 → 单一所有权天然满足,
 * 不登记 animation-conflict 注册表(对齐 stocks/KLineChart 先例)。
 */

import { useEffect, useMemo, useRef } from 'react';
import { init, dispose, type CandleType, type Chart, type KLineData } from 'klinecharts';
import type { CardChartCandle, CardChartNode } from '../../types/card';

interface CardChartProps {
  node: CardChartNode;
}

/** 高度 clamp 到 120..480,默认 240(非有限数值按默认) */
function clampHeight(height?: number): number {
  const v = typeof height === 'number' && Number.isFinite(height) ? height : 240;
  return Math.min(480, Math.max(120, v));
}

/** 运行时行校验:五个核心字段均为有限 number 才保留(卡片字段一律视为不可信) */
function isValidCandle(c: CardChartCandle): boolean {
  return (
    Number.isFinite(c.timestamp) &&
    Number.isFinite(c.open) &&
    Number.isFinite(c.high) &&
    Number.isFinite(c.low) &&
    Number.isFinite(c.close)
  );
}

/** 可选数值字段:有限 number 才透传,否则置空 */
function optionalNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** CardChartCandle → klinecharts KLineData(仅在 isValidCandle 之后调用) */
function toKLineData(c: CardChartCandle): KLineData {
  return {
    timestamp: c.timestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: optionalNumber(c.volume),
    turnover: optionalNumber(c.turnover),
  };
}

export function CardChart({ node }: CardChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const height = clampHeight(node.height);

  const validData = useMemo<KLineData[]>(
    () => (Array.isArray(node.data) ? node.data : []).filter(isValidCandle).map(toKLineData),
    [node.data],
  );
  const hasData = validData.length > 0;

  // init / dispose:有无数据切换时各一次(占位分支不挂容器,不 init)
  useEffect(() => {
    if (!hasData) {
      return;
    }
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const chart = init(el);
    chartRef.current = chart ?? null;
    return () => {
      dispose(el);
      chartRef.current = null;
    };
  }, [hasData]);

  // 数据变化时推入(live patch 与首渲共用此路径)
  useEffect(() => {
    if (hasData) {
      chartRef.current?.applyNewData(validData);
    }
  }, [hasData, validData]);

  // 形态:candlestick(默认实心蜡烛) / area
  useEffect(() => {
    // CandleType 是字符串枚举('candle_solid'/'area'),这里按值收窄,不引运行时枚举
    const candleType = (node.chart_type === 'area' ? 'area' : 'candle_solid') as CandleType;
    chartRef.current?.setStyles({ candle: { type: candleType } });
  }, [node.chart_type, hasData]);

  if (!hasData) {
    return <div className="card-chart-placeholder">[图表: 暂无数据]</div>;
  }

  return (
    <div className="card-chart">
      {node.title && <div className="card-chart-title">{node.title}</div>}
      <div ref={containerRef} className="card-chart-canvas" style={{ height }} />
    </div>
  );
}

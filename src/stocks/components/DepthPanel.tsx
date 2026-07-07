/**
 * 盘口五档面板（个股·ETF 详情共用）
 *
 * 动画 B4：深度条宽度 tween（GSAP scaleX，不动 width）。登记：.stock-depth-bar（transform）。
 * 量单位「手」原样展示；价格按方向着色。深度条按五档内最大量归一。
 */

import { useRef } from 'react';
import { useStockIntro } from '../animations';
import { formatPrice, priceDirection, directionClass } from '../format';
import type { StockQuoteData, StockDepthLevel } from '../../api/stocks';

interface DepthPanelProps {
  quote: StockQuoteData | null;
}

/** 五档量归一到 [0,1]（两侧合并取最大量） */
function depthMax(bids: StockDepthLevel[], asks: StockDepthLevel[]): number {
  const all = [...bids, ...asks].map((d) => d.volume).filter((v) => Number.isFinite(v));
  return all.length ? Math.max(...all, 0) : 0;
}

export function DepthPanel({ quote }: DepthPanelProps) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const bids = quote?.bid_ask?.bids ?? [];
  const asks = quote?.bid_ask?.asks ?? [];
  const hasDepth = (quote?.bid_ask?.available ?? false) && (bids.length > 0 || asks.length > 0);
  const max = depthMax(bids, asks);
  // 量签名：变化时重跑深度条 tween
  const sig = quote
    ? [...bids, ...asks].map((d) => d.volume).join(',')
    : '';

  useStockIntro(
    scopeRef,
    ({ reduce, fromTo }) => {
      fromTo(
        '.stock-depth-bar',
        { scaleX: 0 },
        {
          scaleX: (_i, el) => Number((el as HTMLElement).dataset.ratio ?? 0),
          transformOrigin: 'left center',
          duration: reduce ? 0 : 0.4,
          ease: 'power2.out',
          overwrite: 'auto',
        },
      );
    },
    [sig],
  );

  const ratio = (v: number): number => (max > 0 ? Math.max(0, Math.min(1, v / max)) : 0);

  const renderRow = (level: StockDepthLevel, label: string, side: 'ask' | 'bid') => {
    const dir = priceDirection(side === 'ask' ? 1 : -1);
    return (
      <div className={`stock-depth-row stock-depth-row--${side}`}>
        <span className="stock-depth-label">{label}</span>
        <span className={`stock-depth-price stock-num ${directionClass(dir)}`}>
          {formatPrice(level.price)}
        </span>
        <span className="stock-depth-vol stock-num">{level.volume}</span>
        <span className="stock-depth-track">
          <span className={`stock-depth-bar stock-depth-bar--${side}`} data-ratio={ratio(level.volume)} />
        </span>
      </div>
    );
  };

  if (!quote) {
    return <div className="stock-depth" ref={scopeRef} />;
  }

  // 无五档盘口（如美股无 L2 深度）：给明确说明，不渲染空档位
  if (!hasDepth) {
    return (
      <div className="stock-depth stock-depth--empty" ref={scopeRef}>
        <span className="stock-depth-note">暂无五档盘口</span>
      </div>
    );
  }

  const topAsks = asks.slice(0, 5);
  const topBids = bids.slice(0, 5);

  return (
    <div className="stock-depth" ref={scopeRef}>
      <div className="stock-depth-side stock-depth-asks">
        {topAsks.reverse().map((lvl, i) => (
          <div key={`ask-${i}`}>{renderRow(lvl, `卖${topAsks.length - i}`, 'ask')}</div>
        ))}
      </div>
      <div className="stock-depth-side stock-depth-bids">
        {topBids.map((lvl, i) => (
          <div key={`bid-${i}`}>{renderRow(lvl, `买${i + 1}`, 'bid')}</div>
        ))}
      </div>
    </div>
  );
}

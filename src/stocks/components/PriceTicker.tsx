/**
 * 价格 / 涨跌幅显示（个股·ETF 详情共用）
 *
 * 动画 A3：价格数字滚动 + 涨跌底色闪烁。
 *   - 价格由 GSAP 逐帧写入 ref span 的 textContent（.stock-price），React 不受控渲染该文本
 *     （规则四：避免受控 text 与 GSAP 每帧抢写）；额外 scale 脉冲（transform）。
 *   - 闪烁为 .stock-flash 覆盖层 opacity 脉冲（颜色按方向 data-dir，A 股红涨绿跌）。
 * 登记：.stock-price（transform）、.stock-flash（opacity）。可重复触发 tween overwrite:'auto'。
 * 涨跌额/涨跌幅用普通 React 文本（非 GSAP 接管元素），不冲突。
 */

import { useRef } from 'react';
import gsap from 'gsap';
import { useStockIntro } from '../animations';
import {
  formatPrice,
  formatSigned,
  formatChangePct,
  priceDirection,
  directionClass,
} from '../format';
import type { StockQuoteData } from '../../api/stocks';

interface PriceTickerProps {
  quote: StockQuoteData | null;
}

export function PriceTicker({ quote }: PriceTickerProps) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const priceRef = useRef<HTMLSpanElement>(null);
  const flashRef = useRef<HTMLSpanElement>(null);
  const prevPriceRef = useRef<number | null>(null);

  const price = quote?.price ?? null;
  const dir = quote ? priceDirection(quote.change) : 'flat';

  useStockIntro(
    scopeRef,
    ({ reduce }) => {
      const el = priceRef.current;
      if (!el || price === null) { return; }
      const prev = prevPriceRef.current;

      if (prev === null) {
        // 首帧：直接落值，不做滚动/闪烁
        el.textContent = formatPrice(price);
        prevPriceRef.current = price;
        return;
      }

      // 数字滚动：GSAP 写 textContent（非受控文本）
      const proxy = { v: prev };
      gsap.to(proxy, {
        v: price,
        duration: reduce ? 0 : 0.5,
        ease: 'power1.out',
        overwrite: 'auto',
        onUpdate: () => { el.textContent = formatPrice(proxy.v); },
      });

      if (prev !== price) {
        // scale 脉冲（transform）
        gsap.fromTo(
          el,
          { scale: 1.06 },
          { scale: 1, duration: reduce ? 0 : 0.4, ease: 'power2.out', overwrite: 'auto' },
        );
        // 底色闪烁（opacity 覆盖层）
        const flash = flashRef.current;
        if (flash) {
          flash.dataset.dir = priceDirection(price - prev);
          gsap.fromTo(
            flash,
            { opacity: reduce ? 0 : 0.35 },
            { opacity: 0, duration: reduce ? 0 : 0.6, ease: 'power1.out', overwrite: 'auto' },
          );
        }
      }
      prevPriceRef.current = price;
    },
    [price],
  );

  return (
    <div className="stock-ticker" ref={scopeRef}>
      <span className="stock-flash" ref={flashRef} aria-hidden />
      <div className="stock-ticker-main">
        {/* 价格文本由 GSAP 写入，React 不渲染其内容 */}
        <span className={`stock-price stock-num ${directionClass(dir)}`} ref={priceRef} />
        {quote && (
          <div className={`stock-change ${directionClass(dir)}`}>
            <span className="stock-num">{formatSigned(quote.change)}</span>
            <span className="stock-num">{formatChangePct(quote.change_pct)}</span>
          </div>
        )}
      </div>
      {quote && (
        <dl className="stock-ticker-stats">
          <div><dt>今开</dt><dd className="stock-num">{formatPrice(quote.open)}</dd></div>
          <div><dt>最高</dt><dd className="stock-num">{formatPrice(quote.high)}</dd></div>
          <div><dt>最低</dt><dd className="stock-num">{formatPrice(quote.low)}</dd></div>
          <div><dt>昨收</dt><dd className="stock-num">{formatPrice(quote.prev_close)}</dd></div>
        </dl>
      )}
    </div>
  );
}

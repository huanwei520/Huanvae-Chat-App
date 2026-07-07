/**
 * 盘口行情轮询 Hook — 默认 6s 轮询，离开即停
 *
 * 用于个股/ETF 详情的盘口五档实时刷新。组件卸载或依赖变化时清理定时器，
 * 保证「离开详情视图即停止轮询」（不留后台请求）。
 */

import { useEffect, useRef, useState } from 'react';
import type { StockQuoteData } from '../../api/stocks';

export interface QuotePollingState {
  quote: StockQuoteData | null;
  error: string | null;
  /** 首帧是否加载中（后续轮询不置 loading，避免闪烁） */
  loading: boolean;
}

/**
 * @param loader 拉取盘口的函数（已绑定 api + symbol/market）
 * @param key 标的键（symbol+market），变化时重置并重新轮询
 * @param intervalMs 轮询间隔，默认 6000
 */
export function useQuotePolling(
  loader: () => Promise<StockQuoteData>,
  key: string,
  intervalMs = 6000,
): QuotePollingState {
  const [quote, setQuote] = useState<StockQuoteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setQuote(null);

    const tick = async () => {
      try {
        const q = await loaderRef.current();
        if (!cancelled) {
          setQuote(q);
          setError(null); // 成功一轮清掉上一轮的瞬时错误，避免被 PanelBody 永久锁在 error 态
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    };

    void tick();
    const timer = setInterval(() => { void tick(); }, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key, intervalMs]);

  return { quote, error, loading };
}

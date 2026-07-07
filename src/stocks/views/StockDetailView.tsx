/**
 * 个股详情视图
 *
 * 四面板：K线(日/周) · 盘口五档(6s 轮询,离开即停) · AI 情报 · 财报摘要；逐面板独立 loading/error。
 * 动画：视图级 useStockIntro（A1 .stocks-panel + A5 .stocks-view）；PriceTicker(A3)/DepthPanel(B4) 自持。
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ApiClient } from '../../api/client';
import {
  getKline, getQuote, getIntel, getFinancials,
  type KlinePeriod, type StockIntelData, type StockFinancialsData,
} from '../../api/stocks';
import { useAsyncData, type AsyncRetryOpts } from '../hooks/useAsyncData';
import { isIndexSymbol } from '../classify';
import { useQuotePolling } from '../hooks/useQuotePolling';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useStockIntro } from '../animations';
import { useStockNav, type StockSelection } from '../store';
import { AppButton } from '../../components/common/AppButton';
import { PanelBody } from '../components/PanelBody';
import { KLineChart } from '../components/KLineChart';
import { PriceTicker } from '../components/PriceTicker';
import { DepthPanel } from '../components/DepthPanel';
import { IntelPanel } from '../components/IntelPanel';
import { FinancialsPanel } from '../components/FinancialsPanel';

interface StockDetailViewProps {
  api: ApiClient;
  selection: StockSelection;
}

/** 需求驱动端点重试：约 4 次 × 2.5s ≈ 10s，覆盖 A 股快照秒级填充（美股填充慢则耗尽后落 error） */
const DEMAND_RETRY: AsyncRetryOpts = { attempts: 4, delayMs: 2500 };

export function StockDetailView({ api, selection }: StockDetailViewProps) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const backToOverview = useStockNav((s) => s.backToOverview);
  const [period, setPeriod] = useState<KlinePeriod>('daily');
  const { symbol, market, name } = selection;

  // 指数（^IXIC / ^DJI 等）天然无 AI 情报 / 财报：隐藏这两面板，并跳过其请求
  // （否则对指数发起注定 404 的 DEMAND_RETRY 重试，纯浪费）。K 线仍拉取，
  // 无 K 线源时经 gracefulNotFound 优雅降级为灰字空态。
  const isIndex = isIndexSymbol(symbol);

  // Esc = 返回总览（window 级监听，焦点在 K 线 canvas 等非受控子元素时也生效）
  useEscapeKey(backToOverview);

  // 需求驱动端点首开时快照可能未就绪（盘口轮询注册需求后数秒填充）：重试吸收填充延迟。
  // 美股/美指恒不复权（fetcher 存 adjust=''）：传 '' 与写入键对齐，A 股仍走 qfq。
  const klineLoader = useCallback(
    () => getKline(api, symbol, market, period, market === 'us' ? '' : 'qfq'),
    [api, symbol, market, period],
  );
  const kline = useAsyncData(klineLoader, [klineLoader], DEMAND_RETRY);

  const quoteLoader = useCallback(() => getQuote(api, symbol, market), [api, symbol, market]);
  const quote = useQuotePolling(quoteLoader, `${market}:${symbol}`);

  // 指数不发情报/财报请求（Promise.resolve(null)）；面板也不渲染，data 仅供非指数消费。
  const intelLoader = useCallback(
    (): Promise<StockIntelData | null> => (isIndex ? Promise.resolve(null) : getIntel(api, symbol, market)),
    [api, symbol, market, isIndex],
  );
  const intel = useAsyncData(intelLoader, [intelLoader], DEMAND_RETRY);

  const finLoader = useCallback(
    (): Promise<StockFinancialsData | null> => (isIndex ? Promise.resolve(null) : getFinancials(api, symbol, market)),
    [api, symbol, market, isIndex],
  );
  const financials = useAsyncData(finLoader, [finLoader], DEMAND_RETRY);

  useStockIntro(scopeRef, ({ reduce, from }) => {
    from(scopeRef.current, { opacity: 0, duration: reduce ? 0 : 0.3, overwrite: 'auto' });
    from('.stocks-panel', {
      opacity: 0,
      y: 18,
      duration: reduce ? 0 : 0.4,
      stagger: reduce ? 0 : 0.06,
      overwrite: 'auto',
    });
  }, []);

  const candles = useMemo(() => kline.data?.candles ?? [], [kline.data]);

  return (
    <div className="stocks-view stock-detail" ref={scopeRef}>
      <header className="stock-detail-head">
        <AppButton variant="ghost" size="sm" onClick={backToOverview} aria-label="返回总览">
          ← 返回
        </AppButton>
        <div className="stock-detail-title">
          <span className="stock-detail-name">{name}</span>
          <span className="stock-detail-symbol">{symbol} · {market.toUpperCase()}</span>
        </div>
        <PriceTicker quote={quote.quote} />
      </header>

      <div className="stock-detail-grid">
        <section className="stocks-panel stock-kline-panel">
          <div className="stock-panel-head">
            <span className="stock-panel-title">K 线</span>
            <div className="stock-period-toggle">
              {(['daily', 'weekly'] as KlinePeriod[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`stock-period-btn${period === p ? ' active' : ''}`}
                  onClick={() => setPeriod(p)}
                >
                  {p === 'daily' ? '日K' : '周K'}
                </button>
              ))}
            </div>
          </div>
          <PanelBody
            loading={kline.loading}
            error={kline.error}
            isEmpty={candles.length === 0}
            loadingMessage="加载 K 线..."
            emptyMessage="暂无 K 线数据"
            gracefulNotFound
          >
            <KLineChart candles={candles} adjustNote={kline.data?.adjust_note} />
          </PanelBody>
        </section>

        <section className="stocks-panel stock-depth-wrap">
          <div className="stock-panel-head">
            <span className="stock-panel-title">盘口五档</span>
          </div>
          <PanelBody
            loading={quote.loading}
            error={quote.error}
            isEmpty={!quote.quote}
            loadingMessage="加载盘口..."
            emptyMessage="暂无盘口"
          >
            <DepthPanel quote={quote.quote} />
          </PanelBody>
        </section>

        {/* 指数无 AI 情报 / 财报，隐藏这两面板（美股个股 / A 股仍保留） */}
        {!isIndex && <IntelPanel data={intel.data} loading={intel.loading} error={intel.error} />}
        {!isIndex && (
          <FinancialsPanel data={financials.data} loading={financials.loading} error={financials.error} />
        )}
      </div>
    </div>
  );
}

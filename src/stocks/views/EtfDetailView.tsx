/**
 * ETF 详情视图
 *
 * 组成：K线(恒不复权,角标"不复权") + 基本信息卡 + 盘口五档(6s 轮询)。
 * 动画：视图级 useStockIntro（A1 .stocks-panel + A5 .stocks-view）；PriceTicker(A3)/DepthPanel(B4) 自持。
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ApiClient } from '../../api/client';
import { getEtfKline, getEtfQuote, type KlinePeriod } from '../../api/stocks';
import { useAsyncData, type AsyncRetryOpts } from '../hooks/useAsyncData';
import { useQuotePolling } from '../hooks/useQuotePolling';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useStockIntro } from '../animations';
import { useStockNav, type StockSelection } from '../store';
import { AppButton } from '../../components/common/AppButton';
import { PanelBody } from '../components/PanelBody';
import { KLineChart } from '../components/KLineChart';
import { PriceTicker } from '../components/PriceTicker';
import { DepthPanel } from '../components/DepthPanel';
import { formatDataTime } from '../format';

interface EtfDetailViewProps {
  api: ApiClient;
  selection: StockSelection;
}

/** 需求驱动端点重试（同个股详情）：首开快照未就绪时以 loading 吸收填充延迟 */
const DEMAND_RETRY: AsyncRetryOpts = { attempts: 4, delayMs: 2500 };

export function EtfDetailView({ api, selection }: EtfDetailViewProps) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const backToOverview = useStockNav((s) => s.backToOverview);
  const [period, setPeriod] = useState<KlinePeriod>('daily');
  const { symbol, name } = selection;

  // Esc = 返回总览（window 级监听，焦点在 K 线 canvas 等非受控子元素时也生效）
  useEscapeKey(backToOverview);

  const klineLoader = useCallback(() => getEtfKline(api, symbol, period), [api, symbol, period]);
  const kline = useAsyncData(klineLoader, [klineLoader], DEMAND_RETRY);

  const quoteLoader = useCallback(() => getEtfQuote(api, symbol), [api, symbol]);
  const quote = useQuotePolling(quoteLoader, `etf:${symbol}`);

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
    <div className="stocks-view stock-etf-detail" ref={scopeRef}>
      <header className="stock-detail-head">
        <AppButton variant="ghost" size="sm" onClick={backToOverview} aria-label="返回总览">
          ← 返回
        </AppButton>
        <div className="stock-detail-title">
          <span className="stock-detail-name">{name}</span>
          <span className="stock-detail-symbol">{symbol} · ETF</span>
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
            <KLineChart candles={candles} adjustNote={kline.data?.adjust_note ?? '不复权'} />
          </PanelBody>
        </section>

        <section className="stocks-panel stock-etf-info">
          <div className="stock-panel-head">
            <span className="stock-panel-title">基本信息</span>
          </div>
          <dl className="stock-info-card">
            <div><dt>名称</dt><dd>{name}</dd></div>
            <div><dt>代码</dt><dd className="stock-num">{symbol}</dd></div>
            <div><dt>复权</dt><dd>不复权</dd></div>
            <div><dt>数据时点</dt><dd>{formatDataTime(quote.quote?.fetched_at)}</dd></div>
          </dl>
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
      </div>
    </div>
  );
}

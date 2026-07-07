/**
 * 总览视图
 *
 * 组成：顶部搜索 + 政策风向 + AI 排行榜(⟳) + 准确率 + ETF 两品类 + 新闻。
 * 动画：视图级 useStockIntro 承担 A1（.stocks-panel stagger 进场）+ A5（.stocks-view 淡入）；
 *   各面板的内部动画（A2/A6）由面板自身 scope 承担（选择器互不重叠）。
 * 数据：每面板独立 useAsyncData（逐面板 loading/error）。
 */

import { useCallback, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { ApiClient } from '../../api/client';
import { ErrorToast } from '../../components/common/ErrorToast';
import {
  getHome, getRanking, getAccuracy, getTrackHistory, getEtfList, getMarketWeather, runRanking,
  type StockRankingItem, type StockEtfItem, type StockSearchItem,
} from '../../api/stocks';
import { useAsyncData } from '../hooks/useAsyncData';
import { useStockIntro } from '../animations';
import { useStockNav } from '../store';
import { StockSearchBox } from '../components/StockSearchBox';
import { MarketWeatherPanel } from '../components/MarketWeatherPanel';
import { PolicyPanel } from '../components/PolicyPanel';
import { RankingPanel } from '../components/RankingPanel';
import { AccuracyPanel } from '../components/AccuracyPanel';
import { EtfListPanel } from '../components/EtfListPanel';
import { NewsPanel } from '../components/NewsPanel';

interface OverviewViewProps {
  api: ApiClient;
}

export function OverviewView({ api }: OverviewViewProps) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const openStock = useStockNav((s) => s.openStock);
  const openEtf = useStockNav((s) => s.openEtf);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const weatherLoader = useCallback(() => getMarketWeather(api), [api]);
  const homeLoader = useCallback(() => getHome(api), [api]);
  const rankingLoader = useCallback(() => getRanking(api), [api]);
  const accuracyLoader = useCallback(() => getAccuracy(api), [api]);
  const historyLoader = useCallback(() => getTrackHistory(api), [api]);
  const etfLoader = useCallback(() => getEtfList(api), [api]);

  const weather = useAsyncData(weatherLoader, [weatherLoader]);
  const home = useAsyncData(homeLoader, [homeLoader]);
  const ranking = useAsyncData(rankingLoader, [rankingLoader]);
  const accuracy = useAsyncData(accuracyLoader, [accuracyLoader]);
  const history = useAsyncData(historyLoader, [historyLoader]);
  const etf = useAsyncData(etfLoader, [etfLoader]);

  // 视图级进场：view 淡入 + 面板 stagger（reduced-motion → duration 0）
  useStockIntro(scopeRef, ({ reduce, from }) => {
    from(scopeRef.current, {
      opacity: 0,
      duration: reduce ? 0 : 0.3,
      overwrite: 'auto',
    });
    from('.stocks-panel', {
      opacity: 0,
      y: 18,
      duration: reduce ? 0 : 0.4,
      stagger: reduce ? 0 : 0.06,
      overwrite: 'auto',
    });
  }, []);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setRunError(null);
    try {
      await runRanking(api);
      // 触发后重拉一次排行榜（真实轮询在真数据联调阶段细化）
      ranking.reload();
    } catch (err) {
      // 触发（POST /ranking/run）失败单独提示：面板 error 态只覆盖 getRanking 拉取失败，
      // 不反映触发链路，否则用户点 ⟳ 后 spinner 停但零反馈。
      setRunError(err instanceof Error ? err.message : '触发排序失败，请稍后重试');
    } finally {
      setRunning(false);
    }
  }, [api, ranking]);

  // 搜索框结果按 market 分流：ETF→ETF 详情（getEtfKline，不复权）、其余（cn/us）→个股详情。
  // 搜索框是唯一混合个股 + ETF 的入口，故只有它需要分流。
  const handleSelectSearch = useCallback((item: StockSearchItem) => {
    if (item.market === 'etf') {
      openEtf(item.symbol, item.name);
    } else {
      openStock({ symbol: item.symbol, market: item.market, name: item.name });
    }
  }, [openStock, openEtf]);

  // 排行榜全为个股（RankingPanel），直接开个股详情。name 可空时以 symbol 兜底做标题。
  const handleSelectStock = useCallback((item: StockRankingItem) => {
    openStock({ symbol: item.symbol, market: item.market, name: item.name ?? item.symbol });
  }, [openStock]);

  // ETF 列表面板全为 ETF，直接开 ETF 详情。
  const handleSelectEtf = useCallback((item: StockEtfItem) => {
    openEtf(item.symbol, item.name);
  }, [openEtf]);

  return (
    <div className="stocks-view stock-overview" ref={scopeRef}>
      <div className="stock-overview-search">
        <StockSearchBox api={api} onSelect={handleSelectSearch} />
      </div>

      <div className="stock-overview-grid">
        <div className="stock-overview-col">
          <MarketWeatherPanel data={weather.data} loading={weather.loading} error={weather.error} />
          <PolicyPanel data={home.data?.policy ?? null} loading={home.loading} error={home.error} />
          <RankingPanel
            data={ranking.data}
            loading={ranking.loading}
            error={ranking.error}
            running={running}
            onRun={handleRun}
            onSelect={handleSelectStock}
          />
        </div>
        <div className="stock-overview-col">
          <AccuracyPanel
            accuracy={accuracy.data}
            history={history.data}
            loading={accuracy.loading}
            error={accuracy.error}
          />
          <EtfListPanel data={etf.data} loading={etf.loading} error={etf.error} onSelect={handleSelectEtf} />
          <NewsPanel data={home.data?.news ?? null} loading={home.loading} error={home.error} />
        </div>
      </div>

      {/* 手动排序触发（POST）失败提示（面板 error 态不覆盖触发链路） */}
      <AnimatePresence>
        {runError && (
          <ErrorToast message={runError} onClose={() => setRunError(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

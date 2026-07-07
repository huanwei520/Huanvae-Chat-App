/**
 * AI 选股排行榜面板（总览视图）
 *
 * 动画 A2：卡片进场 stagger（fade+y）+ 分数条 scaleX 展开（GSAP，transform-only）。
 * 登记：.stock-rank-card（transform/opacity）、.stock-score-bar（transform）。
 * ⟳ 手动触发排序：调用方注入 onRun（插入任务请求，成功后轮询 ranking 更新）。
 */

import { useRef } from 'react';
import { AppButton } from '../../components/common/AppButton';
import { PanelBody } from './PanelBody';
import { useStockIntro } from '../animations';
import { formatPrice, formatDataTime } from '../format';
import type { StockRankingData, StockRankingItem } from '../../api/stocks';

interface RankingPanelProps {
  data: StockRankingData | null;
  loading: boolean;
  error: string | null;
  running: boolean;
  onRun: () => void;
  onSelect: (item: StockRankingItem) => void;
}

/** 分数归一到 [0,1]（榜内最高分为满格），无有效分给 0 */
function scoreRatio(score: number | null, maxScore: number): number {
  if (score === null || !Number.isFinite(score) || maxScore <= 0) { return 0; }
  return Math.max(0, Math.min(1, score / maxScore));
}

export function RankingPanel({ data, loading, error, running, onRun, onSelect }: RankingPanelProps) {
  const scopeRef = useRef<HTMLElement>(null);
  const maxScore = data?.ranking.reduce((m, it) => Math.max(m, it.score ?? 0), 0) ?? 0;

  useStockIntro(
    scopeRef,
    ({ reduce, from, fromTo }) => {
      from('.stock-rank-card', {
        opacity: 0,
        y: 16,
        duration: reduce ? 0 : 0.4,
        stagger: reduce ? 0 : 0.05,
        overwrite: 'auto',
      });
      // A2 编排：分数条在卡片进场后再 scaleX 展开（reduced-motion 时瞬时到位）。
      fromTo(
        '.stock-score-bar',
        { scaleX: 0 },
        {
          scaleX: (_i, el) => Number((el as HTMLElement).dataset.ratio ?? 0),
          transformOrigin: 'left center',
          duration: reduce ? 0 : 0.6,
          stagger: reduce ? 0 : 0.05,
          ease: 'power2.out',
          delay: reduce ? 0 : 0.3,
          overwrite: 'auto',
        },
      );
    },
    [data],
  );

  return (
    <section className="stocks-panel stock-ranking-panel" ref={scopeRef}>
      <div className="stock-panel-head">
        <span className="stock-panel-title">AI 选股排行榜</span>
        {data && (
          <span className="stock-panel-time">数据时点：{formatDataTime(data.generated_at)}</span>
        )}
        <AppButton
          variant="secondary"
          size="sm"
          loading={running}
          onClick={onRun}
          aria-label="手动触发排序"
        >
          ⟳ 手动排序
        </AppButton>
      </div>

      <PanelBody
        loading={loading}
        error={error}
        isEmpty={!data || data.ranking.length === 0}
        loadingMessage="加载排行榜..."
        emptyMessage="暂无排行榜数据"
      >
        <div className="stock-rank-list">
          {(data?.ranking ?? []).map((item) => (
            <button
              key={`${item.market}:${item.symbol}`}
              type="button"
              className="stock-rank-card"
              onClick={() => onSelect(item)}
            >
              <span className="stock-rank-no">{item.rank}</span>
              <div className="stock-rank-main">
                <div className="stock-rank-name">
                  <span className="stock-rank-title">{item.name ?? '—'}</span>
                  <span className="stock-rank-symbol">{item.symbol}</span>
                </div>
                <div className="stock-score-track">
                  <span className="stock-score-bar" data-ratio={scoreRatio(item.score, maxScore)} />
                </div>
                {item.reasons.length > 0 && (
                  <p className="stock-rank-reason">{item.reasons[0]}</p>
                )}
              </div>
              <div className="stock-rank-side">
                <span className="stock-score-value stock-num">{item.score?.toFixed(1) ?? '—'}</span>
                {item.price_at_ranking !== null && (
                  <span className="stock-rank-price stock-num">{formatPrice(item.price_at_ranking)}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </PanelBody>
    </section>
  );
}

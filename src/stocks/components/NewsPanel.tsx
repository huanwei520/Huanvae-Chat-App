/**
 * 新闻列表面板（总览视图）
 *
 * 动画 A6：新闻行进场 stagger（fade+y，GSAP）。登记：.stock-policy-item（transform/opacity）
 * —— 与政策条目共用动画语义与 selector。
 */

import { useRef } from 'react';
import { PanelBody } from './PanelBody';
import { useStockIntro } from '../animations';
import { formatPublished } from '../format';
import type { StockNewsBlock } from '../../api/stocks';

interface NewsPanelProps {
  data: StockNewsBlock | null;
  loading: boolean;
  error: string | null;
}

export function NewsPanel({ data, loading, error }: NewsPanelProps) {
  const scopeRef = useRef<HTMLElement>(null);

  useStockIntro(
    scopeRef,
    ({ reduce, from }) => {
      from('.stock-policy-item', {
        opacity: 0,
        y: 12,
        duration: reduce ? 0 : 0.35,
        stagger: reduce ? 0 : 0.04,
        overwrite: 'auto',
      });
    },
    [data],
  );

  return (
    <section className="stocks-panel stock-news-panel" ref={scopeRef}>
      <div className="stock-panel-head">
        <span className="stock-panel-title">市场新闻</span>
      </div>

      <PanelBody
        loading={loading}
        error={error}
        isEmpty={!data || data.items.length === 0}
        loadingMessage="加载新闻..."
        emptyMessage="暂无新闻"
      >
        <ul className="stock-news-list">
          {(data?.items ?? []).map((item, idx) => (
            <li key={idx} className="stock-policy-item stock-news-row">
              <a href={item.url} target="_blank" rel="noreferrer" className="stock-news-title">
                {item.title}
              </a>
              <div className="stock-news-meta">
                <span className="stock-news-source">{item.source}</span>
                <span className="stock-news-date">{formatPublished(item.published)}</span>
              </div>
            </li>
          ))}
        </ul>
      </PanelBody>
    </section>
  );
}

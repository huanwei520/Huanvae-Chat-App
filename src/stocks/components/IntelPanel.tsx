/**
 * AI 情报面板（个股详情）
 *
 * 摘要 + 分节 + 逐条真实源（含发布时间，源无日期显示「无日期」）。
 * 无自有 GSAP，进场由视图级 .stocks-panel stagger 承担。
 */

import { PanelBody } from './PanelBody';
import { formatDataTime, formatPublished } from '../format';
import type { StockIntelData, StockIntelSections } from '../../api/stocks';

interface IntelPanelProps {
  data: StockIntelData | null;
  loading: boolean;
  error: string | null;
}

/** 情报分节渲染顺序 + 中文标题（键对应后端 sections 对象四维度） */
const INTEL_SECTIONS: { key: keyof StockIntelSections; title: string }[] = [
  { key: 'hotspots', title: '热点' },
  { key: 'policy', title: '政策' },
  { key: 'risks', title: '风险' },
  { key: 'news', title: '相关新闻' },
];

export function IntelPanel({ data, loading, error }: IntelPanelProps) {
  return (
    <section className="stocks-panel stock-intel-panel">
      <div className="stock-panel-head">
        <span className="stock-panel-title">AI 情报</span>
        {data && (
          <span className="stock-panel-time">
            {data.model} · {data.article_count} 篇 · {formatDataTime(data.fetched_at)}
          </span>
        )}
      </div>

      <PanelBody
        loading={loading}
        error={error}
        isEmpty={!data}
        loadingMessage="加载情报..."
        emptyMessage="暂无情报"
        gracefulNotFound
      >
        <>
          {data?.summary && <p className="stock-intel-summary">{data.summary}</p>}
          {data && INTEL_SECTIONS.map(({ key, title }) => {
            const points = data.sections?.[key] ?? [];
            if (points.length === 0) { return null; }
            return (
              <div key={key} className="stock-intel-section">
                <span className="stock-subhead">{title}</span>
                <ul className="stock-intel-points">
                  {points.map((pt, pi) => (
                    <li key={pi} className="stock-intel-point">{pt}</li>
                  ))}
                </ul>
              </div>
            );
          })}
          {data && data.sources.length > 0 && (
            <div className="stock-intel-sources">
              <span className="stock-subhead">来源</span>
              <ul>
                {data.sources.map((src, si) => (
                  <li key={si}>
                    <a href={src.url} target="_blank" rel="noreferrer">{src.title}</a>
                    <span className="stock-intel-source-date">{formatPublished(src.published)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      </PanelBody>
    </section>
  );
}

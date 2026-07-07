/**
 * 政策风向面板（总览视图）
 *
 * 动画 A6：政策条目进场 stagger（fade+y，GSAP）。登记：.stock-policy-item（transform/opacity）。
 * 条目来源可折叠展开。
 */

import { useRef, useState } from 'react';
import { PanelBody } from './PanelBody';
import { useStockIntro } from '../animations';
import { formatDataTime, formatPublished } from '../format';
import type { StockPolicyBlock } from '../../api/stocks';

interface PolicyPanelProps {
  data: StockPolicyBlock | null;
  loading: boolean;
  error: string | null;
}

export function PolicyPanel({ data, loading, error }: PolicyPanelProps) {
  const scopeRef = useRef<HTMLElement>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);

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
    <section className="stocks-panel stock-policy-panel" ref={scopeRef}>
      <div className="stock-panel-head">
        <span className="stock-panel-title">政策风向</span>
        {data && <span className="stock-panel-time">生成时间：{formatDataTime(data.generated_at)}</span>}
      </div>

      <PanelBody
        loading={loading}
        error={error}
        isEmpty={!data || data.items.length === 0}
        loadingMessage="加载政策风向..."
        emptyMessage="暂无政策数据"
      >
        <>
          {data?.summary && <p className="stock-policy-summary">{data.summary}</p>}
          <div className="stock-policy-list">
            {(data?.items ?? []).map((item, idx) => (
              <div key={idx} className="stock-policy-item">
                <div className="stock-policy-item-head">
                  <span className="stock-tag">{item.tag}</span>
                  <span className="stock-policy-item-point">{item.point}</span>
                </div>
              </div>
            ))}
          </div>
          {data && data.sources.length > 0 && (
            <div className="stock-policy-source-block">
              <button
                type="button"
                className="stock-policy-toggle"
                onClick={() => setSourcesOpen((v) => !v)}
              >
                {sourcesOpen ? '收起来源' : `来源 (${data.sources.length})`}
              </button>
              {sourcesOpen && (
                <ul className="stock-policy-sources">
                  {data.sources.map((src, si) => (
                    <li key={si}>
                      <a href={src.url} target="_blank" rel="noreferrer">{src.title}</a>
                      <span className="stock-policy-source-date">{formatPublished(src.published)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      </PanelBody>
    </section>
  );
}

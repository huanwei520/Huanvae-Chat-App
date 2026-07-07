/**
 * 财报摘要面板（个股详情）
 *
 * 关键指标 + 报表（利润/资产/现金流三表）；数字等宽。
 * 无自有 GSAP，进场由视图级 .stocks-panel stagger 承担。
 */

import { PanelBody } from './PanelBody';
import { formatDataTime, formatAmount } from '../format';
import type { StockFinancialsData, StockStatementRow } from '../../api/stocks';

interface FinancialsPanelProps {
  data: StockFinancialsData | null;
  loading: boolean;
  error: string | null;
}

/** 三表渲染顺序 + 中文表头（键对应后端 statements 对象的三个字段） */
const STATEMENT_TABLES: { key: 'income' | 'balance' | 'cashflow'; title: string }[] = [
  { key: 'income', title: '利润表' },
  { key: 'balance', title: '资产负债表' },
  { key: 'cashflow', title: '现金流量表' },
];

export function FinancialsPanel({ data, loading, error }: FinancialsPanelProps) {
  return (
    <section className="stocks-panel stock-financials-panel">
      <div className="stock-panel-head">
        <span className="stock-panel-title">财报摘要</span>
        {data && <span className="stock-panel-time">{data.source} · {formatDataTime(data.fetched_at)}</span>}
      </div>

      <PanelBody
        loading={loading}
        error={error}
        isEmpty={!data}
        loadingMessage="加载财报..."
        emptyMessage="暂无财报"
        gracefulNotFound
      >
        <>
          {data && data.highlights.length > 0 && (
            <div className="stock-financials-highlights">
              {data.highlights.map((h, idx) => (
                <div key={idx} className="stock-highlight">
                  <span className="stock-highlight-label">{h.label}</span>
                  <span className="stock-highlight-value stock-num">{formatAmount(h.value)}</span>
                </div>
              ))}
            </div>
          )}
          {data && STATEMENT_TABLES.map(({ key, title }) => {
            const rows: StockStatementRow[] = data.statements[key] ?? [];
            if (rows.length === 0) { return null; }
            return (
              <div key={key} className="stock-financials-statement">
                <span className="stock-subhead">{title}</span>
                <div className="stock-table-scroll">
                  <table className="stock-table stock-financials-table">
                    <thead>
                      <tr>
                        <th>指标</th>
                        {data.periods.map((p) => <th key={p} className="stock-num-col">{p}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, ri) => (
                        <tr key={ri}>
                          <td>{row.item}</td>
                          {data.periods.map((p) => (
                            <td key={p} className="stock-num-col stock-num">
                              {p in row.values ? formatAmount(row.values[p]) : '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </>
      </PanelBody>
    </section>
  );
}

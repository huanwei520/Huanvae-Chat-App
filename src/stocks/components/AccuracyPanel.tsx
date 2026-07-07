/**
 * 准确率面板（总览视图）
 *
 * 1/5/20d 窗口命中率表 + 历史榜；数字用等宽（.stock-num）。
 * 无自有 GSAP，进场由视图级 .stocks-panel stagger 承担。
 */

import { ListEmpty } from '../../components/common/ListStates';
import { PanelBody } from './PanelBody';
import { formatPercent, formatSigned } from '../format';
import type { StockAccuracyData, StockTrackHistoryData } from '../../api/stocks';

interface AccuracyPanelProps {
  accuracy: StockAccuracyData | null;
  history: StockTrackHistoryData | null;
  loading: boolean;
  error: string | null;
}

/**
 * 命中率（占比 ratio 0-1）→ 百分比展示；null（无满窗样本）→ 占位。
 * 数值口径按设计文档（hit_rate=超额>0 占比）；生产当前无满窗样本，故数值路径尚未经真数据核实。
 */
function fmtHitRate(v: number | null): string {
  return v === null || v === undefined ? '—' : formatPercent(v * 100);
}

/** 平均超额（return ratio）→ 带符号百分比展示；null → 占位。口径同上，未经真数据核实。 */
function fmtExcess(v: number | null): string {
  return v === null || v === undefined ? '—' : `${formatSigned(v * 100)}%`;
}

export function AccuracyPanel({ accuracy, history, loading, error }: AccuracyPanelProps) {
  return (
    <section className="stocks-panel stock-accuracy-panel">
      <div className="stock-panel-head">
        <span className="stock-panel-title">准确率追踪</span>
        {accuracy && <span className="stock-panel-time">基准：{accuracy.benchmark}</span>}
      </div>

      <PanelBody
        loading={loading}
        error={error}
        isEmpty={!accuracy}
        loadingMessage="加载准确率..."
        emptyMessage="暂无准确率数据"
      >
        <>
          {accuracy && accuracy.records_evaluated === 0 ? (
            // 尚无满窗样本：显示后端提示文案，不铺一张全占位的表
            <p className="stock-accuracy-hint">{accuracy.hint ?? '暂无已满窗口的追踪记录'}</p>
          ) : (
            <table className="stock-table stock-accuracy-table">
              <thead>
                <tr>
                  <th>窗口</th>
                  <th className="stock-num-col">命中率</th>
                  <th className="stock-num-col">平均超额</th>
                  <th className="stock-num-col">样本</th>
                </tr>
              </thead>
              <tbody>
                {(accuracy?.windows ?? []).map((w) => {
                  const stat = accuracy?.overall[w];
                  return (
                    <tr key={w}>
                      <td>{w}</td>
                      <td className="stock-num-col stock-num">{fmtHitRate(stat?.hit_rate ?? null)}</td>
                      <td className="stock-num-col stock-num">{fmtExcess(stat?.avg_excess ?? null)}</td>
                      <td className="stock-num-col stock-num">{stat?.n ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="stock-accuracy-history">
            <span className="stock-subhead">历史榜</span>
            {!history || history.records.length === 0 ? (
              <ListEmpty message="暂无历史记录" />
            ) : (
              <table className="stock-table stock-history-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>标的</th>
                    <th className="stock-num-col">1d 超额</th>
                    <th className="stock-num-col">5d 超额</th>
                    <th className="stock-num-col">20d 超额</th>
                  </tr>
                </thead>
                <tbody>
                  {history.records.map((r, idx) => (
                    <tr key={`${r.as_of}:${r.symbol}:${idx}`}>
                      <td>
                        {r.as_of}
                        {r.is_backfill && <span className="stock-backfill-badge">回填</span>}
                      </td>
                      <td>{r.name ?? '—'}</td>
                      <td className="stock-num-col stock-num">{fmtExcess(r.excess_1d)}</td>
                      <td className="stock-num-col stock-num">{fmtExcess(r.excess_5d)}</td>
                      <td className="stock-num-col stock-num">{fmtExcess(r.excess_20d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      </PanelBody>
    </section>
  );
}

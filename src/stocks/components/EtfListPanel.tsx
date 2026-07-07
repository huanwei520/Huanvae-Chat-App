/**
 * ETF 两品类列表面板（总览视图）
 *
 * 无自有 GSAP，进场由视图级 .stocks-panel stagger 承担。
 * 涨跌用 A 股语义色（.stock-dir--up/down），数字等宽。
 *
 * 键盘可达：每行 tabIndex+role=button，Tab 聚焦、Enter/Space 打开详情；焦点环用 JS 判定
 * （kbdFocusedKey，同 UnifiedList 先例；WKWebView 对非按钮元素 :focus-visible 不稳，不能纯 CSS），
 * 高亮仅动 background/box-shadow，不碰 transform/opacity。
 */

import { useState } from 'react';
import { PanelBody } from './PanelBody';
import { formatPrice, formatChangePct, priceDirection, directionClass } from '../format';
import type { StockEtfListData, StockEtfItem } from '../../api/stocks';

interface EtfListPanelProps {
  data: StockEtfListData | null;
  loading: boolean;
  error: string | null;
  onSelect: (item: StockEtfItem) => void;
}

export function EtfListPanel({ data, loading, error, onSelect }: EtfListPanelProps) {
  // 当前被聚焦（键盘/点击）的行 symbol：驱动 JS 焦点环，失焦清空
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>, item: StockEtfItem) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(item);
    }
  };

  return (
    <section className="stocks-panel stock-etf-panel">
      <div className="stock-panel-head">
        <span className="stock-panel-title">ETF 行情</span>
      </div>

      <PanelBody
        loading={loading}
        error={error}
        isEmpty={!data || data.categories.length === 0}
        loadingMessage="加载 ETF..."
        emptyMessage="暂无 ETF 数据"
      >
        {(data?.categories ?? []).map((cat) => (
          <div key={cat.name} className="stock-etf-category">
            <span className="stock-subhead">{cat.name}</span>
            <table className="stock-table stock-etf-table">
              <tbody>
                {cat.items.map((item) => {
                  const dir = priceDirection(item.change_pct);
                  return (
                    <tr
                      key={item.symbol}
                      className={`stock-etf-row${focusedKey === item.symbol ? ' stock-etf-row--kbd-active' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`${item.name} ${item.symbol}，打开详情`}
                      onClick={() => onSelect(item)}
                      onKeyDown={(e) => handleRowKeyDown(e, item)}
                      onFocus={() => setFocusedKey(item.symbol)}
                      onBlur={() => setFocusedKey(null)}
                    >
                      <td className="stock-etf-name">{item.name}</td>
                      <td className="stock-etf-symbol">{item.symbol}</td>
                      <td className={`stock-num-col stock-num ${directionClass(dir)}`}>
                        {formatPrice(item.price)}
                      </td>
                      <td className={`stock-num-col stock-num ${directionClass(dir)}`}>
                        {formatChangePct(item.change_pct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </PanelBody>
    </section>
  );
}

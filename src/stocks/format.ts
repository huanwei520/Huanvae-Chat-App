/**
 * 股票研究窗口 — 纯格式化工具
 *
 * 全部为无副作用纯函数，便于单测；组件里只调用、不内联逻辑。
 * 配色语义遵循 A 股惯例（涨=红 --stock-up，跌=绿 --stock-down，平=中性）。
 */

/** 涨跌方向 */
export type StockDirection = 'up' | 'down' | 'flat';

/** 由涨跌额（或涨跌幅）判断方向。0 或非有限值视为平。 */
export function priceDirection(change: number): StockDirection {
  if (!Number.isFinite(change) || change === 0) { return 'flat'; }
  return change > 0 ? 'up' : 'down';
}

/** 方向对应的 className 修饰（配合 CSS 变量 --stock-up/--stock-down）。 */
export function directionClass(dir: StockDirection): string {
  return `stock-dir--${dir}`;
}

/**
 * 格式化涨跌幅百分比，带正负号。
 * @param pct 百分比数值（3.21 表示 +3.21%）
 */
export function formatChangePct(pct: number): string {
  if (!Number.isFinite(pct)) { return '—'; }
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/** 格式化带正负号的数值（涨跌额等）。 */
export function formatSigned(value: number, digits = 2): string {
  if (!Number.isFinite(value)) { return '—'; }
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}`;
}

/** 格式化价格（无符号，固定小数）。 */
export function formatPrice(value: number, digits = 2): string {
  if (!Number.isFinite(value)) { return '—'; }
  return value.toFixed(digits);
}

/**
 * 格式化无符号百分比（如命中率），不带正负号。
 * @param pct 百分比数值（65 表示 65%）
 */
export function formatPercent(pct: number, digits = 2): string {
  if (!Number.isFinite(pct)) { return '—'; }
  return `${pct.toFixed(digits)}%`;
}

/**
 * 格式化成交额/市值为「亿/万」中文单位。
 * @param value 原始金额（元）
 */
export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) { return '—'; }
  const abs = Math.abs(value);
  if (abs >= 1e8) { return `${(value / 1e8).toFixed(2)}亿`; }
  if (abs >= 1e4) { return `${(value / 1e4).toFixed(2)}万`; }
  return value.toFixed(0);
}

/**
 * 格式化数据时点（fetched_at / as_of）为「本地时间」显示；空值给占位。
 * @param iso ISO 时间串或 null
 */
export function formatDataTime(iso: string | null | undefined): string {
  if (!iso) { return '时点未知'; }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) { return '时点未知'; }
  return d.toLocaleString();
}

/** 格式化真实源发布时间；源无日期（null）显示「无日期」，绝不用当前时间冒充。 */
export function formatPublished(iso: string | null | undefined): string {
  if (!iso) { return '无日期'; }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) { return '无日期'; }
  return d.toLocaleDateString();
}

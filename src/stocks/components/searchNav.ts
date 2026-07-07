/**
 * 股票搜索下拉 — 键盘导航纯逻辑
 *
 * 抽成无副作用纯函数，便于 vitest 零 mock 单测（StockSearchBox 组件测试只验连线）。
 */

/** 下拉列表 DOM id（供 aria-controls 指向 role="listbox" 容器）。 */
export const SEARCH_LISTBOX_ID = 'stock-search-listbox';

/** 第 i 个结果项的 DOM id（供 aria-activedescendant 指向当前高亮项）。 */
export function searchOptionId(index: number): string {
  return `${SEARCH_LISTBOX_ID}-opt-${index}`;
}

/**
 * 计算下拉的下一个高亮下标。
 *
 * 语义（对齐 UnifiedList 键盘光标：夹紧、不循环）：
 *   - `len <= 0`（无结果）→ 恒返回 -1；
 *   - 当前无高亮（current < 0）：↓ 落到首项 0、↑ 落到末项 len-1；
 *   - 已有高亮：在 [0, len-1] 内加 delta 后夹紧（首项再 ↑ / 末项再 ↓ 停在原地）。
 *
 * @param current 当前高亮下标（-1 表示无高亮）
 * @param len     结果条数
 * @param delta   +1 下移、-1 上移
 */
export function moveActiveIndex(current: number, len: number, delta: number): number {
  if (len <= 0) { return -1; }
  if (current < 0) { return delta > 0 ? 0 : len - 1; }
  return Math.min(len - 1, Math.max(0, current + delta));
}

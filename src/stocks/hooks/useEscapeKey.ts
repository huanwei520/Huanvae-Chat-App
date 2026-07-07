/**
 * Escape 键全局监听 Hook
 *
 * 详情视图用来实现「Esc = 返回总览」：无论焦点在视图内哪个可聚焦元素（K线/盘口/按钮），
 * 都能触发返回。用 window 级 keydown 监听（而非某个 DOM 节点 onKeyDown），避免焦点
 * 落在非受控子元素（如 klinecharts canvas）时收不到事件。
 *
 * 总览视图的搜索下拉自持局部 Escape（关下拉、焦点留输入框），与本 Hook 不冲突：
 * 搜索框在输入框 onKeyDown 里对 Escape 调用 stopPropagation，避免同一次 Esc 既关下拉又返回。
 */

import { useEffect } from 'react';

/**
 * 监听 window keydown，命中 Escape 时调用 onEscape。
 *
 * @param onEscape 触发回调（应为 useCallback 稳定引用，或 store action）
 * @param enabled  是否启用（默认 true）；false 时不挂监听
 */
export function useEscapeKey(onEscape: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) { return; }
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onEscape(); }
    };
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); };
  }, [onEscape, enabled]);
}

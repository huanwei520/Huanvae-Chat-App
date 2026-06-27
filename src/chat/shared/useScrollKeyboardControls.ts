import { useCallback } from 'react';
import type { KeyboardEvent, RefObject } from 'react';

/**
 * 给可滚动消息容器加键盘控制。
 *
 * - End → 滚到最新（底部）   Home → 滚到顶部
 * - PageDown / PageUp → 按视口高度的 90% 翻页
 */
export interface ScrollKeyboardControls {
  /** 直接展开到滚动容器 div 上的属性集合 */
  containerProps: {
    tabIndex: number;
    role: string;
    'aria-label': string;
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  };
}

const PAGE_SCROLL_RATIO = 0.9;

export function useScrollKeyboardControls(
  containerRef: RefObject<HTMLDivElement | null>,
  ariaLabel = '消息列表：End 到最新，Home 到顶部，PageUp/PageDown 翻页',
): ScrollKeyboardControls {
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const el = containerRef.current;
      if (!el) { return; }
      // 消息容器是 flex-direction: column-reverse，滚动原点在底部：
      // scrollTop=0 即最新（底部），向上（更旧）为负，顶部为 -(scrollHeight - clientHeight)。
      switch (e.key) {
        case 'End':
          e.preventDefault();
          el.scrollTop = 0;                                   // 最新（底部）
          break;
        case 'Home':
          e.preventDefault();
          el.scrollTop = -(el.scrollHeight - el.clientHeight); // 最旧（顶部）
          break;
        case 'PageDown':
          e.preventDefault();
          el.scrollTop += el.clientHeight * PAGE_SCROLL_RATIO; // 向更新/底部（趋向 0）
          break;
        case 'PageUp':
          e.preventDefault();
          el.scrollTop -= el.clientHeight * PAGE_SCROLL_RATIO; // 向更旧/顶部（趋向负）
          break;
        default:
          break;
      }
    },
    [containerRef],
  );

  return {
    containerProps: {
      tabIndex: 0,
      role: 'group',
      'aria-label': ariaLabel,
      onKeyDown,
    },
  };
}

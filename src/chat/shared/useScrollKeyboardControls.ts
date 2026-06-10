import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';

/**
 * 给可滚动消息容器加键盘控制 + 可靠的「仅键盘聚焦」标志。
 *
 * - End → 滚到最新（底部）   Home → 滚到顶部
 * - PageDown / PageUp → 按视口高度的 90% 翻页
 *
 * kbdFocused：仅当容器经由键盘（Tab）获得焦点时为 true；鼠标按下导致的聚焦不点亮。
 * 之所以用 JS 自行判定而非 CSS `:focus-visible`，是因为 Tauri macOS 的 WKWebView 对
 * `<div tabindex=0>` 的 `:focus-visible` 支持不稳定，会出现「聚焦了却无任何外环」的情况。
 */
export interface ScrollKeyboardControls {
  /** 容器是否处于键盘聚焦态（用于点亮焦点环） */
  kbdFocused: boolean;
  /** 直接展开到滚动容器 div 上的属性集合 */
  containerProps: {
    tabIndex: number;
    role: string;
    'aria-label': string;
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
    onFocus: () => void;
    onBlur: () => void;
    onPointerDown: () => void;
  };
}

const PAGE_SCROLL_RATIO = 0.9;

export function useScrollKeyboardControls(
  containerRef: RefObject<HTMLDivElement | null>,
  ariaLabel = '消息列表：End 到最新，Home 到顶部，PageUp/PageDown 翻页',
): ScrollKeyboardControls {
  const [kbdFocused, setKbdFocused] = useState(false);
  // 鼠标按下会先于 focus 触发；用它区分「键盘聚焦」与「鼠标聚焦」
  const pointerDownRef = useRef(false);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const el = containerRef.current;
      if (!el) { return; }
      switch (e.key) {
        case 'End':
          e.preventDefault();
          el.scrollTop = el.scrollHeight;
          break;
        case 'Home':
          e.preventDefault();
          el.scrollTop = 0;
          break;
        case 'PageDown':
          e.preventDefault();
          el.scrollTop += el.clientHeight * PAGE_SCROLL_RATIO;
          break;
        case 'PageUp':
          e.preventDefault();
          el.scrollTop -= el.clientHeight * PAGE_SCROLL_RATIO;
          break;
        default:
          break;
      }
    },
    [containerRef],
  );

  const onFocus = useCallback(() => {
    setKbdFocused(!pointerDownRef.current);
    pointerDownRef.current = false;
  }, []);
  const onBlur = useCallback(() => { setKbdFocused(false); }, []);
  const onPointerDown = useCallback(() => { pointerDownRef.current = true; }, []);

  return {
    kbdFocused,
    containerProps: {
      tabIndex: 0,
      role: 'group',
      'aria-label': ariaLabel,
      onKeyDown,
      onFocus,
      onBlur,
      onPointerDown,
    },
  };
}

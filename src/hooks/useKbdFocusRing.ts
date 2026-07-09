/**
 * 键盘可见焦点环双轨 Hook
 *
 * 背景：可点击的头像 / 顶栏容器是裸 div[role=button][tabindex=0]。WKWebView 对非按钮
 * 元素的 :focus-visible 支持不稳定，纯 CSS 焦点环不可靠，故用 JS 判定的类名
 * (a11y-kbd-focus) 作为可靠轨道，:focus-visible 作为原生降级；两轨共用同一 outline
 * （见 src/styles/base.css）。
 *
 * pointerDownRef 区分键盘 / 鼠标聚焦：指针按下引发的聚焦不显示焦点环，仅键盘 Tab
 * 聚焦时显示。
 *
 * keyed 形态：组件级调用一次，.map() 循环内用 handlersFor(key) / isKbdFocused(key)
 * 逐项挂载，不在循环里调 Hook（遵守 rules-of-hooks）。单实例场景传常量 key 即可。
 */
import { useCallback, useRef, useState } from 'react';

interface KbdFocusHandlers {
  onPointerDown: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

export interface KbdFocusRing {
  /** 指定 key 当前是否处于键盘聚焦态 */
  isKbdFocused: (key: string) => boolean;
  /** 为指定 key 生成 pointerDown / focus / blur 处理器 */
  handlersFor: (key: string) => KbdFocusHandlers;
}

export function useKbdFocusRing(): KbdFocusRing {
  // 最近一次聚焦前是否发生指针按下（区分鼠标点击聚焦 vs 键盘 Tab 聚焦）
  const pointerDownRef = useRef(false);
  // 当前键盘聚焦的 key（同一时刻至多一个），失焦清空
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const isKbdFocused = useCallback(
    (key: string) => focusedKey === key,
    [focusedKey],
  );

  const handlersFor = useCallback(
    (key: string): KbdFocusHandlers => ({
      onPointerDown: () => {
        pointerDownRef.current = true;
        // 兜底清零：focus 是 pointerdown 的默认动作，在同一事件轮内同步派发，
        // 必然先于本 macrotask 超时执行，故正常「按下 → 聚焦」路径不会被误清；
        // 若按下后无 focus 跟随（按下后拖走 / 触摸滚动取消），超时清掉残留，
        // 避免下一次键盘 Tab 聚焦被误判为指针聚焦而吞掉一次焦点环。
        setTimeout(() => {
          pointerDownRef.current = false;
        }, 0);
      },
      onFocus: () => {
        // 指针按下引发的聚焦不显示焦点环；仅键盘（Tab）聚焦时显示
        if (!pointerDownRef.current) {
          setFocusedKey(key);
        }
        pointerDownRef.current = false;
      },
      onBlur: () => {
        setFocusedKey((prev) => (prev === key ? null : prev));
      },
    }),
    [],
  );

  return { isKbdFocused, handlersFor };
}

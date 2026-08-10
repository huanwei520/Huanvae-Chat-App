/**
 * 边缘侧滑返回 Hook（移动端整屏页通用）
 *
 * 从屏幕左边缘起手右滑 → 页面跟手右移 → 松手达标则触发 `onBack`（**沿用调用方既有的
 * 返回动作**，本 hook 不自己关页面）；不达标则弹回原位。
 *
 * ## 与既有返回栈的关系
 *
 * 本 hook 只负责「手势 → 触发返回动作」这一段。移动端整屏页的返回动作已经收口在
 * 调用方的 `onClose`（顶栏返回键同一个），而 Android 系统返回键那条路由由
 * [useMobileBackHandler](./useMobileBackHandler.ts) 的全局处理器栈统一分发
 * （MobileMain 的 handleMobileBack 里按优先级 `setShowXxxPage(false)`）。
 * 三条入口（顶栏按钮 / 系统返回 / 边缘侧滑）最终落到同一个状态切换，不另起一套。
 *
 * ## 单一所有权（见 .claude/rules/animation.md 规则一/四）
 *
 * 返回的 `x` 是本 hook 独占的 MotionValue，调用方把它挂到某个 `motion.*` 的
 * `style={{ x }}` 上；该元素的 transform **不得**再被 CSS transition / variants /
 * 受控 style 触碰。整屏页的入退场动画请放在**外层**另一个 motion 容器上（variants 控
 * 其 x），两层各有各的 transform，互不抢帧。
 *
 * ## 为什么不用 preventDefault 锁滚动
 *
 * React 17+ 把 `onTouchStart` / `onTouchMove` 注册为 **passive** 监听，回调里
 * `preventDefault()` 无效。因此纵向滚动的让位靠两处：① 主轴判定（纵向为主即弃权，
 * 见 resolveEdgeSwipeAxis）；② 承载元素的 CSS `touch-action: pan-y`。
 */

import { useCallback, useEffect, useRef } from 'react';
import type { TouchEvent as ReactTouchEvent, TouchEventHandler } from 'react';
import { animate, useMotionValue } from 'framer-motion';
import type { MotionValue } from 'framer-motion';
import {
  isEdgeSwipeStart,
  resolveEdgeSwipeAxis,
  shouldCommitEdgeSwipe,
  type EdgeSwipeAxis,
} from '../utils/edgeSwipe';

/** 回弹动画：接近临界阻尼的弹簧，约 200ms 归位，不过冲。 */
const REBOUND_SPRING = { type: 'spring' as const, stiffness: 420, damping: 42, mass: 0.8 };

interface GestureState {
  /** 本次触摸是否从边缘起手（非边缘起手全程不跟踪） */
  tracking: boolean;
  axis: EdgeSwipeAxis;
  startX: number;
  startY: number;
  startTime: number;
}

export interface EdgeSwipeBackHandlers {
  onTouchStart: TouchEventHandler<HTMLElement>;
  onTouchMove: TouchEventHandler<HTMLElement>;
  onTouchEnd: TouchEventHandler<HTMLElement>;
  onTouchCancel: TouchEventHandler<HTMLElement>;
}

export interface UseEdgeSwipeBackOptions {
  /** 达标时触发的返回动作（与顶栏返回键同一个回调） */
  onBack: () => void;
}

export interface UseEdgeSwipeBackResult {
  /** 跟手位移（px，恒 ≥ 0）。挂到 motion 组件的 `style={{ x }}`，由本 hook 独占。 */
  x: MotionValue<number>;
  /** 摊到承载元素上的触摸事件处理器 */
  handlers: EdgeSwipeBackHandlers;
}

/** 系统「减弱动效」开启时，回弹不做弹簧，直接归位。 */
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useEdgeSwipeBack({ onBack }: UseEdgeSwipeBackOptions): UseEdgeSwipeBackResult {
  const x = useMotionValue(0);
  const gesture = useRef<GestureState>({
    tracking: false,
    axis: 'pending',
    startX: 0,
    startY: 0,
    startTime: 0,
  });
  const reboundRef = useRef<ReturnType<typeof animate> | null>(null);
  // onBack 每次 render 可能是新函数；用 latest-ref 让稳定的事件处理器读到最新的
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  const stopRebound = useCallback(() => {
    reboundRef.current?.stop();
    reboundRef.current = null;
  }, []);

  const springBack = useCallback(() => {
    stopRebound();
    if (prefersReducedMotion()) {
      x.set(0);
      return;
    }
    reboundRef.current = animate(x, 0, REBOUND_SPRING);
  }, [stopRebound, x]);

  const onTouchStart = useCallback(
    (e: ReactTouchEvent<HTMLElement>) => {
      const touch = e.touches[0];
      // 多指（缩放等）或非边缘起手 → 本次触摸全程不跟踪
      if (e.touches.length !== 1 || !isEdgeSwipeStart(touch.clientX)) {
        gesture.current.tracking = false;
        return;
      }
      // 上一次的回弹还在跑就接管它，避免两个来源同时写 x
      stopRebound();
      gesture.current = {
        tracking: true,
        axis: 'pending',
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
      };
    },
    [stopRebound],
  );

  const onTouchMove = useCallback(
    (e: ReactTouchEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g.tracking) {
        return;
      }
      // 手势中途多了一指 → 交还给系统（缩放/多指滚动）
      if (e.touches.length !== 1) {
        g.tracking = false;
        springBack();
        return;
      }
      const touch = e.touches[0];
      const dx = touch.clientX - g.startX;
      const dy = touch.clientY - g.startY;

      if (g.axis === 'pending') {
        const axis = resolveEdgeSwipeAxis(dx, dy);
        if (axis === 'pending') {
          return;
        }
        if (axis === 'rejected') {
          // 还没动过 x（观望期不位移），直接弃权即可，无需回弹
          g.tracking = false;
          return;
        }
        g.axis = 'horizontal';
      }

      // 只跟右滑；回拉到起点左侧时贴住 0，不让页面被拖出左边界
      x.set(Math.max(0, dx));
    },
    [springBack, x],
  );

  const onTouchEnd = useCallback(
    (e: ReactTouchEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g.tracking) {
        return;
      }
      g.tracking = false;
      if (g.axis !== 'horizontal') {
        return;
      }
      g.axis = 'pending';

      const touch = e.changedTouches[0];
      const dx = touch.clientX - g.startX;
      const commit = shouldCommitEdgeSwipe({
        dx,
        elapsedMs: Date.now() - g.startTime,
        viewportWidth: window.innerWidth,
      });

      if (commit) {
        // 达标：交给调用方既有的返回动作。x 停在当前位移，页面接着播它自己的退场动画，
        // 位置连续、无跳变（本层不再动 x）。
        onBackRef.current();
        return;
      }
      springBack();
    },
    [springBack],
  );

  const onTouchCancel = useCallback(() => {
    const g = gesture.current;
    if (!g.tracking) {
      return;
    }
    g.tracking = false;
    g.axis = 'pending';
    springBack();
  }, [springBack]);

  // 卸载时停掉在跑的回弹，避免动画继续写已卸载组件的 MotionValue
  useEffect(() => stopRebound, [stopRebound]);

  return {
    x,
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
  };
}

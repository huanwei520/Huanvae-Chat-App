/**
 * 移动端图片查看器的「缩放 / 平移」手势层
 *
 * @module chat/shared
 * @location src/chat/shared/useImageZoom.ts
 *
 * ## 为什么必须有这一层（根因，别再退回 CSS 那条路）
 *
 * 修复前 `.mobile-media-preview-image` 上写着 `touch-action: pinch-zoom;`，注释是「支持双指缩放」。
 * 但 CSS 规范里 `touch-action` 描述的是**浏览器自己**被允许做哪些默认手势，`pinch-zoom` 的语义是
 *「允许起始于本元素的触摸触发**页面级**双指缩放」—— 缩放的是整个 visual viewport，也就是整个 App，
 * 跟「把这张图片放大」正相反。而组件里**从来没有任何 JS 缩放实现**，
 * 所以用户看到的一直是 WebView 的原生页面缩放，不是图片缩放。
 *
 * ⇒ 正确形态只能是：
 *   1. 用 `touch-action: none` 把浏览器的默认双指缩放**在预览浮层内**关掉（见 chat-view.css 浮层规则）；
 *   2. 由本模块用 JS 实现真正作用在图片上的缩放 / 平移。
 *
 * ## 为什么不用 React 的 onTouchMove
 *
 * React 17+ 把 `touchstart` / `touchmove` 注册成 **passive** 监听器，
 * 里面调 `preventDefault()` 无效（本仓 `src/styles/mobile/profile-page.css` 已记过这个坑）。
 * 所以手势监听一律走 `addEventListener(..., { passive: false })` 手动挂。
 *
 * ## 与「横向切图」层的交界：单一真值源 mediaZoomState
 *
 * 本模块是 `chat/shared/mediaZoomState.ts` 所说的**写方**：缩放比例一变就
 * `setMediaZoomed(scale > 1)`。切图层是读方，读到 true 就把横向手势整个让出去。
 *
 * | 状态 | 横向拖动 |
 * |---|---|
 * | 未放大 | 切上一张 / 下一张（切图层） |
 * | 已放大 | 平移图片，不切图（本层） |
 *
 * 未放大时本模块**不处理也不 preventDefault 单指触摸**，单指手势整条留给切图层。
 * 反过来，切图层用 `maxTouchCount >= 2` 排除多指，所以捏合过程不会被误判成滑动。
 *
 * ## 单测覆盖边界（先说清楚测不到什么）
 *
 * 下面的几何计算是纯函数、已单测（tests/unit/imageZoomGesture.test.ts）；
 * 但「手指移动多少 → 图片显示成什么样」属于布局行为，jsdom 里
 * `offsetWidth` / `getBoundingClientRect()` 恒 0（见 .claude/rules/frontend-test.md
 * 「滚动 / 布局相关行为：vitest 结构性测不出」），**只能真机复核**。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { setMediaZoomed } from './mediaZoomState';

/** 最小缩放（原始大小） */
export const IMAGE_ZOOM_MIN = 1;
/** 最大缩放 */
export const IMAGE_ZOOM_MAX = 5;
/** 双击放大到的倍数 */
export const IMAGE_ZOOM_DOUBLE_TAP = 2.5;
/** 判定「已放大」的浮点裕度：捏合回落到 1.000001 不该算放大态 */
export const IMAGE_ZOOM_EPSILON = 0.01;

/** 双击判定：两次抬手间隔上限（ms） */
const DOUBLE_TAP_INTERVAL = 300;
/** 双击判定：两次落点距离上限（px） */
const DOUBLE_TAP_SLOP = 32;
/** 单次触摸算「点按」而非「拖动」的位移上限（px） */
const TAP_MOVE_SLOP = 12;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 把缩放倍数夹进 [IMAGE_ZOOM_MIN, IMAGE_ZOOM_MAX]；非有限值一律回落到最小值 */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return IMAGE_ZOOM_MIN;
  }
  return clampNumber(scale, IMAGE_ZOOM_MIN, IMAGE_ZOOM_MAX);
}

/** 当前是否处于「已放大」态（写进 mediaZoomState，供切图层判断横向拖动归谁） */
export function isZoomedScale(scale: number): boolean {
  return scale > IMAGE_ZOOM_MIN + IMAGE_ZOOM_EPSILON;
}

/**
 * 平移边界：放大后图片超出可视框的那一半就是可平移的最大距离
 *
 * @param content 图片**未缩放时**的显示尺寸（max-width/max-height 约束后的实际盒子）
 * @param viewport 可视框尺寸（承载层的布局尺寸）
 */
export function clampTranslate(
  translate: Point,
  scale: number,
  content: Size,
  viewport: Size,
): Point {
  const maxX = Math.max(0, (content.width * scale - viewport.width) / 2);
  const maxY = Math.max(0, (content.height * scale - viewport.height) / 2);
  return {
    x: clampNumber(translate.x, -maxX, maxX),
    y: clampNumber(translate.y, -maxY, maxY),
  };
}

/**
 * 求「把手势起点下的那个图像点钉在手势当前点」所需的 translate
 *
 * 变换形如 `translate(t) scale(s)`，变换原点是承载层**未变换时**的中心 `origin`（屏幕坐标）。
 * 一个图像点 p（相对 origin、未缩放）映射到屏幕：`origin + t + s·p`。
 *
 * 由手势起点 anchor 反解 p，再代入目标缩放 scale 与手势当前点 focus 求新的 t：
 * - `p = (anchor - origin - startTranslate) / startScale`
 * - `t = focus - origin - scale · p`
 *
 * 双击放大是同一个公式的退化情形（anchor === focus === 点按位置）。
 */
export function anchoredTranslate(args: {
  /** 手势开始时的缩放 */
  startScale: number;
  /** 手势开始时的平移 */
  startTranslate: Point;
  /** 承载层未变换时的中心（屏幕坐标），手势期间不变 */
  origin: Point;
  /** 手势起点（屏幕坐标） */
  anchor: Point;
  /** 手势当前点（屏幕坐标） */
  focus: Point;
  /** 目标缩放 */
  scale: number;
}): Point {
  const { startScale, startTranslate, origin, anchor, focus, scale } = args;
  const px = (anchor.x - origin.x - startTranslate.x) / startScale;
  const py = (anchor.y - origin.y - startTranslate.y) / startScale;
  return {
    x: focus.x - origin.x - scale * px,
    y: focus.y - origin.y - scale * py,
  };
}

export interface ImageZoomController {
  /**
   * 挂在图片的承载层上。
   *
   * 这一层同时是**手势采集区**和**被变换的那一层** —— 两件事共用一个元素是有意的：
   * 它铺满整个媒体区（CSS flex:1 + align-self:stretch），所以双指落在图片周围的留白里也算；
   * 而独占一个元素意味着切图层不必和它抢同一个 ref。
   *
   * 🔴 这里是 **callback ref 而不是 RefObject**，成因是真机实测出来的缺陷（gen-47，
   * Android 模拟器 L3 实测）：横滑切上一张 / 下一张时上层会把 `src` 先置成空串，
   * MobileMediaPreview 的 `{src && ...}` 于是把承载层**整个卸载再重挂**，
   * 而挂监听的 effect 依赖里只有 `enabled` —— 它不会因为换了个 DOM 节点而重跑，
   * 监听就永远留在了那个已被摘掉的旧节点上 ⇒ 切过一次图之后，
   * 捏合 / 平移 / 双击**整层失效**（真机复现：切图前捏合图片区变化 37.5%，
   * 切一次图后同一个手势变化 0%，而 pointerCount 实测仍是 2）。
   * callback ref 让「节点换了」这件事本身成为 effect 的依赖，监听跟着节点走。
   */
  stageRef: (node: HTMLDivElement | null) => void;
  /** 挂在图片本身上 —— 用它的实际显示尺寸算平移边界 */
  mediaRef: RefObject<HTMLImageElement | null>;
  /** 复位到 1x 并居中（换图 / 重新打开时调用） */
  resetZoom: () => void;
}

interface PinchSession {
  startScale: number;
  startTranslate: Point;
  origin: Point;
  anchor: Point;
  startDistance: number;
  viewport: Size;
  content: Size;
}

interface PanSession {
  startTranslate: Point;
  anchor: Point;
  viewport: Size;
  content: Size;
}

function touchPoint(touch: Touch): Point {
  return { x: touch.clientX, y: touch.clientY };
}

function touchesMidpoint(touches: TouchList): Point {
  const a = touchPoint(touches[0]);
  const b = touchPoint(touches[1]);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function touchesDistance(touches: TouchList): number {
  const a = touchPoint(touches[0]);
  const b = touchPoint(touches[1]);
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 图片缩放 / 平移手势层
 *
 * @param enabled 仅在「预览已打开 且 是图片」时为 true；视频路径完全不挂监听
 */
export function useImageZoom(enabled: boolean): ImageZoomController {
  // 承载层节点存两份：
  // - stageElRef：给逐帧写 transform 用（读它零重渲染）
  // - stageNode ：给挂监听的 effect 当依赖用（节点被换掉时必须重挂，见 ImageZoomController.stageRef 注释）
  const stageElRef = useRef<HTMLDivElement | null>(null);
  const [stageNode, setStageNode] = useState<HTMLDivElement | null>(null);
  const stageRef = useCallback((node: HTMLDivElement | null) => {
    stageElRef.current = node;
    setStageNode(node);
  }, []);
  const mediaRef = useRef<HTMLImageElement | null>(null);

  // 缩放/平移全程只走 ref + 直接写 DOM：手势期间**零 React 重渲染**
  // （重渲染会连带整棵 AnimatePresence 子树，60fps 下会卡）
  const scaleRef = useRef(IMAGE_ZOOM_MIN);
  const translateRef = useRef<Point>({ x: 0, y: 0 });

  // 谁是当前激活的那个预览实例。
  // 聊天列表里每条图片消息都挂着一个 MobileMediaPreview（isOpen=false），
  // 若它们也往 mediaZoomState 里写，就会把真正打开的那个实例的放大态覆盖掉。
  const enabledRef = useRef(false);

  const applyTransform = useCallback(() => {
    const stage = stageElRef.current;
    if (stage) {
      const { x, y } = translateRef.current;
      stage.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scaleRef.current})`;
    }
    if (enabledRef.current) {
      setMediaZoomed(isZoomedScale(scaleRef.current));
    }
  }, []);

  const resetZoom = useCallback(() => {
    scaleRef.current = IMAGE_ZOOM_MIN;
    translateRef.current = { x: 0, y: 0 };
    applyTransform();
  }, [applyTransform]);

  // 激活 / 释放：只有激活方才有资格写 mediaZoomState
  useEffect(() => {
    const wasEnabled = enabledRef.current;
    enabledRef.current = enabled;
    if (enabled) {
      // 激活即归位：既把 transform 写成显式的 1x（不留"从没被写过"的空 transform），
      // 也顺手把真值源对齐（resetZoom → applyTransform，此时 enabledRef 已是 true）
      resetZoom();
      return;
    }
    if (wasEnabled) {
      // 本实例刚从激活变成关闭：释放放大态，别把 true 留给下一个打开的预览
      setMediaZoomed(false);
    }
    resetZoom();
  }, [enabled, resetZoom]);

  useEffect(() => {
    const stage = stageNode;
    if (!enabled || !stage) {
      return;
    }

    let pinch: PinchSession | null = null;
    let pan: PanSession | null = null;
    let lastTapAt = 0;
    let lastTapPoint: Point | null = null;
    let touchStartPoint: Point | null = null;
    let touchMoved = false;

    /**
     * 采集承载层的几何：
     * - origin：未变换时的中心。`getBoundingClientRect()` 给的是**已变换**的框，
     *   减掉当前 translate 才是变换原点（transform-origin 为 center）。
     * - viewport：承载层布局尺寸（`offsetWidth` 不受 transform 影响）。
     * - content：图片未缩放时的实际显示盒子。
     */
    const readMetrics = (): { origin: Point; viewport: Size; content: Size } | null => {
      const rect = stage.getBoundingClientRect();
      const t = translateRef.current;
      const viewport: Size = { width: stage.offsetWidth, height: stage.offsetHeight };
      const media = mediaRef.current;
      const content: Size = media
        ? { width: media.offsetWidth, height: media.offsetHeight }
        : viewport;
      return {
        origin: {
          x: rect.left + rect.width / 2 - t.x,
          y: rect.top + rect.height / 2 - t.y,
        },
        viewport,
        content,
      };
    };

    const commit = (scale: number, translate: Point, viewport: Size, content: Size) => {
      scaleRef.current = scale;
      translateRef.current = clampTranslate(translate, scale, content, viewport);
      applyTransform();
    };

    /** 双击：未放大 → 以点按处为锚点放大；已放大 → 复位 */
    const toggleZoomAt = (point: Point) => {
      const metrics = readMetrics();
      if (!metrics) {
        return;
      }
      if (isZoomedScale(scaleRef.current)) {
        resetZoom();
        return;
      }
      const scale = clampScale(IMAGE_ZOOM_DOUBLE_TAP);
      const translate = anchoredTranslate({
        startScale: scaleRef.current,
        startTranslate: translateRef.current,
        origin: metrics.origin,
        anchor: point,
        focus: point,
        scale,
      });
      commit(scale, translate, metrics.viewport, metrics.content);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        const metrics = readMetrics();
        if (!metrics) {
          return;
        }
        pan = null;
        pinch = {
          startScale: scaleRef.current,
          startTranslate: { ...translateRef.current },
          origin: metrics.origin,
          anchor: touchesMidpoint(e.touches),
          startDistance: touchesDistance(e.touches),
          viewport: metrics.viewport,
          content: metrics.content,
        };
        touchMoved = true; // 捏合过就不再算点按
        e.preventDefault();
        return;
      }

      // 单指：记录点按判定用的落点
      touchStartPoint = touchPoint(e.touches[0]);
      touchMoved = false;

      // 🔴 未放大时**什么都不做、也不 preventDefault** —— 单指手势整条留给横向切图层
      if (!isZoomedScale(scaleRef.current)) {
        pan = null;
        return;
      }

      const metrics = readMetrics();
      if (!metrics) {
        return;
      }
      pan = {
        startTranslate: { ...translateRef.current },
        anchor: touchStartPoint,
        viewport: metrics.viewport,
        content: metrics.content,
      };
      e.preventDefault();
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (pinch && e.touches.length >= 2) {
        const distance = touchesDistance(e.touches);
        const ratio = pinch.startDistance > 0 ? distance / pinch.startDistance : 1;
        const scale = clampScale(pinch.startScale * ratio);
        const translate = anchoredTranslate({
          startScale: pinch.startScale,
          startTranslate: pinch.startTranslate,
          origin: pinch.origin,
          anchor: pinch.anchor,
          focus: touchesMidpoint(e.touches),
          scale,
        });
        commit(scale, translate, pinch.viewport, pinch.content);
        e.preventDefault();
        return;
      }

      if (e.touches.length === 1) {
        const point = touchPoint(e.touches[0]);
        if (touchStartPoint && pointDistance(point, touchStartPoint) > TAP_MOVE_SLOP) {
          touchMoved = true;
        }
        if (pan) {
          commit(
            scaleRef.current,
            {
              x: pan.startTranslate.x + (point.x - pan.anchor.x),
              y: pan.startTranslate.y + (point.y - pan.anchor.y),
            },
            pan.viewport,
            pan.content,
          );
          e.preventDefault();
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (pinch && e.touches.length < 2) {
        pinch = null;
        // 捏回 1x 以内：直接归位，避免留下一个偏移过的「1 倍」图
        if (!isZoomedScale(scaleRef.current)) {
          resetZoom();
        }
        // 双指变单指：若仍是放大态，接力成平移
        if (e.touches.length === 1 && isZoomedScale(scaleRef.current)) {
          const metrics = readMetrics();
          if (metrics) {
            pan = {
              startTranslate: { ...translateRef.current },
              anchor: touchPoint(e.touches[0]),
              viewport: metrics.viewport,
              content: metrics.content,
            };
          }
        }
        return;
      }

      if (e.touches.length > 0) {
        return;
      }

      pan = null;

      // 双击判定（点按未位移才算）
      const point = touchStartPoint;
      touchStartPoint = null;
      if (touchMoved || !point) {
        lastTapAt = 0;
        lastTapPoint = null;
        return;
      }
      const now = e.timeStamp || Date.now();
      if (
        lastTapPoint
        && now - lastTapAt < DOUBLE_TAP_INTERVAL
        && pointDistance(point, lastTapPoint) < DOUBLE_TAP_SLOP
      ) {
        lastTapAt = 0;
        lastTapPoint = null;
        toggleZoomAt(point);
        return;
      }
      lastTapAt = now;
      lastTapPoint = point;
    };

    const handleTouchCancel = () => {
      pinch = null;
      pan = null;
      touchStartPoint = null;
      lastTapAt = 0;
      lastTapPoint = null;
    };

    // 🔴 必须 { passive: false }：React 的 onTouchStart/onTouchMove 是 passive，
    // 里面 preventDefault 无效（见文件头注释）
    // 两点都是实测踩出来的，别"顺手简化"回去：
    // 1. 不写 `: AddEventListenerOptions` 类型标注 —— 那是纯类型名，本仓 eslint 的 no-undef
    //    认不出它（lint:strict 报 'AddEventListenerOptions' is not defined）。
    // 2. 显式带上 `capture: false` —— removeEventListener 收的是 EventListenerOptions，
    //    它只有 `capture?` 一个可选键，属于 TS 的"弱类型"；只写 { passive } 与它零共同属性，
    //    会被弱类型检测判为不可赋值（tsc 报 No overload matches this call）。
    const options = { passive: false, capture: false };
    stage.addEventListener('touchstart', handleTouchStart, options);
    stage.addEventListener('touchmove', handleTouchMove, options);
    stage.addEventListener('touchend', handleTouchEnd, options);
    stage.addEventListener('touchcancel', handleTouchCancel, options);

    return () => {
      stage.removeEventListener('touchstart', handleTouchStart, options);
      stage.removeEventListener('touchmove', handleTouchMove, options);
      stage.removeEventListener('touchend', handleTouchEnd, options);
      stage.removeEventListener('touchcancel', handleTouchCancel, options);
    };
    // 🔴 stageNode 必须在依赖里：换图会把承载层卸载重挂，节点一换就得重挂监听
  }, [enabled, stageNode, applyTransform, resetZoom]);

  return { stageRef, mediaRef, resetZoom };
}

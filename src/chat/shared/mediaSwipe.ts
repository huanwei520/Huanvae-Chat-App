/**
 * 全屏媒体预览的「横向切图」手势判定 —— 纯逻辑，零 React / 零 DOM 依赖
 *
 * @module chat/shared
 * @location src/chat/shared/mediaSwipe.ts
 *
 * ## 与「缩放 / 平移」手势层的分工（两层的交界只有一条布尔判据）
 *
 * | 状态 | 横向拖动归谁 |
 * |---|---|
 * | **未放大** | 本层：切上一张 / 下一张 |
 * | **已放大** | 缩放 / 平移层：平移图片，本层一律不切图 |
 *
 * 交界**故意只用一个布尔量** `zoomed`（真值源见 chat/shared/mediaZoomState.ts，
 * 写方是缩放层 chat/shared/useImageZoom.ts）：
 * 若改成「放大态下平移到边缘再继续拖就切图」，判据就变成
 * 「zoomed AND 已到平移边界 AND 又继续拖了 N 像素」—— 其中"已到平移边界"是缩放层内部的
 * **连续量**，本层要读到它就得把两层的状态耦在一起，而那正是两单交界处最容易互相破坏的形态。
 * 所以本层的定义是：**放大态下横拖恒为平移，即使平移到头也不切图**；用户双击 / 缩小回未放大态
 * 即可继续左右切，代价是一次双击，不是不可达。
 *
 * ## 第二条独立规则：多指手势永远不是切图
 *
 * `maxTouchCount >= 2` 直接判非切图。这**不是** `zoomed` 的兜底，而是另一件事：
 * 双指捏合的过程态里两根手指的质心可以横向移动几十像素，若不排除，捏合到一半会被
 * 误判成一次左滑。两条规则各自独立成立，缺一都会漏。
 */

import type { MediaStepDirection } from './mediaGallery';

/** 触发切换所需的最小水平位移（像素）——低于它一律回弹 */
export const SWIPE_MIN_DISTANCE_PX = 56;

/**
 * 也可以按容器宽度的比例触发（大屏上 56px 太容易误触）。
 * 实际阈值取两者的**较大值**，见 swipeCommitThreshold。
 */
export const SWIPE_COMMIT_WIDTH_RATIO = 0.18;

/** |dx| 必须比 |dy| 大这么多倍才算「横向」手势（否则是竖向拖动，不归本层） */
export const SWIPE_DIRECTION_RATIO = 1.2;

/** 到边界后继续拖的阻尼系数：跟手位移打折，松手弹回 —— 让「到头了」看得见 */
export const SWIPE_EDGE_DAMPING = 0.35;

/** 一次手势的原始输入（全部来自 touch / pointer 事件，无 DOM 对象） */
export interface SwipeInput {
  /** 是否处于放大态（缩放 / 平移层持有的真值） */
  zoomed: boolean;
  /** 本次手势过程中出现过的**最大**同时触点数（鼠标拖动恒为 1） */
  maxTouchCount: number;
  /** 水平位移：>0 向右拖（想看更旧的上一张），<0 向左拖（想看更新的下一张） */
  dx: number;
  /** 垂直位移 */
  dy: number;
  /** 手势容器宽度（jsdom 下恒为 0，此时阈值退到 SWIPE_MIN_DISTANCE_PX） */
  containerWidth: number;
  /** 序列里还有没有上一张 */
  canPrev: boolean;
  /** 序列里还有没有下一张 */
  canNext: boolean;
}

/**
 * 这次横向拖动是不是该整个让给缩放 / 平移层。
 *
 * 返回 true 时本层**连跟手位移都不画** —— 画了就会和缩放层同时改同一个元素的 transform
 * （见 .claude/rules/animation.md 规则一：一个属性只能有一个动画主人）。
 */
export function swipeOwnedByZoomLayer(input: Pick<SwipeInput, 'zoomed' | 'maxTouchCount'>): boolean {
  return input.zoomed || input.maxTouchCount >= 2;
}

/** 是不是一个「横向」手势（竖向拖动不归本层，直接不跟手） */
export function isHorizontalSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) > Math.abs(dy) * SWIPE_DIRECTION_RATIO;
}

/** 触发切换的位移阈值：像素下限与容器宽度比例取较大者 */
export function swipeCommitThreshold(containerWidth: number): number {
  return Math.max(SWIPE_MIN_DISTANCE_PX, containerWidth * SWIPE_COMMIT_WIDTH_RATIO);
}

/**
 * 跟手位移：正常方向 1:1 跟手；**该方向已经没有下一张时按 SWIPE_EDGE_DAMPING 打折**。
 *
 * 打折而不是钉死在 0，是为了让「第一张继续往前拖」这件事**在画面上有反馈** ——
 * 完全不动的话，用户分不清"到头了"和"这个 App 的滑动坏了"（两者同形）。
 */
export function swipeTrackOffset(dx: number, canPrev: boolean, canNext: boolean): number {
  const blocked = dx > 0 ? !canPrev : !canNext;
  return blocked ? dx * SWIPE_EDGE_DAMPING : dx;
}

/**
 * 松手时的裁决：给出要切的方向，或 null（= 回弹，不切图）。
 *
 * null 的三种成因（都必须回弹）：被缩放层接管 / 不是横向手势或没拖够 / 该方向已到边界。
 */
export function resolveSwipeCommit(input: SwipeInput): MediaStepDirection | null {
  if (swipeOwnedByZoomLayer(input)) { return null; }
  if (!isHorizontalSwipe(input.dx, input.dy)) { return null; }
  if (Math.abs(input.dx) < swipeCommitThreshold(input.containerWidth)) { return null; }

  // dx > 0 = 手指向右拖 = 内容往右走 = 露出左边那张 = 更旧的「上一张」
  const direction: MediaStepDirection = input.dx > 0 ? -1 : 1;
  if (direction === -1 && !input.canPrev) { return null; }
  if (direction === 1 && !input.canNext) { return null; }
  return direction;
}

/**
 * 横向切图手势判定的纯逻辑测试
 *
 * 这份测试的核心是**两层手势的交界**（单⑯缩放 / 单⑰切图）：
 *
 * | 状态 | 横向拖动 |
 * |---|---|
 * | 未放大 | 切上一张 / 下一张（本层） |
 * | 已放大 | 平移图片，不切图（缩放层） |
 *
 * 「放大态下不切图」这条**必须有机器判据** —— 真机截图上「做对了」与
 * 「放大态下也误切了」是同一张图上看不出区别的两件事（拖了之后画面都变了）。
 */

import { describe, it, expect } from 'vitest';
import {
  SWIPE_EDGE_DAMPING,
  SWIPE_MIN_DISTANCE_PX,
  isHorizontalSwipe,
  resolveSwipeCommit,
  swipeCommitThreshold,
  swipeOwnedByZoomLayer,
  swipeTrackOffset,
  type SwipeInput,
} from '../../src/chat/shared/mediaSwipe';

/** 一个「未放大、单指、横向拖过阈值、两个方向都有邻居」的基准输入 */
function baseInput(over: Partial<SwipeInput> = {}): SwipeInput {
  return {
    zoomed: false,
    maxTouchCount: 1,
    dx: -120,
    dy: 4,
    containerWidth: 400,
    canPrev: true,
    canNext: true,
    ...over,
  };
}

describe('swipeOwnedByZoomLayer：横向手势归谁', () => {
  it('未放大 + 单指 ⇒ 归切图层', () => {
    expect(swipeOwnedByZoomLayer({ zoomed: false, maxTouchCount: 1 })).toBe(false);
  });

  it('🔴 已放大 ⇒ 归缩放层（切图层连跟手位移都不画）', () => {
    expect(swipeOwnedByZoomLayer({ zoomed: true, maxTouchCount: 1 })).toBe(true);
  });

  it('双指 ⇒ 归缩放层（捏合过程中两指质心会横移几十像素，不排除就会被误判成左滑）', () => {
    expect(swipeOwnedByZoomLayer({ zoomed: false, maxTouchCount: 2 })).toBe(true);
  });
});

describe('isHorizontalSwipe：方向判定', () => {
  it('明显横向 ⇒ true', () => {
    expect(isHorizontalSwipe(-100, 10)).toBe(true);
  });

  it('明显竖向 ⇒ false（竖向拖动不归本层）', () => {
    expect(isHorizontalSwipe(10, -100)).toBe(false);
  });

  it('斜着但不够横（未超过 1.2 倍）⇒ false', () => {
    expect(isHorizontalSwipe(-100, 90)).toBe(false);
  });
});

describe('swipeCommitThreshold：阈值', () => {
  it('容器宽度未知（jsdom 恒 0）时退到像素下限', () => {
    expect(swipeCommitThreshold(0)).toBe(SWIPE_MIN_DISTANCE_PX);
  });

  it('大屏上按宽度比例放大阈值（避免误触）', () => {
    expect(swipeCommitThreshold(1000)).toBe(180);
  });
});

describe('swipeTrackOffset：跟手位移与边界回弹', () => {
  it('方向上有邻居 ⇒ 1:1 跟手', () => {
    expect(swipeTrackOffset(-80, true, true)).toBe(-80);
    expect(swipeTrackOffset(80, true, true)).toBe(80);
  });

  it('🔴 第一张继续往前拖 ⇒ 打折（不是钉死不动 —— 不动就与"手势坏了"同形）', () => {
    expect(swipeTrackOffset(80, false, true)).toBeCloseTo(80 * SWIPE_EDGE_DAMPING);
    // 打了折，但确实还在跟手
    expect(Math.abs(swipeTrackOffset(80, false, true))).toBeGreaterThan(0);
    expect(Math.abs(swipeTrackOffset(80, false, true))).toBeLessThan(80);
  });

  it('🔴 最后一张继续往后拖 ⇒ 同样打折回弹', () => {
    expect(swipeTrackOffset(-80, true, false)).toBeCloseTo(-80 * SWIPE_EDGE_DAMPING);
  });
});

describe('resolveSwipeCommit：松手裁决', () => {
  it('向左拖过阈值 ⇒ 下一张（+1）', () => {
    expect(resolveSwipeCommit(baseInput({ dx: -120 }))).toBe(1);
  });

  it('向右拖过阈值 ⇒ 上一张（-1）', () => {
    expect(resolveSwipeCommit(baseInput({ dx: 120 }))).toBe(-1);
  });

  it('🔴 放大态：拖多远都不切图（本条就是与缩放层交界的机器判据）', () => {
    expect(resolveSwipeCommit(baseInput({ zoomed: true, dx: -400 }))).toBeNull();
    expect(resolveSwipeCommit(baseInput({ zoomed: true, dx: 400 }))).toBeNull();
  });

  it('🔴 双指：拖多远都不切图', () => {
    expect(resolveSwipeCommit(baseInput({ maxTouchCount: 2, dx: -400 }))).toBeNull();
  });

  it('没拖够 ⇒ null（回弹）', () => {
    expect(resolveSwipeCommit(baseInput({ dx: -40 }))).toBeNull();
  });

  it('竖向为主 ⇒ null（不抢竖向手势）', () => {
    expect(resolveSwipeCommit(baseInput({ dx: -120, dy: -300 }))).toBeNull();
  });

  it('🔴 第一张往前 ⇒ null（回弹，不循环到最后一张）', () => {
    expect(resolveSwipeCommit(baseInput({ dx: 200, canPrev: false }))).toBeNull();
  });

  it('🔴 最后一张往后 ⇒ null（回弹，不循环到第一张）', () => {
    expect(resolveSwipeCommit(baseInput({ dx: -200, canNext: false }))).toBeNull();
  });

  it('单张序列：两个方向都不切', () => {
    expect(resolveSwipeCommit(baseInput({ dx: 200, canPrev: false, canNext: false }))).toBeNull();
    expect(resolveSwipeCommit(baseInput({ dx: -200, canPrev: false, canNext: false }))).toBeNull();
  });

  it('判据自检：同一组输入只把 zoomed 从 false 翻成 true，结论就从 1 变 null —— 这条判据有区分力', () => {
    const input = baseInput({ dx: -200 });
    expect(resolveSwipeCommit({ ...input, zoomed: false })).toBe(1);
    expect(resolveSwipeCommit({ ...input, zoomed: true })).toBeNull();
  });
});

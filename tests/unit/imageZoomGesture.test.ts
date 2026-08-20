/**
 * 图片查看器缩放手势 —— 几何纯函数单测
 *
 * 🔴 覆盖边界（先说清楚测不到什么，别让全绿被读成"行为验过了"）：
 * 本文件只测 `useImageZoom` 里的**纯几何计算**。「手指移动多少 → 屏幕上图片长什么样」
 * 依赖真实布局，而 jsdom 里 `offsetWidth` / `getBoundingClientRect()` 恒 0
 * （见 .claude/rules/frontend-test.md「滚动 / 布局相关行为：vitest 结构性测不出」），
 * 那一半只能真机复核。
 */

import { describe, it, expect, vi } from 'vitest';

// 被测模块 import 了 mediaZoomState（zustand store）——这里只测几何纯函数，
// 把写方替换掉，避免单测顺带碰到全局 store。
vi.mock('../../src/chat/shared/mediaZoomState', () => ({
  setMediaZoomed: vi.fn(),
}));

import {
  IMAGE_ZOOM_MAX,
  IMAGE_ZOOM_MIN,
  anchoredTranslate,
  clampScale,
  clampTranslate,
  isZoomedScale,
  type Point,
} from '../../src/chat/shared/useImageZoom';

/**
 * 把一个图像点（相对变换原点、未缩放）映射到屏幕坐标
 *
 * 与 `transform: translate(t) scale(s)`（transform-origin 为 center）等价：
 * `screen = origin + translate + scale * p`
 */
function toScreen(origin: Point, translate: Point, scale: number, p: Point): Point {
  return {
    x: origin.x + translate.x + scale * p.x,
    y: origin.y + translate.y + scale * p.y,
  };
}

/** 由屏幕点反解图像点 */
function toContent(origin: Point, translate: Point, scale: number, screen: Point): Point {
  return {
    x: (screen.x - origin.x - translate.x) / scale,
    y: (screen.y - origin.y - translate.y) / scale,
  };
}

describe('clampScale', () => {
  it('夹在 [MIN, MAX] 之间', () => {
    expect(clampScale(0.2)).toBe(IMAGE_ZOOM_MIN);
    expect(clampScale(1)).toBe(1);
    expect(clampScale(2.5)).toBe(2.5);
    expect(clampScale(99)).toBe(IMAGE_ZOOM_MAX);
  });

  it('非有限值回落到 MIN（两指重合时 distance=0 会算出 NaN/Infinity）', () => {
    expect(clampScale(Number.NaN)).toBe(IMAGE_ZOOM_MIN);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(IMAGE_ZOOM_MIN);
    expect(clampScale(Number.NEGATIVE_INFINITY)).toBe(IMAGE_ZOOM_MIN);
  });
});

describe('isZoomedScale（切图手势层读的那个判据）', () => {
  it('1x 与浮点毛刺不算放大态', () => {
    expect(isZoomedScale(1)).toBe(false);
    expect(isZoomedScale(1.000001)).toBe(false);
    expect(isZoomedScale(1.005)).toBe(false);
  });

  it('真放大了才算', () => {
    expect(isZoomedScale(1.02)).toBe(true);
    expect(isZoomedScale(2.5)).toBe(true);
  });
});

describe('clampTranslate', () => {
  const viewport = { width: 200, height: 100 };

  // 注：夹到边界 0 时结果可能是 -0（Math.min/max 的正常语义），
  // toEqual 会把 -0 与 0 判为不等，故逐字段用 toBeCloseTo。
  it('1x 时不允许平移（图片没有超出可视框）', () => {
    const r = clampTranslate({ x: 999, y: -999 }, 1, viewport, viewport);
    expect(r.x).toBeCloseTo(0, 10);
    expect(r.y).toBeCloseTo(0, 10);
  });

  it('放大后可平移「超出的那一半」', () => {
    // 内容 200x100 放大 2 倍 = 400x200，超出 200x100，两侧各 100 / 50
    const clamped = clampTranslate({ x: 500, y: -300 }, 2, viewport, viewport);
    expect(clamped.x).toBeCloseTo(100, 10);
    expect(clamped.y).toBeCloseTo(-50, 10);

    // 边界内原样透传
    const inside = clampTranslate({ x: 30, y: -20 }, 2, viewport, viewport);
    expect(inside.x).toBeCloseTo(30, 10);
    expect(inside.y).toBeCloseTo(-20, 10);
  });

  it('信箱边（内容窄于可视框）那一轴仍然锁死', () => {
    // 竖图 100x200 放在 300x200 的框里：2 倍后宽 200 仍小于 300 ⇒ 横向不可平移
    const content = { width: 100, height: 200 };
    const box = { width: 300, height: 200 };
    const r = clampTranslate({ x: 80, y: 80 }, 2, content, box);
    expect(r.x).toBeCloseTo(0, 10);
    expect(r.y).toBeCloseTo(80, 10);
  });
});

describe('anchoredTranslate（把手势起点下的那个图像点钉住）', () => {
  const origin: Point = { x: 100, y: 100 };

  it('原地捏合：锚点下的图像点在放大后仍停在同一屏幕坐标', () => {
    const startScale = 1;
    const startTranslate: Point = { x: 0, y: 0 };
    const anchor: Point = { x: 150, y: 120 };
    const scale = 2;

    const pinned = toContent(origin, startTranslate, startScale, anchor);
    const translate = anchoredTranslate({
      startScale, startTranslate, origin, anchor, focus: anchor, scale,
    });
    const after = toScreen(origin, translate, scale, pinned);

    expect(after.x).toBeCloseTo(anchor.x, 6);
    expect(after.y).toBeCloseTo(anchor.y, 6);
  });

  it('中点移动时，被钉住的图像点跟着中点走（捏合同时平移）', () => {
    const startScale = 1.5;
    const startTranslate: Point = { x: -20, y: 35 };
    const anchor: Point = { x: 210, y: 90 };
    const focus: Point = { x: 240, y: 80 };
    const scale = 3;

    const pinned = toContent(origin, startTranslate, startScale, anchor);
    const translate = anchoredTranslate({
      startScale, startTranslate, origin, anchor, focus, scale,
    });
    const after = toScreen(origin, translate, scale, pinned);

    expect(after.x).toBeCloseTo(focus.x, 6);
    expect(after.y).toBeCloseTo(focus.y, 6);
  });

  it('缩放不变时退化成纯平移（位移量 = 中点位移量）', () => {
    const startScale = 2;
    const startTranslate: Point = { x: 10, y: -10 };
    const anchor: Point = { x: 130, y: 140 };
    const focus: Point = { x: 160, y: 100 };

    const translate = anchoredTranslate({
      startScale, startTranslate, origin, anchor, focus, scale: startScale,
    });

    expect(translate.x).toBeCloseTo(startTranslate.x + (focus.x - anchor.x), 6);
    expect(translate.y).toBeCloseTo(startTranslate.y + (focus.y - anchor.y), 6);
  });
});

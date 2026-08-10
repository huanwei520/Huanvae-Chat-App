/**
 * 边缘侧滑返回 —— 纯阈值判定单测（src/utils/edgeSwipe.ts）
 *
 * 覆盖三段判定逻辑的真实分支：
 * 1. isEdgeSwipeStart       起手点是否落在左边缘带（含边界值、越界、负值）
 * 2. resolveEdgeSwipeAxis   主轴判定：观望 / 接管为横向返回 / 让位给纵向滚动
 * 3. shouldCommitEdgeSwipe  松手判定：距离通道（含屏宽比例 vs 绝对下限的取大）
 *                           与速度通道（含最小位移门槛、elapsedMs=0 的除零保护）
 *
 * 断言的都是「输入 → 判定结果」的行为，不断言导出的常量本身（那种断言恒真、
 * 改坏实现也不会红，属假测试）。边界用例成对写「刚好达标 / 差一点」，
 * 让阈值比较符写反（>= 写成 >、max 写成 min 等）时必然翻红。
 *
 * hook 侧（触摸事件时序、跟手位移、回弹动画）无法在 jsdom 里可信复现，
 * 由真机验收覆盖。
 */

import { describe, it, expect } from 'vitest';
import {
  isEdgeSwipeStart,
  resolveEdgeSwipeAxis,
  edgeSwipeCommitDistance,
  shouldCommitEdgeSwipe,
} from '../../src/utils/edgeSwipe';

describe('isEdgeSwipeStart — 起手点是否落在左边缘带', () => {
  it('边缘带内（含 0 与右边界 24）判为边缘起手', () => {
    expect(isEdgeSwipeStart(0)).toBe(true);
    expect(isEdgeSwipeStart(12)).toBe(true);
    expect(isEdgeSwipeStart(24)).toBe(true);
  });

  it('越过边缘带一像素即不算（页面内容区起手不抢手势）', () => {
    expect(isEdgeSwipeStart(25)).toBe(false);
    expect(isEdgeSwipeStart(200)).toBe(false);
  });

  it('负坐标（触点在视口左侧外）不算', () => {
    expect(isEdgeSwipeStart(-1)).toBe(false);
  });

  it('可传入自定义边缘带宽度', () => {
    expect(isEdgeSwipeStart(30, 40)).toBe(true);
    expect(isEdgeSwipeStart(41, 40)).toBe(false);
  });
});

describe('resolveEdgeSwipeAxis — 手势主轴判定', () => {
  it('两轴位移都没超过 slop → 继续观望，不抢手势', () => {
    expect(resolveEdgeSwipeAxis(0, 0)).toBe('pending');
    expect(resolveEdgeSwipeAxis(9, 9)).toBe('pending');
    expect(resolveEdgeSwipeAxis(-9, 3)).toBe('pending');
  });

  it('超过 slop 且向右为主 → 接管为返回手势', () => {
    expect(resolveEdgeSwipeAxis(12, 0)).toBe('horizontal');
    expect(resolveEdgeSwipeAxis(30, 10)).toBe('horizontal');
    expect(resolveEdgeSwipeAxis(30, -10)).toBe('horizontal'); // 向上斜滑，横向仍占优
  });

  it('纵向为主 → 让位给页面滚动', () => {
    expect(resolveEdgeSwipeAxis(4, 20)).toBe('rejected');
    expect(resolveEdgeSwipeAxis(4, -20)).toBe('rejected');
  });

  it('向左滑不是返回手势', () => {
    expect(resolveEdgeSwipeAxis(-20, 2)).toBe('rejected');
  });

  it('横纵分量相等（45° 平手）→ 判 rejected，把手势让给滚动', () => {
    expect(resolveEdgeSwipeAxis(20, 20)).toBe('rejected');
    expect(resolveEdgeSwipeAxis(20, -20)).toBe('rejected');
  });

  it('纵向已超 slop 但横向还很小 → 直接 rejected，不再观望', () => {
    expect(resolveEdgeSwipeAxis(2, 11)).toBe('rejected');
  });

  it('可传入自定义 slop：放大后同一位移仍在观望期', () => {
    expect(resolveEdgeSwipeAxis(12, 0, 40)).toBe('pending');
    expect(resolveEdgeSwipeAxis(41, 0, 40)).toBe('horizontal');
  });
});

describe('edgeSwipeCommitDistance — 提交所需位移', () => {
  it('宽屏按屏宽比例（0.28）', () => {
    expect(edgeSwipeCommitDistance(400)).toBeCloseTo(112, 5);
    expect(edgeSwipeCommitDistance(1000)).toBeCloseTo(280, 5);
  });

  it('窄屏被绝对下限 64px 兜住（比例值更小时取下限）', () => {
    // 200 * 0.28 = 56 < 64 → 取 64
    expect(edgeSwipeCommitDistance(200)).toBe(64);
    expect(edgeSwipeCommitDistance(0)).toBe(64);
  });

  it('临界点：屏宽约 228.6px 处两条规则交接，之后随屏宽增长', () => {
    const narrow = edgeSwipeCommitDistance(228);
    const wide = edgeSwipeCommitDistance(320);
    expect(narrow).toBe(64);
    expect(wide).toBeGreaterThan(narrow);
  });
});

describe('shouldCommitEdgeSwipe — 松手是否提交返回', () => {
  const VIEWPORT = 390; // iPhone 逻辑宽度；阈值 = max(64, 109.2) = 109.2

  it('距离通道：拖过阈值即提交（慢慢拖也算）', () => {
    expect(shouldCommitEdgeSwipe({ dx: 110, elapsedMs: 1200, viewportWidth: VIEWPORT })).toBe(true);
  });

  it('距离通道：差一点点且很慢 → 不提交（应回弹）', () => {
    // 109 < 109.2，且 109/1200 ≈ 0.09 px/ms 远低于快滑阈值
    expect(shouldCommitEdgeSwipe({ dx: 109, elapsedMs: 1200, viewportWidth: VIEWPORT })).toBe(false);
  });

  it('速度通道：位移不够但甩得够快 → 提交', () => {
    // 40px / 60ms ≈ 0.67 px/ms ≥ 0.45，且 40 ≥ 24
    expect(shouldCommitEdgeSwipe({ dx: 40, elapsedMs: 60, viewportWidth: VIEWPORT })).toBe(true);
  });

  it('速度通道：速度差一点 → 不提交', () => {
    // 40px / 100ms = 0.4 px/ms < 0.45
    expect(shouldCommitEdgeSwipe({ dx: 40, elapsedMs: 100, viewportWidth: VIEWPORT })).toBe(false);
  });

  it('速度通道有最小位移门槛：极快但只挪了一点点 → 不提交', () => {
    // 20px / 10ms = 2 px/ms 远超速度阈值，但 20 < 24 的最小位移门槛
    expect(shouldCommitEdgeSwipe({ dx: 20, elapsedMs: 10, viewportWidth: VIEWPORT })).toBe(false);
    // 同样时长下达到门槛则提交（证明拦下 20px 的是位移门槛而非别的原因）
    expect(shouldCommitEdgeSwipe({ dx: 24, elapsedMs: 10, viewportWidth: VIEWPORT })).toBe(true);
  });

  it('elapsedMs=0 不产生 Infinity 速度：只走距离通道', () => {
    expect(shouldCommitEdgeSwipe({ dx: 30, elapsedMs: 0, viewportWidth: VIEWPORT })).toBe(false);
    expect(shouldCommitEdgeSwipe({ dx: 200, elapsedMs: 0, viewportWidth: VIEWPORT })).toBe(true);
  });

  it('零位移/负位移（回拉到起点左侧）一律不提交', () => {
    expect(shouldCommitEdgeSwipe({ dx: 0, elapsedMs: 300, viewportWidth: VIEWPORT })).toBe(false);
    expect(shouldCommitEdgeSwipe({ dx: -50, elapsedMs: 100, viewportWidth: VIEWPORT })).toBe(false);
  });

  it('窄屏下用绝对下限判距离：同一位移在窄屏提交、在宽屏不提交', () => {
    // 70px：窄屏(200) 阈值 64 → 提交；宽屏(1000) 阈值 280 → 不提交（且够慢，不走速度通道）
    expect(shouldCommitEdgeSwipe({ dx: 70, elapsedMs: 800, viewportWidth: 200 })).toBe(true);
    expect(shouldCommitEdgeSwipe({ dx: 70, elapsedMs: 800, viewportWidth: 1000 })).toBe(false);
  });
});

/**
 * imageBackground.ts 测试
 *
 * 覆盖等比缩放纯函数 fitWithinMaxEdge（背景图压缩前的尺寸决策）+ 体积/边长上限常量契约。
 * 实际 canvas 压缩（compressImageToFile）依赖浏览器 canvas，由组件集成层手动验证。
 */

import { describe, it, expect } from 'vitest';
import { fitWithinMaxEdge, DEFAULT_MAX_EDGE, DEFAULT_MAX_BYTES } from '../../src/utils/imageBackground';

describe('fitWithinMaxEdge', () => {
  it('原图不超上限 → 不放大、原样取整', () => {
    expect(fitWithinMaxEdge(800, 600, 1600)).toEqual({ w: 800, h: 600 });
    expect(fitWithinMaxEdge(1600, 900, 1600)).toEqual({ w: 1600, h: 900 });
  });

  it('横图超限 → 按最长边等比缩小', () => {
    // 3200 → 1600（scale 0.5），高 1600→800
    expect(fitWithinMaxEdge(3200, 1600, 1600)).toEqual({ w: 1600, h: 800 });
  });

  it('竖图超限 → 按最长边（高）等比缩小', () => {
    // 高 2000 → 1600（scale 0.8），宽 1000→800
    expect(fitWithinMaxEdge(1000, 2000, 1600)).toEqual({ w: 800, h: 1600 });
  });

  it('非整数边长取整', () => {
    expect(fitWithinMaxEdge(1500.6, 1000.4, 1600)).toEqual({ w: 1501, h: 1000 });
  });

  it('零尺寸兜底为至少 1×1', () => {
    expect(fitWithinMaxEdge(0, 0, 1600)).toEqual({ w: 1, h: 1 });
  });

  it('体积/边长上限常量契约', () => {
    expect(DEFAULT_MAX_EDGE).toBe(1600);
    expect(DEFAULT_MAX_BYTES).toBe(1.5 * 1024 * 1024);
  });
});

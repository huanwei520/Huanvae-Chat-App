/**
 * cropImage 工具测试
 *
 * 重点测可写错的 pickOutputSize（min/floor/兜底）；canvas 重绘部分依赖真实 DOM，
 * 由 AvatarCropModal 组件测试 + code review 把关。
 */
import { describe, it, expect } from 'vitest';
import { pickOutputSize } from '../../src/utils/cropImage';

describe('pickOutputSize', () => {
  it('裁剪区域小于上限时不放大，按区域宽取整', () => {
    expect(pickOutputSize(300, 512)).toBe(300);
  });

  it('裁剪区域大于上限时取上限', () => {
    expect(pickOutputSize(1000, 512)).toBe(512);
  });

  it('非整数向下取整', () => {
    expect(pickOutputSize(300.9, 512)).toBe(300);
  });

  it('非正值兜底为 1（避免 0/负数画布）', () => {
    expect(pickOutputSize(0, 512)).toBe(1);
    expect(pickOutputSize(-10, 512)).toBe(1);
  });
});

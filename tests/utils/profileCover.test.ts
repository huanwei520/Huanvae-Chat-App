/**
 * profileCover.ts 纯函数测试
 *
 * 覆盖 qqHeroStyles 由封面主色派生卡底淡染色 / 封面兜底色 / 文字明暗的三类分支。
 * 纯函数无 DOM/canvas 依赖，直接断言返回值。
 */

import { describe, it, expect } from 'vitest';
import { qqHeroStyles, CARD_TINT } from '../../src/utils/profileCover';

describe('qqHeroStyles', () => {
  it('无主色（null/undefined）→ 全部回落默认（null）', () => {
    expect(qqHeroStyles(null)).toEqual({
      cardBackground: null,
      coverFallback: null,
    });
    expect(qqHeroStyles(undefined)).toEqual({
      cardBackground: null,
      coverFallback: null,
    });
  });

  it('深色主色 → 卡底=主色与白 0.82 淡染、封面兜底=主色实色', () => {
    const dark = { r: 30, g: 30, b: 60 };
    const s = qqHeroStyles(dark);
    // 卡底淡染（手算硬编码独立守卫）：30+(225)*0.82=214.5→215；60+(195)*0.82=219.9→220
    expect(s.cardBackground).toBe('rgba(215, 215, 220, 1)');
    // 封面兜底用主色实色
    expect(s.coverFallback).toBe('rgba(30, 30, 60, 1)');
  });

  it('亮色主色 → 卡底接近白、封面兜底=主色实色', () => {
    const light = { r: 245, g: 245, b: 245 };
    const s = qqHeroStyles(light);
    expect(s.coverFallback).toBe('rgba(245, 245, 245, 1)');
    // 卡底手算硬编码独立守卫：245+(10)*0.82=253.2→253
    expect(s.cardBackground).toBe('rgba(253, 253, 253, 1)');
  });

  it('CARD_TINT 为 0.82（卡底淡染比例契约）', () => {
    expect(CARD_TINT).toBe(0.82);
  });
});

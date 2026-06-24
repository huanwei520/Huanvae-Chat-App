/**
 * profileCover.ts 纯函数测试
 *
 * 覆盖：
 * - qqHeroStyles 由背景主色派生卡底淡染色（有主色 / 无主色两分支）
 * - backgroundCoverStyle 由背景类型派生封面 CSS（图片 / 纯色 / 无 三态 + 缺值回落）
 */

import { describe, it, expect } from 'vitest';
import { qqHeroStyles, backgroundCoverStyle, CARD_TINT } from '../../src/utils/profileCover';

describe('qqHeroStyles', () => {
  it('无主色（null/undefined）→ 卡底 null（回落 CSS 默认）', () => {
    expect(qqHeroStyles(null)).toEqual({ cardBackground: null });
    expect(qqHeroStyles(undefined)).toEqual({ cardBackground: null });
  });

  it('深色主色 → 卡底=主色与白 0.82 淡染（手算硬编码独立守卫）', () => {
    // 30+(225)*0.82=214.5→215；60+(195)*0.82=219.9→220
    expect(qqHeroStyles({ r: 30, g: 30, b: 60 }).cardBackground).toBe('rgba(215, 215, 220, 1)');
  });

  it('亮色主色 → 卡底接近白（245+(10)*0.82=253.2→253）', () => {
    expect(qqHeroStyles({ r: 245, g: 245, b: 245 }).cardBackground).toBe('rgba(253, 253, 253, 1)');
  });

  it('CARD_TINT 为 0.82（卡底淡染比例契约）', () => {
    expect(CARD_TINT).toBe(0.82);
  });
});

describe('backgroundCoverStyle', () => {
  it('image：用（已收口的）显示 URL 作 backgroundImage', () => {
    expect(backgroundCoverStyle('image', 'http://127.0.0.1:8765/user-backgrounds/u.jpg?t=1', null)).toEqual({
      backgroundImage: 'url(http://127.0.0.1:8765/user-backgrounds/u.jpg?t=1)',
    });
  });

  it('color：用纯色作 backgroundColor 并清除 backgroundImage', () => {
    expect(backgroundCoverStyle('color', null, '#3b82f6')).toEqual({
      backgroundImage: 'none',
      backgroundColor: '#3b82f6',
    });
  });

  it('none → 空对象（回落 CSS 默认渐变）', () => {
    expect(backgroundCoverStyle('none', null, null)).toEqual({});
  });

  it('类型与值不匹配（缺值）→ 空对象，不产出半截样式', () => {
    expect(backgroundCoverStyle('image', null, null)).toEqual({});
    expect(backgroundCoverStyle('color', null, null)).toEqual({});
  });
});

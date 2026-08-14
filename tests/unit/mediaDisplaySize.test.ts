/**
 * mediaDisplaySize —— 气泡内媒体的显示尺寸（手机端媒体缩放，2026-08-14）
 *
 * 被测对象 src/chat/shared/mediaDisplaySize.ts，两个纯函数：
 *   calculateDisplaySize  给上限盒（宽 <= 280、高 <= 320，且**限高不再倒着缩宽度**）
 *   mediaContainerStyle   把上限盒翻译成「width + max-width:100% + aspect-ratio」
 *
 * 🔴 这一层只能守「算得对不对」与「用的是相对量还是绝对量」。
 * **真实像素是不是不缺角，jsdom 结构性测不出**（无布局引擎，getBoundingClientRect 恒 0，
 * 见 .claude/rules/frontend-test.md「滚动 / 布局相关行为」）—— 那一半只能靠真机。
 */

import { describe, it, expect } from 'vitest';
import { calculateDisplaySize, mediaContainerStyle } from '../../src/chat/shared/mediaDisplaySize';

describe('calculateDisplaySize', () => {
  it('16:9 横图：卡到宽度上限，高度按比例', () => {
    expect(calculateDisplaySize(1280, 720)).toEqual({ width: 280, height: 158 });
  });

  it('🔴 超高竖图不再被算成细条（原宽 < 上限）：限高只截高，宽度保持原宽', () => {
    // 旧实现：200 < 280 宽度不动，卡高把高截到 300 后又按比例把宽算成 20 → 20x300 细条。
    const size = calculateDisplaySize(200, 3000);

    expect(size).toEqual({ width: 200, height: 320 });
    // 反向断言：宽度一旦掉到 200 以下，就说明「卡高那一步又把宽度缩回去了」
    expect(size.width).toBeGreaterThanOrEqual(200);
  });

  it('🔴 超高竖图不再被算成细条（原宽 > 上限）：宽度停在 280，不被高度倒着缩', () => {
    // 旧实现：先卡宽 280x4200，再卡高 → 21x300。
    const size = calculateDisplaySize(600, 9000);

    expect(size).toEqual({ width: 280, height: 320 });
    expect(size.width).toBeGreaterThanOrEqual(280);
  });

  it('高度上限是 320（本批 300 → 320）', () => {
    // 1:2 竖图，宽度卡到 280 后高度本应 560，被截到上限
    expect(calculateDisplaySize(500, 1000).height).toBe(320);
  });

  it('比原始尺寸小于上限时不放大', () => {
    expect(calculateDisplaySize(120, 90)).toEqual({ width: 120, height: 90 });
  });

  it('尺寸缺失（<= 0）→ 退到上限盒本身', () => {
    expect(calculateDisplaySize(0, 0)).toEqual({ width: 280, height: 320 });
    expect(calculateDisplaySize(-1, 100)).toEqual({ width: 280, height: 320 });
  });

  it('自定义上限被尊重', () => {
    expect(calculateDisplaySize(1000, 1000, 100, 100)).toEqual({ width: 100, height: 100 });
  });
});

describe('mediaContainerStyle', () => {
  it('🔴 用相对量承担收缩：给 max-width 100% + aspect-ratio，绝不写内联绝对 height', () => {
    const style = mediaContainerStyle({ width: 280, height: 158 });

    expect(style.width).toBe(280);
    expect(style.maxWidth).toBe('100%');
    expect(style.aspectRatio).toBe('280 / 158');
    // 反向断言（防「两行并存」蒙混）：写死高度会让窄屏收缩时高度不跟着走 → 又出现信箱空隙
    expect(style.height).toBeUndefined();
  });

  it('比例取的是显示盒的宽高比（超高竖图 ⇒ 盒子比例 != 画面比例，靠 object-fit contain 补黑边）', () => {
    const size = calculateDisplaySize(600, 9000);

    expect(mediaContainerStyle(size).aspectRatio).toBe('280 / 320');
  });
});

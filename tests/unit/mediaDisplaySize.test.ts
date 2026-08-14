/**
 * mediaDisplaySize —— 气泡内媒体的显示尺寸（A1「不硬撑黑边」，2026-08-14）
 *
 * 被测对象 src/chat/shared/mediaDisplaySize.ts，两个纯函数：
 *   calculateDisplaySize  给上限盒：窗口内（1/2.5 ≤ ar ≤ 2.5）容器比例 = 原图比例（零黑边），
 *                         窗口外才钉到边界比例并 letterbox
 *   mediaContainerStyle   把上限盒翻译成「width + max-width:100% + aspect-ratio」
 *
 * 🔴 本文件必须**同时**守住两个相反方向（缺一个就会把另一个改回去）：
 *   ① 窗口内不再落进「统一的大盒」—— 任意竖版手机截图都不该再算成 280×320；
 *   ② 窗口外不回「细条」—— 200×3000 曾被更早那版算成 20×300。
 *
 * 🔴 这一层只能守「算得对不对」。**真实像素上还剩多少黑边、加载完那一帧会不会跳版，
 * jsdom 结构性测不出**（无布局引擎，getBoundingClientRect 恒 0，
 * 见 .claude/rules/frontend-test.md「滚动 / 布局相关行为」）—— 那一半只能靠真机。
 */

import { describe, it, expect } from 'vitest';
import { calculateDisplaySize, mediaContainerStyle } from '../../src/chat/shared/mediaDisplaySize';

/** 容器比例（保留 3 位小数，抵消 Math.round 的整像素误差） */
const ratioOf = (s: { width: number; height: number }) => Number((s.width / s.height).toFixed(3));

describe('calculateDisplaySize —— 窗口内：容器比例 = 原图比例，零黑边', () => {
  it('16:9 横图：卡到宽度上限，高度按比例', () => {
    expect(calculateDisplaySize(1280, 720)).toEqual({ width: 280, height: 158 });
  });

  it('🔴 竖版手机截图不再被撑成统一的 280×320（1080×2400，ar=0.45）', () => {
    const size = calculateDisplaySize(1080, 2400);

    expect(size).toEqual({ width: 144, height: 320 });
    // 反向断言：一旦又变回 280 宽，就说明「高度截断把容器比例改成了盒子比例」回来了
    expect(size.width).not.toBe(280);
    // 容器比例必须就是原图比例 ⇒ object-fit: contain 之下一个黑像素都不剩
    expect(ratioOf(size)).toBe(Number((1080 / 2400).toFixed(3)));
  });

  it('🔴 换一张竖版截图不会落到同一个盒子里（iPhone 1179×2556 与上一条结果不同）', () => {
    const a = calculateDisplaySize(1080, 2400);
    const b = calculateDisplaySize(1179, 2556);

    expect(b).toEqual({ width: 148, height: 320 });
    // 「统一的大小」的判据就是这一条：两张不同比例的竖图必须给出不同的容器
    expect(b).not.toEqual(a);
  });

  it('窗口边界 ar = 2.5（1000×400）仍按原比例，不 letterbox', () => {
    const size = calculateDisplaySize(1000, 400);

    expect(size).toEqual({ width: 280, height: 112 });
    expect(ratioOf(size)).toBe(2.5);
  });

  it('窗口边界 ar = 0.4（400×1000）仍按原比例，不 letterbox', () => {
    const size = calculateDisplaySize(400, 1000);

    expect(size).toEqual({ width: 128, height: 320 });
    expect(ratioOf(size)).toBe(0.4);
  });

  it('高度上限是 320：1:2 竖图（500×1000）按原比例缩到 160×320', () => {
    const size = calculateDisplaySize(500, 1000);

    expect(size).toEqual({ width: 160, height: 320 });
    expect(size.height).toBe(320);
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

describe('calculateDisplaySize —— 窗口外：钉到边界比例 letterbox，且绝不回细条', () => {
  it('🔴 超高长截图（200×3000，ar≈0.067）钉到 1:2.5，不是 20×300 的细条', () => {
    const size = calculateDisplaySize(200, 3000);

    expect(size).toEqual({ width: 128, height: 320 });
    // 更早那版「先卡宽再卡高」在这里给 20×300 —— 宽度掉回两位数就是它回来了
    expect(size.width).toBeGreaterThan(100);
    expect(ratioOf(size)).toBe(0.4);
  });

  it('🔴 更宽一点的长截图（600×9000）同样钉到 1:2.5，而不是上一版的 280×320', () => {
    const size = calculateDisplaySize(600, 9000);

    expect(size).toEqual({ width: 128, height: 320 });
    // 上一版「只截高、宽度不动」在这里给 280×320（= 统一的大盒）
    expect(size.width).not.toBe(280);
  });

  it('超宽全景（3000×200，ar=15）钉到 2.5:1，不再细成一条 280×19', () => {
    const size = calculateDisplaySize(3000, 200);

    expect(size).toEqual({ width: 280, height: 112 });
    expect(ratioOf(size)).toBe(2.5);
  });

  it('窗口边界两侧连续：ar 从 0.4 迈到 0.39 时容器尺寸不跳变', () => {
    const inside = calculateDisplaySize(400, 1000);   // ar = 0.400
    const outside = calculateDisplaySize(390, 1000);  // ar = 0.390

    expect(outside).toEqual(inside);
  });

  it('窗口外但本身很小的图不被放大（20×300 的自然盒仍是 120×300）', () => {
    expect(calculateDisplaySize(20, 300)).toEqual({ width: 120, height: 300 });
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

  it('窗口内的容器比例就是画面比例（竖版截图 ⇒ contain 之下无黑边）', () => {
    const size = calculateDisplaySize(1080, 2400);

    expect(mediaContainerStyle(size).aspectRatio).toBe('144 / 320');
  });

  it('窗口外比例才与画面不同（靠 object-fit contain 补黑边）', () => {
    const size = calculateDisplaySize(600, 9000);

    expect(mediaContainerStyle(size).aspectRatio).toBe('128 / 320');
  });
});

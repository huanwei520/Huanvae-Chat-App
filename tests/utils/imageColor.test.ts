/**
 * imageColor.ts 颜色互转测试（背景主色 ↔ 主题 hex）
 *
 * 覆盖本次新增的 rgbToHex / hexToRgb：背景主色驱动主题色需 RGB→#rrggbb；
 * 纯色背景需 #rrggbb→RGB 取 dominant。
 */

import { describe, it, expect } from 'vitest';
import { rgbToHex, hexToRgb } from '../../src/utils/imageColor';

describe('rgbToHex', () => {
  it('基本转换 + 补零', () => {
    expect(rgbToHex({ r: 30, g: 30, b: 60 })).toBe('#1e1e3c');
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe('#ffffff');
  });

  it('小数四舍五入 + 越界钳制', () => {
    // r:200.6→201=c9, g:49.4→49=31, b:50=32
    expect(rgbToHex({ r: 200.6, g: 49.4, b: 50 })).toBe('#c93132');
    // r:300→clamp 255=ff, g:-10→clamp 0=00, b:128=80
    expect(rgbToHex({ r: 300, g: -10, b: 128 })).toBe('#ff0080');
  });
});

describe('hexToRgb', () => {
  it('6 位十六进制（含/不含 #）', () => {
    expect(hexToRgb('#1e1e3c')).toEqual({ r: 30, g: 30, b: 60 });
    expect(hexToRgb('1E1E3C')).toEqual({ r: 30, g: 30, b: 60 });
  });

  it('3 位简写展开', () => {
    expect(hexToRgb('#f80')).toEqual({ r: 255, g: 136, b: 0 });
  });

  it('非法输入 → null', () => {
    expect(hexToRgb('#12')).toBeNull();
    expect(hexToRgb('rgb(1,2,3)')).toBeNull();
    expect(hexToRgb('')).toBeNull();
  });

  it('rgbToHex 与 hexToRgb 往返一致', () => {
    const rgb = { r: 18, g: 200, b: 77 };
    expect(hexToRgb(rgbToHex(rgb))).toEqual(rgb);
  });
});

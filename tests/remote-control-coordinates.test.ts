/**
 * 会议内远程控制——坐标换算与键位表契约测试（§7.2；对应实现 coordinates.ts）
 *
 * @module tests/remote-control-coordinates.test
 */

import { describe, expect, it } from 'vitest';
import {
  BUTTON_LEFT,
  BUTTON_MIDDLE,
  BUTTON_RIGHT,
  computeLetterbox,
  domButtonsToMask,
  domKeyToKeysym,
  keysToWire,
  makeInputEvent,
  mapClientToScreen,
} from '../src/remote-control/coordinates';

const GEO_16_9: Parameters<typeof mapClientToScreen>[2] = {
  containerW: 800,
  containerH: 450, // 与帧同比 → 无 letterbox
  frameW: 960,
  frameH: 540,
  screenW: 1920,
  screenH: 1080,
};

describe('computeLetterbox（contain 布局）', () => {
  it('同比容器无黑边', () => {
    const lb = computeLetterbox(GEO_16_9);
    expect(lb.dispW).toBeCloseTo(800);
    expect(lb.dispH).toBeCloseTo(450);
    expect(lb.offsetX).toBeCloseTo(0);
    expect(lb.offsetY).toBeCloseTo(0);
  });

  it('更宽容器产生左右黑边', () => {
    const lb = computeLetterbox({ ...GEO_16_9, containerW: 1600, containerH: 450 });
    // 高度受限：dispH=450、dispW=800，水平居中
    expect(lb.dispW).toBeCloseTo(800);
    expect(lb.dispH).toBeCloseTo(450);
    expect(lb.offsetX).toBeCloseTo(400);
    expect(lb.offsetY).toBeCloseTo(0);
  });

  it('非法尺寸回退零几何', () => {
    const lb = computeLetterbox({ ...GEO_16_9, frameW: 0 });
    expect(lb.dispW).toBe(0);
  });
});

describe('mapClientToScreen（client → frame → screen）', () => {
  it('中心点映射到屏幕中心', () => {
    expect(mapClientToScreen(400, 225, GEO_16_9)).toEqual({ x: 960, y: 540 });
  });

  it('左上角映射到屏幕原点', () => {
    expect(mapClientToScreen(0, 0, GEO_16_9)).toEqual({ x: 0, y: 0 });
  });

  it('右下角映射到屏幕右下（§7.2 screen = frame × screen/frame）', () => {
    expect(mapClientToScreen(800, 450, GEO_16_9)).toEqual({ x: 1920, y: 1080 });
  });

  it('黑边（帧外）返回 null——越界拒绝不回绕（§7.2，mapping.rs 同语义）', () => {
    const wide = { ...GEO_16_9, containerW: 1600 };
    expect(mapClientToScreen(100, 225, wide)).toBeNull(); // 左黑边
    expect(mapClientToScreen(1500, 225, wide)).toBeNull(); // 右黑边
    expect(mapClientToScreen(400, -1, GEO_16_9)).toBeNull();
  });

  it('screen 几何缺省时按 frame 1:1 兜底', () => {
    const p = mapClientToScreen(400, 225, {
      containerW: 800,
      containerH: 450,
      frameW: 960,
      frameH: 540,
      screenW: 0,
      screenH: 0,
    });
    expect(p).toEqual({ x: 480, y: 270 });
  });
});

describe('buttons 位掩码（0x06，session.rs:17 bit0 左/bit1 右/bit2 中）', () => {
  it('DOM buttons 同序掩码，仅裁 u8/u16 域', () => {
    expect(domButtonsToMask(1)).toBe(BUTTON_LEFT);
    expect(domButtonsToMask(2)).toBe(BUTTON_RIGHT);
    expect(domButtonsToMask(4)).toBe(BUTTON_MIDDLE);
    expect(BUTTON_LEFT | BUTTON_RIGHT).toBe(3);
  });
});

describe('最小键位表（§7.2）', () => {
  it('字母/数字映射 X11 keysym（ASCII 段）', () => {
    expect(domKeyToKeysym('a')).toBe(0x61);
    expect(domKeyToKeysym('A')).toBe(0x61); // 大写同键，修饰由 Shift 键状态承载
    expect(domKeyToKeysym('Z')).toBe(0x7a);
    expect(domKeyToKeysym('0')).toBe(0x30);
    expect(domKeyToKeysym('9')).toBe(0x39);
  });

  it('功能键/方向键/修饰键映射（keysym 低 16 位天然落 u16 域）', () => {
    expect(domKeyToKeysym('Enter')).toBe(0xff0d);
    expect(domKeyToKeysym('Escape')).toBe(0xff1b);
    expect(domKeyToKeysym('ArrowLeft')).toBe(0xff51);
    expect(domKeyToKeysym('ArrowUp')).toBe(0xff52);
    expect(domKeyToKeysym('Shift')).toBe(0xffe1);
    expect(domKeyToKeysym('Control')).toBe(0xffe5);
    expect(domKeyToKeysym('Alt')).toBe(0xffe9);
    expect(domKeyToKeysym(' ')).toBe(0x20);
  });

  it('表外键丢弃（返回 null，调用方计数留痕）', () => {
    expect(domKeyToKeysym('F13')).toBeNull();
    expect(domKeyToKeysym('AudioVolumeUp')).toBeNull();
    expect(domKeyToKeysym('_dead')).toBeNull();
  });

  it('keysToWire：u16 裁剪＋去重＋升序（0x06 keys 域快照）', () => {
    expect(keysToWire([0xff0d, 0x61, 0xff0d])).toEqual([0x61, 0xff0d]);
    expect(keysToWire([0x1_0061])).toEqual([0x61]); // 低 16 位裁剪
  });

  it('makeInputEvent 组 0x06 域载荷', () => {
    expect(makeInputEvent(100, 200, BUTTON_LEFT | 0x100, [0x61])).toEqual({
      x: 100,
      y: 200,
      buttons: BUTTON_LEFT, // u8 域钳制（高位噪声被裁，session.rs buttons:u8）
      keys: [0x61],
    });
  });
});

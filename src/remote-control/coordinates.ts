/**
 * 会议内远程控制——坐标换算与最小键位表（§7.2；纯函数，vitest 单测）
 *
 * 通路：控制窗 client 坐标 →（letterbox 几何）→ frame 坐标 →（屏幕几何）→ screen 坐标
 *   screen_x = frame_x × screen_w / frame_w
 * 几何来源：frame w/h 取 daemon 帧元数据；screen w/h 取 daemon status 的采集返回
 * （backend.rs:145 GetImage 全屏几何）；daemon 未连接时 screen 兜底 = frame（1:1）。
 *
 * 键位表：设计 §7.2 测试面最小集（字母/数字/方向键/Enter/Esc/Shift/Ctrl/Alt/Space/
 * Backspace/Tab）→ X11 keysym 低 16 位（keysym 0x00–0xffff 天然落 u16 域）；
 * 表外键丢弃并计数留痕；全量键位表为生产评审项（§10.1 P-8）。
 *
 * @module remote-control/coordinates
 */

import type { ControlInputEvent } from './types';

/** contain 模式 letterbox 几何 */
export interface FrameGeometry {
  /** 容器（捕获区）CSS 像素尺寸 */
  containerW: number;
  containerH: number;
  /** 帧像素尺寸（daemon 帧元数据） */
  frameW: number;
  frameH: number;
  /** 被控屏物理几何（daemon status.screen；缺省 = frame 尺寸 1:1） */
  screenW: number;
  screenH: number;
}

/** 由容器/帧/屏三组尺寸算 contain 布局（显示尺寸 + 居中偏移） */
export function computeLetterbox(geo: FrameGeometry): {
  dispW: number;
  dispH: number;
  offsetX: number;
  offsetY: number;
} {
  if (geo.frameW <= 0 || geo.frameH <= 0 || geo.containerW <= 0 || geo.containerH <= 0) {
    return { dispW: 0, dispH: 0, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(geo.containerW / geo.frameW, geo.containerH / geo.frameH);
  const dispW = geo.frameW * scale;
  const dispH = geo.frameH * scale;
  return {
    dispW,
    dispH,
    offsetX: (geo.containerW - dispW) / 2,
    offsetY: (geo.containerH - dispH) / 2,
  };
}

/**
 * client（容器内 CSS 像素，左上原点）→ screen 坐标。
 * 落在 letterbox 黑边/帧外返回 null（§7.2：越界拒绝不回绕，mapping.rs:105-107 同语义）。
 */
export function mapClientToScreen(
  clientX: number,
  clientY: number,
  geo: FrameGeometry,
): { x: number; y: number } | null {
  const { dispW, dispH, offsetX, offsetY } = computeLetterbox(geo);
  if (dispW <= 0 || dispH <= 0) { return null; }
  const fx = clientX - offsetX;
  const fy = clientY - offsetY;
  if (fx < 0 || fy < 0 || fx > dispW || fy > dispH) { return null; }
  const frameX = (fx / dispW) * geo.frameW;
  const frameY = (fy / dispH) * geo.frameH;
  const screenW = geo.screenW > 0 ? geo.screenW : geo.frameW;
  const screenH = geo.screenH > 0 ? geo.screenH : geo.frameH;
  const x = Math.round((frameX * screenW) / geo.frameW);
  const y = Math.round((frameY * screenH) / geo.frameH);
  // u16 域钳制（0x06 InputEvent x/y:u16BE，session.rs:13）
  const clamp16 = (v: number) => Math.max(0, Math.min(0xffff, v));
  return { x: clamp16(x), y: clamp16(y) };
}

/** 0x06 buttons 位掩码（session.rs:17：bit0 左/bit1 右/bit2 中） */
export const BUTTON_LEFT = 1 << 0;
export const BUTTON_RIGHT = 1 << 1;
export const BUTTON_MIDDLE = 1 << 2;

/** DOM MouseEvent.buttons 已是同序位掩码（bit0 左/bit1 右/bit2 中），仅裁 u8 域 */
export function domButtonsToMask(buttons: number): number {
  return buttons & 0x07;
}

/**
 * 最小键位表：DOM `KeyboardEvent.key` → X11 keysym 低 16 位。
 * 表外返回 null（丢弃＋审计计数，§7.2）。
 */
const KEY_TABLE: Record<string, number> = {
  // 字母（keysym = 小写 ASCII）
  ...Object.fromEntries(
    'abcdefghijklmnopqrstuvwxyz'.split('').map((c, i) => [c, 0x61 + i]),
  ),
  // 大写字母与 shift 组合按同一 keysym（被控端以 Shift 修饰键状态为准）
  ...Object.fromEntries(
    'abcdefghijklmnopqrstuvwxyz'.split('').map((c, i) => [c.toUpperCase(), 0x61 + i]),
  ),
  // 数字
  ...Object.fromEntries(
    '0123456789'.split('').map((c, i) => [c, 0x30 + i]),
  ),
  // 功能键
  Enter: 0xff0d,
  Escape: 0xff1b,
  Backspace: 0xff08,
  Tab: 0xff09,
  ' ': 0x0020,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  // 修饰键
  Shift: 0xffe1,
  Control: 0xffe5,
  Alt: 0xffe9,
};

/** 查表（未命中返回 null；调用方丢弃并计数） */
export function domKeyToKeysym(key: string): number | null {
  const sym = KEY_TABLE[key];
  return typeof sym === 'number' ? sym & 0xffff : null;
}

/** keysym 集合 → 0x06 keys 域（u16 升序去重） */
export function keysToWire(keys: Iterable<number>): number[] {
  return [...new Set([...keys].map((k) => k & 0xffff))].sort((a, b) => a - b);
}

/** 组一个 0x06 域输入事件（daemon /control/input 载荷） */
export function makeInputEvent(
  x: number,
  y: number,
  buttons: number,
  keys: Iterable<number>,
): ControlInputEvent {
  return { x, y, buttons: buttons & 0xff, keys: keysToWire(keys) };
}

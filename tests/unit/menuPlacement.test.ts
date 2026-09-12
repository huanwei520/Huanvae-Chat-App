/**
 * 长按菜单三缘限位（menuPlacement）纯函数单测
 *
 * 覆盖 2026-09-10「长按菜单边缘限位」任务的钳制规则：
 * - 贴左缘 / 贴右缘：菜单钳进可视区（含安全区 inset 加宽的边界）；
 * - 贴底缘：气泡上方放菜单（默认）；上方放不下 → 下翻；下翻仍溢出 → 底缘回钳；
 * - 边界 = max(padding, safe-area-inset)，左右上下四向；
 * - 可视区极端窄（菜单比可视区宽）时区间不倒挂。
 *
 * 移动端真实尺寸参照：1080×2400@420dpi 模拟器，CSS 视口 ≈411×891。
 */
import { describe, it, expect } from 'vitest';
import { clampMobileMenuPlacement, probeSafeAreaInsets, ZERO_INSETS } from '../../src/chat/shared/menuPlacement';

const VP = { width: 411, height: 891 };

describe('clampMobileMenuPlacement · 居中默认（不贴缘）', () => {
  it('屏幕中间气泡 → 菜单水平居中气泡、垂直在上方，且完整在可视区内', () => {
    const w = 3 * 64 + 14; // 真实 3 项菜单宽（回复/复制/删除+多选）
    const p = clampMobileMenuPlacement({
      bubble: { left: 150, right: 260, top: 500, bottom: 540 },
      viewportWidth: VP.width, viewportHeight: VP.height,
      menuWidth: w, menuHeight: 58,
    });
    expect(p.placement).toBe('above');
    expect(p.top).toBe(500 - 8 - 58); // bubble.top - gap - menuHeight
    expect(p.left).toBe(205 - w / 2); // 居中
    expect(p.left).toBeGreaterThanOrEqual(10);
    expect(p.left + w).toBeLessThanOrEqual(VP.width - 10);
  });
});

describe('clampMobileMenuPlacement · 贴左缘', () => {
  it('左侧来消息泡（left≈0）→ 菜单钳到 padding=10，不越左缘', () => {
    const p = clampMobileMenuPlacement({
      bubble: { left: 2, right: 160, top: 500, bottom: 540 },
      viewportWidth: VP.width, viewportHeight: VP.height,
      menuWidth: 206, menuHeight: 58,
    });
    // 未钳制时居中 x = 81-103 = -22 < padding=10 → 钳到 10
    expect(p.left).toBe(10);
    expect(p.left + 206).toBeLessThanOrEqual(VP.width - 10);
    expect(p.placement).toBe('above');
  });

  it('左缘有安全区 inset（横屏刘海 30px）→ 钳到 inset 而非 padding', () => {
    const p = clampMobileMenuPlacement({
      bubble: { left: 0, right: 160, top: 500, bottom: 540 },
      viewportWidth: VP.width, viewportHeight: VP.height,
      insets: { top: 0, right: 0, bottom: 0, left: 30 },
      menuWidth: 200, menuHeight: 58,
    });
    expect(p.left).toBe(30);
  });
});

describe('clampMobileMenuPlacement · 贴右缘', () => {
  it('右侧自己消息泡（right≈411）→ 菜单右缘钳到 视口宽-padding，不越右缘', () => {
    const p = clampMobileMenuPlacement({
      bubble: { left: 250, right: 409, top: 500, bottom: 540 },
      viewportWidth: VP.width, viewportHeight: VP.height,
      menuWidth: 206, menuHeight: 58,
    });
    // 未钳制时居中 x = 329.5-103 = 226.5，右缘 226.5+206=432.5 > 401 → 钳到 401-206=195
    expect(p.left + 206).toBeLessThanOrEqual(VP.width - 10);
    expect(p.left).toBe(VP.width - 10 - 206);
  });

  it('右缘安全区 inset 20px → 菜单右缘避让到 inset 内侧', () => {
    const p = clampMobileMenuPlacement({
      bubble: { left: 250, right: 411, top: 500, bottom: 540 },
      viewportWidth: VP.width, viewportHeight: VP.height,
      insets: { top: 0, right: 20, bottom: 0, left: 0 },
      menuWidth: 200, menuHeight: 58,
    });
    expect(p.left + 200).toBeLessThanOrEqual(VP.width - 20);
  });
});

describe('clampMobileMenuPlacement · 贴底缘', () => {
  it('贴底小气泡（bottom=889）→ 上方放得下 → above，菜单底边距气泡 gap=8，完整在可视区', () => {
    const p = clampMobileMenuPlacement({
      bubble: { left: 100, right: 300, top: 849, bottom: 889 },
      viewportWidth: VP.width, viewportHeight: VP.height,
      menuWidth: 206, menuHeight: 58,
    });
    expect(p.placement).toBe('above');
    expect(p.top).toBe(849 - 8 - 58);
    expect(p.top + 58).toBeLessThanOrEqual(VP.height - 10);
  });

  it('贴底 + 底部安全区 inset 48px（手势导航条）→ 菜单底边在 inset 上方', () => {
    const p = clampMobileMenuPlacement({
      bubble: { left: 100, right: 300, top: 801, bottom: 841 },
      viewportWidth: VP.width, viewportHeight: VP.height,
      insets: { top: 24, right: 0, bottom: 48, left: 0 },
      menuWidth: 206, menuHeight: 58,
    });
    expect(p.placement).toBe('above');
    expect(p.top).toBe(801 - 8 - 58);
    expect(p.top + 58).toBeLessThanOrEqual(VP.height - 48);
  });

  it('上方放不下（气泡贴顶）→ 翻转到气泡下方 below', () => {
    const p = clampMobileMenuPlacement({
      bubble: { left: 100, right: 300, top: 30, bottom: 70 },
      viewportWidth: VP.width, viewportHeight: VP.height,
      menuWidth: 398, menuHeight: 58,
    });
    expect(p.placement).toBe('below');
    expect(p.top).toBe(70 + 8);
  });

  it('上方放不下且下方也溢出（高气泡）→ 底缘回钳：菜单完整可见（top ≤ maxY）', () => {
    // 气泡高 750：top=80, bottom=830 → 上方 80-8-58=14 < minY=10? 否 → above 放得下
    // 构造：top=70, bottom=820；yAbove=70-8-58=4 < 10 → 上方放不下；
    // yBelow=828, maxY=891-10-58=823 → 828>823 → 下方也放不下 → 回钳。
    const p = clampMobileMenuPlacement({
      bubble: { left: 100, right: 300, top: 70, bottom: 820 },
      viewportWidth: VP.width, viewportHeight: VP.height,
      menuWidth: 206, menuHeight: 58,
    });
    expect(p.top).toBeGreaterThanOrEqual(10);
    expect(p.top + 58).toBeLessThanOrEqual(VP.height - 10);
    // 下方空间 823-828=-5 < 上方空间 4-10=-6 → 下方空间大 → below 回钳到 maxY
    expect(p.placement).toBe('below');
    expect(p.top).toBe(VP.height - 10 - 58);
  });

  it('两侧都放不下且上方空间更大 → 回钳到顶缘 minY', () => {
    const p = clampMobileMenuPlacement({
      bubble: { left: 100, right: 300, top: 40, bottom: 850 },
      viewportWidth: VP.width, viewportHeight: VP.height,
      menuWidth: 206, menuHeight: 58,
    });
    // yAbove=40-8-58=-26 → 上方放不下；yBelow=858 > maxY=823 → 下方也放不下
    // spaceAbove=-26-10=-36 < spaceBelow=823-858=-35 → 下方大 → below maxY
    expect(p.placement).toBe('below');
    expect(p.top).toBe(823);
  });
});

describe('clampMobileMenuPlacement · 退化与兜底', () => {
  it('菜单比可视区宽 → x 区间不倒挂，钳到 minX', () => {
    const p = clampMobileMenuPlacement({
      bubble: { left: 200, right: 210, top: 500, bottom: 540 },
      viewportWidth: 300, viewportHeight: VP.height,
      menuWidth: 500, menuHeight: 58,
    });
    expect(p.left).toBe(10);
    expect(p.left + 500).toBeGreaterThan(300); // 如实越界（物理上不可避免），但起点被钳住
  });

  it('insets 缺省 → 与 ZERO_INSETS 等价', () => {
    const a = clampMobileMenuPlacement({
      bubble: { left: 2, right: 160, top: 500, bottom: 540 },
      viewportWidth: VP.width, viewportHeight: VP.height,
      menuWidth: 200, menuHeight: 58,
    });
    const b = clampMobileMenuPlacement({
      bubble: { left: 2, right: 160, top: 500, bottom: 540 },
      viewportWidth: VP.width, viewportHeight: VP.height,
      insets: ZERO_INSETS,
      menuWidth: 200, menuHeight: 58,
    });
    expect(a).toEqual(b);
  });
});

describe('probeSafeAreaInsets · 探针兜底', () => {
  it('jsdom 下可安全调用（env() 不解析 → 返回零 inset），且探针节点无残留', () => {
    const before = document.body.childElementCount;
    const insets = probeSafeAreaInsets();
    expect(insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(document.body.childElementCount).toBe(before); // 探针用完即删
  });
});

// ==================================================================
// 修复前算法诊断镜像（git HEAD 79ce79a MessageContextMenu.tsx 旧 ：211-252
// 移动端分支公式原样照抄），并代入实测真实菜单尺寸 291.52×62.02
// （1080×2400@420dpi 模拟器实测，见证据 logs/metrics-*.json）——
// 用可复算数字锁住三处缺陷行为，防止回退。
// ==================================================================
import { clampMobileMenuPlacement as clamp } from '../../src/chat/shared/menuPlacement';

const REAL_W = 291.52;
const REAL_H = 62.02;

interface Rect { left: number; right: number; top: number; bottom: number }

/** 修复前（HEAD）移动端分支位置公式，原样照抄（含把 x 推成负值的右缘钳制与无校验翻转） */
function legacyPlacement(b: Rect, vw: number, _vh: number) {
  const padding = 10;
  const menuWidth = 6 * 52 + 16; // = 328（HEAD 旧 ：224：itemCount*52+16，6 项）
  const menuHeight = 44;         // HEAD 旧 ：225
  const bubbleCenterX = b.left + (b.right - b.left) / 2;
  let x = bubbleCenterX - menuWidth / 2;
  if (x < padding) { x = padding; }
  if (x + menuWidth > vw - padding) { x = vw - menuWidth - padding; }
  let y = b.top - menuHeight - 8;
  if (y < padding) { y = b.bottom + 8; }
  return { left: x, top: y, width: menuWidth, height: menuHeight };
}

describe('诊断镜像 · 修复前算法的三处缺陷（实测尺寸代入）', () => {
  it('缺陷1a 窄视口 320dp：旧钳制把 x 推成 -18 → 菜单画出左缘被裁切；新钳制完整在可视区内', () => {
    const b: Rect = { left: 80, right: 310, top: 300, bottom: 342 };
    const old1 = legacyPlacement(b, 320, 915);
    expect(old1.left).toBe(-18); // 320-328-10，旧右缘钳制无左侧下界保护
    expect(old1.left + REAL_W).toBeLessThanOrEqual(320 - 10); // 右侧其实装得下 → 纯放置缺陷
    const p = clamp({ bubble: b, viewportWidth: 320, viewportHeight: 915, menuWidth: REAL_W, menuHeight: REAL_H });
    expect(p.left).toBeGreaterThanOrEqual(10);
    expect(p.left + REAL_W).toBeLessThanOrEqual(320 - 10);
  });

  it('缺陷2 高气泡贴底（top<62 触发翻下）：旧翻下无底缘校验 → 菜单底边 930.02 溢出；新底缘回钳完整可见', () => {
    const b: Rect = { left: 100, right: 300, top: 50, bottom: 860 };
    const old1 = legacyPlacement(b, 412, 915);
    expect(old1.top).toBe(868);          // 翻到气泡下方，无任何校验
    expect(old1.top + REAL_H).toBeGreaterThan(915); // 真实底边 930.02 溢出可视区
    const p = clamp({ bubble: b, viewportWidth: 412, viewportHeight: 915, menuWidth: REAL_W, menuHeight: REAL_H });
    expect(p.placement).toBe('below');
    expect(p.top).toBe(915 - 10 - REAL_H); // 底缘回钳
    expect(p.top + REAL_H).toBeLessThanOrEqual(915 - 10);
  });

  it('缺陷3 安全区顶部 inset 49：旧允许菜单顶 23 画进状态栏下；新边界取 max(padding,inset) → 翻到气泡下方避让', () => {
    const b: Rect = { left: 100, right: 300, top: 75, bottom: 117 };
    const old1 = legacyPlacement(b, 412, 915);
    expect(old1.top).toBe(23);
    expect(old1.top).toBeLessThan(49); // 画进状态栏（inset.top=49）之下
    const p = clamp({
      bubble: b, viewportWidth: 412, viewportHeight: 915,
      insets: { top: 49, right: 0, bottom: 0, left: 0 },
      menuWidth: REAL_W, menuHeight: REAL_H,
    });
    expect(p.placement).toBe('below'); // 上方放不下（boundTop=49）
    expect(p.top).toBe(b.bottom + 8);
    expect(p.top).toBeGreaterThanOrEqual(49);
  });

  it('缺陷1b 高度低估 44 vs 实测 62.02：旧菜单底边压住气泡顶边 10.02px；新 gap=8 不压气泡', () => {
    // R 场景实测气泡矩形（logs/metrics-02-menu-right-edge.json）
    const b: Rect = { left: 201.27, right: 404.48, top: 731.84, bottom: 774.24 };
    const old1 = legacyPlacement(b, 412, 915);
    expect(old1.top).toBeCloseTo(679.84, 2);
    expect(old1.top + REAL_H).toBeGreaterThan(b.top);       // 741.86 > 731.84
    expect(old1.top + REAL_H - b.top).toBeCloseTo(10.02, 2); // 压住气泡顶边
    const p = clamp({ bubble: b, viewportWidth: 412, viewportHeight: 915, menuWidth: REAL_W, menuHeight: REAL_H });
    expect(p.placement).toBe('above');
    expect(p.top + REAL_H).toBe(b.top - 8); // 恰好 gap=8，不压气泡
  });
});

describe('触点锚兜底（bubbleRect 缺失 → 零宽/零高合成矩形）', () => {
  it('触点在屏幕中部 → 菜单以触点为中心、在触点上方，完整在可视区内', () => {
    const touch = { x: 206, y: 600 };
    const p = clamp({
      bubble: { left: touch.x, right: touch.x, top: touch.y, bottom: touch.y },
      viewportWidth: 412, viewportHeight: 915,
      menuWidth: REAL_W, menuHeight: REAL_H,
    });
    expect(p.placement).toBe('above');
    expect(p.left).toBeCloseTo(touch.x - REAL_W / 2, 2);
    expect(p.top).toBe(touch.y - 8 - REAL_H);
    expect(p.left).toBeGreaterThanOrEqual(10);
    expect(p.left + REAL_W).toBeLessThanOrEqual(412 - 10);
    expect(p.top).toBeGreaterThanOrEqual(49); // 不进状态栏
  });

  it('触点贴右缘（x=408）→ 右缘钳制，不溢出；触点贴底 → 上弹且完整可见', () => {
    const p1 = clamp({
      bubble: { left: 408, right: 408, top: 600, bottom: 600 },
      viewportWidth: 412, viewportHeight: 915,
      menuWidth: REAL_W, menuHeight: REAL_H,
    });
    expect(p1.left + REAL_W).toBeLessThanOrEqual(412 - 10);
    const p2 = clamp({
      bubble: { left: 206, right: 206, top: 910, bottom: 910 },
      viewportWidth: 412, viewportHeight: 915,
      menuWidth: REAL_W, menuHeight: REAL_H,
    });
    expect(p2.placement).toBe('above');
    expect(p2.top + REAL_H).toBeLessThanOrEqual(915 - 10);
    expect(p2.top).toBeGreaterThanOrEqual(49);
  });
});

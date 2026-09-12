/**
 * 远控控制窗链路状态机单元测试（src/remote-control/ControlWindow.tsx）
 *
 * 背景（2026-09-09 修「常驻未连接」误报）：旧实现 status 初值 null 直接渲染
 * 「控制 daemon 未连接」＝首探未归即宣断；且单次探活失败立翻「未连接」＝瞬时
 * 超时误报。新状态机：probing（首探未归不宣断）→ connected（单败保持，不清零
 * 不翻面）→ down（连续 LINK_DOWN_STREAK 次失败才确证，此时为真断开）。
 *
 * 纯函数 nextLinkState(prev, ok, failStreak) 的迁移表覆盖。
 */

import { describe, it, expect } from 'vitest';
import {
  nextLinkState,
  LINK_DOWN_STREAK,
  type LinkState,
} from '../src/remote-control/ControlWindow';

describe('nextLinkState · 远控控制窗链路三态机', () => {
  it('常量语义：连续失败阈值 = 3（≈≥3s 连续不可达）', () => {
    expect(LINK_DOWN_STREAK).toBe(3);
  });

  it('探活成功 → 恒 connected（无论此前何态、失败计数多少）', () => {
    const states: LinkState[] = ['probing', 'connected', 'down'];
    for (const prev of states) {
      for (const streak of [0, 1, LINK_DOWN_STREAK, 99]) {
        expect(nextLinkState(prev, true, streak)).toBe('connected');
      }
    }
  });

  it('首探未归（probing）＋失败未达阈值 → 保持 probing，不宣断（初值误报修复点）', () => {
    for (let streak = 1; streak < LINK_DOWN_STREAK; streak++) {
      expect(nextLinkState('probing', false, streak)).toBe('probing');
    }
  });

  it('connected 中单次/双次瞬时失败 → 保持 connected 不翻面（竞态误报修复点）', () => {
    for (let streak = 1; streak < LINK_DOWN_STREAK; streak++) {
      expect(nextLinkState('connected', false, streak)).toBe('connected');
    }
  });

  it('连续失败达阈值 → down（此时「未连接」为真断开，如实展示）', () => {
    expect(nextLinkState('probing', false, LINK_DOWN_STREAK)).toBe('down');
    expect(nextLinkState('connected', false, LINK_DOWN_STREAK)).toBe('down');
  });

  it('down 后单次失败仍 down（未恢复前不闪回），成功即归 connected', () => {
    expect(nextLinkState('down', false, LINK_DOWN_STREAK + 5)).toBe('down');
    expect(nextLinkState('down', true, 99)).toBe('connected');
  });

  it('全迁移表穷举：probing/connected 未达阈值绝不新入 down；down 只能经成功离开', () => {
    const states: LinkState[] = ['probing', 'connected', 'down'];
    for (const prev of states) {
      for (let streak = 0; streak <= 20; streak++) {
        const next = nextLinkState(prev, false, streak);
        // 非 down 态在未达阈值时不得新入 down
        if (prev !== 'down' && streak < LINK_DOWN_STREAK) {
          expect(next).not.toBe('down');
        }
        if (next === 'down' && prev !== 'down') {
          expect(streak).toBeGreaterThanOrEqual(LINK_DOWN_STREAK);
        }
      }
      // down 态只能经成功离开
      expect(nextLinkState(prev, true, 0)).toBe('connected');
    }
  });
});

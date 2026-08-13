/**
 * deviceState 纯函数测试（VPN 设备死锁 / lockout 判定 + 本终端持有地址集合）
 *
 * ## isDeviceOccupiedElsewhere
 * 判定式：服务端说它在线（`status === 'online'`），但它**不由本终端持有**
 *         ⇒ 它在别的终端上跑着 ⇒ 本终端不得再选取连接（同一 VPN IP / 同一密钥会冲突）。
 *
 * 入参 serverStatus 必须是**服务端原值**。页面为了让本机连上隧道后立刻显示在线，在展示层会把
 * 本机那台强制显示成 'online'（displayStatusKey）——若误用那个覆盖值，本机自己这台
 * 会被判成"被占用"，连带废掉对它的锁定 / 解锁 / 删除。下面 `('online', true) → false`
 * 那条就是钉死这一点的防回归用例。
 *
 * ## reconcileSelfHeldIps
 * 「持有」比「此刻正连着」宽一格：本机**刚放开**的地址，在服务端那份 'online' 刷新之前仍算持有。
 * 少了这一格，断开隧道当帧那台设备就会被自己误判成「已被其它终端占用」而灰掉，
 * 要等服务端心跳超时才恢复（huanwei 2026-08-13 报障）。
 * 但也不能永久持有 —— 服务端读数一追上就必须忘掉，否则别人真连上它时不再灰掉，
 * 等于废掉 lockout 防护。下面「忘掉」那一组就是钉这一半。
 */

import { describe, it, expect } from 'vitest';
import {
  isDeviceOccupiedElsewhere,
  reconcileSelfHeldIps,
  OCCUPIED_HINT,
} from '../../src/huanvaeGuard/deviceState';

/** 造设备列表条目（只用到判定关心的两个字段） */
const dev = (virtual_ip: string, status: string) => ({ virtual_ip, status });

describe('isDeviceOccupiedElsewhere', () => {
  it('online 且不由本终端持有 → 被其它终端占用', () => {
    expect(isDeviceOccupiedElsewhere('online', false)).toBe(true);
  });

  it('online 且由本终端持有 → 不算占用（防回归：误用 displayStatusKey 会让这条变 true）', () => {
    // 本机正在连的那台必须仍可选中，否则对它的「锁定 / 解锁 / 删除」会一并被废掉
    expect(isDeviceOccupiedElsewhere('online', true)).toBe(false);
  });

  it('非 online 的服务端状态一律不算占用', () => {
    expect(isDeviceOccupiedElsewhere('offline', false)).toBe(false);
    expect(isDeviceOccupiedElsewhere('unknown', false)).toBe(false);
    // 'locked' 等后端可能新增、前端未本地化的状态原样透传，同样不参与占用判定
    expect(isDeviceOccupiedElsewhere('locked', false)).toBe(false);
    expect(isDeviceOccupiedElsewhere('', false)).toBe(false);
  });

  it('非 online 时是否持有不影响结果', () => {
    expect(isDeviceOccupiedElsewhere('offline', true)).toBe(false);
    expect(isDeviceOccupiedElsewhere('unknown', true)).toBe(false);
  });

  it('状态匹配区分大小写，不做归一化（避免凭空放行未知形态）', () => {
    expect(isDeviceOccupiedElsewhere('ONLINE', false)).toBe(false);
    expect(isDeviceOccupiedElsewhere('Online', false)).toBe(false);
  });
});

describe('reconcileSelfHeldIps · 记住', () => {
  it('连接中：本机隧道地址被收进集合', () => {
    expect(reconcileSelfHeldIps([], '10.0.0.5', [dev('10.0.0.5', 'online')]))
      .toEqual(['10.0.0.5']);
  });

  it('连接中：服务端还没把本机这台报成 online 也照样收进来（心跳未追上不影响持有）', () => {
    expect(reconcileSelfHeldIps([], '10.0.0.5', [dev('10.0.0.5', 'offline')]))
      .toEqual(['10.0.0.5']);
  });

  it('未连接且集合为空：保持为空（不会凭空持有任何地址）', () => {
    expect(reconcileSelfHeldIps([], null, [dev('10.0.0.9', 'online')])).toEqual([]);
  });
});

describe('reconcileSelfHeldIps · 断开后仍持有（本单要修的症状）', () => {
  it('刚断开、服务端那份 online 还是陈旧读数 → 仍算本终端持有 ⇒ 不被判占用', () => {
    const held = reconcileSelfHeldIps(['10.0.0.5'], null, [dev('10.0.0.5', 'online')]);
    expect(held).toEqual(['10.0.0.5']);
    // 端到端接上占用判定：断开当帧该设备必须仍可选
    expect(isDeviceOccupiedElsewhere('online', held.includes('10.0.0.5'))).toBe(false);
  });

  it('别的终端占着的地址从来不进集合 ⇒ 仍然被判占用（lockout 防护未被削弱）', () => {
    const held = reconcileSelfHeldIps(['10.0.0.5'], null, [
      dev('10.0.0.5', 'online'),
      dev('10.0.0.7', 'online'),
    ]);
    expect(held).not.toContain('10.0.0.7');
    expect(isDeviceOccupiedElsewhere('online', held.includes('10.0.0.7'))).toBe(true);
  });
});

describe('reconcileSelfHeldIps · 忘掉（服务端追上之后必须放手）', () => {
  it('服务端把它翻成 offline → 移出集合', () => {
    expect(reconcileSelfHeldIps(['10.0.0.5'], null, [dev('10.0.0.5', 'offline')])).toEqual([]);
  });

  it('设备已从列表消失（被删）→ 移出集合', () => {
    expect(reconcileSelfHeldIps(['10.0.0.5'], null, [])).toEqual([]);
  });

  it('忘掉之后它再变 online 就是别人在用 ⇒ 重新灰掉', () => {
    // 第一步：服务端追上（offline）→ 忘掉
    const afterCatchUp = reconcileSelfHeldIps(['10.0.0.5'], null, [dev('10.0.0.5', 'offline')]);
    expect(afterCatchUp).toEqual([]);
    // 第二步：别的终端把它连起来（online）→ 不在集合里 ⇒ 判占用
    const afterOthersTakeIt = reconcileSelfHeldIps(afterCatchUp, null, [dev('10.0.0.5', 'online')]);
    expect(afterOthersTakeIt).toEqual([]);
    expect(isDeviceOccupiedElsewhere('online', afterOthersTakeIt.includes('10.0.0.5'))).toBe(true);
  });

  it('本机换连另一台后，旧地址一旦被服务端刷新就放手，新地址进集合', () => {
    expect(reconcileSelfHeldIps(['10.0.0.5'], '10.0.0.6', [
      dev('10.0.0.5', 'offline'),
      dev('10.0.0.6', 'online'),
    ])).toEqual(['10.0.0.6']);
  });
});

describe('reconcileSelfHeldIps · 引用稳定性（调用方直接塞回 state 不会自激）', () => {
  it('内容不变时原样返回同一个数组引用', () => {
    const prev = ['10.0.0.5'];
    const next = reconcileSelfHeldIps(prev, '10.0.0.5', [dev('10.0.0.5', 'online')]);
    expect(next).toBe(prev);
  });

  it('空集合且无隧道时也返回同一引用', () => {
    const prev: readonly string[] = [];
    expect(reconcileSelfHeldIps(prev, null, [dev('10.0.0.5', 'online')])).toBe(prev);
  });

  it('内容真变了才返回新引用', () => {
    const prev = ['10.0.0.5'];
    const next = reconcileSelfHeldIps(prev, null, [dev('10.0.0.5', 'offline')]);
    expect(next).not.toBe(prev);
    expect(next).toEqual([]);
  });

  it('不重复收录同一个地址（连接期间反复 reconcile 不会让集合膨胀）', () => {
    let held: readonly string[] = [];
    for (let i = 0; i < 5; i += 1) {
      held = reconcileSelfHeldIps(held, '10.0.0.5', [dev('10.0.0.5', 'online')]);
    }
    expect(held).toEqual(['10.0.0.5']);
  });
});

describe('OCCUPIED_HINT', () => {
  it('非空，且说清了原因（防止被清空导致禁用变成"点了没反应"）', () => {
    expect(OCCUPIED_HINT.length).toBeGreaterThan(0);
    expect(OCCUPIED_HINT).toContain('其它终端');
    expect(OCCUPIED_HINT).toContain('不能');
  });
});

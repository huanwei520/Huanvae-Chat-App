/**
 * isDeviceOccupiedElsewhere 纯函数测试（VPN 设备死锁 / lockout 判定）
 *
 * 判定式：服务端说它在线（`status === 'online'`），但它不是本机此刻隧道在用的那台
 *         ⇒ 它在别的终端上跑着 ⇒ 本终端不得再选取连接（同一 VPN IP / 同一密钥会冲突）。
 *
 * 入参 serverStatus 必须是**服务端原值**。页面为了让本机连上隧道后立刻显示在线，在展示层会把
 * 本机那台强制显示成 'online'（displayStatusKey）——若误用那个覆盖值，本机自己这台
 * 会被判成"被占用"，连带废掉对它的锁定 / 解锁 / 删除。下面 `('online', true) → false`
 * 那条就是钉死这一点的防回归用例。
 */

import { describe, it, expect } from 'vitest';
import { isDeviceOccupiedElsewhere, OCCUPIED_HINT } from '../../src/huanvaeGuard/deviceState';

describe('isDeviceOccupiedElsewhere', () => {
  it('online 且非本机 → 被其它终端占用', () => {
    expect(isDeviceOccupiedElsewhere('online', false)).toBe(true);
  });

  it('online 且是本机 → 不算占用（防回归：误用 displayStatusKey 会让这条变 true）', () => {
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

  it('非 online 时 isSelf 不影响结果', () => {
    expect(isDeviceOccupiedElsewhere('offline', true)).toBe(false);
    expect(isDeviceOccupiedElsewhere('unknown', true)).toBe(false);
  });

  it('状态匹配区分大小写，不做归一化（避免凭空放行未知形态）', () => {
    expect(isDeviceOccupiedElsewhere('ONLINE', false)).toBe(false);
    expect(isDeviceOccupiedElsewhere('Online', false)).toBe(false);
  });
});

describe('OCCUPIED_HINT', () => {
  it('非空，且说清了原因（防止被清空导致禁用变成"点了没反应"）', () => {
    expect(OCCUPIED_HINT.length).toBeGreaterThan(0);
    expect(OCCUPIED_HINT).toContain('其它终端');
    expect(OCCUPIED_HINT).toContain('不能');
  });
});

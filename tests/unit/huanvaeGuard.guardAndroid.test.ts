/**
 * guardAndroid（src/huanvaeGuard/guardAndroid.ts）契约测试 —— 安卓取数轨
 *
 * 覆盖：
 *   - getStatus：hg_status 投影（statusJson 字符串解析 / available=false / statusJson 空）
 *   - startTunnel：hg_connect → hg_control_start 全链；授权闸（hg_guard_vpn_not_prepared
 *     时先 hg_prepare_vpn 后重试一次）；用户拒绝授权不重试；控制面失败不中止（controlStarted=false）
 *   - stopTunnel：hg_disconnect + hg_control_stop 顺序
 *   - describeError：reject 前缀族 → 人话文案映射（验收⑦映射表的实现处）
 *   - 会话 JSON 契约：master_url/device_id/access_token[/refresh_token] 键名（HgSession
 *     抽取契约），refresh_token 空串不出现
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  getStatus,
  startTunnel,
  stopTunnel,
  describeError,
} from '../../src/huanvaeGuard/guardAndroid';

const mockInvoke = vi.mocked(invoke);

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

/** 与 Guard 核心 vpn.rs status_json 同型的最小样本（redact 字段不含任何凭据值） */
const STATUS_JSON_SAMPLE = {
  status_code: 2,
  active: true,
  interface_name: 'tun0',
  address: '10.66.0.2/32',
  listen_port: 0,
  peers: [{ public_key: 'pk', endpoint: 'e:1', last_handshake: 3, rx_bytes: 1, tx_bytes: 2 }],
  control_plane: {
    enabled: true, connected: true, applied_peers: 1, applied_at: 100, auth_failures: 0,
  },
  last_error: null,
};

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('guardAndroid.getStatus', () => {
  it('available=true 且 statusJson 为字符串：解析为 TunnelStatus 同型对象', async () => {
    mockInvoke.mockResolvedValueOnce({
      available: true,
      bridgeVersion: 3,
      statusCode: 2,
      statusJson: JSON.stringify(STATUS_JSON_SAMPLE),
    });

    const snap = await getStatus();

    expect(mockInvoke).toHaveBeenCalledWith('plugin:hg-guard|hg_status');
    expect(snap.available).toBe(true);
    expect(snap.status).toEqual(STATUS_JSON_SAMPLE);
    expect(snap.status?.active).toBe(true);
    expect(snap.status?.control_plane?.connected).toBe(true);
  });

  it('available=false（桥不可用）：available=false + status=null，不解析', async () => {
    mockInvoke.mockResolvedValueOnce({ available: false, error: 'load failed' });

    const snap = await getStatus();

    expect(snap).toEqual({ available: false, status: null });
  });

  it('statusJson 缺省/null（桥就绪但状态未就绪）：available=true + status=null', async () => {
    mockInvoke.mockResolvedValueOnce({ available: true, statusCode: 0, statusJson: null });

    const snap = await getStatus();

    expect(snap).toEqual({ available: true, status: null });
  });
});

describe('guardAndroid.startTunnel — 授权闸与全链', () => {
  const params = {
    masterUrl: 'https://master.example.com',
    userId: 'user-1',
    deviceId: 'dev-1',
    accessToken: 'access-token-value',
    refreshToken: 'refresh-token-value',
  };

  it('已授权路径：connect 直接过 → control_start，会话 JSON 键名符合抽取契约', async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true, statusCode: 1 }); // hg_connect
    mockInvoke.mockResolvedValueOnce({ ok: true }); // hg_control_start

    const r = await startTunnel(params);

    expect(r).toEqual({ ok: true, controlStarted: true, controlError: undefined });
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'plugin:hg-guard|hg_connect', {
      masterUrl: params.masterUrl,
      session: expect.any(String),
    });
    const connectArgs = mockInvoke.mock.calls[0][1] as { session: string };
    const session = JSON.parse(connectArgs.session);
    expect(session).toEqual({
      master_url: params.masterUrl,
      user_id: params.userId,
      device_id: params.deviceId,
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'plugin:hg-guard|hg_control_start', {
      masterUrl: params.masterUrl,
      session: connectArgs.session,
    });
  });

  it('授权闸：connect 拒 not_prepared → prepare(用户同意) → 重试 connect 恰一次', async () => {
    mockInvoke
      .mockRejectedValueOnce('hg_guard_vpn_not_prepared') // 第一次 connect
      .mockResolvedValueOnce({ authorized: true }) // prepare
      .mockResolvedValueOnce({ ok: true, statusCode: 1 }) // 重试 connect
      .mockResolvedValueOnce({ ok: true }); // control_start

    const r = await startTunnel(params);

    expect(r.ok).toBe(true);
    const connectCalls = mockInvoke.mock.calls.filter(([cmd]) => cmd === 'plugin:hg-guard|hg_connect');
    expect(connectCalls).toHaveLength(2);
    expect(mockInvoke).toHaveBeenCalledWith('plugin:hg-guard|hg_prepare_vpn');
  });

  it('用户拒绝授权：不重试 connect，抛人话错误', async () => {
    mockInvoke
      .mockRejectedValueOnce('hg_guard_vpn_not_prepared')
      .mockResolvedValueOnce({ authorized: false });

    await expect(startTunnel(params)).rejects.toThrow(/VPN 授权未通过/);
    expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === 'plugin:hg-guard|hg_connect')).toHaveLength(1);
    expect(mockInvoke).not.toHaveBeenCalledWith('plugin:hg-guard|hg_control_start', expect.anything());
  });

  it('非授权类失败：原样上抛，不触发 prepare', async () => {
    mockInvoke.mockRejectedValueOnce('hg_guard_fetch_config_failed:redacted-detail');

    await expect(startTunnel(params)).rejects.toBe('hg_guard_fetch_config_failed:redacted-detail');
    expect(mockInvoke).not.toHaveBeenCalledWith('plugin:hg-guard|hg_prepare_vpn');
  });

  it('控制面失败不中止：controlStarted=false + controlError 带映射文案', async () => {
    mockInvoke
      .mockResolvedValueOnce({ ok: true, statusCode: 1 })
      .mockRejectedValueOnce('hg_guard_control_failed:code=-5 lastError=...');

    const r = await startTunnel(params);

    expect(r.ok).toBe(true);
    expect(r.controlStarted).toBe(false);
    expect(r.controlError).toContain('控制面启动失败');
    expect(r.controlError).toContain('code=-5');
  });

  it('refresh_token 为空串：会话 JSON 中整个键不出现（空串 ≠ 令牌）', async () => {
    mockInvoke.mockResolvedValue({ ok: true });

    await startTunnel({ ...params, refreshToken: '' });

    const session = JSON.parse((mockInvoke.mock.calls[0][1] as { session: string }).session);
    expect(session).not.toHaveProperty('refresh_token');
  });
});

describe('guardAndroid.stopTunnel', () => {
  it('先 hg_disconnect 后 hg_control_stop（均幂等）', async () => {
    mockInvoke.mockResolvedValue({ ok: true });

    await stopTunnel();

    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'plugin:hg-guard|hg_disconnect');
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'plugin:hg-guard|hg_control_stop');
  });
});

describe('guardAndroid.describeError — reject 前缀族映射（验收⑦映射表）', () => {
  it.each([
    ['hg_guard_bridge_unavailable:UnsatisfiedLinkError', 'Guard 原生组件不可用', 'UnsatisfiedLinkError'],
    ['hg_guard_invalid_args:session required', 'Guard 调用参数错误', 'session required'],
    ['hg_guard_fetch_config_failed:HttpError', '获取设备配置失败', 'HttpError'],
    ['hg_guard_vpn_not_prepared', 'VPN 尚未获得系统授权', ''],
    ['hg_guard_start_service_failed:IllegalStateException', 'VPN 服务启动失败', 'IllegalStateException'],
    ['hg_guard_control_failed:code=-5', '控制面启动失败', 'code=-5'],
  ])('%s → 含人话短语与 redact 后缀', (reject, phrase, detail) => {
    const text = describeError(reject);
    expect(text).toContain(phrase);
    if (detail !== '') { expect(text).toContain(detail); }
  });

  it('裸前缀（无后缀）：不给悬空冒号', () => {
    expect(describeError('hg_guard_vpn_not_prepared')).not.toMatch(/[：:]$/);
    expect(describeError('hg_guard_bridge_unavailable')).toBe(
      'Guard 原生组件不可用（桥加载失败或版本不匹配）。请重启应用后重试；若仍复现，说明此构建未包含可用的 Guard 组件',
    );
  });

  it('包装形态（实测）：人话映射对转发层包装的 reject 同样生效', () => {
    const wrapped = 'hg_guard: mobile invoke hgConnect failed: hg_guard_vpn_not_prepared';
    expect(describeError(wrapped)).toBe(
      'VPN 尚未获得系统授权：请重试，并在系统弹窗中允许建立 VPN 连接',
    );
  });

  it('未知错误原样透传（string / Error）', () => {
    expect(describeError('普通失败')).toBe('普通失败');
    expect(describeError(new Error('boom'))).toBe('boom');
  });
});

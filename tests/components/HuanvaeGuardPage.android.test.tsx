/**
 * HuanvaeGuardPage — Android 专属行为测试（阶段 2b 前端双轨）
 *
 * 钉住安卓轨的四条契约（每条都能在「没做安卓分流」的旧实现下 FAIL）：
 *   1. 探活走插件命令面轨（guardAndroid.getStatus），**绝不**碰桌面回环轨 localApi
 *   2. 修复/安装服务钮在安卓**不渲染**（无 SCM/LaunchDaemon，勘察 §1.2 #1 / §6.10 裁决）
 *   3. 连接全链走 guardAndroid.startTunnel（插件面内含拉配置），biometric_authenticate
 *      与 localApi.startTunnel 都不被触碰（macOS 专属门禁语义裁剪）
 *   4. startTunnel 失败：reject 人话文案进错误横幅；断开走 guardAndroid.stopTunnel
 *
 * 与 HuanvaeGuardPage.windows.test.tsx 同构（platform mock 是模块级，分文件隔离）。
 * 计时：3s 常驻轮询 ⇒ 全文件 fake timer + async 推进（详见 .claude/rules/frontend-test.md）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import type { HgDevice, TunnelStatus } from '../../src/huanvaeGuard/types';

// platform → android
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'android',
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }));

// guardAndroid 部分 mock：getStatus/startTunnel/stopTunnel 换 spy，describeError 用真实现
// （错误横幅断言的是 reject 前缀 → 人话映射的真实产物）
const mockGuardAndroid = vi.hoisted(() => ({
  getStatus: vi.fn(),
  startTunnel: vi.fn(),
  stopTunnel: vi.fn(),
}));
vi.mock('../../src/huanvaeGuard/guardAndroid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/huanvaeGuard/guardAndroid')>();
  return {
    ...actual,
    getStatus: mockGuardAndroid.getStatus,
    startTunnel: mockGuardAndroid.startTunnel,
    stopTunnel: mockGuardAndroid.stopTunnel,
  };
});

const mockLocalApi = vi.hoisted(() => ({
  getStatus: vi.fn(),
  startTunnel: vi.fn(),
  stopTunnel: vi.fn(),
  resolveLocalPort: vi.fn().mockResolvedValue(19198),
}));
vi.mock('../../src/huanvaeGuard/localApi', () => mockLocalApi);

const mockServerApi = vi.hoisted(() => ({
  getDevices: vi.fn().mockResolvedValue([]),
  listGroups: vi.fn().mockResolvedValue([]),
  listLinks: vi.fn().mockResolvedValue([]),
  getGroupDetail: vi.fn(),
  registerDevice: vi.fn(),
  deleteDevice: vi.fn(),
  lockDevice: vi.fn(),
  unlockDevice: vi.fn(),
  getDeviceConfig: vi.fn(),
  createLinkInvite: vi.fn(),
  acceptLinkInvite: vi.fn(),
  deleteLink: vi.fn(),
  createGroup: vi.fn(),
  createGroupInvite: vi.fn(),
  acceptGroupInvite: vi.fn(),
  leaveGroup: vi.fn(),
  toggleGroup: vi.fn(),
  deleteGroup: vi.fn(),
}));
vi.mock('../../src/huanvaeGuard/serverApi', () => mockServerApi);

vi.mock('../../src/services/deviceInfo', () => ({
  getDeviceInfo: vi.fn().mockResolvedValue({ macAddress: '00:11:22:33:44:55' }),
}));

import HuanvaeGuardPage from '../../src/huanvaeGuard/HuanvaeGuardPage';

/** 桥可用、隧道未建（hg_status 投影；control_plane 与桌面 ControlPlaneStatus 同型） */
const SNAP_UP: { available: true; status: TunnelStatus } = {
  available: true,
  status: {
    active: false, peers: [],
    control_plane: { enabled: true, connected: true, applied_peers: 0, auth_failures: 0 },
  },
};
/** 桥可用、隧道已建（断开钮出现的姿态） */
const SNAP_CONNECTED: { available: true; status: TunnelStatus } = {
  available: true,
  status: { ...SNAP_UP.status, active: true },
};

function setWindowQuery() {
  const params = new URLSearchParams({
    userId: 'u1',
    serverUrl: btoa('https://api.example.com'),
    accessToken: btoa('access-token'),
    refreshToken: btoa('refresh-token'),
  });
  window.history.replaceState({}, '', `/?${params}`);
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function renderPage() {
  render(<HuanvaeGuardPage />);
  await tick(0);
}

const ONE_DEVICE: HgDevice = {
  device_id: 'dev-1', user_id: 'u1', device_name: '手机', public_key: 'pk',
  virtual_ip: '10.66.0.2', node_id: null, psk_hash: null, os: 'android',
  device_fingerprint: null, status: 'offline', locked_endpoint: null,
  last_heartbeat: null, created_at: '', updated_at: '',
};

beforeEach(() => {
  cleanup();
  vi.useFakeTimers();
  setWindowQuery();
  h.invoke.mockReset();
  mockLocalApi.getStatus.mockReset();
  mockGuardAndroid.getStatus.mockReset();
  mockGuardAndroid.startTunnel.mockReset();
  mockGuardAndroid.stopTunnel.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
});

describe('HuanvaeGuardPage (Android) — 取数双轨', () => {
  it('探活走 guardAndroid.getStatus；localApi 与 hg_* 命令零调用；冠词为安卓措辞', async () => {
    mockGuardAndroid.getStatus.mockResolvedValue(SNAP_UP);

    await renderPage();

    expect(mockGuardAndroid.getStatus).toHaveBeenCalled();
    expect(mockLocalApi.getStatus).not.toHaveBeenCalled();
    expect(h.invoke).not.toHaveBeenCalled(); // 无 hg_is_installed / hg_local_control_port / biometric_*
    expect(screen.getByText('Guard 组件就绪')).toBeInTheDocument();
    expect(screen.queryByText('服务运行中')).not.toBeInTheDocument();
  });

  it('桥不可用：显示「Guard 组件不可用」，修复/安装服务钮不渲染（勘察 §6.10 裁剪）', async () => {
    mockGuardAndroid.getStatus.mockRejectedValueOnce(new Error('bridge gone'));

    await renderPage();

    expect(screen.getByText('Guard 组件不可用')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '安装服务' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '修复服务' })).not.toBeInTheDocument();
    // 平台支持面含安卓：不显示「仅 … 支持」的平台提示
    expect(screen.queryByText(/仅 Windows \/ macOS/)).not.toBeInTheDocument();
  });
});

describe('HuanvaeGuardPage (Android) — 连接/断开全链', () => {
  async function connectSelected() {
    mockServerApi.getDevices.mockResolvedValue([ONE_DEVICE]);
    await renderPage();
    fireEvent.click(screen.getByRole('radio'));
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    await tick(0);
  }

  it('连接走 guardAndroid.startTunnel（插件面内含拉配置），biometric/localApi 零触碰', async () => {
    mockGuardAndroid.getStatus.mockResolvedValue(SNAP_UP);
    mockGuardAndroid.startTunnel.mockResolvedValue({ ok: true, controlStarted: true });

    await connectSelected();

    expect(mockGuardAndroid.startTunnel).toHaveBeenCalledWith({
      masterUrl: 'https://api.example.com',
      deviceId: 'dev-1',
      userId: 'u1',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    expect(h.invoke).not.toHaveBeenCalledWith('biometric_authenticate', expect.anything());
    expect(mockLocalApi.startTunnel).not.toHaveBeenCalled();
    expect(mockServerApi.getDeviceConfig).not.toHaveBeenCalled();
  });

  it('startTunnel 拒绝：reject 前缀映射的人话文案进错误横幅', async () => {
    mockGuardAndroid.getStatus.mockResolvedValue(SNAP_UP);
    mockGuardAndroid.startTunnel.mockRejectedValue('hg_guard_fetch_config_failed:HttpError');

    await connectSelected();

    const banner = screen.getByRole('alert');
    expect(within(banner).getByText(/获取设备配置失败/)).toBeInTheDocument();
    expect(within(banner).getByText(/HttpError/)).toBeInTheDocument();
  });

  it('断开走 guardAndroid.stopTunnel（hg_disconnect+control_stop），localApi.stopTunnel 零触碰', async () => {
    mockGuardAndroid.getStatus
      .mockResolvedValueOnce(SNAP_UP) // 挂载探活：桥就绪、未连接 → 渲染「连接」
      .mockResolvedValue(SNAP_CONNECTED); // 连接后的复查起：已连接 → 渲染「断开」
    mockGuardAndroid.startTunnel.mockResolvedValue({ ok: true, controlStarted: true });
    mockGuardAndroid.stopTunnel.mockResolvedValue(undefined);

    await connectSelected();

    const disconnect = screen.getByRole('button', { name: '断开' });
    await act(async () => {
      fireEvent.click(disconnect);
      await Promise.resolve();
    });
    await tick(0);

    expect(mockGuardAndroid.stopTunnel).toHaveBeenCalled();
    expect(mockLocalApi.stopTunnel).not.toHaveBeenCalled();
  });
});

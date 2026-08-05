/**
 * HuanvaeGuardPage — 设备在线状态跨窗刷新契约
 *
 * HG 页面跑在独立 Tauri 窗口，设备列表此前只在 windowData 变化时拉一次，
 * 后端 `hg_device_status_changed` 帧到达主窗口后 HG 窗口的在线态会一直陈旧。
 * 主窗口收帧后 emit('hg:device-status-changed', {device_id, status}) 跨窗广播
 * （见 tests/unit/wsHandlersDispatch.test.ts），本文件锁定 HG 窗口这一侧：
 *   1. 页面 listen 了 'hg:device-status-changed'，回调触发设备列表重新拉取
 *   2. 回调把 payload 的 device_id / status 真的写进日志面板（而非丢弃 payload）
 *
 * 注：mock 布局照 HuanvaeGuardPage.test.tsx，差别只在 @tauri-apps/api/event 的
 * listen 要按事件名把 handler 存下来，供测试主动触发。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';

// ============== Mock @tauri-apps/plugin-os ==============
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'windows',
}));

// ============== Mock @tauri-apps/api/event ==============
// listen 按事件名把 handler 存进 map，测试据此主动投递跨窗事件
const eventMock = vi.hoisted(() => {
  const handlers = new Map<string, (e: { payload: unknown }) => void>();
  return {
    handlers,
    emit: vi.fn().mockResolvedValue(undefined),
    listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => {
      handlers.set(name, cb);
      return () => {};
    }),
  };
});
vi.mock('@tauri-apps/api/event', () => eventMock);

// ============== Mock localApi ==============
// 常驻单飞探活只调 getStatus：默认 {success:false} → 「本地服务未运行」
vi.mock('../../src/huanvaeGuard/localApi', () => ({
  getStatus: vi.fn().mockResolvedValue({ success: false }),
  startTunnel: vi.fn(),
  stopTunnel: vi.fn(),
  // 探活转为「运行中」时页面用它取真实控制端口打日志（端口不写死）：19198 = 模块内的默认端口
  resolveLocalPort: vi.fn().mockResolvedValue(19198),
}));

// ============== Mock serverApi ==============
const mockServerApi = vi.hoisted(() => ({
  getDevices: vi.fn(),
  listGroups: vi.fn(),
  listLinks: vi.fn(),
  getGroupDetail: vi.fn(),
  createGroup: vi.fn(),
  createGroupInvite: vi.fn(),
  acceptGroupInvite: vi.fn(),
  joinGroup: vi.fn(),
  leaveGroup: vi.fn(),
  toggleGroup: vi.fn(),
  deleteGroup: vi.fn(),
  registerDevice: vi.fn(),
  deleteDevice: vi.fn(),
  lockDevice: vi.fn(),
  unlockDevice: vi.fn(),
  getDeviceConfig: vi.fn(),
  createLinkInvite: vi.fn(),
  acceptLinkInvite: vi.fn(),
  deleteLink: vi.fn(),
}));

vi.mock('../../src/huanvaeGuard/serverApi', () => mockServerApi);

// ============== Mock deviceInfo ==============
vi.mock('../../src/services/deviceInfo', () => ({
  getDeviceInfo: vi.fn().mockResolvedValue({ macAddress: '00:11:22:33:44:55' }),
}));

// 必须在 mock 之后再 import 被测组件
import HuanvaeGuardPage from '../../src/huanvaeGuard/HuanvaeGuardPage';

// ============== 测试工具 ==============

const TEST_DEVICES = [
  {
    device_id: 'dev-1',
    user_id: 'u1',
    device_name: '我的电脑',
    public_key: 'pk1',
    virtual_ip: '10.10.0.1',
    node_id: null,
    psk_hash: null,
    os: 'Windows',
    device_fingerprint: null,
    status: 'offline',
    locked_endpoint: null,
    last_heartbeat: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  },
  {
    device_id: 'dev-2',
    user_id: 'u1',
    device_name: '我的笔记本',
    public_key: 'pk2',
    virtual_ip: '10.10.0.2',
    node_id: null,
    psk_hash: null,
    os: 'Windows',
    device_fingerprint: null,
    status: 'offline',
    locked_endpoint: null,
    last_heartbeat: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  },
];

function setWindowQuery() {
  const params = new URLSearchParams({
    userId: 'u1',
    serverUrl: btoa('https://api.example.com'),
    accessToken: btoa('access-token'),
    refreshToken: btoa('refresh-token'),
  });
  window.history.replaceState({}, '', `/?${params}`);
}

/** 渲染页面并等首屏设备加载完成，返回已注册的跨窗状态变更 handler */
async function renderAndGetStatusHandler() {
  render(<HuanvaeGuardPage />);
  await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalledTimes(1));

  const handler = eventMock.handlers.get('hg:device-status-changed');
  // 事件名必须一模一样：主窗口 emit 的是 'hg:device-status-changed'，
  // 页面监听别的名字等于永远收不到
  expect(handler).toBeInstanceOf(Function);
  return handler!;
}

// ============== 测试用例 ==============

describe('HuanvaeGuardPage — hg:device-status-changed 跨窗刷新', () => {
  beforeEach(() => {
    cleanup();
    setWindowQuery();
    eventMock.handlers.clear();
    Object.values(mockServerApi).forEach((m) => m.mockReset());
    mockServerApi.getDevices.mockResolvedValue(TEST_DEVICES);
    mockServerApi.listGroups.mockResolvedValue([]);
    mockServerApi.listLinks.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('收到 hg:device-status-changed 后重新拉取设备列表', async () => {
    const handler = await renderAndGetStatusHandler();

    await act(async () => {
      handler({ payload: { device_id: 'dev-1', status: 'online' } });
    });

    // 首屏 1 次 + 事件驱动的 1 次刷新 = 2 次；不刷新则在线态永远停留在首屏快照
    await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalledTimes(2));
    expect(mockServerApi.getDevices).toHaveBeenLastCalledWith(
      'https://api.example.com',
      'access-token',
    );
  });

  it('回调把 payload 的 device_id / status 写进日志面板', async () => {
    const handler = await renderAndGetStatusHandler();

    await act(async () => {
      handler({ payload: { device_id: 'dev-1', status: 'online' } });
    });

    // 只断语义（同一行日志里同时出现设备标识与「在线」），不锁具体措辞
    await waitFor(() => {
      expect(
        screen.getByText(/dev-1[\s\S]*在线|在线[\s\S]*dev-1/),
      ).toBeInTheDocument();
    });
  });

  it('offline 状态同样按 payload 写日志（不是写死「在线」）', async () => {
    const handler = await renderAndGetStatusHandler();

    await act(async () => {
      handler({ payload: { device_id: 'dev-2', status: 'offline' } });
    });

    await waitFor(() => {
      expect(
        screen.getByText(/dev-2[\s\S]*离线|离线[\s\S]*dev-2/),
      ).toBeInTheDocument();
    });
    // 该帧说的是 dev-2 掉线，日志里不该冒出 dev-1 的状态行
    expect(screen.queryByText(/dev-1[\s\S]*(在线|离线)/)).not.toBeInTheDocument();
  });
});

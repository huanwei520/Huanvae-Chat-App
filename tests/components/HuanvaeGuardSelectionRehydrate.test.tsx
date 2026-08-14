/**
 * HuanvaeGuardPage — 「关掉再打开，正在运行的那台仍然是选中态」（V3）
 *
 * huanwei 2026-08-14 原话：「vpn 页面在关闭后再打开，**正在运行的配置选项其选中状态会消失**，
 * 当然其是可操作的，只是一个小问题可以连带修复」。
 *
 * ## 根因（本文件锁的就是这条）
 * HG 页跑在独立 Tauri 窗口里，关掉窗口 = 整棵 React 树销毁；重开是**全新挂载**，
 * `selectedDeviceId` 从 `useState<string | null>(null)` 重新开始。而守护进程是**独立进程**，
 * 隧道原样在跑 —— 于是页面上「谁在跑」一点痕迹都没有：单选框全空、下方设备动作区整块不渲染。
 *
 * ## 修法：从守护进程回读，不在本地另存
 * 唯一真值是守护进程 `/api/tunnel/status` 回的 `address`；拿它在设备列表里找
 * `virtual_ip` 相同的那台即可。**刻意不落本地**：守护进程无状态、重启即丢配置，
 * 别的终端也可能把设备接管走，本地那份很快会指向一台根本没在跑的设备。
 *
 * 本文件四条：
 *   1. 隧道在跑 ⇒ 挂载后那台设备的单选框是 checked（重开即恢复）；
 *   2. 隧道没在跑 ⇒ 一个都不选（不许瞎猜一台出来）；
 *   3. 回读只做一次 ⇒ 用户随后手动改选另一台不会被拽回去（这是「可操作」的前提）；
 *   4. 隧道地址在设备列表里找不到对应设备 ⇒ 不选（不许拿地址硬凑）。
 *
 * mock 布局照 tests/components/HuanvaeGuardStatusRefresh.test.tsx，差别只在
 * localApi.getStatus 要能按用例换返回值。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';

// ============== Mock @tauri-apps/plugin-os ==============
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'windows',
}));

// ============== Mock @tauri-apps/api/event ==============
// listen 按事件名把 handler 存下来，测试据此主动投递跨窗事件（照
// tests/components/HuanvaeGuardStatusRefresh.test.tsx 的写法）
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
const mockLocalApi = vi.hoisted(() => ({
  getStatus: vi.fn(),
  startTunnel: vi.fn(),
  stopTunnel: vi.fn(),
  resolveLocalPort: vi.fn().mockResolvedValue(19198),
}));
vi.mock('../../src/huanvaeGuard/localApi', () => mockLocalApi);

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

/** 守护进程「隧道在跑，用的是 10.10.0.2」的应答（address 带 CIDR 前缀，与真实形态一致） */
const RUNNING_ON_DEV2 = {
  success: true,
  data: {
    active: true,
    interface_name: 'utun6',
    address: '10.10.0.2/24',
    listen_port: 51820,
    peers: [],
  },
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

/**
 * 某台设备那一行的单选框（行是 <label>，radio 在其内部）。
 * selector 必须锚到 .hg-device-name：选中之后设备名会在下方动作区
 * （`已选择 <b>名字</b>`）再出现一次，裸 getByText 会撞上 multiple elements。
 */
function radioOf(deviceName: string): HTMLInputElement {
  const row = screen
    .getByText(deviceName, { selector: '.hg-device-name' })
    .closest('.hg-device-item');
  expect(row, `没找到 ${deviceName} 那一行`).not.toBeNull();
  return (row as HTMLElement).querySelector('input[type="radio"]') as HTMLInputElement;
}

describe('HuanvaeGuardPage 选中态从守护进程回读（V3）', () => {
  beforeEach(() => {
    cleanup();
    setWindowQuery();
    // handler 表跨用例复用会让上一轮已卸载页面的回调被投递，必须逐轮清空
    eventMock.handlers.clear();
    Object.values(mockServerApi).forEach((m) => m.mockReset());
    mockLocalApi.getStatus.mockReset();
    mockServerApi.getDevices.mockResolvedValue(TEST_DEVICES);
    mockServerApi.listGroups.mockResolvedValue([]);
    mockServerApi.listLinks.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('🔴 重开时隧道在跑 ⇒ 正在跑的那台恢复成选中（本用例就是他报的现象）', async () => {
    mockLocalApi.getStatus.mockResolvedValue(RUNNING_ON_DEV2);

    render(<HuanvaeGuardPage />);
    await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalled());

    await waitFor(() => expect(radioOf('我的笔记本').checked).toBe(true));
    // 只恢复那一台，不是把谁都点上
    expect(radioOf('我的电脑').checked).toBe(false);
    // 选中态真的生效到下方动作区（这块在 selectedDevice 为空时整块不渲染）
    expect(screen.getByText('我的笔记本', { selector: '.hg-device-detail-target b' }))
      .toBeInTheDocument();
  });

  it('隧道没在跑 ⇒ 一台都不选（不许凭空猜一台出来）', async () => {
    mockLocalApi.getStatus.mockResolvedValue({ success: false });

    render(<HuanvaeGuardPage />);
    await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalled());
    // 探活已落地（服务未运行的文案出来了）才断言，避免抢在状态到达之前
    await waitFor(() => expect(screen.getByText('服务未运行')).toBeInTheDocument());

    expect(radioOf('我的电脑').checked).toBe(false);
    expect(radioOf('我的笔记本').checked).toBe(false);
  });

  it('🔴 手选优先：用户改选另一台后，设备列表重新拉取也不会把他拽回在跑的那台', async () => {
    mockLocalApi.getStatus.mockResolvedValue(RUNNING_ON_DEV2);

    render(<HuanvaeGuardPage />);
    await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalled());
    await waitFor(() => expect(radioOf('我的笔记本').checked).toBe(true));

    await act(async () => {
      fireEvent.click(radioOf('我的电脑'));
    });
    expect(radioOf('我的电脑').checked).toBe(true);

    // 让 devices 换一个新引用（真实路径：主窗口转发的 hg:device-status-changed 会重拉列表），
    // 回读 effect 因此真的会再跑一遍 —— 选择权必须留在用户手里。
    // 走既有的跨窗事件通道，不给页面加任何测试专用出口。
    mockServerApi.getDevices.mockResolvedValue([...TEST_DEVICES]);
    const onStatusChanged = eventMock.handlers.get('hg:device-status-changed');
    expect(onStatusChanged, '页面必须 listen 了 hg:device-status-changed').toBeDefined();
    await act(async () => {
      onStatusChanged!({ payload: { device_id: 'dev-2', status: 'online' } });
    });
    await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalledTimes(2));

    expect(radioOf('我的电脑').checked).toBe(true);
    expect(radioOf('我的笔记本').checked).toBe(false);
  });

  it('隧道地址在设备列表里没有对应设备 ⇒ 不选（不许拿地址硬凑一台）', async () => {
    mockLocalApi.getStatus.mockResolvedValue({
      success: true,
      data: { ...RUNNING_ON_DEV2.data, address: '10.99.99.99/24' },
    });

    render(<HuanvaeGuardPage />);
    await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalled());
    // 探活已落地的正对照：隧道在跑时状态冠写「已连接」
    await waitFor(() => expect(screen.getByText('已连接')).toBeInTheDocument());

    expect(radioOf('我的电脑').checked).toBe(false);
    expect(radioOf('我的笔记本').checked).toBe(false);
  });
});

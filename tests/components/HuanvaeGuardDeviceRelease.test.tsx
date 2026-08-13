/**
 * HuanvaeGuardPage — 断开隧道后「刚放开的那台设备」当帧重新可选
 *
 * ## 症状（huanwei 2026-08-13）
 * 「在链接后断开链接还需要一段时间那个断开链接的配置文件才会显示离线可操作」。
 * 成因：`HgDevice.status` 是**服务端**那份、要等心跳超时才翻 offline；而本机一断开，
 * 隧道地址当帧就变 null ⇒ 旧判定式 `status==='online' && !isSelf` 立刻为 true
 * ⇒ 本终端刚放开的那台被自己判成「已被其它终端占用」而灰掉。
 *
 * ## 本文件锁的是整条链（纯函数单测锁不到的那一段）
 *   1. 连接中：本机那台可选（判定不能把自己算成占用）
 *   2. 断开当帧：同一台仍可选、且**没有**占用徽标 —— 服务端仍报 online 也不许灰
 *   3. 服务端追上（offline）后别的终端把它连起来（重新 online）→ **必须**重新灰掉
 *      （lockout 防护没被这次修复削弱，这条是修复的"反向边"）
 *   4. 另一台一直被别人占着的设备，全程灰着
 *
 * mock 布局照 HuanvaeGuardStatusRefresh.test.tsx（listen 按事件名存 handler，
 * 供测试主动投递跨窗设备状态变更），差别只在 getStatus 要在测试中途换返回值来模拟连接/断开。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';

// ============== Mock @tauri-apps/plugin-os ==============
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'windows',
}));

// ============== Mock @tauri-apps/api/core（页面 invoke 生物识别 / 安装查询） ==============
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// ============== Mock @tauri-apps/api/event ==============
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

// ============== 测试数据 ==============

/** 本机这台：10.10.0.1 —— 隧道地址与它一致 */
const SELF_IP = '10.10.0.1';
/** 别人那台：10.10.0.2 —— 全程 online 且从不属于本终端 */
const OTHER_IP = '10.10.0.2';

const device = (id: string, name: string, ip: string, status: string) => ({
  device_id: id,
  user_id: 'u1',
  device_name: name,
  public_key: `pk-${id}`,
  virtual_ip: ip,
  node_id: null,
  psk_hash: null,
  os: 'Windows',
  device_fingerprint: null,
  status,
  locked_endpoint: null,
  last_heartbeat: null,
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
});

const activeStatus = {
  success: true,
  data: {
    active: true,
    address: `${SELF_IP}/24`,
    interface_name: 'utun7',
    peers: [],
  },
};

const inactiveStatus = {
  success: true,
  data: { active: false, address: null, interface_name: null, peers: [] },
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
 * 取设备**列表里**那一行。必须限定在 .hg-device-list 内：选中某台后，下方详情区
 * 「已选择 <b>我的电脑</b>」会出现同名文本，全局 getByText 会撞上两个节点。
 */
function rowOf(deviceName: string): HTMLElement {
  const list = document.querySelector('.hg-device-list');
  expect(list).not.toBeNull();
  const row = Array.from(list!.querySelectorAll('label')).find(
    (el) => el.querySelector('.hg-device-name')?.textContent === deviceName,
  );
  expect(row, `设备列表里找不到 ${deviceName}`).toBeDefined();
  return row!;
}

/** 取某台设备行的单选框（radio 的 disabled 就是「能不能选它」的机器判据） */
function radioOf(deviceName: string): HTMLInputElement {
  const radio = rowOf(deviceName).querySelector('input[type="radio"]');
  expect(radio).not.toBeNull();
  return radio as HTMLInputElement;
}

/** 某台设备行上是否挂着「已在其它终端连接」占用徽标 */
function hasOccupiedBadge(deviceName: string): boolean {
  return rowOf(deviceName).textContent?.includes('已在其它终端连接') ?? false;
}

/** 服务端设备列表换一批，并投递跨窗状态变更事件驱动页面重新拉取 */
async function pushDevices(devices: ReturnType<typeof device>[]) {
  mockServerApi.getDevices.mockResolvedValue(devices);
  const handler = eventMock.handlers.get('hg:device-status-changed');
  expect(handler).toBeInstanceOf(Function);
  await act(async () => {
    handler!({ payload: { device_id: 'dev-self', status: 'refresh' } });
  });
  await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalled());
}

// ============== 测试用例 ==============

describe('HuanvaeGuardPage — 断开后刚放开的设备当帧可选', () => {
  beforeEach(() => {
    cleanup();
    setWindowQuery();
    eventMock.handlers.clear();
    Object.values(mockServerApi).forEach((m) => m.mockReset());
    mockLocalApi.getStatus.mockReset();
    mockLocalApi.stopTunnel.mockReset();
    mockServerApi.listGroups.mockResolvedValue([]);
    mockServerApi.listLinks.mockResolvedValue([]);
    // 服务端两台都报 online：本机那台是因为本机连着，另一台是真被别人占着
    mockServerApi.getDevices.mockResolvedValue([
      device('dev-self', '我的电脑', SELF_IP, 'online'),
      device('dev-other', '别人的机器', OTHER_IP, 'online'),
    ]);
    mockLocalApi.getStatus.mockResolvedValue(activeStatus);
    mockLocalApi.stopTunnel.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('连接中→断开→服务端追上→别人接手：四个阶段的可选性各自正确', async () => {
    render(<HuanvaeGuardPage />);
    await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalled());
    // 阶段 1：连接中。本机那台可选（不能把自己算成被占用）；别人那台灰。
    await waitFor(() => expect(screen.getByRole('button', { name: '断开' })).toBeInTheDocument());
    expect(radioOf('我的电脑').disabled).toBe(false);
    expect(hasOccupiedBadge('我的电脑')).toBe(false);
    expect(radioOf('别人的机器').disabled).toBe(true);
    expect(hasOccupiedBadge('别人的机器')).toBe(true);

    // 阶段 2：断开。服务端那份 online 尚未刷新（getDevices 返回值没变），
    // 本机那台必须**仍然**可选 —— 这就是本次要修的症状。
    mockLocalApi.getStatus.mockResolvedValue(inactiveStatus);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '断开' }));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '连接' })).toBeInTheDocument());
    expect(radioOf('我的电脑').disabled).toBe(false);
    expect(hasOccupiedBadge('我的电脑')).toBe(false);
    // 同一帧里别人那台依然灰着：修复没有退化成「无脑放行所有 online」
    expect(radioOf('别人的机器').disabled).toBe(true);

    // 阶段 3：服务端心跳追上，本机那台翻 offline。仍可选（offline 从不算占用）。
    await pushDevices([
      device('dev-self', '我的电脑', SELF_IP, 'offline'),
      device('dev-other', '别人的机器', OTHER_IP, 'online'),
    ]);
    await waitFor(() => expect(radioOf('我的电脑').disabled).toBe(false));

    // 阶段 4：别的终端把这台连起来 → 重新 online。必须重新灰掉，
    // 否则「本终端放开过」就成了永久放行，lockout 防护被废掉。
    await pushDevices([
      device('dev-self', '我的电脑', SELF_IP, 'online'),
      device('dev-other', '别人的机器', OTHER_IP, 'online'),
    ]);
    await waitFor(() => expect(radioOf('我的电脑').disabled).toBe(true));
    expect(hasOccupiedBadge('我的电脑')).toBe(true);
  });

  it('断开后「连接」按钮对刚放开的那台不再被占用判定挡住', async () => {
    render(<HuanvaeGuardPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '断开' })).toBeInTheDocument());

    // 连接期间先选中本机那台
    await act(async () => { fireEvent.click(radioOf('我的电脑')); });
    expect(radioOf('我的电脑').checked).toBe(true);

    mockLocalApi.getStatus.mockResolvedValue(inactiveStatus);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '断开' }));
    });

    // 选中态没有被「占用自愈 effect」误清空，且「连接」按钮可用
    // （serviceRunning 为 true —— getStatus 成功即视为服务在跑）
    await waitFor(() => {
      const connectBtn = screen.getByRole('button', { name: '连接' });
      expect(connectBtn).not.toBeDisabled();
    });
    expect(radioOf('我的电脑').checked).toBe(true);
  });
});

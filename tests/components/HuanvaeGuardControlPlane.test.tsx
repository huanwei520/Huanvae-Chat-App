/**
 * HuanvaeGuardPage — 控制面（配置无感热更新）接线契约
 *
 * ## 这份测试挡的是什么
 * 桌面端此前发给守护进程的 `POST /api/tunnel/start` body **恰好 6 个键**
 * （address / private_key / peers / obfuscation / dns / mtu），**没有 `control`**。
 * 守护进程拿不到凭据就走 `CONTROL_PLANE_ABSENT`：只打一行 warn 然后 return ——
 * 接口照样 200、界面照样显示「已连接」，而这条隧道的 peer 集在启动那一刻**冻住**，
 * 后来加入的设备它永远不知道。也就是说「配置无感热更新」在桌面端**零覆盖**，
 * 而且从界面上任何一处都看不出来。
 *
 * 两半各自独立、缺一半就等于没修：
 *   1. **接线**：连接时把四个凭据真的发出去；必需值缺失时**中止**而不是静默降级；
 *   2. **响亮失败**：链路不健康时界面必须显式说出来 —— 接线哪天又被改掉时，
 *      "缺了会喊"是唯一还站着的防线。
 *
 * ## 为什么用真渲染 + 真点击，而不是源码静态扫描
 * 同目录 HuanvaeGuardConnectBiometric.test.tsx 用的是静态扫描（当时判断驱动成本高）。
 * 这里驱动得起来，就不该退回静态扫描：本单要证的恰恰是**实参**（四个值分别取自哪里），
 * 而"某个标识符出现在某个函数体内"证不了取值对不对 —— 那正是这类缺陷藏身的地方。
 *
 * mock 布局照 HuanvaeGuardStatusRefresh.test.tsx（listen 按事件名存 handler 供主动投递）。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import type { ControlPlaneStatus } from '../../src/huanvaeGuard/types';

// ============== Mock @tauri-apps/plugin-os ==============
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'macos',
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
const localApiMock = vi.hoisted(() => ({
  getStatus: vi.fn(),
  startTunnel: vi.fn(),
  stopTunnel: vi.fn(),
  resolveLocalPort: vi.fn().mockResolvedValue(19198),
}));
vi.mock('../../src/huanvaeGuard/localApi', () => localApiMock);

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

// ============== 固定素材 ==============

/** 全是编造值。本仓是 PUBLIC 公开仓：测试里不许出现任何真实地址 / 真令牌 / 真设备 ID */
const SERVER_URL = 'https://master.example.invalid:443';
const ACCESS_TOKEN = 'ZZQ-FAKE-ACCESS-9x7';
const REFRESH_TOKEN = 'ZZQ-FAKE-REFRESH-9x7';
const DEVICE_ID = 'dev-uuid-1';

const TEST_DEVICES = [
  {
    device_id: DEVICE_ID,
    user_id: 'u1',
    device_name: '我的电脑',
    public_key: 'pk1',
    virtual_ip: '10.10.0.1',
    node_id: null,
    psk_hash: null,
    os: 'macOS',
    device_fingerprint: null,
    // 'offline' ⇒ 不会被 isDeviceOccupiedElsewhere 判成"别的终端在用"，本机可选
    status: 'offline',
    locked_endpoint: null,
    last_heartbeat: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  },
];

const DEVICE_CONFIG = {
  address: '10.10.0.1/32',
  dns: null,
  mtu: 1280,
  peers: [],
  obfuscation: {
    h1: [1, 2], h2: [3, 4], h3: [5, 6], h4: [7, 8],
    s1: 10, s2: 20, s3: 30, s4: 40, jc: 4, jmin: 8, jmax: 80,
  },
  private_key: 'ZZQ-FAKE-PRIVKEY',
};

/** 服务在跑、隧道还没建：连接按钮此时可用 */
const STATUS_IDLE = { success: true, data: { active: false, peers: [] } };

/** 隧道在跑 + 指定的控制面读数（undefined = 旧守护进程，字段整个不下发） */
function statusActive(controlPlane?: ControlPlaneStatus) {
  return {
    success: true,
    data: {
      active: true,
      interface_name: 'utun9',
      address: '10.10.0.1/32',
      listen_port: 51820,
      peers: [],
      ...(controlPlane === undefined ? {} : { control_plane: controlPlane }),
    },
  };
}

const HEALTHY_CP: ControlPlaneStatus = {
  enabled: true,
  connected: true,
  applied_peers: 2,
  applied_at: 1_760_000_000,
  auth_failures: 0,
};

function setWindowQuery() {
  const params = new URLSearchParams({
    userId: 'u1',
    serverUrl: btoa(SERVER_URL),
    accessToken: btoa(ACCESS_TOKEN),
    refreshToken: btoa(REFRESH_TOKEN),
  });
  window.history.replaceState({}, '', `/?${params}`);
}

/** 渲染 + 等首屏设备到位 */
async function renderPage() {
  render(<HuanvaeGuardPage />);
  await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalledTimes(1));
}

/** 选中唯一那台设备，再点「连接」，并等 startTunnel 落地（或确认它没被调用） */
async function selectDeviceAndConnect() {
  const radio = await screen.findByRole('radio');
  fireEvent.click(radio);
  const connectBtn = await screen.findByRole('button', { name: '连接' });
  await waitFor(() => expect(connectBtn).not.toBeDisabled());
  await act(async () => {
    fireEvent.click(connectBtn);
  });
}

/** 告警条的原文（不存在时为 null）—— 用 class 定位，避免与别的横幅混淆 */
function warnText(): string | null {
  return document.querySelector('.hg-cp-warn')?.textContent ?? null;
}

beforeEach(() => {
  cleanup();
  setWindowQuery();
  eventMock.handlers.clear();
  Object.values(mockServerApi).forEach((m) => m.mockReset());
  mockServerApi.getDevices.mockResolvedValue(TEST_DEVICES);
  mockServerApi.listGroups.mockResolvedValue([]);
  mockServerApi.listLinks.mockResolvedValue([]);
  mockServerApi.getDeviceConfig.mockResolvedValue(DEVICE_CONFIG);
  localApiMock.getStatus.mockReset();
  localApiMock.getStatus.mockResolvedValue(STATUS_IDLE);
  localApiMock.startTunnel.mockReset();
  localApiMock.startTunnel.mockResolvedValue({ success: true });
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

describe('HuanvaeGuardPage — 启动隧道时携带控制面凭据', () => {
  it('点「连接」时把四个凭据发给守护进程（值分别取自 windowData 与选中设备）', async () => {
    await renderPage();
    await selectDeviceAndConnect();

    await waitFor(() => expect(localApiMock.startTunnel).toHaveBeenCalledTimes(1));
    const params = localApiMock.startTunnel.mock.calls[0][0] as { control?: unknown };
    // 整体比对而不是逐键 toContain：键名是与守护进程的 JSON 线格式契约，
    // 多一个少一个都要当场翻红；值则钉死"哪个值取自哪里"这件本单真正要证的事。
    expect(params.control).toEqual({
      master_url: SERVER_URL,
      device_id: DEVICE_ID,
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
    });
  });

  it('🔴 缺访问令牌时中止连接：一次 startTunnel 都不许发出去，且界面必须报错', async () => {
    await renderPage();
    // 令牌真的会被换掉：主窗口的 session:tokens-updated 会整个覆盖两个令牌，
    // 发来空值时它们就是空串（这不是假想路径，是页面自己接的那条事件）
    const tokenHandler = eventMock.handlers.get('session:tokens-updated');
    expect(tokenHandler).toBeInstanceOf(Function);
    await act(async () => {
      tokenHandler!({ payload: { accessToken: '', refreshToken: '' } });
    });

    await selectDeviceAndConnect();

    // 静默降级成"不传 control"正好把这个 bug 原样复活，且复活后同样看不出来
    expect(localApiMock.startTunnel).not.toHaveBeenCalled();
    // 同类正对照：同一次点击里，凭据检查之前的那一步**确实跑到了**——
    // 证明上面那个 not.toHaveBeenCalled 是"被拦下"，不是"整个流程压根没启动"
    expect(mockServerApi.getDeviceConfig).toHaveBeenCalledTimes(1);
    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toContain('访问令牌');
  });

  it('缺刷新令牌：仍然连接（daemon 侧是 Option），但必须在日志里说出来', async () => {
    await renderPage();
    const tokenHandler = eventMock.handlers.get('session:tokens-updated')!;
    await act(async () => {
      tokenHandler({ payload: { accessToken: ACCESS_TOKEN, refreshToken: '' } });
    });

    await selectDeviceAndConnect();

    await waitFor(() => expect(localApiMock.startTunnel).toHaveBeenCalledTimes(1));
    const params = localApiMock.startTunnel.mock.calls[0][0] as {
      control: Record<string, unknown>;
    };
    // 🔴 断言的是 `undefined` 而不是空串：空串是一个**存在但没用**的凭据，
    // 递过去会让守护进程以为自己能续期，到第一次过期时才发现不能 —— 那正是最难查的形态。
    // undefined 会被 JSON.stringify 整个丢掉，对上守护进程的 Option<String>。
    // 「键确实没上线」由 tests/unit/huanvaeGuard.localApi.test.ts 在**序列化后的 body**
    // 上钉着（这一层拿到的是对象，Object.keys 对 undefined 值仍会列出该键，验不到那件事）。
    expect(params.control.refresh_token).toBeUndefined();
    // 另外三个必需值照常，缺一个都不该走到这里
    expect(params.control.master_url).toBe(SERVER_URL);
    expect(params.control.device_id).toBe(DEVICE_ID);
    expect(params.control.access_token).toBe(ACCESS_TOKEN);
    // "可缺"不等于"可以静默地缺"：控制链会在第一次访问令牌过期时死掉且回不来
    expect(await screen.findByText(/缺少刷新令牌/)).toBeInTheDocument();
  });
});

describe('HuanvaeGuardPage — 控制面不健康时界面必须喊出来', () => {
  it('健康时不显示告警条（不能靠常亮告警来"保证不漏"）', async () => {
    localApiMock.getStatus.mockResolvedValue(statusActive(HEALTHY_CP));
    await renderPage();

    // 先等隧道态真的渲染出来，否则"没有告警"可能只是还没加载完
    expect(await screen.findByText('已连接')).toBeInTheDocument();
    expect(warnText()).toBeNull();
  });

  it('旧守护进程（不下发 control_plane）→ 提示升级守护进程', async () => {
    localApiMock.getStatus.mockResolvedValue(statusActive(undefined));
    await renderPage();

    await waitFor(() => expect(warnText()).toContain('守护进程版本过旧'));
    // 冠上同时写着「已连接」——正是这一对并存，才叫"不许显示成一切正常"
    expect(screen.getByText('已连接')).toBeInTheDocument();
  });

  it('enabled=false 且无 last_error（CONTROL_PLANE_ABSENT）→ 说明本次未携带凭据', async () => {
    localApiMock.getStatus.mockResolvedValue(
      statusActive({ ...HEALTHY_CP, enabled: false, connected: false, applied_peers: 0 }),
    );
    await renderPage();

    await waitFor(() => expect(warnText()).toContain('未启用配置热更新'));
    // 🔴 这一对并存才是本条要证的事：冠上确实写着「已连接」，所以"界面只显示成功"
    // 这种失败形态在这里是**能发生**的；告警条与它同屏出现，才叫"不许显示成一切正常"。
    // 少了这半句，上面那条 toContain 只证明"字符串存在过"，证不到它挡住了什么。
    expect(screen.getByText('已连接')).toBeInTheDocument();
  });

  it('enabled=false 且有 last_error（启动失败）→ 原因必须原样带出', async () => {
    localApiMock.getStatus.mockResolvedValue(
      statusActive({
        ...HEALTHY_CP, enabled: false, connected: false, last_error: 'tls profile is broken',
      }),
    );
    await renderPage();

    await waitFor(() => expect(warnText()).toContain('tls profile is broken'));
    // 同上：`enabled=false` 的两种读数（有 / 无 last_error）各自都要证"没被显示成一切正常"
    expect(screen.getByText('已连接')).toBeInTheDocument();
  });

  it('enabled && !connected（断开重连中）→ 说"已断开"并附凭据被拒次数', async () => {
    localApiMock.getStatus.mockResolvedValue(
      statusActive({ ...HEALTHY_CP, connected: false, auth_failures: 3 }),
    );
    await renderPage();

    await waitFor(() => expect(warnText()).toContain('已断开'));
    expect(warnText()).toContain('3');
  });

  it('隧道没在跑时不显示告警（没有隧道就没有"这条隧道的热更新"）', async () => {
    // 读数刻意给成最难看的一种：不加这条门控，页面在服务刚起、还没建隧道时
    // 就会常年挂着一条告警 —— 常亮的告警等于没有告警
    localApiMock.getStatus.mockResolvedValue({
      success: true,
      data: { active: false, peers: [], control_plane: { ...HEALTHY_CP, enabled: false, connected: false } },
    });
    await renderPage();

    expect(await screen.findByRole('button', { name: '连接' })).toBeInTheDocument();
    expect(warnText()).toBeNull();
  });

  it('告警条不是第二个 live region（全页只允许一个 role="alert"）', async () => {
    localApiMock.getStatus.mockResolvedValue(statusActive(undefined));
    await renderPage();

    await waitFor(() => expect(warnText()).not.toBeNull());
    // 此刻没有错误横幅，所以整页应当零个 alert；告警条靠样式发声，不抢 ARIA 播报
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('.hg-cp-warn')?.getAttribute('role')).toBeNull();
  });
});

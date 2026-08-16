/**
 * HuanvaeGuardPage — Windows 专属行为测试
 *
 * 覆盖本次新增的「安装 / 修复服务」入口（每条都能在旧实现下 FAIL）：
 *   1. Windows 上**根本没有**这个按钮 —— 旧实现的渲染门控写死 `osPlatform === 'macos'`，
 *      安装器把服务注册搞砸之后，用户在界面上除了看见「服务未运行」之外无事可做
 *   2. 两态压成一句 —— 旧 `serviceStatusLabel` 对非 macOS 一律返回「服务未运行」，
 *      把「未注册」（安装器失败）和「已注册但起不来」（服务程序有问题）压成同一句话；
 *      新实现给 Windows 也做三态，两类成因在界面上就分开了
 *   3. 失败要说话 —— hg_repair 抛出的 Rust 中文原因必须进错误横幅，绝不显示成成功
 *   4. 退避耗尽后的下一步文案必须是 **Windows 的那句**（「用户账户控制」/ %ProgramData% 日志路径），
 *      不能沿用 macOS 的 launchd 措辞
 *
 * 与 HuanvaeGuardPage.macos.test.tsx 分文件，因 platform mock 是模块级、无法逐用例覆盖；
 * 与 HuanvaeGuardPage.test.tsx（同为 windows）分文件，因那份没有按命令名分发的 invoke spy，
 * 无法逐用例设置「服务是否已在 SCM 注册」。
 *
 * 计时：组件挂载即起 3s 常驻轮询，handleRepair 最长等 7.5s，故全文件用 fake timer 并一律以
 * **async** 版本推进（vi.advanceTimersByTimeAsync）—— 同步版不 flush microtask，
 * 轮询/退避里 await 的 mock promise 永远不落地。详见 .claude/rules/frontend-test.md。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import type { ApiResponse, TunnelStatus } from '../../src/huanvaeGuard/types';

// platform → windows
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'windows',
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// invoke spy：按命令名分发。h.registered.value 供各用例逐条设置「服务是否已在 SCM 注册」
// （Windows 侧 hg_is_installed = `sc query` 不返回 1060）。
const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  registered: { value: false },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }));

const STATUS_DOWN: ApiResponse<TunnelStatus> = { success: false };
const TUNNEL_DOWN: TunnelStatus = { active: false, peers: [] };
const STATUS_UP: ApiResponse<TunnelStatus> = { success: true, data: TUNNEL_DOWN };

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
  createGroup: vi.fn(),
  createGroupInvite: vi.fn(),
  acceptGroupInvite: vi.fn(),
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

vi.mock('../../src/services/deviceInfo', () => ({
  getDeviceInfo: vi.fn().mockResolvedValue({ macAddress: '00:11:22:33:44:55' }),
}));

import HuanvaeGuardPage from '../../src/huanvaeGuard/HuanvaeGuardPage';

// 与 SUT 常量对齐（HuanvaeGuardPage.tsx：REPAIR_BACKOFF_MS / setInterval(poll, 3000)）
const BACKOFF_TOTAL_MS = 500 + 1000 + 2000 + 4000;

/** 真实的 Rust 侧 Err(String)：desktop/huanvaeguard.rs classify_repair_failure 的「取消授权」分支 */
const UAC_CANCELLED_REASON =
  '已取消管理员授权。注册 VPN 服务必须以管理员身份执行 —— 请再点一次，并在弹出的「用户账户控制」中点击「是」。';

/**
 * 真实的 Rust 侧 Err(String)：`is_registered()` 在 `sc query` 返回 5（拒绝访问）时给的原因。
 * 旧实现把这一类**读成 `false`**（= 未安装）；现在它走 `Err` ⇒ 前端落到第三态 'unknown'。
 */
const QUERY_FAILED_REASON =
  '无法确认 VPN 服务是否已注册：查询服务状态失败（sc query 返回 5）。请重试；若仍失败，请以管理员身份运行本应用。';

function defaultInvoke(cmd: string): Promise<unknown> {
  if (cmd === 'hg_is_installed') { return Promise.resolve(h.registered.value); }
  return Promise.resolve(true);
}

function setWindowQuery() {
  const params = new URLSearchParams({
    userId: 'u1',
    serverUrl: btoa('https://api.example.com'),
    accessToken: btoa('access-token'),
    refreshToken: btoa('refresh-token'),
  });
  window.history.replaceState({}, '', `/?${params}`);
}

/** 推进 fake timer 并 flush 随之落地的 promise 链（同步版 advanceTimersByTime 不 flush microtask） */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function renderPage() {
  render(<HuanvaeGuardPage />);
  await tick(0);
}

function headerOf(el: HTMLElement): HTMLElement {
  return el.closest('header')!;
}

describe('HuanvaeGuardPage (Windows)', () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
    setWindowQuery();
    h.registered.value = false;
    h.invoke.mockReset();
    h.invoke.mockImplementation(defaultInvoke);
    mockLocalApi.getStatus.mockReset();
    mockLocalApi.getStatus.mockResolvedValue(STATUS_DOWN);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
  });

  it('未注册：header 显示「未安装」，且**存在**「安装服务」按钮（旧实现 Windows 上根本不渲染它）', async () => {
    await renderPage();

    expect(h.invoke).toHaveBeenCalledWith('hg_is_installed');
    const btn = screen.getByRole('button', { name: '安装服务' });
    expect(within(headerOf(btn)).getByText('未安装')).toBeInTheDocument();
    // 旧实现在 Windows 上恒显示这一句，把「未注册」和「已注册未运行」压成同一句话
    expect(screen.queryByText('服务未运行')).not.toBeInTheDocument();
    expect(screen.queryByText('已安装未运行')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '修复服务' })).not.toBeInTheDocument();
    // Windows 受支持 → 不显示"仅 Windows / macOS 支持"提示
    expect(screen.queryByText('仅 Windows / macOS 支持')).not.toBeInTheDocument();
  });

  it('已注册但没跑起来：header 显示「已安装未运行」，按钮为「修复服务」', async () => {
    h.registered.value = true;

    await renderPage();

    const btn = screen.getByRole('button', { name: '修复服务' });
    expect(within(headerOf(btn)).getByText('已安装未运行')).toBeInTheDocument();
    expect(screen.queryByText('未安装')).not.toBeInTheDocument();
    expect(screen.queryByText('服务未运行')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '安装服务' })).not.toBeInTheDocument();
  });

  it('服务运行中：header 显示「服务运行中」，安装/修复按钮整个不渲染', async () => {
    mockLocalApi.getStatus.mockResolvedValue(STATUS_UP);

    await renderPage();

    expect(screen.getByText('服务运行中')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '安装服务' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '修复服务' })).not.toBeInTheDocument();
  });

  it('点击按钮调用 invoke("hg_repair")，成功后翻成运行中', async () => {
    await renderPage();
    const probesBefore = mockLocalApi.getStatus.mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '安装服务' }));
    });
    await tick(0);

    expect(h.invoke).toHaveBeenCalledWith('hg_repair');
    // 退避第一档之前不该有新探活（sc.exe start 返回只代表 SCM 收下了请求）
    expect(mockLocalApi.getStatus.mock.calls.length).toBe(probesBefore);

    mockLocalApi.getStatus.mockResolvedValue(STATUS_UP);
    h.registered.value = true;
    await tick(500);

    expect(mockLocalApi.getStatus.mock.calls.length).toBeGreaterThan(probesBefore);
    expect(screen.getByText('服务运行中')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('修复失败：Rust 侧中文原因（UAC 取消）进错误横幅，不被显示成成功', async () => {
    h.invoke.mockImplementation((cmd: string) => {
      if (cmd === 'hg_repair') { return Promise.reject(UAC_CANCELLED_REASON); }
      return defaultInvoke(cmd);
    });

    await renderPage();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const probesBefore = mockLocalApi.getStatus.mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '安装服务' }));
    });
    await tick(0);

    const banner = screen.getByRole('alert');
    expect(within(banner).getByText(`修复失败：${UAC_CANCELLED_REASON}`)).toBeInTheDocument();
    // 失败即中止，不再走退避重试 → 点击之后零新增探活
    expect(mockLocalApi.getStatus.mock.calls.length).toBe(probesBefore);
    // 按钮没有卡在转圈：仍可再点一次（loading 已复位）
    expect(screen.getByRole('button', { name: '安装服务' })).not.toBeDisabled();
  });

  it('退避耗尽仍未起来：给的是 **Windows** 那句下一步，不是 macOS 的 launchd 措辞', async () => {
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '安装服务' }));
    });
    await tick(BACKOFF_TOTAL_MS);

    const banner = screen.getByRole('alert');
    expect(within(banner).getByText(/用户账户控制/)).toBeInTheDocument();
    // 负向：macOS 那两句的特征词一个都不许出现（沿用 macOS 文案 = 让 Windows 用户去找一个不存在的路径）
    expect(screen.queryByText(/launchd-stderr\.log/)).not.toBeInTheDocument();
    expect(screen.queryByText(/管理员授权时点击「允许」/)).not.toBeInTheDocument();
  });

  // ── 第三态：查询本身失败 ≠ 未安装 ────────────────────────────────────────
  // 旧实现两处都把"没查到"读成"没装"：Rust 侧 `sc query` 非零一律 NotInstalled，
  // 前端 catch 里 setInstalled(false)。两处都在替一个**没查到**的读数下结论，
  // 而这两件事的处置正好相反（没装 → 去装；没查到 → 重试/报错）。

  it('查询失败：header 显示「服务状态未知」，按钮是「修复服务」而不是「安装服务」', async () => {
    h.invoke.mockImplementation((cmd: string) => {
      if (cmd === 'hg_is_installed') { return Promise.reject(QUERY_FAILED_REASON); }
      return defaultInvoke(cmd);
    });

    await renderPage();

    const btn = screen.getByRole('button', { name: '修复服务' });
    expect(within(headerOf(btn)).getByText('服务状态未知')).toBeInTheDocument();
    // 🔴 这三句是旧实现会给出的读数，一句都不许再出现
    expect(screen.queryByText('未安装')).not.toBeInTheDocument();
    expect(screen.queryByText('已安装未运行')).not.toBeInTheDocument();
    expect(screen.queryByText('服务未运行')).not.toBeInTheDocument();
    // 「安装服务」是在断言一件我们并没查到的事 —— 不许出现
    expect(screen.queryByRole('button', { name: '安装服务' })).not.toBeInTheDocument();
  });

  it('查询失败 + 退避耗尽：下一步说的是「没能确认」，不是「注册未完成」也不是「已注册但没起来」', async () => {
    h.invoke.mockImplementation((cmd: string) => {
      if (cmd === 'hg_is_installed') { return Promise.reject(QUERY_FAILED_REASON); }
      return defaultInvoke(cmd);
    });

    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '修复服务' }));
    });
    await tick(BACKOFF_TOTAL_MS);

    const banner = screen.getByRole('alert');
    expect(within(banner).getByText(/没能确认服务是否已注册/)).toBeInTheDocument();
    // 负向：另外两态的特征词一个都不许出现（把 unknown 归进任一已有态 = 换个地方再做一遍这个 bug）
    expect(screen.queryByText(/服务注册未完成/)).not.toBeInTheDocument();
    expect(screen.queryByText(/%ProgramData%\\HuanvaeGuard\\logs/)).not.toBeInTheDocument();
  });

  it('已注册但退避耗尽：下一步指向 Windows 的守护进程日志路径', async () => {
    h.registered.value = true;

    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '修复服务' }));
    });
    await tick(BACKOFF_TOTAL_MS);

    const banner = screen.getByRole('alert');
    expect(within(banner).getByText(/%ProgramData%\\HuanvaeGuard\\logs/)).toBeInTheDocument();
    expect(screen.queryByText(/\/var\/log\/huanvaeguard/)).not.toBeInTheDocument();
  });
});

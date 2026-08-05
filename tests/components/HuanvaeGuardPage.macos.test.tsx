/**
 * HuanvaeGuardPage — macOS 专属行为测试
 *
 * 覆盖 4 条已修复的回归（每条都能在旧实现下 FAIL）：
 *   1. 三态文案 —— 未安装 / 已安装未运行 / 服务运行中，按钮随之在「安装服务 / 修复服务」间切换
 *      （Windows 两态文案由 HuanvaeGuardPage.test.tsx 覆盖）
 *   2. 修复退避重试 —— handleRepair 旧实现零等待探活（launchctl bootstrap 只是提交 job，
 *      必然读到 false）；新实现按 REPAIR_BACKOFF_MS = [500,1000,2000,4000] 逐档重探
 *   3. 失败要说话 —— hg_repair 抛出的 Rust 中文原因必须进错误横幅（只写日志等于没说）；
 *      开窗前 hg_ensure_installed 的失败原因经 URL `installError` 透传，挂载即显示
 *   4. 粘滞 false —— 状态轮询不再被 serviceRunning 门控，后起的守护进程会被自动接上
 *
 * 探活口径：serviceRunning / tunnelStatus 的唯一写者是页面里的常驻单飞探活（probeService），
 * 它只调 localApi.getStatus —— localApi 已不再导出 checkServiceRunning。3s 常驻轮询与
 * handleRepair 的退避重试都只是它的调用方（在途时复用同一个 promise，不各自另发请求）。
 * 因此本文件里一切「探活次数」一律以 mockLocalApi.getStatus.mock.calls.length 为准。
 *
 * 注：与默认 HuanvaeGuardPage.test.tsx（platform→windows）分文件，因 platform mock
 * 是模块级、无法逐用例覆盖。
 *
 * 计时：组件挂载即起 3s 常驻轮询，handleRepair 最长等 7.5s，故全文件用 fake timer
 * 并一律以 **async** 版本推进（vi.advanceTimersByTimeAsync）—— 同步版不 flush microtask，
 * 轮询/退避里 await 的 mock promise 永远不落地。详见 .claude/rules/frontend-test.md。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import type { ApiResponse, TunnelStatus } from '../../src/huanvaeGuard/types';

// platform → macos
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'macos',
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// invoke spy：按命令名分发（旧版对所有命令一律 resolve(true)，会让 hg_is_installed 恒真）。
// h.installed.value 供各用例逐条设置「LaunchDaemon 文件是否已就位」。
const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  installed: { value: false },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }));

// localApi：默认服务未运行（让安装/修复按钮显示）
// 返回值是对象的，用稳定引用常量（每次调用新对象会让下游 effect 无谓重跑）
const STATUS_DOWN: ApiResponse<TunnelStatus> = { success: false };
const TUNNEL_DOWN: TunnelStatus = { active: false, peers: [] };
const STATUS_UP: ApiResponse<TunnelStatus> = { success: true, data: TUNNEL_DOWN };

const mockLocalApi = vi.hoisted(() => ({
  getStatus: vi.fn(),
  startTunnel: vi.fn(),
  stopTunnel: vi.fn(),
  // 探活转为「运行中」时页面用它取真实控制端口打日志（端口不写死）；19198 = 模块内的默认端口
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
const BACKOFF_1_MS = 500;
const BACKOFF_2_MS = 1000;
const POLL_INTERVAL_MS = 3000;

/** 真实的 Rust 侧 Err(String)：classify_install_failure 的「用户取消授权」分支 */
const CANCELLED_AUTH_REASON =
  '安装 macOS VPN 服务需要本机管理员密码，本次授权被取消了。请重试并在弹出的系统提示中输入管理员密码后点「好」。';

function defaultInvoke(cmd: string): Promise<unknown> {
  if (cmd === 'hg_is_installed') { return Promise.resolve(h.installed.value); }
  return Promise.resolve(true);
}

function setWindowQuery(installError?: string) {
  const params = new URLSearchParams({
    userId: 'u1',
    serverUrl: btoa('https://api.example.com'),
    accessToken: btoa('access-token'),
    refreshToken: btoa('refresh-token'),
  });
  if (installError !== undefined) { params.set('installError', installError); }
  window.history.replaceState({}, '', `/?${params}`);
}

/** 推进 fake timer 并 flush 随之落地的 promise 链（同步版 advanceTimersByTime 不 flush microtask） */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** 挂载并 flush 掉首屏所有异步（platform 探测 / hg_is_installed / 首次探活 / 首次轮询 / loadDevices） */
async function renderPage() {
  render(<HuanvaeGuardPage />);
  await tick(0);
}

function headerOf(el: HTMLElement): HTMLElement {
  return el.closest('header')!;
}

describe('HuanvaeGuardPage (macOS)', () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
    setWindowQuery();
    h.installed.value = false;
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

  it('未安装：header 显示「未安装」，按钮为「安装服务」（macOS 受支持，无不支持提示）', async () => {
    await renderPage();

    const btn = screen.getByRole('button', { name: '安装服务' });
    expect(within(headerOf(btn)).getByText('未安装')).toBeInTheDocument();
    // 三态的另两态不应出现
    expect(screen.queryByText('已安装未运行')).not.toBeInTheDocument();
    expect(screen.queryByText('服务运行中')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '修复服务' })).not.toBeInTheDocument();
    // macOS 受支持 → 不显示"仅 Windows / macOS 支持"提示
    expect(screen.queryByText('仅 Windows / macOS 支持')).not.toBeInTheDocument();
  });

  it('已安装但未运行：header 显示「已安装未运行」，按钮为「修复服务」', async () => {
    h.installed.value = true;

    await renderPage();

    expect(h.invoke).toHaveBeenCalledWith('hg_is_installed');
    const btn = screen.getByRole('button', { name: '修复服务' });
    expect(within(headerOf(btn)).getByText('已安装未运行')).toBeInTheDocument();
    expect(screen.queryByText('未安装')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '安装服务' })).not.toBeInTheDocument();
  });

  it('点击按钮调用 invoke("hg_repair") 并在之后重新探活', async () => {
    await renderPage();
    // 挂载时常驻探活已经打过（首拍 void probeService()），故基线取当前实际次数
    const probesBefore = mockLocalApi.getStatus.mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '安装服务' }));
    });
    await tick(0);

    expect(h.invoke).toHaveBeenCalledWith('hg_repair');

    // 探活在退避第一档（500ms）之后才发生
    mockLocalApi.getStatus.mockResolvedValue(STATUS_UP);
    await tick(BACKOFF_1_MS);
    expect(mockLocalApi.getStatus.mock.calls.length).toBeGreaterThan(probesBefore);
  });

  it('修复后按退避表重试探活：首次读到 false 也能在后续重试中翻成运行中（零等待探活回归）', async () => {
    await renderPage();
    // 挂载时常驻探活已经打过（首拍 void probeService()），故基线取当前实际次数
    const probesBefore = mockLocalApi.getStatus.mock.calls.length;

    // 第 1 次 post-click 探活仍 false（launchctl bootstrap 只是把 job 提交给 launchd），
    // 第 2 次才 true —— 旧的「零等待单次探活」实现只会读到那个 false，界面永远停在未安装
    mockLocalApi.getStatus
      .mockResolvedValueOnce(STATUS_DOWN)
      .mockResolvedValue(STATUS_UP);

    // 计时前提：点击之后全程只推进 BACKOFF_1 + BACKOFF_2 = 1500ms < POLL_INTERVAL_MS(3000)，
    // 3s 常驻轮询的下一拍掺不进来 —— 下面几个「精确次数」才只可能来自退避重试本身。
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '安装服务' }));
    });
    await tick(0);

    // hg_repair 已提交，但退避第一档还没到 → 一次都还没探活（旧实现此刻已探过一次）
    expect(h.invoke).toHaveBeenCalledWith('hg_repair');
    expect(mockLocalApi.getStatus.mock.calls.length).toBe(probesBefore);

    // 500ms → 第 1 次探活拿到 false，状态尚未翻转
    await tick(BACKOFF_1_MS);
    expect(mockLocalApi.getStatus.mock.calls.length).toBe(probesBefore + 1);
    expect(screen.getByText('未安装')).toBeInTheDocument();

    // 再 1000ms → 第 2 次探活拿到 true → 跳出重试并翻成运行中
    await tick(BACKOFF_2_MS);
    expect(mockLocalApi.getStatus.mock.calls.length).toBeGreaterThan(probesBefore + 1);
    expect(screen.getByText('服务运行中')).toBeInTheDocument();
    expect(screen.queryByText('未安装')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '安装服务' })).not.toBeInTheDocument();
  });

  it('修复失败：Rust 侧中文原因进错误横幅（不只写日志）', async () => {
    h.invoke.mockImplementation((cmd: string) => {
      if (cmd === 'hg_repair') { return Promise.reject(CANCELLED_AUTH_REASON); }
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
    expect(within(banner).getByText(`修复失败：${CANCELLED_AUTH_REASON}`)).toBeInTheDocument();
    // 失败即中止，不再走退避重试 → 点击之后一次新探活都不该发生（挂载那次之外零增量）
    expect(mockLocalApi.getStatus.mock.calls.length).toBe(probesBefore);
  });

  it('开窗前 hg_ensure_installed 的失败原因经 URL installError 透传，挂载即进错误横幅（无需任何交互）', async () => {
    setWindowQuery(CANCELLED_AUTH_REASON);

    await renderPage();

    const banner = screen.getByRole('alert');
    expect(within(banner).getByText(CANCELLED_AUTH_REASON)).toBeInTheDocument();
    // 同一原因也进日志面板
    expect(screen.getByText(new RegExp(`服务安装未完成：${CANCELLED_AUTH_REASON}$`))).toBeInTheDocument();
    // 全程零交互
    expect(h.invoke).not.toHaveBeenCalledWith('hg_repair');
  });

  it('轮询不再被 serviceRunning 门控：后起的守护进程被自动接上（粘滞 false 回归）', async () => {
    await renderPage();
    expect(screen.getByText('未安装')).toBeInTheDocument();

    // 页面打开之后守护进程才起来
    mockLocalApi.getStatus.mockResolvedValue(STATUS_UP);
    await tick(POLL_INTERVAL_MS);

    // 无任何用户交互，仅靠轮询自己恢复
    expect(screen.getByText('服务运行中')).toBeInTheDocument();
    expect(screen.queryByText('未安装')).not.toBeInTheDocument();
    expect(h.invoke).not.toHaveBeenCalledWith('hg_repair');
  });
});

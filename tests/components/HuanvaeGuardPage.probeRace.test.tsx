/**
 * HuanvaeGuardPage — 本地服务探活链路的结构性缺陷回归（缺陷已修复，本文件当前 **GREEN**）
 *
 * 下面四条钉的都是**已经修掉**的缺陷：源码把探活收敛成"单飞 + 单一写者"之后它们全部通过，
 * 必须保持常绿 —— 任何一条翻红都意味着探活的调度方式或写者结构被改回了旧样子。
 *
 * ## 层级
 * **L1 单元/组件层**（jsdom + mock 掉 invoke / localApi / serverApi），**非真机**。
 * 本文件只能证明"探活的调度方式与 serviceRunning 的写者结构"是否正确；真守护进程半死态、
 * 真 launchd 拉起时序、真回环 HTTP 必须另做真机验证 —— 本文件全绿 ≠ L3 通过。
 *
 * ## 每个用例钉的（旧）缺陷 → 现在靠哪段源码守住（行号按当前源码复核）
 *  1. **轮询无单飞** —— 旧的 3s 轮询是 async 且无在途门控：探活比轮询周期慢时（半死态守护
 *     进程），每一拍都再发一个请求、无限叠加。现由单飞探活 probeService
 *     （HuanvaeGuardPage.tsx:187-224）守住：:188-189 命中 probeInFlightRef 即复用在途那个
 *     promise，:221 落地即清 ref —— 既不叠加，也不会退化成"轮询彻底停摆"。
 *  2. **修复超时的错误横幅无人清理** —— 旧 handleRepair 在退避表耗尽后 setError(hint)，而轮询
 *     只写 serviceRunning、从不碰 error：守护进程晚于 7.5s 才起来时，header 已翻成「服务运行中」，
 *     横幅却还挂着"守护进程未启动"，两处自相矛盾。现由 handleRepair(:417-456) 先把提示原文记进
 *     repairHintRef(:445) 再 setError(:446)、探活侧按原文比对将其收回(:213-217) 守住。
 *  3. **（负向对照）** 服务就绪不得顺手清掉与服务无关的错误 —— 防止 #2 被"每次探活成功就
 *     setError(null)"这种一刀切修法糊弄过去。守住它的是 :216 的 `prev === hint` 原文比对
 *     （只收回自己记下的那一条）。此条修复前后都 PASS，是守门用的对照组，**不得删除**。
 *  4. **serviceRunning 有三个写者** —— 旧实现里挂载 effect / 轮询 / handleRepair 各写一次，且
 *     挂载 effect 的依赖含 windowData，而 token 刷新(:312-327)会换 windowData 的引用，于是一次
 *     纯令牌刷新就顺带再打一次本地探活。现在写者唯一：只有 probeService 写 serviceRunning(:203)
 *     与 tunnelStatus(:204)；windowData effect(:296-299) 只 loadDevices()，handleRepair 也不再
 *     setServiceRunning（见 :434 的说明注释）。
 *
 * ## 计时
 * 组件挂载即起 3s 常驻轮询、修复退避最长 7.5s，故全文件用 fake timer 且一律以 **async**
 * 版本推进（vi.advanceTimersByTimeAsync）—— 同步版不 flush microtask，轮询/退避里 await 的
 * mock promise 永远不落地。详见 .claude/rules/frontend-test.md。
 *
 * 注：mock 约定（platform→macos / vi.hoisted invoke 分发 / localApi / serverApi / deviceInfo /
 * tick / setWindowQuery）与 HuanvaeGuardPage.macos.test.tsx 保持一致，便于两文件对照阅读。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react';
import type { ApiResponse, TunnelStatus } from '../../src/huanvaeGuard/types';

// platform → macos（修复/安装按钮仅 macOS 渲染）
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'macos',
}));

// listen 捕获 handler：用例要能像主窗口那样真的广播 `session:tokens-updated`
const eventMock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => void>(),
  emit: vi.fn(),
  listen: vi.fn(),
}));
vi.mock('@tauri-apps/api/event', () => ({
  emit: eventMock.emit,
  listen: eventMock.listen,
}));

// invoke spy：按命令名分发。h.installed.value 控制「LaunchDaemon 文件是否已就位」
const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  installed: { value: false },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }));

// 返回值是对象的 mock 用稳定引用常量（每次调用新对象会让下游 effect 无谓重跑）
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
  getDevices: vi.fn(),
  listGroups: vi.fn(),
  listLinks: vi.fn(),
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

// 与 SUT 常量对齐（HuanvaeGuardPage.tsx:84 POLL_INTERVAL_MS / :90 REPAIR_BACKOFF_MS）
const POLL_INTERVAL_MS = 3000;
/** REPAIR_BACKOFF_MS = [500,1000,2000,4000] 之和 */
const REPAIR_BUDGET_MS = 7500;
/** 半死态探活耗时：远长于一个轮询周期，用来暴露"每拍都再发一个请求" */
const SLOW_PROBE_MS = 10000;

const SERVER_URL = 'https://api.example.com';

function defaultInvoke(cmd: string): Promise<unknown> {
  if (cmd === 'hg_is_installed') { return Promise.resolve(h.installed.value); }
  return Promise.resolve(true);
}

function setWindowQuery() {
  const params = new URLSearchParams({
    userId: 'u1',
    serverUrl: btoa(SERVER_URL),
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

/** 挂载并 flush 首屏异步（platform / hg_is_installed / 首次探活 / 首次轮询 / loadDevices） */
async function renderPage() {
  render(<HuanvaeGuardPage />);
  await tick(0);
}

/** 当前累计的本地探活次数（唯一入口：常驻单飞探活的 localApi.getStatus） */
function probeCount(): number {
  return mockLocalApi.getStatus.mock.calls.length;
}

describe('HuanvaeGuardPage 探活链路（结构性缺陷回归）', () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
    setWindowQuery();

    eventMock.handlers.clear();
    eventMock.emit.mockReset();
    eventMock.emit.mockResolvedValue(undefined);
    eventMock.listen.mockReset();
    eventMock.listen.mockImplementation((event: string, cb: (e: unknown) => void) => {
      eventMock.handlers.set(event, cb);
      return Promise.resolve(() => {});
    });

    h.installed.value = false;
    h.invoke.mockReset();
    h.invoke.mockImplementation(defaultInvoke);

    mockLocalApi.getStatus.mockReset();
    mockLocalApi.getStatus.mockResolvedValue(STATUS_DOWN);

    mockServerApi.getDevices.mockReset();
    mockServerApi.getDevices.mockResolvedValue([]);
    mockServerApi.listLinks.mockReset();
    mockServerApi.listLinks.mockResolvedValue([]);
    mockServerApi.listGroups.mockReset();
    mockServerApi.listGroups.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
  });

  it('轮询单飞：探活慢于轮询周期时，同一时刻只有一个探活在飞（不叠加请求）', async () => {
    // 半死态守护进程：/api/tunnel/status 要 10s 才回，远长于 3s 轮询周期
    mockLocalApi.getStatus.mockImplementation(
      () => new Promise<ApiResponse<TunnelStatus>>((resolve) => {
        setTimeout(() => { resolve(STATUS_DOWN); }, SLOW_PROBE_MS);
      }),
    );

    await renderPage();
    // 挂载即打一次（HuanvaeGuardPage.tsx:333 常驻探活 effect 里的 `void probeService()`）
    expect(mockLocalApi.getStatus).toHaveBeenCalledTimes(1);

    // 连过 3 个轮询周期，首个探活始终在途 —— 单飞下不该再发第二个
    await tick(POLL_INTERVAL_MS * 3);
    expect(mockLocalApi.getStatus).toHaveBeenCalledTimes(1);

    // 在途探活落地（t=10s）之后轮询必须能接着发（t=12s 那一拍），
    // 否则"单飞"退化成"轮询彻底停摆"—— 这条防的就是那种偷懒修法
    await tick(SLOW_PROBE_MS - POLL_INTERVAL_MS * 3 + POLL_INTERVAL_MS);
    expect(mockLocalApi.getStatus.mock.calls.length).toBeGreaterThan(1);
  });

  it('守护进程晚于退避上限才起来：轮询接上后，修复超时留下的错误横幅必须自动消失', async () => {
    // 文件已就位但进程没起（半装态）→ 按钮为「修复服务」，退避耗尽后走"已安装"那条 hint
    h.installed.value = true;
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '修复服务' }));
    });
    // 退避表 500+1000+2000+4000 全部耗尽，期间探活恒 false
    await tick(REPAIR_BUDGET_MS + 500);

    const banner = screen.getByRole('alert');
    expect(within(banner).getByText(/守护进程未启动/)).toBeInTheDocument();
    expect(screen.queryByText('服务运行中')).not.toBeInTheDocument();

    // 守护进程晚到：轮询下一拍就读到它了
    mockLocalApi.getStatus.mockResolvedValue(STATUS_UP);
    await tick(POLL_INTERVAL_MS + 500);

    expect(screen.getByText('服务运行中')).toBeInTheDocument();

    // 消失断言按 frontend-test.md 要求入 waitFor。注意：RTL 的假时钟探测查的是 `jest` 全局
    // （vitest 下恒 false），waitFor 推不动 vi 的假时钟 —— 所以先用假时钟把轮询推到落地（上面
    // 的 tick），再切回真实计时器让 waitFor 能正常轮询/超时，失败时给出断言错误而非 10s 挂死。
    vi.useRealTimers();
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('就绪不得误清无关错误：连接失败的错误横幅不因服务就绪而消失（负向对照）', async () => {
    // 服务在跑 → 「连接」可点（disabled={isActive || !serviceRunning}）
    mockLocalApi.getStatus.mockResolvedValue(STATUS_UP);
    await renderPage();

    // 用真实交互制造一条与服务状态无关的错误：未选设备就点「连接」→ handleConnect 顶部早返回
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '连接' }));
    });
    await tick(0);

    const banner = screen.getByRole('alert');
    expect(within(banner).getByText('请先选择一个设备')).toBeInTheDocument();
    // 早返回发生在生物识别门禁之前 —— 证明这条横幅确实来自"未选设备"分支，而非别的路径
    expect(h.invoke.mock.calls.some((c) => c[0] === 'biometric_authenticate')).toBe(false);

    // 制造一次真实的 serviceRunning false → true 跃迁（掉线再恢复）
    mockLocalApi.getStatus.mockResolvedValue(STATUS_DOWN);
    await tick(POLL_INTERVAL_MS + 500);
    expect(screen.getByText('未安装')).toBeInTheDocument();

    mockLocalApi.getStatus.mockResolvedValue(STATUS_UP);
    await tick(POLL_INTERVAL_MS + 500);

    // 服务就绪了，但这条横幅跟服务状态无关，必须原样留着
    expect(screen.getByText('服务运行中')).toBeInTheDocument();
    const stillThere = screen.getByRole('alert');
    expect(within(stillThere).getByText('请先选择一个设备')).toBeInTheDocument();
  });

  it('令牌刷新不得触发第二个探活写者（serviceRunning 只能有一个权威来源）', async () => {
    await renderPage();

    expect(eventMock.listen).toHaveBeenCalledWith('session:tokens-updated', expect.any(Function));
    const tokenHandler = eventMock.handlers.get('session:tokens-updated')!;

    const probesBefore = probeCount();
    const deviceLoadsBefore = mockServerApi.getDevices.mock.calls.length;

    // 主窗口广播新令牌（SessionContext.updateTokens 的真实事件形状）
    await act(async () => {
      tokenHandler({ payload: { accessToken: 'new-a', refreshToken: 'new-r' } });
    });
    // 只 flush 微任务、不推进时间 → 轮询这一拍掺不进来，计数变化只可能来自令牌刷新
    await tick(0);

    // 纯令牌刷新不该产生任何本地探活（本地服务在不在，跟后端 token 换没换毫无关系）
    expect(probeCount()).toBe(probesBefore);

    // 正向对照：令牌刷新该做的事仍然做了（拿新 token 重拉设备列表），
    // 证明上面测的不是一个压根没触发的死 effect
    expect(mockServerApi.getDevices.mock.calls.length).toBeGreaterThan(deviceLoadsBefore);
    expect(mockServerApi.getDevices).toHaveBeenLastCalledWith(SERVER_URL, 'new-a');
  });
});

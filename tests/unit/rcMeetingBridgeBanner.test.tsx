/**
 * zmhyvb6n 整改（U2）钉死单测：被控端「正在被控制」横幅的清理不依赖本机 daemon
 *
 * 场景复现：dev/无 daemon 环境（controlStatus() 恒 null —— api.ts:116-124 catch 静默）
 * 下，daemon 轮询清理路径（meetingBridge 4s 轮询里 `if (stopped || !s) return;`）永不生效。
 * 两条 daemon 无关的清理路径必须可用：
 * 1. 信令/数据面释放：rc-release 文本帧 → frameChannel RC_PEER_RELEASED → 即时清横幅；
 * 2. 看门狗兜底：控制端崩溃/强杀（rc-release 不发）→ control-session DC 断开达
 *    RC_BANNER_STALE_MS ⇒ 自动清横幅（isPeerSessionActive 纯数据面判活，零 daemon 查询）。
 * 另锁反向：横幅在位但从未建链（等链建立中）不得被看门狗误清。
 *
 * @module tests/unit/rcMeetingBridgeBanner
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

const emitMock = vi.hoisted(() => vi.fn());
const listeners = vi.hoisted(() => new Map<string, (ev: { payload: unknown }) => void>());
const controlStatusMock = vi.hoisted(() => vi.fn());
const controlDisarmMock = vi.hoisted(() => vi.fn());
const isPeerSessionActiveMock = vi.hoisted(() => vi.fn(() => false));
const setSessionRoleMock = vi.hoisted(() => vi.fn(() => null));
const getRoleMock = vi.hoisted(() => vi.fn((): string | null => null));

vi.mock('@tauri-apps/api/event', () => ({
  emit: emitMock,
  listen: vi.fn((event: string, cb: (ev: { payload: unknown }) => void) => {
    listeners.set(event, cb);
    return Promise.resolve(() => { listeners.delete(event); });
  }),
}));
// 无 daemon 环境核心桩：controlStatus 恒 null（daemon 缺席的真实返回形态）
vi.mock('../../src/remote-control/api', () => ({
  controlStatus: controlStatusMock,
  controlArm: vi.fn(async () => false),
  controlDisarm: controlDisarmMock,
  controlKillswitch: vi.fn(async () => false),
}));
vi.mock('../../src/remote-control/frameChannel', () => ({
  getRole: getRoleMock,
  setSessionRole: setSessionRoleMock,
  isPeerSessionActive: isPeerSessionActiveMock,
}));
vi.mock('../../src/utils/platform', () => ({
  detectPlatform: vi.fn(() => 'windows'),
  isControllablePlatform: vi.fn(() => true),
}));
vi.mock('../../src/remote-control/devGate', () => ({ isDevControl: vi.fn(() => false) }));
vi.mock('../../src/remote-control/ControlAuthPopup', () => ({ default: () => null }));

import MeetingBridge, { RC_BANNER_STALE_MS } from '../../src/remote-control/meetingBridge';
import { CONTROL_SESSION_CHANGED, RC_PEER_RELEASED } from '../../src/remote-control/bus';

function fire(event: string, payload: unknown): void {
  const cb = listeners.get(event);
  expect(cb, `listener ${event} 未注册`).toBeTruthy();
  act(() => { cb!({ payload }); });
}

beforeEach(() => {
  vi.useFakeTimers();
  listeners.clear();
  emitMock.mockReset();
  controlStatusMock.mockReset().mockResolvedValue(null); // 无 daemon
  controlDisarmMock.mockReset().mockResolvedValue(false);
  isPeerSessionActiveMock.mockReset().mockReturnValue(false);
  getRoleMock.mockReset().mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('U2：无 daemon 环境的横幅清理', () => {
  it('信令释放：rc-release → RC_PEER_RELEASED ⇒ 横幅即时撤下（controlStatus=null 全程）', async () => {
    render(<MeetingBridge screenSharing={false} />);
    await act(async () => { await Promise.resolve(); }); // flush listen 注册 + daemon 探查

    fire(CONTROL_SESSION_CHANGED, { controlledByName: 'hg24-real' });
    expect(screen.getByText(/正在被 hg24-real 控制/)).toBeTruthy();
    // 前提固化：daemon 确实被问过且缺席（清理不是它干的）
    expect(controlStatusMock).toHaveBeenCalled();

    fire(RC_PEER_RELEASED, { reason: 'peer-released' });

    expect(screen.queryByText(/正在被/)).toBeNull();
    expect(controlDisarmMock).toHaveBeenCalled();
  });

  it('看门狗兜底：建链后 DC 持续断开达 RC_BANNER_STALE_MS ⇒ 横幅自动撤下（零 daemon 查询依赖）', async () => {
    render(<MeetingBridge screenSharing={false} />);
    await act(async () => { await Promise.resolve(); });

    fire(CONTROL_SESSION_CHANGED, { controlledByName: 'watcher-a' });
    expect(screen.getByText(/正在被 watcher-a 控制/)).toBeTruthy();

    // 会话正常期：DC 在位，横幅稳如老狗（不误清）
    isPeerSessionActiveMock.mockReturnValue(true);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(screen.getByText(/正在被 watcher-a 控制/)).toBeTruthy();

    // 控制端强杀（rc-release 不发）：DC 断开
    isPeerSessionActiveMock.mockReturnValue(false);
    act(() => { vi.advanceTimersByTime(RC_BANNER_STALE_MS - 2_000); });
    expect(screen.getByText(/正在被 watcher-a 控制/)).toBeTruthy(); // 未满窗口不撤
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); }); // 异步推进：微任务随 tick flush
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.queryByText(/正在被/)).toBeNull(); // 达窗自动撤
    expect(controlDisarmMock).toHaveBeenCalled();
  });

  it('反向锁定：横幅在位但从未建链（等链建立）⇒ 看门狗不得误清', async () => {
    render(<MeetingBridge screenSharing={false} />);
    await act(async () => { await Promise.resolve(); });

    fire(CONTROL_SESSION_CHANGED, { controlledByName: 'watcher-b' });
    isPeerSessionActiveMock.mockReturnValue(false); // 全程未建链（重连中/链接中）
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText(/正在被 watcher-b 控制/)).toBeTruthy();
  });
});

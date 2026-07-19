/**
 * WS 半开看门狗 + 重连补偿 sync 集成回归（L2：jsdom + mock RustWebSocket/SessionContext/db，
 * 渲染真 WebSocketProvider）
 *
 * 被测契约（WebSocketContext）：
 * - startPing 每 25s（PING_INTERVAL）检查入站活性：`Date.now() - ws.lastActivityAt`
 *   超过 70s（LIVENESS_TIMEOUT）→ 判半开 → `ws.terminate()` 并停发 ping（不再喂假活 socket）；
 *   活性新鲜则照常发 `{"type":"ping"}`。
 * - terminate → onclose → 走既有指数退避重连；看门狗介入的重连在下一个 connected 帧
 *   补偿触发一次 onReconnected（即使 resumed=true —— 半开时长未知，resumed 重放只覆盖
 *   服务端事件缓冲窗口，超窗漏收只能靠增量 sync 补），flag 一次性消费。
 * - 普通重连（非看门狗路径）保持既有语义：resumed=true 不触发、resumed=false 且非首次触发。
 * - 两处 new RustWebSocket 均传第三参 { idleTimeoutSecs: 90 }（Rust 侧 TCP 半开兜底）。
 *
 * 全程 vi.useFakeTimers()（Date.now 一并被 mock，与 lastActivityAt 联动正确）；
 * Math.random 固定为 0 消除重连 jitter，使首次重连延迟确定 ≤2000ms（推进 3000ms 必覆盖）。
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

// ---- mock RustWebSocket：可控 readyState/事件/活性，记录 send 帧 + terminate 调用 + 构造参数 ----
const wsControl = vi.hoisted(() => {
  interface WsLocalOpts { idleTimeoutSecs?: number }
  class FakeRustWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = 0;
    lastActivityAt = Date.now();
    sent: string[] = [];
    terminateCalls: number[] = [];
    localOpts: WsLocalOpts | undefined;
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: ((ev?: unknown) => void) | null = null;
    onclose: ((ev: { code: number }) => void) | null = null;
    constructor(_url: string, _resolve?: unknown, localOpts?: WsLocalOpts) {
      this.localOpts = localOpts;
      instances.push(this);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      this.readyState = FakeRustWebSocket.CLOSED;
    }
    terminate(code = 4008) {
      this.terminateCalls.push(code);
      this.readyState = FakeRustWebSocket.CLOSED;
      this.onclose?.({ code });
    }
  }
  const instances: InstanceType<typeof FakeRustWebSocket>[] = [];
  return { FakeRustWebSocket, instances };
});
vi.mock('../../src/services/rustWebSocket', () => ({
  RustWebSocket: wsControl.FakeRustWebSocket,
}));

// 稳定单例（vi.hoisted）：新增 getActiveEndpoint / rediscoverOnFailure 供端点轮换测试断言；
// resolveForSecureHttp 保持 () => null（既有半开看门狗测试不关心 resolve 值）。
const discoveryMock = vi.hoisted(() => ({
  resolveForSecureHttp: () => null,
  getActiveEndpoint: () => ({ domain: 'api.huanvae.cn', ip: '47.105.101.42', port: 443, caPem: '' }),
  rediscoverOnFailure: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/services/discovery', () => discoveryMock);

// 稳定单例：真实 SessionContext 的 session/api/clearSession 引用跨 render 稳定。
// 若每次 render 返回新对象（clearSession 新 vi.fn()），installWsHandlers 依赖会变化
// → token 热切换 effect 被虚假触发（isSwappingRef 卡 true 吞掉 onclose、多建假实例），
// 测的就不再是真实运行时行为。
const sessionMock = vi.hoisted(() => ({
  session: { accessToken: 'token', serverUrl: 'https://server', userId: 'me' },
  api: null,
  clearSession: () => {},
}));
vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => sessionMock,
}));

const mockDb = vi.hoisted(() => ({
  getConversations: vi.fn().mockResolvedValue([]),
  advanceConversationRead: vi.fn().mockResolvedValue(undefined),
  saveMessage: vi.fn().mockResolvedValue(undefined),
  updateConversationLastSeq: vi.fn().mockResolvedValue(undefined),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
  refreshConversationPreview: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/db', () => mockDb);

vi.mock('../../src/services/notificationService', () => ({
  notifyNewMessage: vi.fn().mockResolvedValue(undefined),
  notifySystemEvent: vi.fn().mockResolvedValue(undefined),
}));

import { WebSocketProvider, useWebSocket } from '../../src/contexts/WebSocketContext';
import { resetReadPositions } from '../../src/contexts/readPositions';
import type { UnreadSummary } from '../../src/types/websocket';

const OPEN = 1;

const emptySummary = (): UnreadSummary => ({
  total_count: 0,
  friend_unreads: [],
  group_unreads: [],
});

/** ws.sent 中协议 ping 帧数量 */
function pingCount(sent: string[]): number {
  return sent
    .map(s => JSON.parse(s) as { type: string })
    .filter(f => f.type === 'ping')
    .length;
}

/** fake timers 推进（setTimeout/setInterval + await mock 组合必须 async 版本） */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mountConnected() {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(WebSocketProvider, null, children);
  const hook = renderHook(() => useWebSocket(), { wrapper });
  // 等待挂载副作用（读位预载 + connect）完成（mockResolvedValue 仅需 microtask flush）
  await act(async () => {});
  const ws = wsControl.instances[wsControl.instances.length - 1];
  await act(async () => {
    ws.readyState = OPEN;
    ws.onopen?.();
  });
  return { hook, ws };
}

async function deliverConnected(
  ws: { onmessage: ((ev: { data: string }) => void) | null },
  sessionId: string,
  resumed?: boolean,
) {
  await act(async () => {
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'connected',
        unread_summary: emptySummary(),
        session_id: sessionId,
        ...(resumed === undefined ? {} : { resumed }),
      }),
    });
  });
}

let randomSpy: MockInstance<() => number>;

beforeEach(() => {
  vi.useFakeTimers();
  // jitter 固定为 0：首次重连延迟确定（≤2000ms），推进 3000ms 必然覆盖，杜绝随机 flake
  randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
  wsControl.instances.length = 0;
  resetReadPositions();
  mockDb.getConversations.mockClear();
  mockDb.getConversations.mockResolvedValue([]);
  mockDb.advanceConversationRead.mockClear();
  discoveryMock.rediscoverOnFailure.mockClear();
});

afterEach(() => {
  randomSpy.mockRestore();
  vi.useRealTimers();
});

describe('半开看门狗（startPing 活性检查）', () => {
  it('活性新鲜时每 25s 正常发 ping，不判半开', async () => {
    const { hook, ws } = await mountConnected();

    for (let i = 1; i <= 3; i++) {
      ws.lastActivityAt = Date.now(); // 模拟协议 ping/业务帧转发刷新活性
      await advance(25000);
      expect(pingCount(ws.sent)).toBe(i); // 每轮恰好多发 1 帧 ping
    }
    expect(ws.terminateCalls).toEqual([]);

    hook.unmount();
  });

  it('入站静默超 70s → terminate(4008) 且停发 ping', async () => {
    const { hook, ws } = await mountConnected();
    // 全程不刷新 lastActivityAt（模拟半开：出站 ping 进黑洞、入站无任何帧）

    await advance(25000); // 静默 25s ≤ 70s → 照常发 ping
    expect(pingCount(ws.sent)).toBe(1);
    expect(ws.terminateCalls).toEqual([]);

    await advance(25000); // 静默 50s ≤ 70s
    expect(pingCount(ws.sent)).toBe(2);
    expect(ws.terminateCalls).toEqual([]);

    await advance(25000); // 静默 75s > 70s → 判死
    expect(ws.terminateCalls).toEqual([4008]);
    expect(pingCount(ws.sent)).toBe(2); // 判死那一轮不再发 ping

    hook.unmount();
  });

  it('看门狗 terminate → 既有退避重连 → 重连成功即补偿一次 sync（resumed=true 也补）', async () => {
    const { hook, ws } = await mountConnected();
    const cb = vi.fn();
    hook.result.current.onReconnected(cb);

    await advance(75000); // 25s/50s 各发 1 ping，75s 判死 terminate
    expect(ws.terminateCalls).toEqual([4008]);
    expect(wsControl.instances).toHaveLength(1); // 重连定时器尚未到期

    await advance(3000); // 覆盖首次重连延迟（jitter=0，≤2000ms）
    expect(wsControl.instances).toHaveLength(2); // 新连接已创建
    expect(cb).not.toHaveBeenCalled(); // connected 帧到达前不补偿

    const ws2 = wsControl.instances[1];
    await act(async () => {
      ws2.readyState = OPEN;
      ws2.onopen?.();
    });
    await deliverConnected(ws2, 's2', true); // resumed=true：半开路径仍须补偿
    expect(cb).toHaveBeenCalledTimes(1);

    hook.unmount();
  });

  it('普通重连（非看门狗路径）且 resumed=true → 不补偿 sync', async () => {
    const { hook, ws } = await mountConnected();
    const cb = vi.fn();
    hook.result.current.onReconnected(cb);
    await deliverConnected(ws, 's1'); // 首次 connected

    await act(async () => {
      ws.onclose?.({ code: 1006 }); // 对端正常断开，非 terminate
    });
    expect(ws.terminateCalls).toEqual([]); // 看门狗未介入

    await advance(3000);
    expect(wsControl.instances).toHaveLength(2);
    const ws2 = wsControl.instances[1];
    await act(async () => {
      ws2.readyState = OPEN;
      ws2.onopen?.();
    });
    await deliverConnected(ws2, 's2', true); // 会话恢复成功，服务端已重放缺失事件
    expect(cb).not.toHaveBeenCalled();

    hook.unmount();
  });

  it('普通重连 resumed=false 且非首次 → 触发一次 sync（既有行为回归）', async () => {
    const { hook, ws } = await mountConnected();
    const cb = vi.fn();
    hook.result.current.onReconnected(cb);
    await deliverConnected(ws, 's1');

    await act(async () => {
      ws.onclose?.({ code: 1006 });
    });
    await advance(3000);
    expect(wsControl.instances).toHaveLength(2);
    const ws2 = wsControl.instances[1];
    await act(async () => {
      ws2.readyState = OPEN;
      ws2.onopen?.();
    });
    await deliverConnected(ws2, 's2', false);
    expect(cb).toHaveBeenCalledTimes(1);

    hook.unmount();
  });

  it('new RustWebSocket 第三参携带 { idleTimeoutSecs: 90 }（Rust 侧半开兜底）', async () => {
    const { hook, ws } = await mountConnected();
    expect(ws.localOpts).toEqual({ idleTimeoutSecs: 90 });
    hook.unmount();
  });
});

describe('端点轮换（连续重连失败触发 rediscoverOnFailure 自愈）', () => {
  it('首次重连失败不轮换(attempts=1<阈值)；连续第 2 次失败前触发 rediscoverOnFailure(当前 active IP)', async () => {
    const { hook, ws } = await mountConnected();
    await deliverConnected(ws, 's1');

    // 第 1 次断开 → attempts=1 < ROTATE_AFTER_ATTEMPTS(2) → 不轮换，直接重连
    await act(async () => { ws.onclose?.({ code: 1006 }); });
    await advance(2500); // 首次重连延迟 = base(1000)*2^1 = 2000ms（jitter 固定 0）
    expect(wsControl.instances).toHaveLength(2);
    expect(discoveryMock.rediscoverOnFailure).not.toHaveBeenCalled();

    // 第 2 个连接未 open 即再次断开 → attempts=2 → 重连前轮换端点
    const ws2 = wsControl.instances[1];
    await act(async () => { ws2.onclose?.({ code: 1006 }); });
    await advance(4500); // 第 2 次重连延迟 = base*2^2 = 4000ms
    expect(discoveryMock.rediscoverOnFailure).toHaveBeenCalledTimes(1);
    expect(discoveryMock.rediscoverOnFailure).toHaveBeenCalledWith('47.105.101.42');
    expect(wsControl.instances).toHaveLength(3); // 轮换后继续重连（新实例已建）

    hook.unmount();
  });
});

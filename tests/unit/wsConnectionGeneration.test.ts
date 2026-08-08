/**
 * WS 连接世代隔离回归（L2：jsdom + mock RustWebSocket/SessionContext/db，渲染真 WebSocketProvider）
 *
 * 被测契约（WebSocketContext）：**每条 WS 连接的事件只能作用于它自己那一代连接**。
 *
 * 背景（结构性缺陷）：旧实现用一个粘滞布尔 `isDisconnectingRef` 表达「现在不该重连/不该收帧」：
 *   - `disconnect()` 置 true（唯一置位点）；
 *   - `connect()` 复位 false，但复位点排在两个 early return（`!token || !serverUrl`、
 *     `readyState===OPEN || connectingRef`）**之后**；
 *   - 消费点 `ws.onclose` 与 `handleMessage` 命中即 **静默** return。
 * 两个后果：
 *   1) 布尔无法表达「这条 close/帧属于哪一次连接生命周期」——上一代连接迟到的 onclose/在途帧
 *      会在新连接已建立后被当作**当前连接**的事件处理：清掉 `wsRef` / `setConnected(false)` /
 *      `clearInterval(ping)` / 再排一次退避重连（凭空多一条连接）。
 *      这在生产可达：`RustWebSocket.close()` 只置 CLOSING + fire-and-forget `ws_close`，
 *      **不置终态**，服务端的 close 事件与在途帧稍后仍会经 Channel 投递回来（见 rustWebSocket.ts）。
 *   2) `disconnect()` 后若 `connect()` 撞上任一 early return，标志永久卡 true → 此后
 *      onclose 不重连、入站帧全丢，且**零日志**。
 * 修复：用连接世代计数器（connect 递增并把世代捕获进该连接的闭包；disconnect 递增作废旧连接；
 * onclose/入站帧比较「我的世代 === 当前世代」），并给被抑制的事件补 console.warn 可观测信号。
 *
 * mock 的 `close()` 只记录调用 + 置 CLOSING（**不自动派发 onclose**），与真实 RustWebSocket 一致——
 * 「陈旧连接的事件迟到」正是靠这一点复现的，不是测试编造的时序。
 *
 * 全程 vi.useFakeTimers()；Math.random 固定 0 消除重连 jitter（首次重连延迟确定 2000ms）。
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

// ---- mock RustWebSocket：可控 readyState/事件，记录 send 帧与 close 调用 ----
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
    closeCalls: number[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: ((ev?: unknown) => void) | null = null;
    onclose: ((ev: { code: number }) => void) | null = null;
    constructor(_url: string, _resolve?: unknown, _localOpts?: WsLocalOpts) {
      instances.push(this);
    }
    send(data: string) {
      this.sent.push(data);
    }
    /** 真实语义：只置 CLOSING + 发出关闭请求，socket 未终态；服务端 close 事件与在途帧稍后仍会到达 */
    close(code?: number) {
      this.closeCalls.push(code ?? 1000);
      this.readyState = FakeRustWebSocket.CLOSING;
    }
    terminate(code = 4008) {
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

const discoveryMock = vi.hoisted(() => ({
  resolveForSecureHttp: () => null,
  getActiveEndpoint: () => ({ domain: 'api.huanvae.cn', ip: '10.0.0.1', port: 443, caPem: '' }),
  rediscoverOnFailure: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/services/discovery', () => discoveryMock);

// 稳定单例（vi.hoisted）：useSession 返回 sessionHolder.current，**同一对象跨 render 引用稳定**。
// 只有测试显式换掉 current（模拟登出/重新登录）时才变，避免虚假触发依赖 session 引用的 effect。
const sessionHolder = vi.hoisted(() => {
  const loggedIn = () => ({
    session: { accessToken: 'token', serverUrl: 'https://server', userId: 'me' },
    api: null,
    clearSession: () => {},
  });
  const loggedOut = () => ({ session: null, api: null, clearSession: () => {} });
  return { current: loggedIn() as ReturnType<typeof loggedIn> | ReturnType<typeof loggedOut>, loggedIn, loggedOut };
});
vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => sessionHolder.current,
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

type FakeWs = (typeof wsControl.instances)[number];

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

function newest(): FakeWs {
  return wsControl.instances[wsControl.instances.length - 1];
}

async function mountConnected() {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(WebSocketProvider, null, children);
  const hook = renderHook(() => useWebSocket(), { wrapper });
  await act(async () => {}); // 挂载副作用（读位预载 + connect）
  const ws = newest();
  await act(async () => {
    ws.readyState = OPEN;
    ws.onopen?.();
  });
  return { hook, ws };
}

async function deliverConnected(ws: FakeWs, sessionId: string, resumed?: boolean) {
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

/** 送一条好友申请系统通知：处理成功 ⇒ pendingNotifications.friendRequests +1（可计数的"帧被处理"证据） */
async function deliverFriendRequest(ws: FakeWs) {
  await act(async () => {
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'system_notification',
        notification_type: 'friend_request',
        data: {},
      }),
    });
  });
}

/**
 * 建立「ws1 已被取代、ws2 是当前连接」的现场：
 * ws1 断线 → 退避重连 → ws2 建连并 open。返回两条连接。
 */
async function setupSupersededConnection() {
  const { hook, ws } = await mountConnected();
  const ws1 = ws;
  await deliverConnected(ws1, 's1');

  await act(async () => { ws1.onclose?.({ code: 1006 }); });
  await advance(3000); // 首次重连延迟 = base(1000)*2^1 = 2000ms（jitter 固定 0）
  expect(wsControl.instances).toHaveLength(2);

  const ws2 = wsControl.instances[1];
  await act(async () => {
    ws2.readyState = OPEN;
    ws2.onopen?.();
  });
  expect(hook.result.current.connected).toBe(true);

  return { hook, ws1, ws2 };
}

let randomSpy: MockInstance<() => number>;

beforeEach(() => {
  vi.useFakeTimers();
  randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
  wsControl.instances.length = 0;
  sessionHolder.current = sessionHolder.loggedIn();
  resetReadPositions();
  mockDb.getConversations.mockClear();
  mockDb.getConversations.mockResolvedValue([]);
  discoveryMock.rediscoverOnFailure.mockClear();
});

afterEach(() => {
  randomSpy.mockRestore();
  vi.useRealTimers();
});

describe('连接世代隔离：陈旧连接的事件不得污染当前连接', () => {
  it('上一代连接迟到的 onclose：不清当前连接状态、不停当前 ping、不凭空多建一条连接', async () => {
    const { hook, ws1, ws2 } = await setupSupersededConnection();

    // 上一代连接迟到的 close（生产可达：close() 只置 CLOSING，服务端 close 事件稍后经 Channel 回来）
    await act(async () => { ws1.onclose?.({ code: 1006 }); });

    // 1) 当前连接的 connected 状态不得被上一代的 close 清掉
    expect(hook.result.current.connected).toBe(true);

    // 2) 不得为上一代的 close 排退避重连（否则凭空多出一条并存连接）
    ws2.lastActivityAt = Date.now();
    await advance(5000); // 足以覆盖上一代 close 若排队的退避（2000ms）
    expect(wsControl.instances).toHaveLength(2);

    // 3) 当前连接的 ping 定时器仍在（上一代 close 不得 clearInterval 掉它）
    const before = pingCount(ws2.sent);
    ws2.lastActivityAt = Date.now();
    await advance(25000); // PING_INTERVAL
    expect(pingCount(ws2.sent)).toBe(before + 1);

    hook.unmount();
  });

  it('上一代连接的在途入站帧不得被当作当前连接的帧处理', async () => {
    const { hook, ws1, ws2 } = await setupSupersededConnection();

    // 正向对照：当前连接的帧必须被处理
    await deliverFriendRequest(ws2);
    expect(hook.result.current.pendingNotifications.friendRequests).toBe(1);

    // 上一代连接的在途帧必须被丢弃（计数不再变化）
    await deliverFriendRequest(ws1);
    expect(hook.result.current.pendingNotifications.friendRequests).toBe(1);

    hook.unmount();
  });

  it('抑制陈旧事件必须留可观测日志，不许静默吞掉（onclose + 丢帧各一条）', async () => {
    const { hook, ws1, ws2 } = await setupSupersededConnection();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await act(async () => { ws1.onclose?.({ code: 1006 }); });
      expect(warn.mock.calls.flat().join(' ')).toMatch(/\[WebSocket\][\s\S]*陈旧/);

      warn.mockClear();
      await deliverFriendRequest(ws1);
      expect(warn.mock.calls.flat().join(' ')).toMatch(/\[WebSocket\][\s\S]*陈旧/);

      // 当前连接的正常帧不得产生"陈旧"告警（防止把 warn 写成无差别噪音）
      warn.mockClear();
      await deliverFriendRequest(ws2);
      expect(warn.mock.calls.flat().join(' ')).not.toMatch(/陈旧/);
    } finally {
      warn.mockRestore();
      hook.unmount();
    }
  });
});

describe('主动 disconnect 后 connect 撞 early-return（粘滞标志卡死场景）', () => {
  /** 复现：登出 → disconnect()；随后 connect() 撞 `!token` early return（旧实现标志由此卡 true） */
  async function stallThenRelogin(hook: Awaited<ReturnType<typeof mountConnected>>['hook']) {
    sessionHolder.current = sessionHolder.loggedOut();
    await act(async () => { hook.rerender(); });
    await act(async () => {});

    const beforeConnectAttempt = wsControl.instances.length;
    await act(async () => { hook.result.current.connect(); });
    // 确认真的撞了 early return：没有建出新连接（否则本用例的前置条件不成立）
    expect(wsControl.instances).toHaveLength(beforeConnectAttempt);

    sessionHolder.current = sessionHolder.loggedIn();
    await act(async () => { hook.rerender(); });
    await act(async () => {});
    expect(wsControl.instances).toHaveLength(beforeConnectAttempt + 1);

    const ws = newest();
    await act(async () => {
      ws.readyState = OPEN;
      ws.onopen?.();
    });
    return ws;
  }

  it('(a) 此后建立的连接断开时仍会调度重连', async () => {
    const { hook } = await mountConnected();
    const ws2 = await stallThenRelogin(hook);
    const countBefore = wsControl.instances.length;

    await act(async () => { ws2.onclose?.({ code: 1006 }); });
    await advance(3000);

    expect(wsControl.instances).toHaveLength(countBefore + 1);
    hook.unmount();
  });

  it('(b) 此后建立的连接的入站帧仍会被处理', async () => {
    const { hook } = await mountConnected();
    const ws2 = await stallThenRelogin(hook);

    await deliverFriendRequest(ws2);
    expect(hook.result.current.pendingNotifications.friendRequests).toBe(1);

    hook.unmount();
  });

  it('主动 disconnect 的那条连接仍不重连、其在途帧仍不被处理（既有行为回归）', async () => {
    const { hook, ws } = await mountConnected();
    await deliverConnected(ws, 's1');

    await act(async () => { hook.result.current.disconnect(); });

    await act(async () => { ws.onclose?.({ code: 1006 }); });
    await advance(30000);
    expect(wsControl.instances).toHaveLength(1); // 主动断开绝不触发重连

    await deliverFriendRequest(ws);
    expect(hook.result.current.pendingNotifications.friendRequests).toBe(0);

    hook.unmount();
  });
});

/**
 * WS 主连稳定回归（L2：jsdom + mock RustWebSocket/SessionContext/db，渲染真 WebSocketProvider）
 *
 * 被测契约（WebSocketContext）：**token 主动刷新时不重建主连**。
 *
 * 背景（0信任服务端日志实证）：旧「热切换 make-before-break」在每次 token 刷新（≈每 10min）时并行
 * 新开一条 WS 抢占主连、成功后 close 旧连。真机上这条逻辑反而让主连长期闪断——服务端反复
 * register→13ms 内 Client close→unregister，任一时刻没有活 socket，bot 卡片/消息等实时推送落 0
 * 个活连接（只能手动切会话经 REST 拉）。修复=删除热切换：token 只在握手校验，established 后不复验，
 * 故刷新时保持主连不动，只更新 tokenRef（下次断线重连才用最新 token）。
 *
 * 本测试锁定该不变量：一次 token 刷新后（session.accessToken 变化并 re-render），
 *   - 不新建任何 RustWebSocket 实例（无抢占连接）
 *   - 原主连未被 close（无 register→close 闪断）且 readyState 仍 OPEN
 *   - connected 保持 true
 * 连刷 3 次同样成立。旧热切换代码下本测试必红（刷新即 instances+1 且原连被 close）。
 *
 * 同时回归「断线仍会重连」，确保删热切换未误伤既有 onclose→指数退避重连路径。
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

// ---- mock RustWebSocket：async onopen（手动触发，贴近生产 ws_connect .then 时序）；
// close() 记录调用并置 CLOSED（不自动 onclose，贴近真实：onclose 来自服务端 close 事件） ----
interface WsLocalOpts { idleTimeoutSecs?: number }
const wsControl = vi.hoisted(() => {
  class FakeRustWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = 0;
    lastActivityAt = Date.now();
    url: string;
    sent: string[] = [];
    closeCalls: Array<{ code?: number; reason?: string }> = [];
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: ((ev?: unknown) => void) | null = null;
    onclose: ((ev: { code: number }) => void) | null = null;
    constructor(url: string, _resolve?: unknown, _localOpts?: WsLocalOpts) {
      this.url = url;
      instances.push(this as unknown as FakeRustWebSocket);
    }
    send(data: string) { this.sent.push(data); }
    close(code?: number, reason?: string) {
      this.closeCalls.push({ code, reason });
      this.readyState = FakeRustWebSocket.CLOSED;
    }
    terminate(code = 4008) {
      this.readyState = FakeRustWebSocket.CLOSED;
      this.onclose?.({ code });
    }
  }
  const instances: FakeRustWebSocket[] = [];
  return { FakeRustWebSocket, instances };
});
vi.mock('../../src/services/rustWebSocket', () => ({ RustWebSocket: wsControl.FakeRustWebSocket }));

const discoveryMock = vi.hoisted(() => ({
  resolveForSecureHttp: () => null,
  getActiveEndpoint: () => ({ domain: 'api.huanvae.cn', ip: '47.105.101.42', port: 443, caPem: '' }),
  rediscoverOnFailure: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/services/discovery', () => discoveryMock);

// MUTABLE session：模拟生产 token 刷新——updateTokens 产出【新的 session 对象】(新 accessToken)
// + api=useMemo([session,...]) 重算（新 api 实例）。测试改 sessionHolder.current 后 rerender，
// provider 重渲染读到新 session/api，session?.accessToken 值变化触发相关 effect。
const sessionHolder = vi.hoisted(() => {
  const makeApi = () => ({ get: vi.fn().mockResolvedValue({}) });
  const base = () => ({
    session: { accessToken: 'token-0', serverUrl: 'https://server', userId: 'me' },
    api: makeApi(),
    clearSession: vi.fn(),
  });
  return { current: base(), makeApi, base };
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
const emptySummary = (): UnreadSummary => ({ total_count: 0, friend_unreads: [], group_unreads: [] });

function newest() { return wsControl.instances[wsControl.instances.length - 1]; }

async function deliverConnected(ws: typeof wsControl.instances[number], sessionId: string) {
  await act(async () => {
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'connected', unread_summary: emptySummary(), session_id: sessionId, event_seq: 1,
      }),
    });
  });
}

async function mountConnected() {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(WebSocketProvider, null, children);
  const hook = renderHook(() => useWebSocket(), { wrapper });
  await act(async () => {}); // flush mount effects（seedReadPositions + connect）
  const ws = newest();
  await act(async () => { ws.readyState = OPEN; ws.onopen?.(); });
  await deliverConnected(ws, 's0'); // 设 sessionIdRef/lastEventSeqRef，贴近稳定态
  return { hook, ws };
}

/** 模拟一次 token 主动刷新：新 session 对象（新 accessToken）+ 新 api，然后 re-render provider */
async function refreshToken(hook: { rerender: () => void }, n: number) {
  sessionHolder.current = {
    session: { ...sessionHolder.current.session, accessToken: `token-${n}` },
    api: sessionHolder.makeApi(),
    clearSession: sessionHolder.current.clearSession,
  };
  await act(async () => { hook.rerender(); });
  await act(async () => {});
}

let randomSpy: MockInstance<() => number>;

beforeEach(() => {
  vi.useFakeTimers();
  randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0); // jitter=0：重连延迟确定
  wsControl.instances.length = 0;
  resetReadPositions();
  mockDb.getConversations.mockResolvedValue([]);
  sessionHolder.current = sessionHolder.base();
});
afterEach(() => {
  randomSpy.mockRestore();
  vi.useRealTimers();
});

describe('token 刷新不重建主连（防闪断回归）', () => {
  it('单次 token 刷新：不新建连接、原主连不被 close、connected 保持', async () => {
    const { hook, ws } = await mountConnected();
    expect(wsControl.instances).toHaveLength(1);
    expect(ws.readyState).toBe(OPEN);

    await refreshToken(hook, 1);

    // 不变量：无抢占连接 + 原主连未 close + 仍 OPEN + connected
    expect(wsControl.instances).toHaveLength(1);        // 旧热切换会 +1（新开 newWs）
    expect(ws.closeCalls).toEqual([]);                  // 旧热切换会 close(1000,'Token refreshed')
    expect(ws.readyState).toBe(OPEN);
    expect(hook.result.current.connected).toBe(true);

    hook.unmount();
  });

  it('连刷 3 次：始终同一条主连，无新建、无 close', async () => {
    const { hook, ws } = await mountConnected();

    for (let n = 1; n <= 3; n++) {
      // eslint-disable-next-line no-await-in-loop
      await refreshToken(hook, n);
      expect(wsControl.instances).toHaveLength(1);
      expect(ws.closeCalls).toEqual([]);
      expect(ws.readyState).toBe(OPEN);
      expect(hook.result.current.connected).toBe(true);
    }

    // 主连仍是最初那条（未被替换）
    expect(newest()).toBe(ws);
    hook.unmount();
  });

  it('token 刷新后新建连接用【最新】token（真机断线重连才建连，此时取 tokenRef 最新值）', async () => {
    const { hook, ws } = await mountConnected();
    await refreshToken(hook, 7);
    // 主连未动
    expect(wsControl.instances).toHaveLength(1);

    // 真实断线 → 既有 onclose→退避重连路径建新连
    await act(async () => { ws.onclose?.({ code: 1006 }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

    expect(wsControl.instances.length).toBeGreaterThan(1); // 重连未被误伤
    const reconn = newest();
    expect(reconn).not.toBe(ws);
    // 新连 URL 携带刷新后的最新 token（tokenRef 已由 refs-sync effect 更新为 token-7）
    expect(reconn.url).toContain('token=token-7');

    hook.unmount();
  });
});

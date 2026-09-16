/**
 * WebSocketProvider.decrementPendingNotification 真实现测试（块 1789554954434-8kvwan3p-1）
 *
 * 验证新增的角标扣减 API 与 clearPendingNotification 同构（functional set）且：
 * - 真实状态被扣减（渲染 probe 读 pendingNotifications）；
 * - floor 0（重复回执/竞态不产生负数）；
 * - 按类型扣减，不影响其他待处理计数；
 * - by 参数（一次扣多个）生效。
 *
 * session=null 挂载 Provider：只走 disconnect() 分支，不建连、不碰 RustWebSocket 实例。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';

const wsMocks = vi.hoisted(() => ({
  handleWebSocketMessage: vi.fn(() => ({})),
  isRemoteControlEnabled: vi.fn(() => false),
}));

vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: vi.fn(() => ({ session: null, api: {}, clearSession: vi.fn() })),
  useApi: vi.fn(() => ({})),
}));
vi.mock('../../src/contexts/wsHandlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/contexts/wsHandlers')>();
  return { ...actual, handleWebSocketMessage: wsMocks.handleWebSocketMessage };
});
vi.mock('../../src/remote-control/devGate', () => ({
  isRemoteControlEnabled: wsMocks.isRemoteControlEnabled,
}));
vi.mock('../../src/remote-control/wsSender', () => ({
  registerControlSessionWsSender: vi.fn(),
}));
vi.mock('../../src/services/rustWebSocket', () => ({
  RustWebSocket: class {
    onOpen = vi.fn();
    onClose = vi.fn();
    onMessage = vi.fn();
    onError = vi.fn();
    connect = vi.fn();
    close = vi.fn();
    send = vi.fn();
    terminate = vi.fn();
  },
}));
vi.mock('../../src/services/discovery', () => ({
  resolveForSecureHttp: vi.fn(() => Promise.resolve('https://stub')),
  rediscoverOnFailure: vi.fn(() => Promise.resolve('https://stub')),
  getActiveEndpoint: vi.fn(() => 'https://stub'),
}));
vi.mock('../../src/services/syncService', () => ({
  setSyncedConversationListener: vi.fn(),
}));
vi.mock('../../src/db', () => ({
  getConversations: vi.fn(() => Promise.resolve([])),
  saveConversation: vi.fn(() => Promise.resolve(undefined)),
  advanceConversationRead: vi.fn(() => Promise.resolve(undefined)),
  markMessageRecalled: vi.fn(() => Promise.resolve(undefined)),
  markMessageDeleted: vi.fn(() => Promise.resolve(undefined)),
  refreshConversationPreview: vi.fn(() => Promise.resolve(undefined)),
  getFriends: vi.fn(() => Promise.resolve([])),
  getGroups: vi.fn(() => Promise.resolve([])),
}));

import { WebSocketProvider, useWebSocket, type PendingNotifications } from '../../src/contexts/WebSocketContext';

beforeEach(() => {
  vi.clearAllMocks();
});

/** 挂真 Provider + 内部 probe：暴露 pendingNotifications 快照与操作句柄 */
function renderProvider() {
  let state: PendingNotifications = { friendRequests: -1, groupInvites: -1, groupJoinRequests: -1 };
  let dec: ((type: keyof PendingNotifications, by?: number) => void) | undefined;
  let ini: ((counts: Partial<PendingNotifications>) => void) | undefined;
  let clr: ((type: keyof PendingNotifications) => void) | undefined;

  /** probe 挂载前调用句柄 = 测试自身错误，直接抛出（避免非空断言） */
  function ready<T>(v: T | undefined): T {
    if (v === undefined) { throw new Error('probe 未挂载（WebSocketProvider 未渲染）'); }
    return v;
  }

  function Probe(): null {
    const ws = useWebSocket();
    state = { ...ws.pendingNotifications };
    dec = ws.decrementPendingNotification;
    ini = ws.initPendingNotifications;
    clr = ws.clearPendingNotification;
    return null;
  }

  renderHook(() => null, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <WebSocketProvider>
        <Probe />
        {children}
      </WebSocketProvider>
    ),
  });

  return {
    get state() { return state; },
    init: (c: Partial<PendingNotifications>) => act(() => { ready(ini)(c); }),
    decrement: (t: keyof PendingNotifications, by?: number) => act(() => { ready(dec)(t, by); }),
    clear: (t: keyof PendingNotifications) => act(() => { ready(clr)(t); }),
  };
}

describe('decrementPendingNotification（真 context 实现）', () => {
  it('扣减真实状态：init 2 → decrement friendRequests → 1', () => {
    const h = renderProvider();
    h.init({ friendRequests: 2, groupInvites: 1 });
    expect(h.state.friendRequests).toBe(2);

    h.decrement('friendRequests');
    expect(h.state.friendRequests).toBe(1);
    expect(h.state.groupInvites).toBe(1); // 其他类型不动
    expect(h.state.groupJoinRequests).toBe(0);
  });

  it('floor 0：重复回执扣减不产生负数', () => {
    const h = renderProvider();
    h.init({ friendRequests: 1 });

    h.decrement('friendRequests');
    h.decrement('friendRequests');
    h.decrement('friendRequests');

    expect(h.state.friendRequests).toBe(0);
  });

  it('by 参数一次扣多个', () => {
    const h = renderProvider();
    h.init({ friendRequests: 5 });

    h.decrement('friendRequests', 3);
    expect(h.state.friendRequests).toBe(2);
  });

  it('与 clearPendingNotification 并存：clear 后 decrement 仍 floor 0', () => {
    const h = renderProvider();
    h.init({ friendRequests: 3 });
    h.clear('friendRequests');
    expect(h.state.friendRequests).toBe(0);

    h.decrement('friendRequests');
    expect(h.state.friendRequests).toBe(0);
  });
});

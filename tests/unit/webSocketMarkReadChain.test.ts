/**
 * markRead 链路集成测试（L2：jsdom + mock RustWebSocket/SessionContext/db，渲染真 WebSocketProvider）
 *
 * 缺陷①（红点点开不消/不稳定）的 WS 发送侧根因回归：
 * - P2：原 markRead 仅 readyState===OPEN 才发帧，否则静默丢弃无队列 → 真机熄屏/切网
 *   socket 假活时 mark_read 进黑洞。契约：离线时暂存（去重）+ 本地照旧清零，
 *   connected 后补发并清空（服务端读位 GREATEST 合并，重发幂等）。
 * - P4：advance 与 updateConversationLastSeq 两条 invoke 链顺序竞态 → 本地读位恒落后。
 *   契约：markRead 带 seq 时 db.advanceConversationRead 收到显式 seq。
 * - P3 接线：HTTP sync 给 activeChat 落新消息 → 经 setSyncedConversationListener 触发
 *   一次 markRead（带最终 seq）；非 activeChat 严禁标读。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---- mock RustWebSocket：可控 readyState/事件，记录 send 帧 ----
const wsControl = vi.hoisted(() => {
  class FakeRustWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = 0;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: ((ev?: unknown) => void) | null = null;
    onclose: ((ev: { code: number }) => void) | null = null;
    constructor() {
      instances.push(this);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      this.readyState = FakeRustWebSocket.CLOSED;
    }
  }
  const instances: InstanceType<typeof FakeRustWebSocket>[] = [];
  return { FakeRustWebSocket, instances };
});
vi.mock('../../src/services/rustWebSocket', () => ({
  RustWebSocket: wsControl.FakeRustWebSocket,
}));

vi.mock('../../src/services/discovery', () => ({
  resolveForSecureHttp: () => null,
}));

vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => ({
    session: { accessToken: 'token', serverUrl: 'https://server', userId: 'me' },
    api: null,
    clearSession: vi.fn(),
  }),
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
import { notifySyncedConversation } from '../../src/services/syncService';
import { resetReadPositions } from '../../src/contexts/readPositions';
import { getFriendConversationId } from '../../src/utils/conversationId';
import type { UnreadSummary } from '../../src/types/websocket';

const ME = 'me';
const OPEN = 1;
const CLOSED = 3;

function markReadFrames(sent: string[]): Array<{ target_type: string; target_id: string }> {
  return sent
    .map(s => JSON.parse(s) as { type: string; target_type: string; target_id: string })
    .filter(f => f.type === 'mark_read');
}

const summaryOf = (friendId: string, unread: number): UnreadSummary => ({
  total_count: unread,
  friend_unreads: [{
    friend_id: friendId,
    unread_count: unread,
    last_message_preview: 'p',
    last_message_time: '2026-06-10T00:00:00Z',
  }],
  group_unreads: [],
});

async function mountConnected() {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(WebSocketProvider, null, children);
  const hook = renderHook(() => useWebSocket(), { wrapper });
  // 等待挂载副作用（读位预载 + connect）完成
  await act(async () => {});
  const ws = wsControl.instances[wsControl.instances.length - 1];
  await act(async () => {
    ws.readyState = OPEN;
    ws.onopen?.();
  });
  return { hook, ws };
}

async function deliverConnected(ws: { onmessage: ((ev: { data: string }) => void) | null }, summary: UnreadSummary) {
  await act(async () => {
    ws.onmessage?.({ data: JSON.stringify({ type: 'connected', unread_summary: summary, session_id: 's1' }) });
  });
}

beforeEach(() => {
  wsControl.instances.length = 0;
  resetReadPositions();
  mockDb.advanceConversationRead.mockClear();
  mockDb.getConversations.mockClear();
  mockDb.getConversations.mockResolvedValue([]);
});

describe('markRead 暂存补发（P2）', () => {
  it('readyState=CLOSED：不发帧、入 pending、本地 summary 仍清零、advance 照做', async () => {
    const { hook, ws } = await mountConnected();
    await deliverConnected(ws, summaryOf('f1', 2));
    expect(hook.result.current.getFriendUnread('f1')).toBe(2);

    const framesBefore = markReadFrames(ws.sent).length;
    ws.readyState = CLOSED; // 模拟假活/断连（无 onclose，socket 引用仍在）

    await act(async () => {
      hook.result.current.markRead('friend', 'f1');
    });

    expect(markReadFrames(ws.sent)).toHaveLength(framesBefore); // 未发帧
    expect(hook.result.current.getFriendUnread('f1')).toBe(0); // 本地照旧清零
    expect(mockDb.advanceConversationRead).toHaveBeenCalledWith(
      getFriendConversationId(ME, 'f1'),
      undefined,
    );

    // 恢复 OPEN + 下一个 connected → 补发暂存帧并清空
    ws.readyState = OPEN;
    await deliverConnected(ws, summaryOf('f1', 0));
    const frames = markReadFrames(ws.sent);
    expect(frames.filter(f => f.target_type === 'friend' && f.target_id === 'f1')).toHaveLength(1);

    // 再来一个 connected：pending 已清空，不重复补发
    await deliverConnected(ws, summaryOf('f1', 0));
    expect(markReadFrames(ws.sent).filter(f => f.target_id === 'f1')).toHaveLength(1);
  });

  it('离线期间同会话多次 markRead 去重为一条补发帧', async () => {
    const { hook, ws } = await mountConnected();
    await deliverConnected(ws, summaryOf('f1', 2));
    ws.readyState = CLOSED;

    await act(async () => {
      hook.result.current.markRead('friend', 'f1');
      hook.result.current.markRead('friend', 'f1', 9);
      hook.result.current.markRead('group', 'g1');
    });
    expect(markReadFrames(ws.sent)).toHaveLength(0);

    ws.readyState = OPEN;
    await deliverConnected(ws, summaryOf('f1', 0));
    const frames = markReadFrames(ws.sent);
    expect(frames).toHaveLength(2); // friend:f1 去重 + group:g1
    expect(frames).toContainEqual(expect.objectContaining({ target_type: 'friend', target_id: 'f1' }));
    expect(frames).toContainEqual(expect.objectContaining({ target_type: 'group', target_id: 'g1' }));
  });

  it('在线（OPEN）时立即发帧，不入 pending', async () => {
    const { hook, ws } = await mountConnected();
    await deliverConnected(ws, summaryOf('f1', 1));

    await act(async () => {
      hook.result.current.markRead('friend', 'f1');
    });
    expect(markReadFrames(ws.sent).filter(f => f.target_id === 'f1')).toHaveLength(1);

    // 下一个 connected 不应重复补发
    await deliverConnected(ws, summaryOf('f1', 0));
    expect(markReadFrames(ws.sent).filter(f => f.target_id === 'f1')).toHaveLength(1);
  });
});

describe('markRead 显式 seq（P4 顺序竞态消除）', () => {
  it('markRead 带 seq → db.advanceConversationRead 收到显式 seq（好友会话 id 拼接正确）', async () => {
    const { hook, ws } = await mountConnected();
    await deliverConnected(ws, summaryOf('f1', 1));

    await act(async () => {
      hook.result.current.markRead('friend', 'f1', 7);
    });
    expect(mockDb.advanceConversationRead).toHaveBeenCalledWith(
      getFriendConversationId(ME, 'f1'),
      7,
    );

    await act(async () => {
      hook.result.current.markRead('group', 'g1', 42);
    });
    expect(mockDb.advanceConversationRead).toHaveBeenCalledWith('g1', 42);
  });

  it('静态契约：两个消息 hook 的 new_message 回调把 msg.seq 传入 markRead（防漏传回归）', () => {
    // 精确字面量匹配（toContain 天然块内有界）：删掉 ", msg.seq" 即 FAIL
    const friendSrc = readFileSync(
      resolve(__dirname, '../../src/chat/friend/useLocalFriendMessages.ts'),
      'utf-8',
    );
    expect(friendSrc).toContain("ws.markRead('friend', msg.source_id, msg.seq);");

    const groupSrc = readFileSync(
      resolve(__dirname, '../../src/chat/group/useLocalGroupMessages.ts'),
      'utf-8',
    );
    expect(groupSrc).toContain("ws.markRead('group', msg.source_id, msg.seq);");
  });
});

describe('sync 补刀接线（P3：仅 activeChat 标读）', () => {
  it('activeChat 命中 → 触发一次 markRead（帧 + advance 带最终 seq）', async () => {
    const { hook, ws } = await mountConnected();
    await deliverConnected(ws, summaryOf('f1', 3));

    await act(async () => {
      hook.result.current.setActiveChat('friend', 'f1');
    });
    mockDb.advanceConversationRead.mockClear();

    await act(async () => {
      notifySyncedConversation(getFriendConversationId(ME, 'f1'), 'friend', 9);
    });

    expect(markReadFrames(ws.sent).filter(f => f.target_id === 'f1')).toHaveLength(1);
    expect(mockDb.advanceConversationRead).toHaveBeenCalledTimes(1);
    expect(mockDb.advanceConversationRead).toHaveBeenCalledWith(
      getFriendConversationId(ME, 'f1'),
      9,
    );
    expect(hook.result.current.getFriendUnread('f1')).toBe(0);
  });

  it('非 activeChat（别的会话 / 类型不符 / 无 activeChat）→ 不标读', async () => {
    const { hook, ws } = await mountConnected();
    await deliverConnected(ws, summaryOf('f1', 3));

    // 无 activeChat
    await act(async () => {
      notifySyncedConversation(getFriendConversationId(ME, 'f1'), 'friend', 9);
    });
    // activeChat = 别的好友
    await act(async () => {
      hook.result.current.setActiveChat('friend', 'f2');
      notifySyncedConversation(getFriendConversationId(ME, 'f1'), 'friend', 9);
    });
    // activeChat 类型不符（群打开着，同步的是好友会话）
    await act(async () => {
      hook.result.current.setActiveChat('group', 'g1');
      notifySyncedConversation(getFriendConversationId(ME, 'f1'), 'friend', 9);
    });

    expect(markReadFrames(ws.sent)).toHaveLength(0);
    expect(mockDb.advanceConversationRead).not.toHaveBeenCalled();
    expect(hook.result.current.getFriendUnread('f1')).toBe(3); // 严禁全局标读
  });
});

describe('connected active 兜底（人停在会话里时读位被快照推回）', () => {
  it('connected 时 activeChat 非空 → 对该会话执行完整 markRead（帧 + 清零 + advance）', async () => {
    const { hook, ws } = await mountConnected();
    await deliverConnected(ws, summaryOf('f1', 2));
    await act(async () => {
      hook.result.current.setActiveChat('friend', 'f1');
    });
    mockDb.advanceConversationRead.mockClear();

    // 重连场景：再来一个 connected，快照仍带 f1 未读（服务端读位落后）
    await deliverConnected(ws, summaryOf('f1', 2));

    expect(markReadFrames(ws.sent).filter(f => f.target_id === 'f1')).toHaveLength(1);
    expect(mockDb.advanceConversationRead).toHaveBeenCalledWith(
      getFriendConversationId(ME, 'f1'),
      undefined,
    );
    expect(hook.result.current.getFriendUnread('f1')).toBe(0); // 快照推回的红点被兜底清掉
  });
});

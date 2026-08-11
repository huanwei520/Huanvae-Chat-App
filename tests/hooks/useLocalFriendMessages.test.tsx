/**
 * useLocalFriendMessages renderHook 行为测试
 *
 * 首次对该 hook 做 renderHook 级行为验证，覆盖：
 *  1. WS append：onNewMessage 订阅接线（过滤 source_type/source_id）+ 头插新消息 + markRead 调用
 *  2. 去重：同 uuid 帧只更新 seq，不新增条目（handleNewMessage 情况1）
 *  3. 乐观替换（API 路径）：sending → API 响应回写 uuid/seq/sendStatus，clientId 保留 + 落库
 *  4. 乐观替换（WS 回显比 API 快）：WS 帧替换 sending 消息（handleNewMessage 情况2）
 *  5. loadMessages 三分支增量合并：缓存历史保留 + db 版本替换（is_recalled 同步）+ 新增追加降序
 *  6. 撤回 handler：onMessageRecalled 订阅接线 → 原地置 is_recalled + 占位文案 + markMessageRecalled
 *
 * mock context hook 返回值均为 vi.hoisted 稳定单例（引用稳定，见 frontend-test.md）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { WsNewMessage, WsMessageRecalled } from '../../src/types/websocket';
import type { Message, SendMessageResponse } from '../../src/types/chat';
import type { LocalMessage } from '../../src/db';

// ============== 共同 mock 骨架（vi.hoisted 稳定单例） ==============

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  patch: vi.fn(),
}));
const sessionMock = vi.hoisted(() => ({
  session: {
    userId: 'me',
    serverUrl: 'http://t',
    accessToken: 't',
    refreshToken: 'r',
    profile: {
      user_id: 'me',
      user_nickname: 'Me',
      user_email: null,
      user_signature: null,
      user_avatar_url: null,
      admin: 'false',
      created_at: '',
      updated_at: '',
    },
  },
}));
vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => sessionMock,
  useApi: () => apiMock,
}));

const wsListeners = vi.hoisted(() => ({
  onNew: new Set<(m: import('../../src/types/websocket').WsNewMessage) => void>(),
  onRecalled: new Set<(m: import('../../src/types/websocket').WsMessageRecalled) => void>(),
}));
const wsMock = vi.hoisted(() => ({
  connected: false,
  onNewMessage: (cb: (m: import('../../src/types/websocket').WsNewMessage) => void) => {
    wsListeners.onNew.add(cb);
    return () => {
      wsListeners.onNew.delete(cb);
    };
  },
  onMessageRecalled: (cb: (m: import('../../src/types/websocket').WsMessageRecalled) => void) => {
    wsListeners.onRecalled.add(cb);
    return () => {
      wsListeners.onRecalled.delete(cb);
    };
  },
  markRead: vi.fn(),
}));
vi.mock('../../src/contexts/WebSocketContext', () => ({ useWebSocket: () => wsMock }));

const dbMock = vi.hoisted(() => ({
  getMessages: vi.fn().mockResolvedValue([]),
  // 定位窗口化新增的两条导出：SUT 会调它们，工厂里不列 ⇒ vitest 直接抛
  // 「No "getMessagesAround" export is defined on the mock」（frontend-test.md 有专条）
  getMessagesAround: vi.fn().mockResolvedValue(null),
  getMessagesAfter: vi.fn().mockResolvedValue([]),
  getConversation: vi.fn().mockResolvedValue(null),
  saveMessage: vi.fn().mockResolvedValue(undefined),
  saveConversation: vi.fn().mockResolvedValue(undefined),
  markMessageRecalled: vi.fn().mockResolvedValue(undefined),
  updateConversationLastSeq: vi.fn().mockResolvedValue(undefined),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
  refreshConversationPreview: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/db', () => dbMock);
vi.mock('../../src/services/syncService', () => ({ getSyncService: () => null }));
vi.mock('../../src/services/fileService', () => ({
  recordUploadedFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (s: string | null | undefined) => s ?? null,
}));

import { useLocalFriendMessages } from '../../src/chat/friend/useLocalFriendMessages';
import { useChatStore } from '../../src/stores/chatStore';

// ============== 帧/数据构造 ==============

function newFrame(overrides: Partial<WsNewMessage> = {}): WsNewMessage {
  return {
    type: 'new_message',
    source_type: 'friend',
    source_id: 'them',
    message_uuid: 'ws-1',
    sender_id: 'them',
    sender_nickname: 'Them',
    content: 'hello-ws',
    message_type: 'text',
    seq: 3,
    timestamp: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

function deliverNew(frame: WsNewMessage) {
  wsListeners.onNew.forEach((cb) => cb(frame));
}

function deliverRecalled(frame: WsMessageRecalled) {
  wsListeners.onRecalled.forEach((cb) => cb(frame));
}

function makeUiMessage(overrides: Partial<Message> = {}): Message {
  return {
    message_uuid: 'u-1',
    sender_id: 'them',
    receiver_id: 'me',
    message_content: 'cached',
    message_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    file_hash: null,
    image_width: null,
    image_height: null,
    send_time: '2026-01-01T00:00:00Z',
    seq: 1,
    is_recalled: false,
    ...overrides,
  };
}

function makeLocalMessage(overrides: Partial<LocalMessage> = {}): LocalMessage {
  return {
    message_uuid: 'l-1',
    conversation_id: 'conv-me-them',
    conversation_type: 'friend',
    sender_id: 'them',
    sender_name: 'Them',
    sender_avatar: null,
    content: 'from-db',
    content_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    file_hash: null,
    image_width: null,
    image_height: null,
    seq: 1,
    reply_to: null,
    media_group_id: null,
    media_group_index: null,
    media_group_count: null,
    is_recalled: false,
    is_deleted: false,
    send_time: '2026-01-01T00:00:00Z',
    created_at: null,
    ...overrides,
  };
}

describe('useLocalFriendMessages — renderHook 行为', () => {
  beforeEach(() => {
    wsListeners.onNew.clear();
    wsListeners.onRecalled.clear();
    useChatStore.setState({
      cachedFriendMessages: {},
      cachedGroupMessages: {},
      groupMessageBlocks: {},
      friendBlacklistTimes: {},
      groupSpecialCares: {},
      friends: [],
    });
  });

  it('WS append：对方新消息头插 + 字段映射 + markRead 以 (friend, them, seq) 调用', () => {
    const { result } = renderHook(() => useLocalFriendMessages('them'));

    act(() => {
      deliverNew(newFrame());
    });

    expect(result.current.messages).toHaveLength(1);
    const m = result.current.messages[0];
    expect(m.message_uuid).toBe('ws-1');
    expect(m.message_content).toBe('hello-ws');
    expect(m.seq).toBe(3);
    expect(m.clientId).toBe('ws_ws-1');
    // 订阅接线契约：hook 内订阅收到匹配帧后同步 markRead
    expect(wsMock.markRead).toHaveBeenCalledWith('friend', 'them', 3);
  });

  it('去重：同 uuid 第二帧只更新 seq，不新增条目', () => {
    const { result } = renderHook(() => useLocalFriendMessages('them'));

    act(() => {
      deliverNew(newFrame({ seq: 3 }));
    });
    act(() => {
      deliverNew(newFrame({ seq: 8 }));
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].message_uuid).toBe('ws-1');
    expect(result.current.messages[0].seq).toBe(8);
  });

  it('乐观替换（API 路径）：sending 临时消息 → API 响应回写 uuid/seq/sent，clientId 保留 + saveMessage 落库', async () => {
    let resolveApi!: (v: SendMessageResponse) => void;
    const pending = new Promise<SendMessageResponse>((r) => {
      resolveApi = r;
    });
    apiMock.post.mockReturnValueOnce(pending);

    const { result } = renderHook(() => useLocalFriendMessages('them'));

    let sendPromise: Promise<void> = Promise.resolve();
    act(() => {
      sendPromise = result.current.sendTextMessage('hi');
    });

    // 乐观阶段
    expect(result.current.messages).toHaveLength(1);
    const optimistic = result.current.messages[0];
    expect(optimistic.sendStatus).toBe('sending');
    expect(optimistic.seq).toBe(0);
    expect(optimistic.message_uuid.startsWith('client_')).toBe(true);
    const originalClientId = optimistic.clientId;
    expect(originalClientId).toBeDefined();
    // 发送接线：走 POST /api/messages
    expect(apiMock.post).toHaveBeenCalledWith(
      '/api/messages',
      expect.objectContaining({ receiver_id: 'them', message_content: 'hi', message_type: 'text' }),
    );

    // API 响应到达
    await act(async () => {
      resolveApi({ message_uuid: 'real-1', send_time: '2026-01-02T00:00:01Z', seq: 7 });
      await sendPromise;
    });

    expect(result.current.messages).toHaveLength(1);
    const sent = result.current.messages[0];
    expect(sent.message_uuid).toBe('real-1');
    expect(sent.sendStatus).toBe('sent');
    expect(sent.seq).toBe(7);
    expect(sent.clientId).toBe(originalClientId);
    expect(dbMock.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      message_uuid: 'real-1',
      seq: 7,
      conversation_type: 'friend',
      conversation_id: 'conv-me-them',
      content: 'hi',
    }));
  });

  it('乐观替换（WS 回显比 API 快）：自己的 WS 帧替换 sending 消息，不产生第二条', async () => {
    let resolveApi!: (v: SendMessageResponse) => void;
    const pending = new Promise<SendMessageResponse>((r) => {
      resolveApi = r;
    });
    apiMock.post.mockReturnValueOnce(pending);

    const { result } = renderHook(() => useLocalFriendMessages('them'));

    let sendPromise: Promise<void> = Promise.resolve();
    act(() => {
      sendPromise = result.current.sendTextMessage('hi');
    });
    expect(result.current.messages[0].sendStatus).toBe('sending');

    // WS 回显先到（sender 是自己）
    act(() => {
      deliverNew(newFrame({
        message_uuid: 'ws-fast',
        sender_id: 'me',
        seq: 9,
        timestamp: '2026-01-02T00:00:02Z',
      }));
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].message_uuid).toBe('ws-fast');
    expect(result.current.messages[0].sendStatus).toBe('sent');
    expect(result.current.messages[0].seq).toBe(9);

    // API 收尾（同 uuid），避免未处理 rejection；仍不产生第二条
    await act(async () => {
      resolveApi({ message_uuid: 'ws-fast', send_time: '2026-01-02T00:00:02Z', seq: 9 });
      await sendPromise;
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].message_uuid).toBe('ws-fast');
  });

  it('loadMessages 增量合并：缓存历史保留 + db 版本替换（撤回同步）+ 新增追加按 send_time 降序', async () => {
    const T1 = '2026-01-01T00:00:00Z';
    const T2 = '2026-01-02T00:00:00Z';
    const T4 = '2026-01-04T00:00:00Z';

    // 缓存里有旧的 2 条（降序 [新→旧]）
    useChatStore.setState({
      cachedFriendMessages: {
        them: [
          makeUiMessage({ message_uuid: 'old-2', send_time: T2, seq: 2 }),
          makeUiMessage({ message_uuid: 'old-1', send_time: T1, seq: 1 }),
        ],
      },
    });

    // db 窗口：新增 new-4 + old-2 的撤回版（离线期间撤回）
    dbMock.getMessages.mockResolvedValueOnce([
      makeLocalMessage({ message_uuid: 'new-4', seq: 4, send_time: T4, content: 'newest' }),
      makeLocalMessage({
        message_uuid: 'old-2',
        seq: 2,
        send_time: T2,
        is_recalled: true,
        content: '[消息已撤回]',
      }),
    ]);

    const { result } = renderHook(() => useLocalFriendMessages('them'));
    // lazy initializer 读到缓存（不被 useEffect 覆盖的字段可同步断言）
    expect(result.current.messages.map((m) => m.message_uuid)).toEqual(['old-2', 'old-1']);

    await act(async () => {
      await result.current.loadMessages();
    });

    expect(dbMock.getMessages).toHaveBeenCalledWith('conv-me-them', 50);
    expect(result.current.messages.map((m) => m.message_uuid)).toEqual(['new-4', 'old-2', 'old-1']);
    // db 是 SSOT：old-2 被 db 撤回版替换
    expect(result.current.messages[1].is_recalled).toBe(true);
    expect(result.current.messages[1].message_content).toBe('[消息已撤回]');
    // 不在 db 窗口的 old-1 保留缓存版（loadMore 历史不丢）
    expect(result.current.messages[2].is_recalled).toBe(false);
    expect(result.current.messages[2].message_content).toBe('cached');
  });

  // 这条钉的是「DB→UI 转换段」的行为（此前只有静态契约覆盖，而缺陷正好出在这一段）：
  // localMessageToMessage 若漏写 reply_to / 三件套，从 db 读出来的消息就没有引用块、
  // 相册也散成 N 条独立图 —— 且**不报任何错**。
  it('DB→UI 转换：reply_to 与相册三件套必须原样带到 UI Message', async () => {
    dbMock.getMessages.mockResolvedValueOnce([
      makeLocalMessage({
        message_uuid: 'quoted',
        seq: 9,
        reply_to: 'orig-uuid',
        content: '这是一条回复',
      }),
      makeLocalMessage({
        message_uuid: 'album-0',
        seq: 8,
        content_type: 'image',
        media_group_id: 'grp-1',
        media_group_index: 0,
        media_group_count: 3,
      }),
    ]);

    const { result } = renderHook(() => useLocalFriendMessages('them'));
    await act(async () => {
      await result.current.loadMessages();
    });

    const quoted = result.current.messages.find((m) => m.message_uuid === 'quoted');
    expect(quoted?.reply_to).toBe('orig-uuid');

    const albumItem = result.current.messages.find((m) => m.message_uuid === 'album-0');
    expect(albumItem?.media_group_id).toBe('grp-1');
    expect(albumItem?.media_group_index).toBe(0);
    expect(albumItem?.media_group_count).toBe(3);
  });

  it('撤回 handler：onMessageRecalled 帧 → 原地 is_recalled + 占位文案 + markMessageRecalled 落库', () => {
    const { result } = renderHook(() => useLocalFriendMessages('them'));

    act(() => {
      deliverNew(newFrame());
    });
    expect(result.current.messages[0].is_recalled).toBe(false);

    act(() => {
      deliverRecalled({
        type: 'message_recalled',
        source_type: 'friend',
        source_id: 'them',
        message_uuid: 'ws-1',
        recalled_by: 'them',
      });
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].is_recalled).toBe(true);
    expect(result.current.messages[0].message_content).toBe('[消息已撤回]');
    expect(dbMock.markMessageRecalled).toHaveBeenCalledWith('ws-1');
  });
});

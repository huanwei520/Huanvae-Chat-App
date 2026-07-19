/**
 * useLocalGroupMessages renderHook 行为测试
 *
 * 与 useLocalFriendMessages.test.tsx 同构 6 用例（source_type:'group'、source_id:'g-1'），
 * 另加 1 条进群接线用例：mount 后 getGroupMessageBlocks / getGroupSpecialCares /
 * getGroupMemberRemarks 各被以 (api, groupId) 调用。
 *
 * mock context hook 返回值均为 vi.hoisted 稳定单例（引用稳定，见 frontend-test.md）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { WsNewMessage, WsMessageRecalled } from '../../src/types/websocket';
import type { GroupMessage, SendGroupMessageResponse } from '../../src/api/groupMessages';
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

// 群 hook 额外：进群拉取三接口
const groupsApiMock = vi.hoisted(() => ({
  getGroupMessageBlocks: vi.fn().mockResolvedValue([]),
  getGroupSpecialCares: vi.fn().mockResolvedValue([]),
  getGroupMemberRemarks: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/api/groups', () => groupsApiMock);

import { useLocalGroupMessages } from '../../src/chat/group/useLocalGroupMessages';
import { useChatStore } from '../../src/stores/chatStore';

// ============== 帧/数据构造 ==============

function newFrame(overrides: Partial<WsNewMessage> = {}): WsNewMessage {
  return {
    type: 'new_message',
    source_type: 'group',
    source_id: 'g-1',
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

function makeGroupMessage(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    message_uuid: 'u-1',
    group_id: 'g-1',
    sender_id: 'them',
    sender_nickname: 'Them',
    sender_avatar_url: '',
    message_content: 'cached',
    message_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    file_hash: null,
    image_width: null,
    image_height: null,
    reply_to: null,
    send_time: '2026-01-01T00:00:00Z',
    is_recalled: false,
    seq: 1,
    ...overrides,
  };
}

function makeLocalMessage(overrides: Partial<LocalMessage> = {}): LocalMessage {
  return {
    message_uuid: 'l-1',
    conversation_id: 'g-1',
    conversation_type: 'group',
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
    is_recalled: false,
    is_deleted: false,
    send_time: '2026-01-01T00:00:00Z',
    created_at: null,
    ...overrides,
  };
}

describe('useLocalGroupMessages — renderHook 行为', () => {
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

  it('WS append：群新消息头插 + 字段映射 + markRead 以 (group, g-1, seq) 调用', () => {
    const { result } = renderHook(() => useLocalGroupMessages('g-1'));

    act(() => {
      deliverNew(newFrame());
    });

    expect(result.current.messages).toHaveLength(1);
    const m = result.current.messages[0];
    expect(m.message_uuid).toBe('ws-1');
    expect(m.group_id).toBe('g-1');
    expect(m.message_content).toBe('hello-ws');
    expect(m.sender_nickname).toBe('Them');
    expect(m.seq).toBe(3);
    expect(m.clientId).toBe('ws_ws-1');
    expect(wsMock.markRead).toHaveBeenCalledWith('group', 'g-1', 3);
  });

  it('去重：同 uuid 第二帧只更新 seq，不新增条目', () => {
    const { result } = renderHook(() => useLocalGroupMessages('g-1'));

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
    let resolveApi!: (v: SendGroupMessageResponse) => void;
    const pending = new Promise<SendGroupMessageResponse>((r) => {
      resolveApi = r;
    });
    apiMock.post.mockReturnValueOnce(pending);

    const { result } = renderHook(() => useLocalGroupMessages('g-1'));

    let sendPromise: Promise<void> = Promise.resolve();
    act(() => {
      sendPromise = result.current.sendTextMessage('hi');
    });

    expect(result.current.messages).toHaveLength(1);
    const optimistic = result.current.messages[0];
    expect(optimistic.sendStatus).toBe('sending');
    expect(optimistic.seq).toBe(0);
    expect(optimistic.message_uuid.startsWith('client_')).toBe(true);
    const originalClientId = optimistic.clientId;
    expect(originalClientId).toBeDefined();
    // 发送接线：走 POST /api/group_messages
    expect(apiMock.post).toHaveBeenCalledWith(
      '/api/group_messages',
      expect.objectContaining({ group_id: 'g-1', message_content: 'hi', message_type: 'text' }),
    );

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
      conversation_type: 'group',
      conversation_id: 'g-1',
      content: 'hi',
    }));
  });

  it('乐观替换（WS 回显比 API 快）：自己的 WS 帧替换 sending 消息，不产生第二条', async () => {
    let resolveApi!: (v: SendGroupMessageResponse) => void;
    const pending = new Promise<SendGroupMessageResponse>((r) => {
      resolveApi = r;
    });
    apiMock.post.mockReturnValueOnce(pending);

    const { result } = renderHook(() => useLocalGroupMessages('g-1'));

    let sendPromise: Promise<void> = Promise.resolve();
    act(() => {
      sendPromise = result.current.sendTextMessage('hi');
    });
    expect(result.current.messages[0].sendStatus).toBe('sending');

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

    useChatStore.setState({
      cachedGroupMessages: {
        'g-1': [
          makeGroupMessage({ message_uuid: 'old-2', send_time: T2, seq: 2 }),
          makeGroupMessage({ message_uuid: 'old-1', send_time: T1, seq: 1 }),
        ],
      },
    });

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

    const { result } = renderHook(() => useLocalGroupMessages('g-1'));
    expect(result.current.messages.map((m) => m.message_uuid)).toEqual(['old-2', 'old-1']);

    await act(async () => {
      await result.current.loadMessages();
    });

    expect(dbMock.getMessages).toHaveBeenCalledWith('g-1', 50);
    expect(result.current.messages.map((m) => m.message_uuid)).toEqual(['new-4', 'old-2', 'old-1']);
    expect(result.current.messages[1].is_recalled).toBe(true);
    expect(result.current.messages[1].message_content).toBe('[消息已撤回]');
    expect(result.current.messages[2].is_recalled).toBe(false);
    expect(result.current.messages[2].message_content).toBe('cached');
  });

  it('撤回 handler：onMessageRecalled 帧 → 原地 is_recalled + 占位文案 + markMessageRecalled 落库', () => {
    const { result } = renderHook(() => useLocalGroupMessages('g-1'));

    act(() => {
      deliverNew(newFrame());
    });
    expect(result.current.messages[0].is_recalled).toBe(false);

    act(() => {
      deliverRecalled({
        type: 'message_recalled',
        source_type: 'group',
        source_id: 'g-1',
        message_uuid: 'ws-1',
        recalled_by: 'them',
      });
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].is_recalled).toBe(true);
    expect(result.current.messages[0].message_content).toBe('[消息已撤回]');
    expect(dbMock.markMessageRecalled).toHaveBeenCalledWith('ws-1');
  });

  it('进群接线：mount 后三个群私有视图接口各被以 (api, groupId) 调用', async () => {
    renderHook(() => useLocalGroupMessages('g-1'));
    // flush 三个 .then（写 zustand store）
    await act(async () => {});

    expect(groupsApiMock.getGroupMessageBlocks).toHaveBeenCalledWith(apiMock, 'g-1');
    expect(groupsApiMock.getGroupSpecialCares).toHaveBeenCalledWith(apiMock, 'g-1');
    expect(groupsApiMock.getGroupMemberRemarks).toHaveBeenCalledWith(apiMock, 'g-1');
  });
});

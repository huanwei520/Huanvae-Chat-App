/**
 * 三条消息写入路径的 sender_name 一致性测试（D4 昵称混显收口）
 *
 * 契约（src/utils/senderName.ts）：同一条服务端消息经三条写入路径落库，
 * sender_name 必须相同 —— 都走同一个 resolveSenderName，不允许各写各的三元表达式。
 *
 * 三条路径：
 * 1. 历史加载 historyService.loadAllHistoryMessages
 *    （好友分支契约不下发 sender_nickname；群分支 sender_nickname 必填）
 * 2. HTTP 增量同步 syncService.toLocalMessage（经 SyncService.syncMessages 真跑）
 * 3. WebSocket 推送 wsHandlers.saveMessageToLocal
 *
 * 数据源一致性：历史/同步路径的资料回退读 db.getFriends()；WS 路径读
 * chatStore.friends（内存）。两处喂同一份好友资料 ⇒ 三路结果必须一致。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../../src/api/client';

const dbMock = vi.hoisted(() => ({
  saveMessages: vi.fn().mockResolvedValue(undefined),
  saveMessagesSkipExisting: vi.fn().mockResolvedValue(undefined),
  saveMessage: vi.fn().mockResolvedValue(undefined),
  saveConversation: vi.fn().mockResolvedValue(undefined),
  getConversation: vi.fn().mockResolvedValue({ id: 'conv', last_seq: 0 }),
  getLatestMessage: vi.fn().mockResolvedValue(null),
  updateConversationLastSeq: vi.fn().mockResolvedValue(undefined),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
  getFriends: vi.fn().mockResolvedValue([]),
}));

/** 历史接口（historyService 从 api/messages、api/groupMessages 导入，不在 db 里） */
const apiMock = vi.hoisted(() => ({
  getMessages: vi.fn(),
  getGroupMessages: vi.fn(),
}));

vi.mock('../../src/db', () => dbMock);
vi.mock('../../src/api/messages', () => ({ getMessages: apiMock.getMessages }));
vi.mock('../../src/api/groupMessages', () => ({ getGroupMessages: apiMock.getGroupMessages }));
vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (u: string | null | undefined) => u ?? null,
}));
vi.mock('../../src/services/notificationService', () => ({
  notifyNewMessage: vi.fn().mockResolvedValue(undefined),
  notifySystemEvent: vi.fn(),
}));

import { loadAllHistoryMessages } from '../../src/services/historyService';
import { SyncService } from '../../src/services/syncService';
import { saveMessageToLocal } from '../../src/contexts/wsHandlers';
import { useChatStore } from '../../src/stores';
import type { LocalConversation } from '../../src/db';

const ME = 'user-a';
const PEER = 'user-c';

/** 本地好友资料（历史/同步路径 db.getFriends 的返回） */
const FRIENDS = [
  {
    friend_id: PEER,
    username: PEER,
    nickname: '李四',
    avatar_url: null,
    status: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: null,
  },
];

/** 同一份资料的 UI 形态（WS 路径读 chatStore.friends） */
const CHAT_FRIENDS = [
  {
    friend_id: PEER,
    friend_nickname: '李四',
    friend_avatar_url: null,
    add_time: '2026-01-01T00:00:00Z',
    approve_reason: null,
    friend_remark: null,
    is_blacklisted: false,
    is_special_care: false,
  },
];

const friendConvId = 'conv-user-a-user-c'; // getFriendConversationId(ME, PEER) 的字典序结果

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeApi: any = {};

/** 便捷构造：LocalConversation（sync 入参） */
const conv = (id: string, type: 'friend' | 'group', lastSeq = 0): LocalConversation => ({
  id,
  type,
  name: 'x',
  avatar_url: null,
  last_message: null,
  last_message_time: null,
  last_seq: lastSeq,
  last_read_seq: 0,
  unread_count: 0,
  is_muted: false,
  is_pinned: false,
  updated_at: '2026-01-01T00:00:00Z',
  synced_at: null,
});

/** 好友历史加载一行（契约：GET /api/messages 无 sender_nickname 字段） */
const friendHistoryMsg = (uuid: string, senderId: string) => ({
  message_uuid: uuid,
  sender_id: senderId,
  receiver_id: ME,
  message_content: 'hello',
  message_type: 'text',
  file_uuid: null,
  file_url: null,
  file_size: null,
  reply_to: null,
  media_group_id: null,
  media_group_index: null,
  media_group_count: null,
  seq: 1,
  is_recalled: false,
  send_time: '2026-01-01T00:00:00Z',
});

/** 群历史加载一行（契约：sender_nickname 必填） */
const groupHistoryMsg = (uuid: string, senderId: string, nickname: string) => ({
  message_uuid: uuid,
  group_id: 'g1',
  sender_id: senderId,
  sender_nickname: nickname,
  sender_avatar_url: '',
  message_content: 'hello',
  message_type: 'text' as const,
  file_uuid: null,
  file_url: null,
  file_size: null,
  reply_to: null,
  media_group_id: null,
  media_group_index: null,
  media_group_count: null,
  seq: 1,
  is_recalled: false,
  send_time: '2026-01-01T00:00:00Z',
});

/** sync ServerMessage（sender_nickname 可选，与 syncService.ts 类型一致） */
const syncMsg = (uuid: string, senderId: string, nickname?: string) => ({
  message_uuid: uuid,
  sender_id: senderId,
  ...(nickname !== undefined ? { sender_nickname: nickname } : {}),
  message_content: 'hello',
  message_type: 'text',
  seq: 1,
  reply_to: null,
  media_group_id: null,
  media_group_index: null,
  media_group_count: null,
  send_time: '2026-01-01T00:00:00Z',
});

/** WS new_message 推送 */
const wsMsg = (uuid: string, senderId: string, sourceType: 'friend' | 'group', nickname: string) => ({
  type: 'new_message' as const,
  source_type: sourceType,
  source_id: sourceType === 'friend' ? PEER : 'g1',
  message_uuid: uuid,
  sender_id: senderId,
  sender_nickname: nickname,
  content: 'hello',
  message_type: 'text' as const,
  seq: 1,
  timestamp: '2026-01-01T00:00:00Z',
});

/** 三条路径各跑一遍同一情景，返回各自落库的 sender_name */
async function writeThroughThreePaths(opts: {
  friend?: boolean;
  group?: boolean;
  serverNickname?: string;
}) {
  // ── 路径 1：历史加载 ──
  let historySenderName: string | null = null;
  if (opts.friend) {
    apiMock.getMessages.mockResolvedValueOnce({
      messages: [friendHistoryMsg('h-f1', PEER)],
    });
    await loadAllHistoryMessages(fakeApi, PEER, 'friend', ME, () => {});
    historySenderName = dbMock.saveMessagesSkipExisting.mock.calls[dbMock.saveMessagesSkipExisting.mock.calls.length - 1][0][0].sender_name;
  } else {
    apiMock.getGroupMessages.mockResolvedValueOnce({
      messages: [groupHistoryMsg('h-g1', PEER, opts.serverNickname ?? '')],
    });
    await loadAllHistoryMessages(fakeApi, 'g1', 'group', ME, () => {});
    historySenderName = dbMock.saveMessagesSkipExisting.mock.calls[dbMock.saveMessagesSkipExisting.mock.calls.length - 1][0][0].sender_name;
  }

  // ── 路径 2：HTTP 增量同步（真跑 SyncService.syncMessages）──
  const post = vi.fn();
  post.mockResolvedValue({
    conversations: [
      {
        conversation_id: opts.friend ? friendConvId : 'g1',
        conversation_type: opts.friend ? 'friend' : 'group',
        messages: [syncMsg('s-1', PEER, opts.friend ? undefined : opts.serverNickname)],
        latest_seq: 1,
        has_more: false,
      },
    ],
  });
  const sync = new SyncService({ post } as unknown as ApiClient);
  await sync.syncMessages([conv(opts.friend ? friendConvId : 'g1', opts.friend ? 'friend' : 'group')]);
  const syncSenderName = dbMock.saveMessages.mock.calls[dbMock.saveMessages.mock.calls.length - 1][0][0].sender_name as string | null;

  // ── 路径 3：WebSocket 推送 ──
  await saveMessageToLocal(
    wsMsg('w-1', PEER, opts.friend ? 'friend' : 'group', opts.friend ? '' : opts.serverNickname ?? ''),
    ME,
  );
  const wsSenderName = dbMock.saveMessage.mock.calls[dbMock.saveMessage.mock.calls.length - 1][0].sender_name as string | null;

  return { historySenderName, syncSenderName, wsSenderName };
}

describe('三条消息写入路径的 sender_name 一致性（D4）', () => {
  beforeEach(() => {
    Object.values(dbMock).forEach(fn => fn.mockReset());
    dbMock.getConversation.mockResolvedValue({ id: 'conv', last_seq: 0 });
    dbMock.getLatestMessage.mockResolvedValue(null);
    dbMock.getFriends.mockResolvedValue(FRIENDS);
    dbMock.saveMessages.mockResolvedValue(undefined);
    dbMock.saveMessagesSkipExisting.mockResolvedValue(undefined);
    dbMock.saveMessage.mockResolvedValue(undefined);
    dbMock.updateConversationLastSeq.mockResolvedValue(undefined);
    dbMock.updateConversationLastMessage.mockResolvedValue(undefined);
    // WS 路径的资料回退源：chatStore.friends（与 db.getFriends 同一份资料）
    useChatStore.setState({ friends: CHAT_FRIENDS });
  });

  it('群消息：服务端昵称非空 → 三条路径都落服务端昵称', async () => {
    const r = await writeThroughThreePaths({ group: true, serverNickname: '张三' });
    expect(r.historySenderName).toBe('张三');
    expect(r.syncSenderName).toBe('张三');
    expect(r.wsSenderName).toBe('张三');
    expect(new Set([r.historySenderName, r.syncSenderName, r.wsSenderName]).size).toBe(1);
  });

  it('群消息：服务端昵称空白 → 三条路径都回退本地好友资料昵称', async () => {
    const r = await writeThroughThreePaths({ group: true, serverNickname: '   ' });
    expect(r.historySenderName).toBe('李四');
    expect(r.syncSenderName).toBe('李四');
    expect(r.wsSenderName).toBe('李四');
    expect(new Set([r.historySenderName, r.syncSenderName, r.wsSenderName]).size).toBe(1);
  });

  it('群消息：服务端昵称空白且本地无资料 → 三条路径都落 null（显示层兜底）', async () => {
    dbMock.getFriends.mockResolvedValue([]);
    useChatStore.setState({ friends: [] });
    const r = await writeThroughThreePaths({ group: true, serverNickname: '' });
    expect(r.historySenderName).toBeNull();
    expect(r.syncSenderName).toBeNull();
    expect(r.wsSenderName).toBeNull();
  });

  it('好友消息：历史契约无 sender_nickname → 与同步/WS 一样回退好友资料昵称', async () => {
    const r = await writeThroughThreePaths({ friend: true });
    expect(r.historySenderName).toBe('李四');
    expect(r.syncSenderName).toBe('李四');
    expect(r.wsSenderName).toBe('李四');
    expect(new Set([r.historySenderName, r.syncSenderName, r.wsSenderName]).size).toBe(1);
  });
});

describe('好友历史分支：自己发的行回退 selfNickname（昵称优先链不变）', () => {
  beforeEach(() => {
    Object.values(dbMock).forEach(fn => fn.mockReset());
    dbMock.getConversation.mockResolvedValue({ id: friendConvId, last_seq: 0 });
    dbMock.getLatestMessage.mockResolvedValue(null);
    dbMock.getFriends.mockResolvedValue(FRIENDS);
    dbMock.saveMessagesSkipExisting.mockResolvedValue(undefined);
    dbMock.updateConversationLastSeq.mockResolvedValue(undefined);
  });

  it('传 selfNickname → 自己那行 sender_name = 登录 profile 昵称', async () => {
    apiMock.getMessages.mockResolvedValueOnce({
      messages: [friendHistoryMsg('h-own', ME)],
    });
    await loadAllHistoryMessages(fakeApi, PEER, 'friend', ME, () => {}, '我自己');
    const rows = dbMock.saveMessagesSkipExisting.mock.calls[0][0];
    expect(rows[0].sender_id).toBe(ME);
    expect(rows[0].sender_name).toBe('我自己');
  });

  it('不传 selfNickname（向后兼容）→ 自己那行 sender_name = null，他人行仍回退资料', async () => {
    apiMock.getMessages.mockResolvedValueOnce({
      messages: [friendHistoryMsg('h-own2', ME), friendHistoryMsg('h-peer', PEER)],
    });
    await loadAllHistoryMessages(fakeApi, PEER, 'friend', ME, () => {});
    const rows = dbMock.saveMessagesSkipExisting.mock.calls[0][0];
    expect(rows[0].sender_name).toBeNull();
    expect(rows[1].sender_name).toBe('李四');
  });
});

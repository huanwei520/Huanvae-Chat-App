/**
 * syncService 已读位置转发通道测试（L2：mock db，控制 api.post 返回）
 *
 * 已读管线重构（F1）契约：
 * - opts.withReadPositions=true → 请求每个会话项带 with_read_positions:true；不传 → 不带。
 * - 响应 conversation 带 read_positions → notifyReadPositions 转发（friend / group 分型）；
 *   与"有无新消息"无关（即便无新消息、已读位置仍可能推进，需照常转发）。
 * - 响应不带 read_positions（批量启动同步）→ 不转发。
 *
 * 转发目标（useGroup/FriendReadReceipt 订阅）经 subscribeReadPositions 接收。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => ({
  saveMessages: vi.fn().mockResolvedValue(undefined),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
  updateConversationLastSeq: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/db', () => mockDb);

import { SyncService, subscribeReadPositions } from '../../src/services/syncService';
import type { ConversationReadPositions } from '../../src/services/syncService';
import type { LocalConversation } from '../../src/db';

interface ApiConvResult {
  conversation_id: string;
  conversation_type: 'friend' | 'group';
  messages: Array<{
    message_uuid: string;
    sender_id: string;
    message_content: string;
    message_type: string;
    seq: number;
    send_time: string;
  }>;
  latest_seq: number;
  has_more: boolean;
  read_positions?: unknown;
}

function makeApi(conversations: ApiConvResult[]) {
  const post = vi.fn().mockResolvedValue({ conversations });
  return {
    post,
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    getBaseUrl: () => 'http://localhost:8080',
    getAccessToken: () => 'token',
  };
}

const baseConv = (id: string, type: 'friend' | 'group', lastSeq: number): LocalConversation => ({
  id,
  type,
  name: 'test',
  avatar_url: null,
  last_message: null,
  last_message_time: null,
  last_seq: lastSeq,
  unread_count: 0,
  last_read_seq: 0,
  is_muted: false,
  is_pinned: false,
  updated_at: '2026-01-01T00:00:00Z',
  synced_at: null,
});

beforeEach(() => {
  mockDb.saveMessages.mockClear();
  mockDb.updateConversationLastMessage.mockClear();
  mockDb.updateConversationLastSeq.mockClear();
});

describe('syncService 已读位置转发通道', () => {
  it('withReadPositions=true → 请求带 with_read_positions:true', async () => {
    const api = makeApi([
      { conversation_id: 'conv-a', conversation_type: 'friend', messages: [], latest_seq: 0, has_more: false },
    ]);
    const svc = new SyncService(api as never);

    await svc.syncMessages([baseConv('conv-a', 'friend', 0)], { withReadPositions: true });

    const body = api.post.mock.calls[0][1] as { conversations: Array<{ with_read_positions?: boolean }> };
    expect(body.conversations[0].with_read_positions).toBe(true);
  });

  it('不传 opts（批量启动同步）→ 请求不带 with_read_positions', async () => {
    const api = makeApi([
      { conversation_id: 'conv-a', conversation_type: 'friend', messages: [], latest_seq: 0, has_more: false },
    ]);
    const svc = new SyncService(api as never);

    await svc.syncMessages([baseConv('conv-a', 'friend', 0)]);

    const body = api.post.mock.calls[0][1] as { conversations: Array<{ with_read_positions?: boolean }> };
    expect(body.conversations[0].with_read_positions).toBeUndefined();
  });

  it('响应带 friend read_positions → 转发 friend 快照（即使无新消息也转发）', async () => {
    const api = makeApi([
      {
        conversation_id: 'conv-a',
        conversation_type: 'friend',
        messages: [],
        latest_seq: 5,
        has_more: false,
        read_positions: { my_last_read_seq: 5, peer_last_read_seq: 3 },
      },
    ]);
    const svc = new SyncService(api as never);

    const received: ConversationReadPositions[] = [];
    const unsub = subscribeReadPositions((p) => received.push(p));

    await svc.syncMessages([baseConv('conv-a', 'friend', 5)], { withReadPositions: true });
    unsub();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      type: 'friend',
      conversationId: 'conv-a',
      data: { my_last_read_seq: 5, peer_last_read_seq: 3 },
    });
    // 无新消息（messages 空）也照常转发
    expect(mockDb.saveMessages).not.toHaveBeenCalled();
  });

  it('响应带 group read_positions → 转发 group 快照', async () => {
    const groupSnapshot = {
      positions: [
        { user_id: 'u1', last_read_seq: 10, display_name: '张三', avatar_url: 'a.png', last_read_at: null },
      ],
      member_count: 5,
    };
    const api = makeApi([
      {
        conversation_id: 'group-1',
        conversation_type: 'group',
        messages: [],
        latest_seq: 10,
        has_more: false,
        read_positions: groupSnapshot,
      },
    ]);
    const svc = new SyncService(api as never);

    const received: ConversationReadPositions[] = [];
    const unsub = subscribeReadPositions((p) => received.push(p));

    await svc.syncMessages([baseConv('group-1', 'group', 10)], { withReadPositions: true });
    unsub();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ type: 'group', conversationId: 'group-1', data: groupSnapshot });
  });

  it('响应不带 read_positions → 不转发', async () => {
    const api = makeApi([
      { conversation_id: 'conv-a', conversation_type: 'friend', messages: [], latest_seq: 0, has_more: false },
    ]);
    const svc = new SyncService(api as never);

    const received: ConversationReadPositions[] = [];
    const unsub = subscribeReadPositions((p) => received.push(p));

    await svc.syncMessages([baseConv('conv-a', 'friend', 0)]);
    unsub();

    expect(received).toHaveLength(0);
  });

  it('退订后不再收到转发', async () => {
    const api = makeApi([
      {
        conversation_id: 'conv-a',
        conversation_type: 'friend',
        messages: [],
        latest_seq: 5,
        has_more: false,
        read_positions: { my_last_read_seq: 5, peer_last_read_seq: 3 },
      },
    ]);
    const svc = new SyncService(api as never);

    const received: ConversationReadPositions[] = [];
    const unsub = subscribeReadPositions((p) => received.push(p));
    unsub();

    await svc.syncMessages([baseConv('conv-a', 'friend', 5)], { withReadPositions: true });

    expect(received).toHaveLength(0);
  });
});

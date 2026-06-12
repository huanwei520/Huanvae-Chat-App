/**
 * syncService 增量门测试
 *
 * 覆盖 services/syncService.ts 的 syncMessages 在收到"实际并不新"的消息时
 * 必须不写入数据库（避免触发 schedulePreviewNotify → PREVIEW_CHANGED_EVENT
 * → useLocalConversations.loadConversations → cards 重排）。
 *
 * 这是修复"每次登录都看到会话卡片重排（哪怕没有新消息）"的关键守门测试。
 *
 * 失败示例（修复前）：
 *   - 服务端返回 messages: [{seq: 5, ...}]，本地 conversation.last_seq = 5
 *   - 老代码无视 seq 比对，直接 db.saveMessages([{seq:5}]) +
 *     db.updateConversationLastMessage(...) → 触发预览事件 → cards 重测量动画
 *
 * 修复后：
 *   - syncMessages 客户端按 last_seq 二次过滤；message.seq <= localLastSeq 全部丢弃
 *   - newMessages.length === 0 → 跳过 saveMessages + updateConversationLastMessage
 *   - 仍可能调用 updateConversationLastSeq（不触发预览事件，安全）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1) Mock db 全部相关函数 —— 关键是 saveMessages / updateConversationLastMessage
const mockDb = vi.hoisted(() => ({
  saveMessages: vi.fn().mockResolvedValue(undefined),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
  updateConversationLastSeq: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/db', () => mockDb);

// 2) Mock avatar resolver（不应影响测试逻辑）
vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (s: string | null | undefined) => s ?? null,
}));

// 3) ApiClient 的 post 由测试控制返回
type SyncResp = {
  conversations: Array<{
    conversation_id: string;
    conversation_type: 'friend' | 'group';
    messages: Array<{
      message_uuid: string;
      sender_id: string;
      message_content: string;
      message_type: string;
      seq: number;
      send_time: string;
      is_recalled?: boolean;
    }>;
    latest_seq: number;
    has_more: boolean;
  }>;
};

function makeApi(resp: SyncResp) {
  return {
    post: vi.fn().mockResolvedValue(resp),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    getBaseUrl: () => 'http://localhost:8080',
    getAccessToken: () => 'token',
  };
}

import { SyncService } from '../../src/services/syncService';
import type { LocalConversation } from '../../src/db';

const baseConv = (id: string, lastSeq: number): LocalConversation => ({
  id,
  type: 'friend',
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

const baseMsg = (seq: number) => ({
  message_uuid: `uuid-${seq}`,
  sender_id: 'sender-1',
  message_content: `msg ${seq}`,
  message_type: 'text',
  seq,
  send_time: `2026-01-01T00:00:0${seq}Z`,
});

describe('syncService 增量门：仅在 server seq > local last_seq 时才写入', () => {
  beforeEach(() => {
    mockDb.saveMessages.mockClear();
    mockDb.updateConversationLastMessage.mockClear();
    mockDb.updateConversationLastSeq.mockClear();
  });

  it('服务端返回的消息全部 seq <= 本地 last_seq → 不调 saveMessages/updateConversationLastMessage', async () => {
    const api = makeApi({
      conversations: [
        {
          conversation_id: 'conv-A',
          conversation_type: 'friend',
          messages: [baseMsg(3), baseMsg(5)],
          latest_seq: 5,
          has_more: false,
        },
      ],
    });
    const svc = new SyncService(api as never);

    const result = await svc.syncMessages([baseConv('conv-A', 5)]);

    expect(mockDb.saveMessages).not.toHaveBeenCalled();
    expect(mockDb.updateConversationLastMessage).not.toHaveBeenCalled();
    expect(result.newMessagesCount).toBe(0);
    expect(result.updatedConversations).toEqual([]);
  });

  it('服务端返回的消息中只有部分 seq > local last_seq → 仅保存新部分 + 用过滤后最末条更新预览', async () => {
    const api = makeApi({
      conversations: [
        {
          conversation_id: 'conv-B',
          conversation_type: 'friend',
          messages: [baseMsg(3), baseMsg(4), baseMsg(5), baseMsg(6)],
          latest_seq: 6,
          has_more: false,
        },
      ],
    });
    const svc = new SyncService(api as never);

    const result = await svc.syncMessages([baseConv('conv-B', 4)]);

    expect(mockDb.saveMessages).toHaveBeenCalledTimes(1);
    const saved = mockDb.saveMessages.mock.calls[0][0] as Array<{ seq: number }>;
    expect(saved.map(m => m.seq)).toEqual([5, 6]);

    expect(mockDb.updateConversationLastMessage).toHaveBeenCalledTimes(1);
    expect(mockDb.updateConversationLastMessage).toHaveBeenCalledWith(
      'conv-B',
      'msg 6',
      '2026-01-01T00:00:06Z',
    );
    expect(result.newMessagesCount).toBe(2);
    expect(result.updatedConversations).toEqual(['conv-B']);
  });

  it('全部消息都新（local last_seq = 0）→ 全量保存', async () => {
    const api = makeApi({
      conversations: [
        {
          conversation_id: 'conv-C',
          conversation_type: 'friend',
          messages: [baseMsg(1), baseMsg(2)],
          latest_seq: 2,
          has_more: false,
        },
      ],
    });
    const svc = new SyncService(api as never);

    const result = await svc.syncMessages([baseConv('conv-C', 0)]);

    expect(mockDb.saveMessages).toHaveBeenCalledTimes(1);
    const saved = mockDb.saveMessages.mock.calls[0][0] as Array<{ seq: number }>;
    expect(saved.map(m => m.seq)).toEqual([1, 2]);
    expect(result.newMessagesCount).toBe(2);
  });

  it('latest_seq 仍会被记录（即使没有新消息）—— 让下一次同步使用最新 last_seq', async () => {
    const api = makeApi({
      conversations: [
        {
          conversation_id: 'conv-D',
          conversation_type: 'friend',
          messages: [baseMsg(2)],
          latest_seq: 2,
          has_more: false,
        },
      ],
    });
    const svc = new SyncService(api as never);

    await svc.syncMessages([baseConv('conv-D', 2)]);

    // 即使没有新消息，updateConversationLastSeq 仍被调用（不触发预览事件，安全）
    expect(mockDb.updateConversationLastSeq).toHaveBeenCalledWith('conv-D', 2);
  });
});

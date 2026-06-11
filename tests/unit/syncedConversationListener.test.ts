/**
 * syncService 会话同步落库通知测试（L2：mock db/api）
 *
 * sync 补刀（P3）service 半边的契约：
 * - 某会话经 HTTP 增量同步写入了新消息 → 调用模块级 listener(convId, type, latestSeq)
 * - 没有新消息落库（全部 seq <= 本地 last_seq）→ 不通知（不能凭空触发 markRead）
 * - 分页（has_more）→ 用完整同步后的最终 seq 通知
 * - listener 注销（null）后不再通知
 * （activeChat 判定在 WebSocketContext 半边，见 webSocketMarkReadChain.test.ts）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockDb = vi.hoisted(() => ({
  saveMessages: vi.fn().mockResolvedValue(undefined),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
  updateConversationLastSeq: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/db', () => mockDb);
vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (s: string | null | undefined) => s ?? null,
}));

import { SyncService, setSyncedConversationListener } from '../../src/services/syncService';
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

type SyncPage = {
  conversation_id: string;
  conversation_type: 'friend' | 'group';
  messages: ReturnType<typeof baseMsg>[];
  latest_seq: number;
  has_more: boolean;
};

function makeApi(pages: Array<{ conversations: SyncPage[] }>) {
  const post = vi.fn();
  for (const page of pages) {
    post.mockResolvedValueOnce(page);
  }
  return { post, get: vi.fn(), put: vi.fn(), delete: vi.fn() };
}

describe('syncService - 会话同步落库通知（activeChat 标读补刀的 service 半边）', () => {
  const listener = vi.fn();

  beforeEach(() => {
    listener.mockClear();
    mockDb.saveMessages.mockClear();
    setSyncedConversationListener(listener);
  });

  afterEach(() => {
    setSyncedConversationListener(null);
  });

  it('有新消息落库 → 通知 (convId, type, latest_seq)', async () => {
    const api = makeApi([{
      conversations: [{
        conversation_id: 'conv-A',
        conversation_type: 'friend',
        messages: [baseMsg(5), baseMsg(6)],
        latest_seq: 6,
        has_more: false,
      }],
    }]);
    const svc = new SyncService(api as never);

    await svc.syncMessages([baseConv('conv-A', 4)]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('conv-A', 'friend', 6);
  });

  it('无新消息（全部 seq <= 本地 last_seq）→ 不通知', async () => {
    const api = makeApi([{
      conversations: [{
        conversation_id: 'conv-A',
        conversation_type: 'friend',
        messages: [baseMsg(3), baseMsg(4)],
        latest_seq: 4,
        has_more: false,
      }],
    }]);
    const svc = new SyncService(api as never);

    await svc.syncMessages([baseConv('conv-A', 4)]);

    expect(listener).not.toHaveBeenCalled();
  });

  it('分页（has_more）→ 通知一次且带完整同步后的最终 seq', async () => {
    const api = makeApi([
      // 第一页（syncMessages 主请求）
      {
        conversations: [{
          conversation_id: 'conv-B',
          conversation_type: 'group',
          messages: [baseMsg(5)],
          latest_seq: 5,
          has_more: true,
        }],
      },
      // 第二页（syncConversationFully）
      {
        conversations: [{
          conversation_id: 'conv-B',
          conversation_type: 'group',
          messages: [baseMsg(6), baseMsg(7)],
          latest_seq: 7,
          has_more: false,
        }],
      },
    ]);
    const svc = new SyncService(api as never);

    await svc.syncMessages([baseConv('conv-B', 4)]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('conv-B', 'group', 7);
  });

  it('listener 注销后不再通知（WebSocketProvider 卸载场景）', async () => {
    setSyncedConversationListener(null);
    const api = makeApi([{
      conversations: [{
        conversation_id: 'conv-A',
        conversation_type: 'friend',
        messages: [baseMsg(5)],
        latest_seq: 5,
        has_more: false,
      }],
    }]);
    const svc = new SyncService(api as never);

    await svc.syncMessages([baseConv('conv-A', 4)]);

    expect(listener).not.toHaveBeenCalled();
    expect(mockDb.saveMessages).toHaveBeenCalledTimes(1); // 同步本身照常进行
  });
});

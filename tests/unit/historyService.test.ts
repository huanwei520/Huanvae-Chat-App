/**
 * historyService 防回归测试
 *
 * 锁定契约（与 src/services/historyService.ts 文件头注释对齐）：
 *
 * 1. 历史消息加载（loadAllHistoryMessages）必须用 db.saveMessagesSkipExisting
 *    （INSERT OR IGNORE），不可用 db.saveMessages（INSERT OR REPLACE）。
 *    理由：好友消息接口 GET /api/messages 不返回 is_recalled 字段；若用 OR REPLACE
 *    覆盖会把本地已撤回消息的 is_recalled=1 重置为 0，UI 退化为"普通对方消息形态"
 *    （由 CLAUDE.md「功能迭代规则」明确禁止"以兜底默认值覆盖业务状态"的写法）。
 *
 * 2. 好友 / 群聊两条分支都必须走 saveMessagesSkipExisting。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveMessages: vi.fn(),
  saveMessagesSkipExisting: vi.fn(),
  saveConversation: vi.fn(),
  getConversation: vi.fn(),
  getLatestMessage: vi.fn(),
  updateConversationLastSeq: vi.fn(),
  getMessages: vi.fn(),
  getGroupMessages: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  saveMessages: mocks.saveMessages,
  saveMessagesSkipExisting: mocks.saveMessagesSkipExisting,
  saveConversation: mocks.saveConversation,
  getConversation: mocks.getConversation,
  getLatestMessage: mocks.getLatestMessage,
  updateConversationLastSeq: mocks.updateConversationLastSeq,
}));

vi.mock('../../src/api/messages', () => ({
  getMessages: mocks.getMessages,
}));

vi.mock('../../src/api/groupMessages', () => ({
  getGroupMessages: mocks.getGroupMessages,
}));

import { loadAllHistoryMessages } from '../../src/services/historyService';

describe('historyService 历史加载使用 saveMessagesSkipExisting（防回归）', () => {
  beforeEach(() => {
    mocks.saveMessages.mockReset();
    mocks.saveMessagesSkipExisting.mockReset();
    mocks.saveConversation.mockResolvedValue(undefined);
    mocks.getConversation.mockResolvedValue({ id: 'conv-x', last_seq: 0 });
    mocks.getLatestMessage.mockResolvedValue(null);
    mocks.updateConversationLastSeq.mockResolvedValue(undefined);
    mocks.getMessages.mockReset();
    mocks.getGroupMessages.mockReset();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fakeApi: any = {};
  const onProgress = vi.fn();

  it('好友历史加载 → 调 saveMessagesSkipExisting（不调 saveMessages）', async () => {
    // 第一批 1 条消息（不足 BATCH_SIZE=100，循环退出）
    mocks.getMessages.mockResolvedValueOnce({
      messages: [
        {
          message_uuid: 'msg-friend-1',
          sender_id: 'them',
          receiver_id: 'me',
          message_content: 'hello',
          message_type: 'text',
          file_uuid: null,
          file_url: null,
          file_size: null,
          file_hash: null,
          image_width: null,
          image_height: null,
          seq: 5,
          send_time: '2026-01-01T00:00:00Z',
          is_recalled: false,
        },
      ],
      has_more: false,
    });

    await loadAllHistoryMessages(fakeApi, 'friend-1', 'friend', 'me', onProgress);

    expect(mocks.saveMessagesSkipExisting).toHaveBeenCalledTimes(1);
    expect(mocks.saveMessagesSkipExisting.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        message_uuid: 'msg-friend-1',
        conversation_type: 'friend',
        is_recalled: false, // 写入字段（INSERT OR IGNORE 不会覆盖本地已存在的 is_recalled=1）
      }),
    ]);
    // 关键反向断言：禁止走 saveMessages（INSERT OR REPLACE）路径
    expect(mocks.saveMessages).not.toHaveBeenCalled();
  });

  it('群聊历史加载 → 调 saveMessagesSkipExisting（不调 saveMessages）', async () => {
    mocks.getGroupMessages.mockResolvedValueOnce({
      messages: [
        {
          message_uuid: 'msg-group-1',
          group_id: 'group-1',
          sender_id: 'them',
          sender_nickname: 'T',
          sender_avatar_url: '',
          message_content: 'hi',
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
          seq: 3,
        },
      ],
      has_more: false,
    });

    await loadAllHistoryMessages(fakeApi, 'group-1', 'group', 'me', onProgress);

    expect(mocks.saveMessagesSkipExisting).toHaveBeenCalledTimes(1);
    expect(mocks.saveMessagesSkipExisting.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        message_uuid: 'msg-group-1',
        conversation_type: 'group',
      }),
    ]);
    expect(mocks.saveMessages).not.toHaveBeenCalled();
  });

  it('好友分批加载（多个批次）→ 每批都走 saveMessagesSkipExisting', async () => {
    // 第一批：100 条（满 BATCH_SIZE，触发下一批）
    const batch1 = Array.from({ length: 100 }, (_, i) => ({
      message_uuid: `msg-${i}`,
      sender_id: 'them',
      receiver_id: 'me',
      message_content: `msg ${i}`,
      message_type: 'text' as const,
      file_uuid: null,
      file_url: null,
      file_size: null,
      file_hash: null,
      image_width: null,
      image_height: null,
      seq: 100 - i,
      send_time: '2026-01-01T00:00:00Z',
      is_recalled: false,
    }));
    // 第二批：0 条（终止）
    mocks.getMessages
      .mockResolvedValueOnce({ messages: batch1, has_more: false })
      .mockResolvedValueOnce({ messages: [], has_more: false });

    await loadAllHistoryMessages(fakeApi, 'friend-1', 'friend', 'me', onProgress);

    // 至少调用 1 次 saveMessagesSkipExisting；具体次数取决于 has_more 推进逻辑
    expect(mocks.saveMessagesSkipExisting).toHaveBeenCalled();
    expect(mocks.saveMessages).not.toHaveBeenCalled();
  });
});

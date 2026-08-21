/**
 * historyService 防回归测试
 *
 * 锁定契约（与 src/services/historyService.ts 文件头注释对齐）：
 *
 * 1. 历史消息加载（loadAllHistoryMessages）必须用 db.saveMessagesSkipExisting
 *    （INSERT + ON CONFLICT 只补空列），不可用 db.saveMessages（INSERT OR REPLACE）。
 *    理由：本地状态列（如 is_deleted、以及本机撤回后写入的正文占位）不该被一次
 *    历史回拉整行覆盖。
 *    🔴 **原先这里写的理由是「GET /api/messages 不返回 is_recalled」——那是一句假话**：
 *    契约 backend-docs/messages/好友消息.md 明写「is_recalled | bool | 是否已撤回，**恒返回**」，
 *    src/types/chat.ts 的 Message 也把它声明成必填非可选。假话本身没有让 skipExisting
 *    这个选择变错，但它掩护了同一段代码里 `is_recalled: false` 写死的真缺陷（见第 3 条）。
 *
 * 2. 好友 / 群聊两条分支都必须走 saveMessagesSkipExisting。
 *
 * 3. 好友 / 群聊两条分支都必须把服务端的 is_recalled 原样落库，不得写死 false。
 *    写死 false 的后果：本地库里没有的那些历史消息被插成未撤回 ⇒ MessageBubble 不走
 *    撤回占位分支，把服务端已脱敏的字面量「[消息已撤回]」当普通文本气泡渲染出来。
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

/**
 * is_recalled 透传（2026-08-21 新增，外部审计 idx=54）
 *
 * 真缺陷：好友分支写死 `is_recalled: false`，把服务端返回的 true 丢掉。群分支一直写对。
 * 这一组是**行为测试**，不是源码扫描：断言的是落库入参里那一位的值。
 */
describe('historyService 把服务端 is_recalled 原样落库（idx=54 回归）', () => {
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

  it('好友分支：服务端 is_recalled=true → 落库 true（修前恒 false）', async () => {
    mocks.getMessages.mockResolvedValueOnce({
      messages: [
        {
          message_uuid: 'msg-recalled',
          sender_id: 'them',
          receiver_id: 'me',
          message_content: '[消息已撤回]',
          message_type: 'text',
          file_uuid: null,
          file_url: null,
          file_size: null,
          image_width: null,
          image_height: null,
          seq: 9,
          send_time: '2026-01-01T00:00:00Z',
          is_recalled: true,
        },
      ],
      has_more: false,
    });

    await loadAllHistoryMessages(fakeApi, 'friend-1', 'friend', 'me', onProgress);

    const rows = mocks.saveMessagesSkipExisting.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0].is_recalled).toBe(true);
  });

  it('好友分支：服务端 is_recalled=false → 落库 false（不误伤正常消息）', async () => {
    mocks.getMessages.mockResolvedValueOnce({
      messages: [
        {
          message_uuid: 'msg-normal',
          sender_id: 'them',
          receiver_id: 'me',
          message_content: 'hello',
          message_type: 'text',
          file_uuid: null,
          file_url: null,
          file_size: null,
          image_width: null,
          image_height: null,
          seq: 10,
          send_time: '2026-01-01T00:00:00Z',
          is_recalled: false,
        },
      ],
      has_more: false,
    });

    await loadAllHistoryMessages(fakeApi, 'friend-1', 'friend', 'me', onProgress);

    expect(mocks.saveMessagesSkipExisting.mock.calls[0][0][0].is_recalled).toBe(false);
  });

  it('群分支：服务端 is_recalled=true → 落库 true（原本就对，锁住别回退）', async () => {
    mocks.getGroupMessages.mockResolvedValueOnce({
      messages: [
        {
          message_uuid: 'gmsg-recalled',
          group_id: 'group-1',
          sender_id: 'them',
          sender_nickname: 'T',
          sender_avatar_url: '',
          message_content: '[消息已撤回]',
          message_type: 'text',
          file_uuid: null,
          file_url: null,
          file_size: null,
          image_width: null,
          image_height: null,
          reply_to: null,
          send_time: '2026-01-01T00:00:00Z',
          is_recalled: true,
          seq: 4,
        },
      ],
      has_more: false,
    });

    await loadAllHistoryMessages(fakeApi, 'group-1', 'group', 'me', onProgress);

    expect(mocks.saveMessagesSkipExisting.mock.calls[0][0][0].is_recalled).toBe(true);
  });
});

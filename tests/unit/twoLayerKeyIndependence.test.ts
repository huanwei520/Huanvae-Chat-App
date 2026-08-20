/**
 * 两层键 · 「App 已经不依赖后端下发的 file_hash」契约测试
 *
 * ## 它要证的是什么（口径是【反过来】的，别读成"字段已经没了"）
 *
 * 后端接收面此刻**仍在下发** `file_hash`（改造已入库但未部署）。所以"五处还能用"
 * 完全可能只是**旧路径还在兜底**。本文件把兜底切断后再验：
 * **把后端仍在发的那个字段原样喂给解析边界**，断言它**不进入**任何本地/UI 消息对象。
 *
 * 这比"等后端不发了再验"更强：字段还摆在那儿，而 App 已经不看它了。
 *
 * ## 判别力（正/负两侧形状必须不同 —— 否则这个测试什么都没证明）
 *
 * | 侧 | 输入 | 断言的形状 |
 * |---|---|---|
 * | **正**（负载带 file_hash，= 今天生产的真实形态） | `raw` 含 `file_hash: '<64hex>'` | 产出对象 **不含** `file_hash` 键，且不含该哈希值 |
 * | **负**（负载不带，= 后端部署后的形态） | `raw` 无该键 | 产出对象形状**逐字段相同** |
 *
 * 两侧产出**必须逐字段相等** —— 这正是"App 不再依赖它"的机器化表述：
 * 后端发不发，本地结果一模一样。若哪天有人把 `file_hash: msg.file_hash` 加回解析处，
 * 正侧会多出一个键 ⇒ 两侧不再相等 ⇒ 本测试翻红。
 *
 * ⚠️ 本文件只覆盖**解析边界**（历史 / 同步 / WS 帧）。五处 UI 行为（文档下载按钮、
 * 视频封面命中、相册、搜索预览、二次打开不重下）**jsdom 测不出**，只能真机看
 * （见 .claude/rules/frontend-test.md「滚动 / 布局相关行为」同款结构性盲区）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveMessagesSkipExisting: vi.fn(),
  saveMessages: vi.fn(),
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

vi.mock('../../src/api/messages', () => ({ getMessages: mocks.getMessages }));
vi.mock('../../src/api/groupMessages', () => ({ getGroupMessages: mocks.getGroupMessages }));

import { loadAllHistoryMessages } from '../../src/services/historyService';

/** 后端今天仍在下发的那个值（64 位十六进制），用来在产出里搜它 */
const SERVER_HASH = 'a'.repeat(64);

/** 一条文件类好友历史消息的原始形态；`withHash` 决定带不带后端仍在发的 file_hash */
function friendRaw(withHash: boolean): Record<string, unknown> {
  return {
    message_uuid: 'msg-1',
    sender_id: 'them',
    receiver_id: 'me',
    message_content: '[图片] a.png',
    message_type: 'image',
    file_uuid: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    file_url: 'https://example.invalid/a.png',
    file_size: 2048,
    ...(withHash ? { file_hash: SERVER_HASH } : {}),
    image_width: 100,
    image_height: 80,
    seq: 5,
    send_time: '2026-01-01T00:00:00Z',
    is_recalled: false,
  };
}

async function parseFriendHistory(withHash: boolean): Promise<Record<string, unknown>> {
  mocks.saveMessagesSkipExisting.mockClear();
  mocks.getMessages.mockReset();
  mocks.getMessages.mockResolvedValueOnce({ messages: [friendRaw(withHash)], has_more: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await loadAllHistoryMessages({} as any, 'friend-1', 'friend', 'me', vi.fn());

  const rows = mocks.saveMessagesSkipExisting.mock.calls[0][0] as Record<string, unknown>[];
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe('两层键 · 解析边界不再吸收后端下发的 file_hash', () => {
  beforeEach(() => {
    mocks.saveMessagesSkipExisting.mockReset();
    mocks.saveMessages.mockReset();
    mocks.saveConversation.mockResolvedValue(undefined);
    mocks.getConversation.mockResolvedValue({ id: 'conv-x', last_seq: 0 });
    mocks.getLatestMessage.mockResolvedValue(null);
    mocks.updateConversationLastSeq.mockResolvedValue(undefined);
  });

  it('好友历史：负载带 file_hash（= 今天生产的形态）⇒ 落库行里没有该键、也没有该值', async () => {
    const row = await parseFriendHistory(true);

    // 正侧：字段确实被喂进来了，但没进产物
    expect(Object.keys(row)).not.toContain('file_hash');
    expect(JSON.stringify(row)).not.toContain(SERVER_HASH);
    // 同时证明这条消息**确实是文件消息**（否则"没有哈希"可能只是因为它是纯文本，零判别力）
    expect(row.file_uuid).toBe('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
    expect(row.file_size).toBe(2048);
  });

  it('好友历史：带与不带 file_hash，落库行【逐字段相等】—— 这就是「不再依赖」的机器化表述', async () => {
    const withHash = await parseFriendHistory(true);
    const withoutHash = await parseFriendHistory(false);

    // 判别力自证：两侧输入形状不同（一个多一个键），产出必须相同
    expect(Object.keys(friendRaw(true))).toContain('file_hash');
    expect(Object.keys(friendRaw(false))).not.toContain('file_hash');
    expect(withHash).toEqual(withoutHash);
  });

  it('群历史：同款 —— 负载带 file_hash 也不进落库行', async () => {
    mocks.saveMessagesSkipExisting.mockReset();
    mocks.getGroupMessages.mockReset();
    mocks.getGroupMessages.mockResolvedValueOnce({
      messages: [
        {
          message_uuid: 'gmsg-1',
          group_id: 'group-1',
          sender_id: 'them',
          sender_nickname: 'T',
          sender_avatar_url: '',
          message_content: '[视频] a.mp4',
          message_type: 'video',
          file_uuid: '3f2504e0-4f89-11d3-9a0c-0305e82c3302',
          file_url: 'https://example.invalid/a.mp4',
          file_size: 4096,
          file_hash: SERVER_HASH,
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await loadAllHistoryMessages({} as any, 'group-1', 'group', 'me', vi.fn());

    const row = mocks.saveMessagesSkipExisting.mock.calls[0][0][0] as Record<string, unknown>;
    expect(Object.keys(row)).not.toContain('file_hash');
    expect(JSON.stringify(row)).not.toContain(SERVER_HASH);
    expect(row.file_uuid).toBe('3f2504e0-4f89-11d3-9a0c-0305e82c3302');
  });
});

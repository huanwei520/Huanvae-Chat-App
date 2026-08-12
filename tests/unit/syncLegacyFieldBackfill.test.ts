/**
 * syncService 存量字段回填测试（L2：mock db/api）
 *
 * ## 这条测试在防什么
 * `reply_to` 与相册三件套曾在所有接收侧写入路径上被写死 null，2026-08-10 才逐条修好。
 * 修好的只是"之后写进来的"——**已经躺在本地 SQLite 里的行永远是 NULL**：
 * 增量同步只拉 `seq > last_seq` 不会回头，历史加载对已存在行是跳过的。
 * 消息列表又是 DB-first 的 ⇒ 用户看到「别人回复自己的历史消息没有引用块、自己发的却有」
 * （自己发的走 sendMessage 本地直写，一直带着 reply_to）。
 *
 * `SyncService.backfillLegacyFields` 就是那条回头路：每会话每进程一次，用回溯窗口
 * 再问一次 sync 端点，把落在窗口内、本地已存在的那段交给 `db.saveMessagesSkipExisting`
 * （Rust 侧对已存在行只 COALESCE 补这四列）。
 *
 * ## 这里守得住 / 守不住什么
 * 守得住：回填请求发不发、起点算得对不对、哪些消息进回填、幂等、失败不拖崩主同步。
 * 守不住：SQLite 里那条 `ON CONFLICT DO UPDATE` 到底有没有真把列补上
 * —— 那半边由 Rust 单测 `backfills_null_reply_to_on_existing_row` 等四条覆盖。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => ({
  saveMessages: vi.fn().mockResolvedValue(undefined),
  saveMessagesSkipExisting: vi.fn().mockResolvedValue(undefined),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
  updateConversationLastSeq: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/db', () => mockDb);

import { SyncService } from '../../src/services/syncService';
import type { LocalConversation } from '../../src/db';

/** 与 syncService.ts 的 BACKFILL_WINDOW 同值（服务端 sync 单会话一批上限） */
const BACKFILL_WINDOW = 100;

const conv = (id: string, lastSeq: number): LocalConversation => ({
  id,
  type: 'group',
  name: 'g',
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

const msg = (seq: number, extra: Record<string, unknown> = {}) => ({
  message_uuid: `uuid-${seq}`,
  sender_id: 'peer',
  message_content: `msg ${seq}`,
  message_type: 'text',
  seq,
  send_time: `2026-01-01T00:00:00Z`,
  ...extra,
});

/** 无新消息的主同步响应（把注意力留给回填那一次请求） */
const emptyMainPage = (id: string, latestSeq: number) => ({
  conversations: [
    {
      conversation_id: id,
      conversation_type: 'group' as const,
      messages: [],
      latest_seq: latestSeq,
      has_more: false,
    },
  ],
});

const backfillPage = (id: string, messages: ReturnType<typeof msg>[], latestSeq: number) => ({
  conversations: [
    {
      conversation_id: id,
      conversation_type: 'group' as const,
      messages,
      latest_seq: latestSeq,
      has_more: false,
    },
  ],
});

function makeApi() {
  return { post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() };
}

describe('syncService — 存量 reply_to / 相册字段回填', () => {
  beforeEach(() => {
    Object.values(mockDb).forEach(m => m.mockClear());
  });

  it('首次同步会话：主同步之后追发一次回填请求，起点 = last_seq − BACKFILL_WINDOW', async () => {
    const api = makeApi();
    api.post
      .mockResolvedValueOnce(emptyMainPage('g1', 300))
      .mockResolvedValueOnce(backfillPage('g1', [], 300));

    await new SyncService(api as never).syncMessages([conv('g1', 300)]);

    expect(api.post).toHaveBeenCalledTimes(2);
    // 第一次是主同步：起点就是本地 last_seq，绝不能被回填改小（会把新消息挤出 100 条上限）
    expect(api.post).toHaveBeenNthCalledWith(1, '/api/messages/sync', {
      conversations: [expect.objectContaining({ conversation_id: 'g1', last_seq: 300 })],
    });
    // 第二次是回填：起点回退一个窗口
    expect(api.post).toHaveBeenNthCalledWith(2, '/api/messages/sync', {
      conversations: [
        { conversation_id: 'g1', conversation_type: 'group', last_seq: 300 - BACKFILL_WINDOW },
      ],
    });
  });

  it('回填窗口内、本地已存在的那段（seq ≤ last_seq）带 reply_to → 走 saveMessagesSkipExisting', async () => {
    const api = makeApi();
    api.post
      .mockResolvedValueOnce(emptyMainPage('g1', 300))
      .mockResolvedValueOnce(
        backfillPage('g1', [msg(250, { reply_to: 'orig-uuid' }), msg(251, { media_group_id: 'grp-1', media_group_index: 0, media_group_count: 2 })], 300),
      );

    await new SyncService(api as never).syncMessages([conv('g1', 300)]);

    expect(mockDb.saveMessagesSkipExisting).toHaveBeenCalledTimes(1);
    const written = mockDb.saveMessagesSkipExisting.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(written.map(m => m.message_uuid)).toEqual(['uuid-250', 'uuid-251']);
    expect(written[0]).toMatchObject({
      conversation_id: 'g1',
      conversation_type: 'group',
      reply_to: 'orig-uuid',
    });
    expect(written[1]).toMatchObject({
      media_group_id: 'grp-1',
      media_group_index: 0,
      media_group_count: 2,
    });
    // 回填绝不能碰 last_seq / 预览：那是主同步的账
    expect(mockDb.updateConversationLastMessage).not.toHaveBeenCalled();
  });

  it('回填响应里 seq > last_seq 的新消息不进回填写入（归主同步管，重复写会触发会话列表重排）', async () => {
    const api = makeApi();
    api.post
      .mockResolvedValueOnce(emptyMainPage('g1', 300))
      .mockResolvedValueOnce(
        backfillPage('g1', [msg(301, { reply_to: 'orig-new' }), msg(250, { reply_to: 'orig-old' })], 301),
      );

    await new SyncService(api as never).syncMessages([conv('g1', 300)]);

    const written = mockDb.saveMessagesSkipExisting.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(written.map(m => m.message_uuid)).toEqual(['uuid-250']);
  });

  it('窗口内一条都没有这几列 → 不发起写入（不白触发预览通知）', async () => {
    const api = makeApi();
    api.post
      .mockResolvedValueOnce(emptyMainPage('g1', 300))
      .mockResolvedValueOnce(backfillPage('g1', [msg(250), msg(251)], 300));

    await new SyncService(api as never).syncMessages([conv('g1', 300)]);

    expect(mockDb.saveMessagesSkipExisting).not.toHaveBeenCalled();
  });

  it('同一实例第二次同步同一会话：不再重复发回填请求', async () => {
    const api = makeApi();
    api.post
      .mockResolvedValueOnce(emptyMainPage('g1', 300))
      .mockResolvedValueOnce(backfillPage('g1', [], 300))
      .mockResolvedValueOnce(emptyMainPage('g1', 300));

    const svc = new SyncService(api as never);
    await svc.syncMessages([conv('g1', 300)]);
    await svc.syncMessages([conv('g1', 300)]);

    expect(api.post).toHaveBeenCalledTimes(3);
    expect(api.post).toHaveBeenNthCalledWith(3, '/api/messages/sync', {
      conversations: [expect.objectContaining({ last_seq: 300 })],
    });
  });

  it('last_seq = 0 的会话不回填（主同步本来就从 0 拉，回填纯属重复请求）', async () => {
    const api = makeApi();
    api.post.mockResolvedValueOnce(emptyMainPage('g1', 0));

    await new SyncService(api as never).syncMessages([conv('g1', 0)]);

    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('回填请求失败：主同步结果照常返回，不向上抛', async () => {
    const api = makeApi();
    api.post
      .mockResolvedValueOnce(emptyMainPage('g1', 300))
      .mockRejectedValueOnce(new Error('backfill boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await new SyncService(api as never).syncMessages([conv('g1', 300)]);

    expect(result).toEqual({ updatedConversations: [], newMessagesCount: 0 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

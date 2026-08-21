/**
 * syncConversationFully 分页循环的两道死循环安全阀（外部审计 idx=56 回归）
 *
 * 病灶（本轮修复前）：
 *   `while (hasMore)` 的唯一推进量是 `currentSeq = convResult.latest_seq`，
 *   唯一的续跑信号是服务端给的 `has_more`。服务端只要回
 *   「`has_more:true` + `latest_seq` 不推进 + 这一页还有消息」，
 *   下一轮请求参数与上一轮**逐字相同** ⇒ 同一个响应 ⇒ 无限重发 `POST /api/messages/sync`。
 *   该函数在 `useInitialSync` 登录首屏路径上被 await ⇒ 初始同步永不返回。
 *
 * 🔴 这里断言的是**真行为**（真跑 `SyncService.syncMessages`、数真实发出的请求次数），
 *    不是扫源码有没有出现某个常量名。
 *
 * ⚠️ 判据说明：修复前这几个用例不是「失败」，是**挂死**（vitest 会撞测试超时）。
 *    所以每个用例都显式给了 `timeout`，让回退时以超时红掉而不是把整个套件拖死。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => ({
  saveMessages: vi.fn().mockResolvedValue(undefined),
  saveMessagesSkipExisting: vi.fn().mockResolvedValue(undefined),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
  updateConversationLastSeq: vi.fn().mockResolvedValue(undefined),
  getMessages: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/db', () => mockDb);
vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (s: string | null | undefined) => s ?? null,
}));

import { SyncService } from '../../src/services/syncService';
import type { LocalConversation } from '../../src/db';

/** 与 syncService.ts 的 SYNC_MAX_PAGE_ITERATIONS 同值；不导出常量是为了让这条断言独立于实现 */
const EXPECTED_ITERATION_CAP = 500;

const baseConv = (id: string, lastSeq: number): LocalConversation => ({
  id,
  type: 'friend',
  name: 'A',
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

function msg(seq: number) {
  return {
    message_uuid: `uuid-${seq}`,
    sender_id: 'sender-1',
    message_content: `m${seq}`,
    message_type: 'text',
    seq,
    send_time: '2026-01-01T00:00:00Z',
  };
}

/** 造一个 api 桩：post 的响应由回调按「第几次调用」决定 */
function makeApi(respond: (callIndex: number) => unknown) {
  let n = 0;
  const post = vi.fn().mockImplementation(() => {
    const r = respond(n);
    n += 1;
    return Promise.resolve(r);
  });
  return {
    post,
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    getBaseUrl: () => 'http://localhost:8080',
    getAccessToken: () => 'token',
    refreshAccessToken: vi.fn(),
  };
}

function convResult(messages: ReturnType<typeof msg>[], latestSeq: number, hasMore: boolean) {
  return {
    conversations: [
      {
        conversation_id: 'conv-A',
        conversation_type: 'friend',
        messages,
        latest_seq: latestSeq,
        has_more: hasMore,
      },
    ],
  };
}

describe('syncConversationFully 安全阀①：has_more=true 但 latest_seq 不推进 ⇒ 立即停', () => {
  beforeEach(() => {
    Object.values(mockDb).forEach((m) => m.mockClear());
  });

  it('每轮都回同一批消息 + has_more:true + latest_seq 恒定 ⇒ 不死循环', async () => {
    // 修复前：请求参数逐轮相同 ⇒ 永远发下去。修复后：第 2 轮发现没推进即停。
    const api = makeApi(() => convResult([msg(5)], 5, true));
    const svc = new SyncService(api as never);

    await svc.syncMessages([baseConv('conv-A', 0)]);

    // 第 1 轮真拿到了新消息（seq 5 > 0）并推进到 5；第 2 轮 latest_seq 仍是 5 ⇒ 停。
    expect(api.post.mock.calls.length).toBeLessThanOrEqual(3);
    expect(api.post.mock.calls.length).toBeGreaterThanOrEqual(1);
  }, 10_000);

  it('每轮都回「seq 不超过 currentSeq」的消息 + has_more:true ⇒ 不死循环', async () => {
    // 这是 `newMessages.length === 0` 那条 continue 分支：修复前它同样原地打转。
    const api = makeApi(() => convResult([msg(3)], 7, true));
    const svc = new SyncService(api as never);

    // last_seq 已经是 7 ⇒ seq=3 的消息被防御性过滤掉 ⇒ 走 continue 分支
    await svc.syncMessages([baseConv('conv-A', 7)]);

    expect(api.post.mock.calls.length).toBeLessThanOrEqual(3);
  }, 10_000);

  it('服务端把 latest_seq 回退（比上一轮还小）也不会重新拉已同步段', async () => {
    const api = makeApi((i) => (i === 0
      ? convResult([msg(10)], 10, true)
      : convResult([msg(2)], 2, true)));
    const svc = new SyncService(api as never);

    const before = api.post.mock.calls.length;
    await svc.syncMessages([baseConv('conv-A', 0)]);

    expect(api.post.mock.calls.length - before).toBeLessThanOrEqual(3);
    // currentSeq 只增不减 ⇒ 最后写回的 last_seq 不得倒退到 2
    const seqCalls = mockDb.updateConversationLastSeq.mock.calls.map((c) => c[1] as number);
    expect(Math.min(...seqCalls)).toBeGreaterThanOrEqual(10);
  }, 10_000);
});

describe('syncConversationFully 安全阀②：轮数硬上限', () => {
  beforeEach(() => {
    Object.values(mockDb).forEach((m) => m.mockClear());
  });

  it('服务端每轮只推进 1 且 has_more 恒真 ⇒ 在上限处停下，不无限跑', async () => {
    // 这个形状躲得过安全阀①（每轮确实推进了），只有轮数上限拦得住。
    const api = makeApi((i) => convResult([msg(i + 1)], i + 1, true));
    const svc = new SyncService(api as never);

    await svc.syncMessages([baseConv('conv-A', 0)]);

    // +1 = `syncMessages` 自己那一次批量请求（它先发一次，看到 has_more 才进
    // syncConversationFully 的分页循环）。上限只管分页循环里那 500 轮。
    expect(api.post.mock.calls.length).toBe(EXPECTED_ITERATION_CAP + 1);
  }, 30_000);
});

describe('syncConversationFully：正常多页分页不受安全阀影响（不许误伤）', () => {
  beforeEach(() => {
    Object.values(mockDb).forEach((m) => m.mockClear());
  });

  it('三页正常推进（latest_seq 逐页增大，最后一页 has_more:false）⇒ 三页都拉到', async () => {
    const api = makeApi((i) => {
      if (i === 0) { return convResult([msg(1), msg(2)], 2, true); }
      if (i === 1) { return convResult([msg(3), msg(4)], 4, true); }
      return convResult([msg(5)], 5, false);
    });
    const svc = new SyncService(api as never);

    const result = await svc.syncMessages([baseConv('conv-A', 0)]);

    expect(api.post.mock.calls.length).toBe(3);
    // 三页的消息都写进了本地库
    const saved = mockDb.saveMessages.mock.calls.flatMap((c) => c[0] as { seq: number }[]);
    expect(saved.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(result.updatedConversations).toContain('conv-A');
  }, 10_000);

  it('单页结束（has_more:false）⇒ 只发一次请求', async () => {
    const api = makeApi(() => convResult([msg(1)], 1, false));
    const svc = new SyncService(api as never);

    await svc.syncMessages([baseConv('conv-A', 0)]);

    expect(api.post.mock.calls.length).toBe(1);
  }, 10_000);
});

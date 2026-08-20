/**
 * useConversationMessageSearch Hook 测试
 *
 * 本 hook 这次从「必须先输入关键词才有结果」改成 Telegram 式「先按分类列出，关键词只是收窄」，
 * 且结果分页取。覆盖：
 * 1. **无关键词就出结果**（本次改造的核心）：挂载即查首屏，且必然带 conversation_id
 * 2. 有关键词 → 防抖 500ms 后带 query 重查，分类过滤条件同时保留（"在分类内过滤"）
 * 3. 各分类下发的 content_type 过滤正确（图片走 include 白名单，文字走 exclude 黑名单）
 * 4. 只换分类不重打防抖计时
 * 5. **分页不是一次性全取**：首屏只取一页，loadMore 用 offset=已加载条数 追加
 * 6. hasMore 的判据是「本页拿满 PAGE_SIZE」；拿不满 → 到底 → loadMore 变空操作
 * 7. conversationId 为空（AI 会话）不调 DB；DB 抛错 → error 填充、结果清空
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockListConversationMessages = vi.hoisted(() => vi.fn());

vi.mock('../../src/db', () => ({
  listConversationMessages: mockListConversationMessages,
}));

import {
  useConversationMessageSearch,
  CONVERSATION_PAGE_SIZE,
} from '../../src/components/search/useConversationMessageSearch';
import type { MessageCategory } from '../../src/components/search/messageCategory';
import type { LocalMessage } from '../../src/db';

const CONV_ID = 'conv-u1-u9';

const buildMessage = (uuid: string, contentType = 'text', content = '内容'): LocalMessage => ({
  message_uuid: uuid,
  conversation_id: CONV_ID,
  conversation_type: 'friend',
  sender_id: 'u1',
  sender_name: 'User1',
  sender_avatar: null,
  content,
  content_type: contentType,
  file_uuid: null,
  file_url: null,
  file_size: null,
  image_width: null,
  image_height: null,
  seq: 1,
  reply_to: null,
  media_group_id: null,
  media_group_index: null,
  media_group_count: null,
  is_recalled: false,
  is_deleted: false,
  send_time: '2026-05-11T00:00:00Z',
  created_at: null,
});

/** 造满一页（用于让 hasMore 为 true） */
const fullPage = (prefix: string): LocalMessage[] =>
  Array.from({ length: CONVERSATION_PAGE_SIZE }, (_, i) => buildMessage(`${prefix}-${i}`));

describe('useConversationMessageSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockListConversationMessages.mockReset();
    mockListConversationMessages.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('无关键词也出结果：挂载即按分类查首屏，query 不下发', async () => {
    mockListConversationMessages.mockResolvedValue([buildMessage('m1', 'image', 'a.png')]);
    const { result } = renderHook(() => useConversationMessageSearch(CONV_ID, '', 'image'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockListConversationMessages).toHaveBeenCalledTimes(1);
    expect(mockListConversationMessages).toHaveBeenCalledWith({
      conversationId: CONV_ID,
      query: undefined,
      limit: CONVERSATION_PAGE_SIZE,
      offset: 0,
      filter: { include_content_types: ['image'] },
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.message_uuid).toBe('m1');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('有关键词：防抖 500ms 后带 query 重查，且分类过滤条件仍在（在分类内过滤）', async () => {
    const { rerender } = renderHook(
      ({ query }: { query: string }) => useConversationMessageSearch(CONV_ID, query, 'image'),
      { initialProps: { query: '' } },
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mockListConversationMessages).toHaveBeenCalledTimes(1);

    rerender({ query: 'holiday' });
    // 未到 500ms 不重查
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(mockListConversationMessages).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(mockListConversationMessages).toHaveBeenCalledTimes(2);
    expect(mockListConversationMessages).toHaveBeenLastCalledWith({
      conversationId: CONV_ID,
      query: 'holiday',
      limit: CONVERSATION_PAGE_SIZE,
      offset: 0,
      filter: { include_content_types: ['image'] },
    });
  });

  it('各分类下发对应的 content_type 过滤：图片用 include，文字用 exclude', async () => {
    const filterFor = async (category: MessageCategory) => {
      mockListConversationMessages.mockClear();
      renderHook(() => useConversationMessageSearch(CONV_ID, '', category));
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      const { calls } = mockListConversationMessages.mock;
      return calls[calls.length - 1]?.[0].filter;
    };

    expect(await filterFor('all')).toEqual({});
    expect(await filterFor('image')).toEqual({ include_content_types: ['image'] });
    expect(await filterFor('video')).toEqual({ include_content_types: ['video'] });
    expect(await filterFor('file')).toEqual({ include_content_types: ['file', 'audio'] });
    expect(await filterFor('text')).toEqual({
      exclude_content_types: ['image', 'video', 'file', 'audio'],
    });
  });

  it('只换分类不重打防抖计时：换页签立即重查，不必再等 500ms', async () => {
    const { rerender } = renderHook(
      ({ category }: { category: MessageCategory }) =>
        useConversationMessageSearch(CONV_ID, 'hello', category),
      { initialProps: { category: 'all' as MessageCategory } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    const callsAfterDebounce = mockListConversationMessages.mock.calls.length;

    rerender({ category: 'image' as MessageCategory });
    // 只推进 1 个 tick（远小于 500ms 防抖窗）就应该已经重查
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(mockListConversationMessages.mock.calls.length).toBe(callsAfterDebounce + 1);
    expect(mockListConversationMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'hello', filter: { include_content_types: ['image'] } }),
    );
  });

  it('分页：首屏只取一页；loadMore 以 offset=已加载条数 追加，不是一次性全取', async () => {
    mockListConversationMessages.mockResolvedValueOnce(fullPage('p1'));
    const { result } = renderHook(() => useConversationMessageSearch(CONV_ID, '', 'all'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // 首屏就一页，limit 恒为 PAGE_SIZE —— 绝不出现「limit 取个巨大值一把梭」
    expect(mockListConversationMessages).toHaveBeenCalledTimes(1);
    expect(mockListConversationMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: CONVERSATION_PAGE_SIZE, offset: 0 }),
    );
    expect(result.current.items).toHaveLength(CONVERSATION_PAGE_SIZE);
    expect(result.current.hasMore).toBe(true);

    mockListConversationMessages.mockResolvedValueOnce([buildMessage('p2-0')]);
    await act(async () => {
      result.current.loadMore();
      await vi.runAllTimersAsync();
    });

    expect(mockListConversationMessages).toHaveBeenCalledTimes(2);
    expect(mockListConversationMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: CONVERSATION_PAGE_SIZE, offset: CONVERSATION_PAGE_SIZE }),
    );
    // 追加而非替换
    expect(result.current.items).toHaveLength(CONVERSATION_PAGE_SIZE + 1);
    expect(result.current.items[CONVERSATION_PAGE_SIZE]?.message_uuid).toBe('p2-0');
    // 末页没拿满 → 到底
    expect(result.current.hasMore).toBe(false);
  });

  it('首屏没拿满一页 → hasMore=false，loadMore 是空操作', async () => {
    mockListConversationMessages.mockResolvedValue([buildMessage('m1')]);
    const { result } = renderHook(() => useConversationMessageSearch(CONV_ID, '', 'all'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.hasMore).toBe(false);

    await act(async () => {
      result.current.loadMore();
      await vi.runAllTimersAsync();
    });
    expect(mockListConversationMessages).toHaveBeenCalledTimes(1);
  });

  it('换分类后重新从 offset=0 取，不接着上一分类的页码', async () => {
    mockListConversationMessages.mockResolvedValue(fullPage('p1'));
    const { result, rerender } = renderHook(
      ({ category }: { category: MessageCategory }) =>
        useConversationMessageSearch(CONV_ID, '', category),
      { initialProps: { category: 'all' as MessageCategory } },
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    await act(async () => {
      result.current.loadMore();
      await vi.runAllTimersAsync();
    });
    expect(mockListConversationMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: CONVERSATION_PAGE_SIZE }),
    );

    rerender({ category: 'image' as MessageCategory });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockListConversationMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 0, filter: { include_content_types: ['image'] } }),
    );
    expect(result.current.items).toHaveLength(CONVERSATION_PAGE_SIZE);
  });

  it('conversationId 为空（如 AI 会话）：不调 DB', async () => {
    renderHook(() => useConversationMessageSearch(null, 'hello', 'all'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockListConversationMessages).not.toHaveBeenCalled();
  });

  it('DB 抛错：error 被填充、结果清空、loading 收敛', async () => {
    mockListConversationMessages.mockRejectedValue(new Error('db down'));
    const { result } = renderHook(() => useConversationMessageSearch(CONV_ID, '', 'all'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.error).toBe('db down');
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.hasMore).toBe(false);
  });

  // ── 群聊「按群成员查找」（huanwei 新需求：单独看某个群员在本群说过什么）──
  it('传 senderId：作为 sender_id 进 filter，且与分类过滤并存（可「只看某人发的图片」）', async () => {
    renderHook(() => useConversationMessageSearch(CONV_ID, '', 'image', 'u-zhangsan'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockListConversationMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filter: { include_content_types: ['image'], sender_id: 'u-zhangsan' },
      }),
    );
  });

  it('不传 senderId：filter 里**不出现** sender_id（不能塞 undefined 给 Rust）', async () => {
    renderHook(() => useConversationMessageSearch(CONV_ID, '', 'all'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // 不用 .at(-1)：本仓 TS lib target 没有它（v1.1.26 已因此踩过一次）
    const calls = mockListConversationMessages.mock.calls;
    const arg = calls[calls.length - 1][0];
    expect(arg.filter).not.toHaveProperty('sender_id');
  });

  // 这条是本需求最容易漏的点：senderId 不进依赖数组的话，切成员后仍显示上一个人的结果
  it('切换 senderId ⇒ 重新查询（否则切了成员还是上一个人的记录）', async () => {
    const { rerender } = renderHook(
      ({ sender }: { sender: string }) => useConversationMessageSearch(CONV_ID, '', 'all', sender),
      { initialProps: { sender: 'u-a' } },
    );

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    const callsAfterFirst = mockListConversationMessages.mock.calls.length;

    rerender({ sender: 'u-b' });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockListConversationMessages.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    expect(mockListConversationMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ filter: expect.objectContaining({ sender_id: 'u-b' }) }),
    );
  });
});

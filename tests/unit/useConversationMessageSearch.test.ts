/**
 * useConversationMessageSearch Hook 测试
 *
 * 覆盖：
 * 1. query 为空 / conversationId 为空 → 不调 DB
 * 2. 500ms 防抖后才查库，且**必然带上 conversation_id**（会话内搜索的核心约束）
 * 3. 分类页签下发的过滤条件正确（图片走 include 白名单，文字走 exclude 黑名单）
 * 4. 只换分类不重打防抖计时（换页签应立刻出结果，不是再等 500ms）
 * 5. DB 抛错 → error 被填充且结果清空
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockSearchMessages = vi.hoisted(() => vi.fn());

vi.mock('../../src/db', () => ({
  searchMessages: mockSearchMessages,
}));

import {
  useConversationMessageSearch,
  CONVERSATION_SEARCH_LIMIT,
} from '../../src/components/search/useConversationMessageSearch';
import type { MessageCategory } from '../../src/components/search/messageCategory';
import type { SearchMessageResult } from '../../src/db';

const CONV_ID = 'conv-u1-u9';

const buildHit = (uuid: string, contentType: string, content: string): SearchMessageResult => ({
  message: {
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
    file_hash: null,
    image_width: null,
    image_height: null,
    seq: 1,
    reply_to: null,
    is_recalled: false,
    is_deleted: false,
    send_time: '2026-05-11T00:00:00Z',
    created_at: null,
  },
  conversation_name: 'User9',
  conversation_avatar: null,
  context_before: null,
  context_after: null,
});

describe('useConversationMessageSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSearchMessages.mockReset();
    mockSearchMessages.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('query 为空：不调 DB', async () => {
    const { result } = renderHook(() => useConversationMessageSearch(CONV_ID, '', 'all'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockSearchMessages).not.toHaveBeenCalled();
    expect(result.current.hits).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('conversationId 为空（如 AI 会话）：即使有关键词也不调 DB', async () => {
    renderHook(() => useConversationMessageSearch(null, 'hello', 'all'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockSearchMessages).not.toHaveBeenCalled();
  });

  it('防抖 500ms 后查库，且必然带 conversation_id 限定本会话', async () => {
    mockSearchMessages.mockResolvedValue([buildHit('m1', 'text', 'hello world')]);
    const { result } = renderHook(() => useConversationMessageSearch(CONV_ID, 'hello', 'all'));

    // 未到 500ms 不查
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(mockSearchMessages).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(mockSearchMessages).toHaveBeenCalledTimes(1);
    expect(mockSearchMessages).toHaveBeenCalledWith('hello', CONVERSATION_SEARCH_LIMIT, {
      conversation_id: CONV_ID,
    });
    expect(result.current.hits).toHaveLength(1);
    expect(result.current.hits[0]?.message.message_uuid).toBe('m1');
    expect(result.current.error).toBeNull();
  });

  it('分类页签下发对应的 content_type 过滤：图片用 include，文字用 exclude', async () => {
    const runWithCategory = async (category: MessageCategory) => {
      mockSearchMessages.mockClear();
      renderHook(() => useConversationMessageSearch(CONV_ID, 'target', category));
      await act(async () => {
        await vi.runAllTimersAsync();
      });
      const { calls } = mockSearchMessages.mock;
      return calls[calls.length - 1];
    };

    expect(await runWithCategory('image')).toEqual([
      'target',
      CONVERSATION_SEARCH_LIMIT,
      { conversation_id: CONV_ID, include_content_types: ['image'] },
    ]);
    expect(await runWithCategory('video')).toEqual([
      'target',
      CONVERSATION_SEARCH_LIMIT,
      { conversation_id: CONV_ID, include_content_types: ['video'] },
    ]);
    expect(await runWithCategory('file')).toEqual([
      'target',
      CONVERSATION_SEARCH_LIMIT,
      { conversation_id: CONV_ID, include_content_types: ['file', 'audio'] },
    ]);
    expect(await runWithCategory('text')).toEqual([
      'target',
      CONVERSATION_SEARCH_LIMIT,
      { conversation_id: CONV_ID, exclude_content_types: ['image', 'video', 'file', 'audio'] },
    ]);
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
    expect(mockSearchMessages).toHaveBeenCalledTimes(1);

    rerender({ category: 'image' as MessageCategory });
    // 只推进 1 个 tick（远小于 500ms 防抖窗）就应该已经重查
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(mockSearchMessages).toHaveBeenCalledTimes(2);
    expect(mockSearchMessages.mock.calls[1]).toEqual([
      'hello',
      CONVERSATION_SEARCH_LIMIT,
      { conversation_id: CONV_ID, include_content_types: ['image'] },
    ]);
  });

  it('DB 抛错：error 被填充、结果清空、loading 收敛', async () => {
    mockSearchMessages.mockRejectedValue(new Error('db down'));
    const { result } = renderHook(() => useConversationMessageSearch(CONV_ID, 'hello', 'all'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.error).toBe('db down');
    expect(result.current.hits).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});

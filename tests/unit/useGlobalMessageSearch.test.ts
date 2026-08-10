/**
 * useGlobalMessageSearch Hook 测试
 *
 * 覆盖：
 * 1. query 为空时不调用 DB，返回空 groups
 * 2. query 非空触发 500ms 防抖后调 DB
 * 3. 快速连续输入只在最后一次触发 DB 调用（防抖）
 * 4. 返回结果按 conversation_id 分组
 * 5. DB 抛错时 error 字段被填充
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockSearchMessages = vi.hoisted(() => vi.fn());

vi.mock('../../src/db', () => ({
  searchMessages: mockSearchMessages,
}));

import { useGlobalMessageSearch } from '../../src/hooks/useGlobalMessageSearch';
import type { SearchMessageResult } from '../../src/db';

const buildHit = (
  messageUuid: string,
  conversationId: string,
  conversationType: 'friend' | 'group',
  conversationName: string,
  content: string,
): SearchMessageResult => ({
  message: {
    message_uuid: messageUuid,
    conversation_id: conversationId,
    conversation_type: conversationType,
    sender_id: 'u1',
    sender_name: 'User1',
    sender_avatar: null,
    content,
    content_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    file_hash: null,
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
  },
  conversation_name: conversationName,
  conversation_avatar: null,
  context_before: null,
  context_after: null,
});

describe('useGlobalMessageSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSearchMessages.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('empty query: no DB call, empty groups', () => {
    const { result } = renderHook(() => useGlobalMessageSearch(''));
    expect(result.current.groups).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(mockSearchMessages).not.toHaveBeenCalled();
  });

  it('non-empty query: triggers DB after 500ms debounce', async () => {
    mockSearchMessages.mockResolvedValue([]);
    const { result } = renderHook(() => useGlobalMessageSearch('hello'));

    expect(mockSearchMessages).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockSearchMessages).toHaveBeenCalledTimes(1);
    expect(mockSearchMessages).toHaveBeenLastCalledWith('hello', 50);
  });

  it('rapid input: only the last query is searched (debounce)', async () => {
    mockSearchMessages.mockResolvedValue([]);
    const { rerender } = renderHook(({ q }: { q: string }) => useGlobalMessageSearch(q), {
      initialProps: { q: 'a' },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    rerender({ q: 'ab' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    rerender({ q: 'abc' });

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockSearchMessages).toHaveBeenCalledTimes(1);
    expect(mockSearchMessages).toHaveBeenLastCalledWith('abc', 50);
  });

  it('groups results by conversation_id', async () => {
    mockSearchMessages.mockResolvedValue([
      buildHit('m1', 'conv-a-b', 'friend', 'Alice', 'hello world'),
      buildHit('m2', 'conv-a-b', 'friend', 'Alice', 'hello there'),
      buildHit('m3', 'group-1', 'group', 'GroupOne', 'hello team'),
    ]);
    const { result } = renderHook(() => useGlobalMessageSearch('hello'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.groups).toHaveLength(2);
    const friendGroup = result.current.groups.find((g) => g.conversationId === 'conv-a-b');
    const groupGroup = result.current.groups.find((g) => g.conversationId === 'group-1');
    expect(friendGroup?.hits).toHaveLength(2);
    expect(friendGroup?.conversationType).toBe('friend');
    expect(friendGroup?.conversationName).toBe('Alice');
    expect(groupGroup?.hits).toHaveLength(1);
    expect(groupGroup?.conversationType).toBe('group');
  });

  it('DB error: error field populated, groups empty', async () => {
    mockSearchMessages.mockRejectedValue(new Error('db crash'));
    const { result } = renderHook(() => useGlobalMessageSearch('q'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.error).toBe('db crash');
    expect(result.current.groups).toEqual([]);
  });

  it('non-Error rejection: falls back to "搜索失败"', async () => {
    mockSearchMessages.mockRejectedValue('plain string error');
    const { result } = renderHook(() => useGlobalMessageSearch('q'));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.error).toBe('搜索失败');
    expect(result.current.groups).toEqual([]);
  });

  it('query cleared after results: groups reset, loading false', async () => {
    mockSearchMessages.mockResolvedValue([buildHit('m1', 'c1', 'friend', 'A', 'x')]);
    const { result, rerender } = renderHook(({ q }: { q: string }) => useGlobalMessageSearch(q), {
      initialProps: { q: 'hello' },
    });

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.groups).toHaveLength(1);

    rerender({ q: '' });
    expect(result.current.groups).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});

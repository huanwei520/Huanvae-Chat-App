/**
 * useLocalConversations 并发重读陈旧覆盖回归测试（L2：jsdom + mock db/session）
 *
 * 防回归契约：loadConversations 并发重读时必须以单调请求序号守卫，
 * 先发后至的陈旧响应不得覆盖最新请求已落地的结果（否则会话预览整体
 * 回退旧数据 → 排序输入翻动 → 列表卡片上下抽搐一个来回）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ConversationWithPreview } from '../../src/db';

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  getConversationPreviews: vi.fn(),
}));

vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: mocks.useSession,
}));

vi.mock('../../src/db', () => ({
  getConversationPreviews: mocks.getConversationPreviews,
}));

import { useLocalConversations } from '../../src/hooks/useLocalConversations';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function groupRow(id: string, content: string): ConversationWithPreview {
  return {
    id,
    type: 'group',
    name: id,
    avatar_url: null,
    last_seq: 1,
    unread_count: 0,
    is_muted: false,
    is_pinned: false,
    updated_at: '2026-01-01T00:00:00Z',
    msg_content: content,
    msg_content_type: 'text',
    msg_send_time: '2026-01-01T00:00:00Z',
  };
}

beforeEach(() => {
  mocks.useSession.mockReturnValue({ session: { userId: 'me' } });
  mocks.getConversationPreviews.mockReset();
});

describe('useLocalConversations 陈旧响应丢弃（单调序号守卫）', () => {
  it('先发请求后到 → 丢弃，终态 = 最后发起请求的结果', async () => {
    const d1 = deferred<ConversationWithPreview[]>();
    const d2 = deferred<ConversationWithPreview[]>();
    mocks.getConversationPreviews
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise);

    const { result } = renderHook(() => useLocalConversations());
    // mount effect 发起第 1 次加载（挂起中）
    expect(mocks.getConversationPreviews).toHaveBeenCalledTimes(1);

    // 第 2 次加载发起（第 1 次仍在途）
    act(() => { void result.current.refresh(); });
    expect(mocks.getConversationPreviews).toHaveBeenCalledTimes(2);

    // 后发请求先回（最新数据）→ 落地
    await act(async () => { d2.resolve([groupRow('g1', '新数据')]); });
    expect(result.current.getGroupPreview('g1')?.lastMessage).toBe('新数据');

    // 先发请求后回（陈旧数据）→ 必须被丢弃，不覆盖
    await act(async () => { d1.resolve([groupRow('g1', '旧数据')]); });
    expect(result.current.getGroupPreview('g1')?.lastMessage).toBe('新数据');
    expect(result.current.loading).toBe(false);
    expect(result.current.initialized).toBe(true);
  });

  it('陈旧响应先回（最新仍在途）→ 不落地，终态仍 = 最新请求结果', async () => {
    const d1 = deferred<ConversationWithPreview[]>();
    const d2 = deferred<ConversationWithPreview[]>();
    mocks.getConversationPreviews
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise);

    const { result } = renderHook(() => useLocalConversations());
    act(() => { void result.current.refresh(); });

    // 陈旧请求先回：在最新请求落地前不得写入预览
    await act(async () => { d1.resolve([groupRow('g1', '旧数据')]); });
    expect(result.current.getGroupPreview('g1')).toBeUndefined();
    // 最新请求仍在途，loading 保持 true（由最新请求收尾）
    expect(result.current.loading).toBe(true);

    await act(async () => { d2.resolve([groupRow('g1', '新数据')]); });
    expect(result.current.getGroupPreview('g1')?.lastMessage).toBe('新数据');
    expect(result.current.loading).toBe(false);
    expect(result.current.initialized).toBe(true);
  });

  it('无并发时单次加载正常落地（守卫不误伤常规路径）', async () => {
    const d1 = deferred<ConversationWithPreview[]>();
    mocks.getConversationPreviews.mockReturnValueOnce(d1.promise);

    const { result } = renderHook(() => useLocalConversations());
    await act(async () => { d1.resolve([groupRow('g1', '唯一数据')]); });
    expect(result.current.getGroupPreview('g1')?.lastMessage).toBe('唯一数据');
    expect(result.current.loading).toBe(false);
    expect(result.current.initialized).toBe(true);
  });
});

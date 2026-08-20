/**
 * useDiscoverySearch Hook 测试（服务端统一发现搜索：人 / 群 / bot）
 *
 * 覆盖：
 * 1. 空 query（含仅空白）→ 不调 searchDiscovery，三类结果空，loading false
 * 2. 非空 query 经 500ms 防抖后调 searchDiscovery(api, kw) 一次，
 *    并把后端卡片映射为视图模型（头像经 resolveServerAvatarUrl 收口）
 * 3. searchDiscovery 抛错 → error 被设置且三类结果清空（独立降级）
 * 4. 快速连续输入只在最后一次触发（防抖）
 *
 * mock 约定：
 * - useApi 返回 vi.hoisted 稳定单例 mockApi（对齐真实 Context 的引用稳定性，避免虚假触发依赖 effect）
 * - resolveServerAvatarUrl 用哨兵变换替代（断言"确实经收口点解析、而非裸后端 URL"）
 * - setTimeout 防抖 + await mock：用 vi.advanceTimersByTimeAsync / runAllTimersAsync 推进（含 microtask flush）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('../../src/contexts/SessionContext', () => ({ useApi: () => mockApi }));

const mockSearchDiscovery = vi.hoisted(() => vi.fn());
vi.mock('../../src/api/discovery', () => ({ searchDiscovery: mockSearchDiscovery }));

vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (p: string | null | undefined) => (p ? `proxied://${p}` : null),
}));

import { useDiscoverySearch } from '../../src/hooks/useDiscoverySearch';

describe('useDiscoverySearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSearchDiscovery.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('空 query（仅空白）：不调 searchDiscovery，三类结果为空，loading false', () => {
    const { result } = renderHook(() => useDiscoverySearch('   '));

    expect(mockSearchDiscovery).not.toHaveBeenCalled();
    expect(result.current.people).toEqual([]);
    expect(result.current.groups).toEqual([]);
    expect(result.current.bots).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('非空 query 防抖 500ms 后调 searchDiscovery(api, kw) 一次，并映射为视图模型（头像经收口）', async () => {
    mockSearchDiscovery.mockResolvedValue({
      people: [{ user_id: 'u1', nickname: 'N', avatar_url: 'a.jpg', is_friend: false }],
      groups: [
        {
          group_id: 'g1',
          group_name: 'G',
          avatar_url: 'gg.jpg',
          member_count: 5,
          join_approval_required: false,
          is_member: true,
        },
      ],
      bots: [{ bot_user_id: 'bot_1', username: 'weatherbot', nickname: 'B', avatar_url: null, is_friend: true }],
    });

    const { result } = renderHook(() => useDiscoverySearch('kw'));

    // 防抖窗口内未触发，但已进入 loading
    expect(mockSearchDiscovery).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(mockSearchDiscovery).toHaveBeenCalledTimes(1);
    expect(mockSearchDiscovery).toHaveBeenCalledWith(mockApi, 'kw');

    expect(result.current.people).toEqual([
      { userId: 'u1', nickname: 'N', avatarUrl: 'proxied://a.jpg', isFriend: false },
    ]);
    // `toEqual` 是**逐键全等**（不是包含）⇒ 视图模型多出任何一个键都会红，
    // 已删除的那个入群模式派生键被加回来时同样红（变异 M7 实测：报的就是这一条）。
    // 🔴 故意**不再**额外写一条点名该键的 `not.toHaveProperty` —— 那条断言的载荷已被本行覆盖，
    // 而写出它会让"全仓不得再出现该 token"这条验收判据自己变红（同族坑见
    // frontend-test.md「不变量口径写『禁裸写死』，不是『禁出现该数字』」）。
    expect(result.current.groups).toEqual([
      { groupId: 'g1', groupName: 'G', avatarUrl: 'proxied://gg.jpg', memberCount: 5, isMember: true },
    ]);
    expect(result.current.bots).toEqual([
      { botUserId: 'bot_1', username: 'weatherbot', nickname: 'B', avatarUrl: null, isFriend: true },
    ]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('searchDiscovery 抛错 → error 被设置且三类结果清空（独立降级）', async () => {
    mockSearchDiscovery.mockRejectedValue(new Error('discovery down'));
    const { result } = renderHook(() => useDiscoverySearch('kw'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.error).toBe('discovery down');
    expect(result.current.people).toEqual([]);
    expect(result.current.groups).toEqual([]);
    expect(result.current.bots).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('非 Error 拒绝 → 回退文案「搜索失败」', async () => {
    mockSearchDiscovery.mockRejectedValue('plain string');
    const { result } = renderHook(() => useDiscoverySearch('kw'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.error).toBe('搜索失败');
  });

  it('快速连续输入只在最后一次触发 searchDiscovery（防抖）', async () => {
    mockSearchDiscovery.mockResolvedValue({ people: [], groups: [], bots: [] });
    const { rerender } = renderHook(({ q }: { q: string }) => useDiscoverySearch(q), {
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

    expect(mockSearchDiscovery).toHaveBeenCalledTimes(1);
    expect(mockSearchDiscovery).toHaveBeenCalledWith(mockApi, 'abc');
  });
});

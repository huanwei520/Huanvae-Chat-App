/**
 * useChatMenu 好友关系操作 handler 测试
 *
 * 覆盖从资料页移到三条杠菜单的关系操作 handler：
 * - handleToggleSpecialCare：按当前状态 add/removeSpecialCare + 乐观更新 store
 * - handleBlacklist：addBlacklist + 乐观更新 store + 回到 main 视图
 * - handleUnblacklist：removeBlacklist + 乐观更新 store
 * - isFriendSpecialCare / isFriendBlacklisted 反映 store 实时状态
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useChatStore } from '../../src/stores/chatStore';
import type { Friend } from '../../src/types/chat';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => mockApi,
  useSession: () => ({ session: { userId: 'me' } }),
}));

vi.mock('../../src/components/common/AvatarCropModal', () => ({
  useAvatarCrop: () => ({ requestCrop: vi.fn(), cropModal: null }),
}));

const friendsApi = vi.hoisted(() => ({
  removeFriend: vi.fn(),
  setFriendRemark: vi.fn(),
  addBlacklist: vi.fn(),
  removeBlacklist: vi.fn(),
  addSpecialCare: vi.fn(),
  removeSpecialCare: vi.fn(),
}));
vi.mock('../../src/api/friends', () => friendsApi);

import { useChatMenu } from '../../src/chat/group/useChatMenu';

function makeFriend(overrides: Partial<Friend> = {}): Friend {
  return {
    friend_id: 'f1',
    friend_nickname: 'Friend One',
    friend_avatar_url: null,
    add_time: '',
    approve_reason: null,
    friend_remark: null,
    is_blacklisted: false,
    is_special_care: false,
    ...overrides,
  };
}

function setStoreFriend(f: Friend) {
  useChatStore.setState({ friends: [f] });
}

const target = (f: Friend) => ({ type: 'friend' as const, data: f });

describe('useChatMenu 好友关系操作', () => {
  beforeEach(() => {
    Object.values(friendsApi).forEach((m) => { m.mockReset(); m.mockResolvedValue(undefined); });
  });

  it('isFriendSpecialCare / isFriendBlacklisted 反映 store 状态', () => {
    const f = makeFriend({ is_special_care: true, is_blacklisted: true });
    setStoreFriend(f);
    const { result } = renderHook(() => useChatMenu({ target: target(f) }));
    expect(result.current.isFriendSpecialCare).toBe(true);
    expect(result.current.isFriendBlacklisted).toBe(true);
  });

  it('handleToggleSpecialCare：未关心 → addSpecialCare + store 置 true', async () => {
    const f = makeFriend({ is_special_care: false });
    setStoreFriend(f);
    const { result } = renderHook(() => useChatMenu({ target: target(f) }));

    await act(async () => { await result.current.handleToggleSpecialCare(); });

    expect(friendsApi.addSpecialCare).toHaveBeenCalledWith(mockApi, 'f1');
    expect(friendsApi.removeSpecialCare).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(useChatStore.getState().friends.find((x) => x.friend_id === 'f1')?.is_special_care).toBe(true);
    });
  });

  it('handleToggleSpecialCare：已关心 → removeSpecialCare + store 置 false', async () => {
    const f = makeFriend({ is_special_care: true });
    setStoreFriend(f);
    const { result } = renderHook(() => useChatMenu({ target: target(f) }));

    await act(async () => { await result.current.handleToggleSpecialCare(); });

    expect(friendsApi.removeSpecialCare).toHaveBeenCalledWith(mockApi, 'f1');
    expect(friendsApi.addSpecialCare).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(useChatStore.getState().friends.find((x) => x.friend_id === 'f1')?.is_special_care).toBe(false);
    });
  });

  it('handleBlacklist：addBlacklist + store 置 true + 视图回 main', async () => {
    const f = makeFriend({ is_blacklisted: false });
    setStoreFriend(f);
    const { result } = renderHook(() => useChatMenu({ target: target(f) }));
    act(() => { result.current.handleSetView('confirm-blacklist'); });
    expect(result.current.view).toBe('confirm-blacklist');

    await act(async () => { await result.current.handleBlacklist(); });

    expect(friendsApi.addBlacklist).toHaveBeenCalledWith(mockApi, 'f1');
    await waitFor(() => {
      expect(useChatStore.getState().friends.find((x) => x.friend_id === 'f1')?.is_blacklisted).toBe(true);
    });
    expect(result.current.view).toBe('main');
  });

  it('handleUnblacklist：removeBlacklist + store 置 false', async () => {
    const f = makeFriend({ is_blacklisted: true });
    setStoreFriend(f);
    const { result } = renderHook(() => useChatMenu({ target: target(f) }));

    await act(async () => { await result.current.handleUnblacklist(); });

    expect(friendsApi.removeBlacklist).toHaveBeenCalledWith(mockApi, 'f1');
    await waitFor(() => {
      expect(useChatStore.getState().friends.find((x) => x.friend_id === 'f1')?.is_blacklisted).toBe(false);
    });
  });

  it('特别关心失败：store 不变（无乐观写入）', async () => {
    const f = makeFriend({ is_special_care: false });
    setStoreFriend(f);
    friendsApi.addSpecialCare.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useChatMenu({ target: target(f) }));

    await act(async () => { await result.current.handleToggleSpecialCare(); });

    await waitFor(() => {
      expect(useChatStore.getState().friends.find((x) => x.friend_id === 'f1')?.is_special_care).toBe(false);
    });
  });
});

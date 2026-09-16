/**
 * 好友申请处理 → 「+」角标即时扣减 测试（块 1789554954434-8kvwan3p-1）
 *
 * 根因回归：approve/reject 好友申请（及接受/拒绝群邀请）成功回执后，
 * WebSocketContext.pendingNotifications 未扣减 → 「+」红点挂着要重登才消。
 * 覆盖：usePendingRequests 四个动作成功回执后调用 decrementPendingNotification；
 * 动作失败（API 抛错）不扣减。WebSocketProvider 真实现的 floor 0 见
 * tests/unit/wsPendingDecrement.test.tsx。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  useApi: vi.fn(),
  approveFriendRequest: vi.fn(),
  rejectFriendRequest: vi.fn(),
  acceptGroupInvitation: vi.fn(),
  declineGroupInvitation: vi.fn(),
  decrementPendingNotification: vi.fn(),
}));

vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: mocks.useSession,
  useApi: mocks.useApi,
}));
vi.mock('../../src/contexts/WebSocketContext', () => ({
  useWebSocket: () => ({ decrementPendingNotification: mocks.decrementPendingNotification }),
}));
vi.mock('../../src/api/friends', () => ({
  approveFriendRequest: mocks.approveFriendRequest,
  rejectFriendRequest: mocks.rejectFriendRequest,
}));
vi.mock('../../src/api/groups', () => ({
  acceptGroupInvitation: mocks.acceptGroupInvitation,
  declineGroupInvitation: mocks.declineGroupInvitation,
}));
// loadPendingSources 返回空四类，让 hook 挂载即完成加载（动作不经真实 API 面）
vi.mock('../../src/components/unified/pendingRequests', () => ({
  buildPendingItems: (s: unknown) => s,
  loadPendingSources: vi.fn(() => Promise.resolve({
    friendRequests: [],
    groupInvites: [],
    sentFriendReqs: [],
    sentJoinReqs: [],
  })),
}));

import { usePendingRequests } from '../../src/hooks/usePendingRequests';
import type { PendingRequest } from '../../src/api/friends';
import type { GroupInvitation } from '../../src/api/groups';

function friendReq(over: Partial<PendingRequest>): PendingRequest {
  return {
    request_id: 'req-1',
    request_user_id: 'user-A',
    requester_nickname: 'A',
    requester_avatar_url: null,
    request_message: null,
    request_time: '2026-09-16T00:00:00Z',
    ...over,
  } as unknown as PendingRequest;
}

function groupInv(over: Partial<GroupInvitation>): GroupInvitation {
  return {
    request_id: 'inv-1',
    group_id: 'g1',
    group_name: '群1',
    group_avatar_url: null,
    inviter_nickname: 'X',
    message: null,
    created_at: '2026-09-16T00:00:00Z',
    ...over,
  } as unknown as GroupInvitation;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useSession.mockReturnValue({ session: { userId: 'me' } });
  mocks.useApi.mockReturnValue({});
  mocks.approveFriendRequest.mockResolvedValue(undefined);
  mocks.rejectFriendRequest.mockResolvedValue(undefined);
  mocks.acceptGroupInvitation.mockResolvedValue(undefined);
  mocks.declineGroupInvitation.mockResolvedValue(undefined);
});

describe('usePendingRequests 动作回执后扣减「+」角标', () => {
  it('通过好友申请成功 → decrementPendingNotification("friendRequests") 调一次', async () => {
    const { result } = renderHook(() =>
      usePendingRequests({ onFriendAdded: vi.fn(), addGroup: vi.fn() }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.approveFriend(friendReq({ request_id: 'r1' }));
    });

    expect(mocks.approveFriendRequest).toHaveBeenCalledTimes(1);
    expect(mocks.decrementPendingNotification).toHaveBeenCalledTimes(1);
    expect(mocks.decrementPendingNotification).toHaveBeenCalledWith('friendRequests');
  });

  it('拒绝好友申请成功 → 同样扣减 friendRequests', async () => {
    const { result } = renderHook(() => usePendingRequests());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.rejectFriend(friendReq({ request_id: 'r2' }));
    });

    expect(mocks.rejectFriendRequest).toHaveBeenCalledTimes(1);
    expect(mocks.decrementPendingNotification).toHaveBeenCalledTimes(1);
    expect(mocks.decrementPendingNotification).toHaveBeenCalledWith('friendRequests');
  });

  it('接受群邀请成功 → 扣减 groupInvites', async () => {
    const { result } = renderHook(() => usePendingRequests());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.acceptInvite(groupInv({ request_id: 'i1' }));
    });

    expect(mocks.acceptGroupInvitation).toHaveBeenCalledTimes(1);
    expect(mocks.decrementPendingNotification).toHaveBeenCalledTimes(1);
    expect(mocks.decrementPendingNotification).toHaveBeenCalledWith('groupInvites');
  });

  it('拒绝群邀请成功 → 扣减 groupInvites', async () => {
    const { result } = renderHook(() => usePendingRequests());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.declineInvite(groupInv({ request_id: 'i2' }));
    });

    expect(mocks.declineGroupInvitation).toHaveBeenCalledTimes(1);
    expect(mocks.decrementPendingNotification).toHaveBeenCalledTimes(1);
    expect(mocks.decrementPendingNotification).toHaveBeenCalledWith('groupInvites');
  });

  it('通过失败（API 抛错）→ 不扣减角标', async () => {
    mocks.approveFriendRequest.mockRejectedValue(new Error('网络错误'));
    const { result } = renderHook(() => usePendingRequests());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.approveFriend(friendReq({ request_id: 'r3' }));
    });

    expect(result.current.error).toBe('网络错误');
    expect(mocks.decrementPendingNotification).not.toHaveBeenCalled();
  });

  it('未登录（session null）→ 动作直接返回，不扣减', async () => {
    mocks.useSession.mockReturnValue({ session: null });
    const { result } = renderHook(() => usePendingRequests());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.approveFriend(friendReq({ request_id: 'r4' }));
    });

    expect(mocks.approveFriendRequest).not.toHaveBeenCalled();
    expect(mocks.decrementPendingNotification).not.toHaveBeenCalled();
  });
});

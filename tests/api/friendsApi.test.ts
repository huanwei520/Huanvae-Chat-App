/**
 * 好友 API 封装单元测试（src/api/friends.ts）
 *
 * 仅覆盖 6 个未被其他测试文件覆盖的函数：
 *   getFriends / getPendingRequests / approveFriendRequest /
 *   rejectFriendRequest / getPresence / removeFriend
 * （sendFriendRequest / setFriendRemark / 黑名单 / 特别关心 / getBlacklistTimes
 *  已在其他文件覆盖，此处不重复。）
 *
 * 用假 ApiClient（get/post/put/delete/patch 为 vi.fn）验证每个函数：
 *   - 正常：以正确 path/body 调用 api.get/post，并返回解包后的数据；
 *   - 分支：rejectReason / removeReason 缺省与显式两条分支的 body 差异；
 *   - 异常：api 抛错时函数原样向上抛（薄封装不 try/catch 不兜底）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ApiClient } from '../../src/api/client';
import * as friends from '../../src/api/friends';

function makeApi() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    getBaseUrl: vi.fn(),
    getAccessToken: vi.fn(),
    refreshAccessToken: vi.fn(),
  } as unknown as ApiClient & {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
  };
}

describe('好友 API 封装 (api/friends)', () => {
  let api: ReturnType<typeof makeApi>;

  beforeEach(() => {
    api = makeApi();
  });

  // ---- getFriends ----

  it('getFriends 正常：GET /api/friends 并原样返回响应', async () => {
    const resp = { items: [{ friend_user_id: 'u2' }] };
    api.get.mockResolvedValue(resp);
    const out = await friends.getFriends(api);
    expect(api.get).toHaveBeenCalledWith('/api/friends');
    expect(out).toEqual(resp);
  });

  it('getFriends 异常：api.get 抛错时向上抛', async () => {
    api.get.mockRejectedValue(new Error('friends-fail'));
    await expect(friends.getFriends(api)).rejects.toThrow('friends-fail');
  });

  // ---- getPendingRequests ----

  it('getPendingRequests 正常：GET /api/friends/requests/pending 并原样返回数组', async () => {
    const resp = [
      {
        request_id: 'r1',
        request_user_id: 'u9',
        request_message: 'hi',
        request_time: '2026-07-01T00:00:00Z',
        requester_nickname: '张三',
        requester_avatar_url: null,
      },
    ];
    api.get.mockResolvedValue(resp);
    const out = await friends.getPendingRequests(api);
    expect(api.get).toHaveBeenCalledWith('/api/friends/requests/pending');
    expect(out).toEqual(resp);
  });

  it('getPendingRequests 异常：向上抛', async () => {
    api.get.mockRejectedValue(new Error('pending-fail'));
    await expect(friends.getPendingRequests(api)).rejects.toThrow('pending-fail');
  });

  // ---- approveFriendRequest ----

  it('approveFriendRequest 正常：POST approve 带 user_id + applicant_user_id', async () => {
    api.post.mockResolvedValue(undefined);
    const out = await friends.approveFriendRequest(api, 'me-1', 'applicant-2');
    expect(api.post).toHaveBeenCalledWith('/api/friends/requests/approve', {
      user_id: 'me-1',
      applicant_user_id: 'applicant-2',
    });
    expect(out).toBeUndefined();
  });

  it('approveFriendRequest 异常：向上抛', async () => {
    api.post.mockRejectedValue(new Error('approve-fail'));
    await expect(friends.approveFriendRequest(api, 'me-1', 'applicant-2')).rejects.toThrow(
      'approve-fail',
    );
  });

  // ---- rejectFriendRequest ----

  it('rejectFriendRequest 带原因：body 含 reject_reason', async () => {
    api.post.mockResolvedValue(undefined);
    await friends.rejectFriendRequest(api, 'me-1', 'applicant-2', '不认识你');
    expect(api.post).toHaveBeenCalledWith('/api/friends/requests/reject', {
      user_id: 'me-1',
      applicant_user_id: 'applicant-2',
      reject_reason: '不认识你',
    });
  });

  it('rejectFriendRequest 不带原因：body 无 reject_reason 键', async () => {
    api.post.mockResolvedValue(undefined);
    await friends.rejectFriendRequest(api, 'me-1', 'applicant-2');
    // toHaveBeenCalledWith 用 toEqual 语义严格比对整个对象：多出 reject_reason 键会失败
    expect(api.post).toHaveBeenCalledWith('/api/friends/requests/reject', {
      user_id: 'me-1',
      applicant_user_id: 'applicant-2',
    });
  });

  it('rejectFriendRequest 异常：向上抛', async () => {
    api.post.mockRejectedValue(new Error('reject-fail'));
    await expect(friends.rejectFriendRequest(api, 'me-1', 'applicant-2')).rejects.toThrow(
      'reject-fail',
    );
  });

  // ---- getPresence ----

  it('getPresence 正常：GET /api/friends/presence 并原样返回数组', async () => {
    const resp = [
      { user_id: 'u2', online: true },
      { user_id: 'u3', online: false, last_seen_at: '2026-07-16T12:00:00Z' },
    ];
    api.get.mockResolvedValue(resp);
    const out = await friends.getPresence(api);
    expect(api.get).toHaveBeenCalledWith('/api/friends/presence');
    expect(out).toEqual(resp);
  });

  it('getPresence 异常：向上抛', async () => {
    api.get.mockRejectedValue(new Error('presence-fail'));
    await expect(friends.getPresence(api)).rejects.toThrow('presence-fail');
  });

  // ---- removeFriend（body 含 new Date()，用 fake timers 固定系统时间以断言精确 body）----

  describe('removeFriend', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('带原因：body 含 remove_reason + 固定 remove_time', async () => {
      api.post.mockResolvedValue(undefined);
      await friends.removeFriend(api, 'me-1', 'friend-2', '互删');
      expect(api.post).toHaveBeenCalledWith('/api/friends/remove', {
        user_id: 'me-1',
        friend_user_id: 'friend-2',
        remove_time: '2026-07-17T00:00:00.000Z',
        remove_reason: '互删',
      });
    });

    it('不带原因：remove_reason 默认空串（removeReason || \'\'）', async () => {
      api.post.mockResolvedValue(undefined);
      await friends.removeFriend(api, 'me-1', 'friend-2');
      expect(api.post).toHaveBeenCalledWith('/api/friends/remove', {
        user_id: 'me-1',
        friend_user_id: 'friend-2',
        remove_time: '2026-07-17T00:00:00.000Z',
        remove_reason: '',
      });
    });

    it('异常：api.post 抛错时向上抛', async () => {
      api.post.mockRejectedValue(new Error('remove-fail'));
      await expect(friends.removeFriend(api, 'me-1', 'friend-2')).rejects.toThrow('remove-fail');
    });
  });
});

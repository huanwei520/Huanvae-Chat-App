/**
 * useAddFriendFlow 测试：加好友「预览确认」流程
 *
 * 查找 → 出确认卡 → 确认发送；查无此人空态；不能加自己。
 * （替代 ButtonMigration 里被移除的 props-driven AddFriendTab 用例）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  getPublicProfile: vi.fn(),
  sendFriendRequest: vi.fn(),
  api: { tag: 'api' },
  session: { userId: 'me' },
  friends: [] as Array<{ friend_id: string }>,
}));

vi.mock('../../src/api/profile', () => ({ getPublicProfile: mocks.getPublicProfile }));
vi.mock('../../src/api/friends', () => ({ sendFriendRequest: mocks.sendFriendRequest }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => mocks.api,
  useSession: () => ({ session: mocks.session }),
}));
vi.mock('../../src/stores', () => ({
  useChatStore: (sel: (s: { friends: Array<{ friend_id: string }> }) => unknown) => sel({ friends: mocks.friends }),
}));

import { useAddFriendFlow } from '../../src/hooks/useAddFriendFlow';

const PROFILE = {
  user_id: 'bob',
  user_nickname: 'Bob',
  user_signature: 'hi',
  user_avatar_url: null,
  background_url: null,
  gender: null,
  birthday: null,
  region: null,
  created_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  mocks.getPublicProfile.mockReset();
  mocks.sendFriendRequest.mockReset();
  mocks.friends = [];
});

describe('useAddFriendFlow', () => {
  it('lookup 命中：拉公开资料出确认卡', async () => {
    mocks.getPublicProfile.mockResolvedValue(PROFILE);
    const { result } = renderHook(() => useAddFriendFlow());
    act(() => result.current.setFriendId('bob'));
    await act(async () => { await result.current.lookup(); });
    expect(mocks.getPublicProfile).toHaveBeenCalledWith(mocks.api, 'bob');
    expect(result.current.preview).toEqual(PROFILE);
    expect(result.current.notFound).toBe(false);
  });

  it('lookup 查无此人：空态，不出确认卡', async () => {
    mocks.getPublicProfile.mockRejectedValue(new Error('404'));
    const { result } = renderHook(() => useAddFriendFlow());
    act(() => result.current.setFriendId('ghost'));
    await act(async () => { await result.current.lookup(); });
    expect(result.current.preview).toBeNull();
    expect(result.current.notFound).toBe(true);
  });

  it('不能添加自己：给出错误、不发请求', async () => {
    const { result } = renderHook(() => useAddFriendFlow());
    act(() => result.current.setFriendId('me'));
    await act(async () => { await result.current.lookup(); });
    expect(mocks.getPublicProfile).not.toHaveBeenCalled();
    expect(result.current.error).toBe('不能添加自己为好友');
    expect(result.current.preview).toBeNull();
  });

  it('确认发送：调用 sendFriendRequest 并置 sent + 触发 onSent', async () => {
    mocks.getPublicProfile.mockResolvedValue(PROFILE);
    mocks.sendFriendRequest.mockResolvedValue(undefined);
    const onSent = vi.fn();
    const { result } = renderHook(() => useAddFriendFlow(onSent));
    act(() => result.current.setFriendId('bob'));
    act(() => result.current.setReason('hello'));
    await act(async () => { await result.current.lookup(); });
    await act(async () => { await result.current.send(); });
    expect(mocks.sendFriendRequest).toHaveBeenCalledWith(mocks.api, 'me', 'bob', 'hello');
    expect(result.current.sent).toBe(true);
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it('改 ID 会清空上一次预览（避免旧确认卡串台）', async () => {
    mocks.getPublicProfile.mockResolvedValue(PROFILE);
    const { result } = renderHook(() => useAddFriendFlow());
    act(() => result.current.setFriendId('bob'));
    await act(async () => { await result.current.lookup(); });
    expect(result.current.preview).toEqual(PROFILE);
    act(() => result.current.setFriendId('bob2'));
    expect(result.current.preview).toBeNull();
    expect(result.current.notFound).toBe(false);
  });

  it('已是好友：isFriend=true（UI 据此提示）', async () => {
    mocks.friends = [{ friend_id: 'bob' }];
    const { result } = renderHook(() => useAddFriendFlow());
    act(() => result.current.setFriendId('bob'));
    expect(result.current.isFriend).toBe(true);
  });

  it('改 ID 作废进行中的旧查找：bob 迟到结果不覆盖 carol 的预览（防串台）', async () => {
    let resolveBob: (v: unknown) => void = () => {};
    mocks.getPublicProfile.mockImplementation((_api: unknown, id: string) =>
      (id === 'bob'
        ? new Promise((res) => { resolveBob = res as (v: unknown) => void; })
        : Promise.resolve(PROFILE)),
    );
    const { result } = renderHook(() => useAddFriendFlow());
    act(() => result.current.setFriendId('bob'));
    let p: Promise<void> = Promise.resolve();
    act(() => { p = result.current.lookup(); });   // 对 bob 的查找进行中
    act(() => result.current.setFriendId('carol')); // 查找中改 ID → 作废
    await act(async () => { resolveBob(PROFILE); await p; }); // bob 迟到 resolve
    expect(result.current.preview).toBeNull();       // 旧结果被丢弃
    expect(result.current.friendId).toBe('carol');
  });
});

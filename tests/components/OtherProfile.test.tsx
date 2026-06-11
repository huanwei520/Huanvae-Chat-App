/**
 * 他人资料页测试
 *
 * 覆盖：
 * - profileViewStore：open/close 切换 userId
 * - OtherProfilePanel：拉公开资料展示字段；非好友显示"加好友"并调用 sendFriendRequest；
 *   好友显示"发送消息"并调用 onSendMessage + onClose；M3 关系操作区占位存在
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { useProfileViewStore } from '../../src/stores/profileViewStore';
import { useChatStore } from '../../src/stores/chatStore';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const sessionState = vi.hoisted(() => ({ session: { userId: 'me' } }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => mockApi,
  useSession: () => sessionState,
}));

const mockGetPublicProfile = vi.hoisted(() => vi.fn());
vi.mock('../../src/api/profile', () => ({ getPublicProfile: mockGetPublicProfile }));

const mockSendFriendRequest = vi.hoisted(() => vi.fn());
vi.mock('../../src/api/friends', () => ({ sendFriendRequest: mockSendFriendRequest }));

import { OtherProfilePanel } from '../../src/chat/shared/OtherProfilePanel';

function setFriends(ids: string[]) {
  useChatStore.setState({
    friends: ids.map((id) => ({
      friend_id: id,
      friend_nickname: `nick_${id}`,
      friend_avatar_url: null,
      add_time: '',
      approve_reason: null,
      friend_remark: null,
    })),
  });
}

describe('profileViewStore', () => {
  beforeEach(() => { useProfileViewStore.setState({ userId: null }); });

  it('open 设置 userId，close 清空', () => {
    useProfileViewStore.getState().open('u42');
    expect(useProfileViewStore.getState().userId).toBe('u42');
    useProfileViewStore.getState().close();
    expect(useProfileViewStore.getState().userId).toBeNull();
  });
});

describe('OtherProfilePanel', () => {
  beforeEach(() => {
    cleanup();
    mockGetPublicProfile.mockReset();
    mockSendFriendRequest.mockReset();
    mockSendFriendRequest.mockResolvedValue(undefined);
    setFriends([]);
  });

  it('拉取并展示公开字段（昵称/@ID/签名）', async () => {
    mockGetPublicProfile.mockResolvedValue({
      user_id: 'alice', user_nickname: 'Alice', user_signature: '签名内容', user_avatar_url: null,
    });
    render(<OtherProfilePanel userId="alice" onClose={() => {}} onSendMessage={() => {}} />);

    await waitFor(() => expect(screen.getByText('签名内容')).toBeInTheDocument());
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    // 非好友 → 关系状态"非好友" + M3 占位
    expect(screen.getByText('非好友')).toBeInTheDocument();
    expect(screen.getByText('关系操作')).toBeInTheDocument();
  });

  it('非好友点击加好友调用 sendFriendRequest', async () => {
    mockGetPublicProfile.mockResolvedValue({ user_id: 'bob', user_nickname: 'Bob', user_signature: null, user_avatar_url: null });
    render(<OtherProfilePanel userId="bob" onClose={() => {}} onSendMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /添加好友/ }));
    await waitFor(() => expect(mockSendFriendRequest).toHaveBeenCalledTimes(1));
    expect(mockSendFriendRequest).toHaveBeenCalledWith(mockApi, 'me', 'bob');
  });

  it('好友点击发送消息调用 onSendMessage + onClose', async () => {
    setFriends(['carol']);
    mockGetPublicProfile.mockResolvedValue({ user_id: 'carol', user_nickname: 'Carol', user_signature: null, user_avatar_url: null });
    const onSendMessage = vi.fn();
    const onClose = vi.fn();
    render(<OtherProfilePanel userId="carol" onClose={onClose} onSendMessage={onSendMessage} />);
    await waitFor(() => expect(screen.getByText('已是好友')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /发送消息/ }));
    expect(onSendMessage).toHaveBeenCalledWith('carol');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockSendFriendRequest).not.toHaveBeenCalled();
  });

  it('查看自己时不显示操作区与 M3 占位', async () => {
    mockGetPublicProfile.mockResolvedValue({ user_id: 'me', user_nickname: 'Me', user_signature: null, user_avatar_url: null });
    render(<OtherProfilePanel userId="me" onClose={() => {}} onSendMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText('这是你自己')).toBeInTheDocument());
    expect(screen.queryByText('关系操作')).toBeNull();
    expect(screen.queryByRole('button', { name: /添加好友/ })).toBeNull();
  });
});

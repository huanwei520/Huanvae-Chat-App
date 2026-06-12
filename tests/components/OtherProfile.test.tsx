/**
 * 他人公开资料页测试（只读化后）
 *
 * 覆盖：
 * - profileViewStore：open/close 切换 userId
 * - OtherProfilePanel：拉公开资料展示公开字段（昵称/@ID/签名）；
 *   非好友显示"添加好友"并调用 sendFriendRequest；
 *   好友只读（无发送消息/特别关心/拉黑/删除好友等关系操作——已移到私聊三条杠菜单）；
 *   查看自己不显示任何操作按钮。
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
vi.mock('../../src/api/friends', () => ({
  sendFriendRequest: mockSendFriendRequest,
}));

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
      is_blacklisted: false,
      is_special_care: false,
    })),
  });
}

/** 关系操作类按钮（只读资料页一律不应出现） */
const RELATION_OP_PATTERNS = [/发送消息/, /特别关心/, /拉黑/, /删除好友/];

describe('profileViewStore', () => {
  beforeEach(() => { useProfileViewStore.setState({ userId: null }); });

  it('open 设置 userId，close 清空', () => {
    useProfileViewStore.getState().open('u42');
    expect(useProfileViewStore.getState().userId).toBe('u42');
    useProfileViewStore.getState().close();
    expect(useProfileViewStore.getState().userId).toBeNull();
  });
});

describe('OtherProfilePanel（只读公开资料）', () => {
  beforeEach(() => {
    cleanup();
    mockGetPublicProfile.mockReset();
    mockSendFriendRequest.mockReset();
    mockSendFriendRequest.mockResolvedValue(undefined);
    setFriends([]);
  });

  it('拉取并展示公开字段（昵称/@ID/签名），非好友显示状态且无关系操作', async () => {
    mockGetPublicProfile.mockResolvedValue({
      user_id: 'alice', user_nickname: 'Alice', user_signature: '签名内容', user_avatar_url: null,
    });
    render(<OtherProfilePanel userId="alice" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('签名内容')).toBeInTheDocument());
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('非好友')).toBeInTheDocument();
    // 只读：无"关系操作"分区，无任何关系操作按钮
    expect(screen.queryByText('关系操作')).toBeNull();
    for (const pat of RELATION_OP_PATTERNS) {
      expect(screen.queryByRole('button', { name: pat })).toBeNull();
    }
  });

  it('非好友点击加好友调用 sendFriendRequest', async () => {
    mockGetPublicProfile.mockResolvedValue({ user_id: 'bob', user_nickname: 'Bob', user_signature: null, user_avatar_url: null });
    render(<OtherProfilePanel userId="bob" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /添加好友/ }));
    await waitFor(() => expect(mockSendFriendRequest).toHaveBeenCalledTimes(1));
    expect(mockSendFriendRequest).toHaveBeenCalledWith(mockApi, 'me', 'bob');
  });

  it('好友：只读，显示"已是好友"且不含任何关系操作/加好友按钮', async () => {
    setFriends(['carol']);
    mockGetPublicProfile.mockResolvedValue({ user_id: 'carol', user_nickname: 'Carol', user_signature: null, user_avatar_url: null });
    render(<OtherProfilePanel userId="carol" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('已是好友')).toBeInTheDocument());

    for (const pat of RELATION_OP_PATTERNS) {
      expect(screen.queryByRole('button', { name: pat })).toBeNull();
    }
    expect(screen.queryByRole('button', { name: /添加好友/ })).toBeNull();
  });

  it('查看自己：显示"这是你自己"且无加好友按钮', async () => {
    mockGetPublicProfile.mockResolvedValue({ user_id: 'me', user_nickname: 'Me', user_signature: null, user_avatar_url: null });
    render(<OtherProfilePanel userId="me" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('这是你自己')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /添加好友/ })).toBeNull();
  });
});

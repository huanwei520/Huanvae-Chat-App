/**
 * 他人资料页测试
 *
 * 覆盖：
 * - profileViewStore：open/close 切换 userId
 * - OtherProfilePanel：拉公开资料展示字段；非好友显示"加好友"并调用 sendFriendRequest；
 *   好友显示"发送消息"并调用 onSendMessage + onClose；M3 关系操作区占位存在
 * - 拉黑：好友拉黑需二次确认 → addBlacklist + 乐观更新 store；已拉黑显示"取消拉黑"
 *   → removeBlacklist + 乐观更新；拉黑失败保留确认态 + 错误 + store 不变
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
const mockRemoveFriend = vi.hoisted(() => vi.fn());
const mockAddBlacklist = vi.hoisted(() => vi.fn());
const mockRemoveBlacklist = vi.hoisted(() => vi.fn());
vi.mock('../../src/api/friends', () => ({
  sendFriendRequest: mockSendFriendRequest,
  removeFriend: mockRemoveFriend,
  addBlacklist: mockAddBlacklist,
  removeBlacklist: mockRemoveBlacklist,
}));

import { OtherProfilePanel } from '../../src/chat/shared/OtherProfilePanel';

function setFriends(ids: string[], blacklistedIds: string[] = []) {
  useChatStore.setState({
    friends: ids.map((id) => ({
      friend_id: id,
      friend_nickname: `nick_${id}`,
      friend_avatar_url: null,
      add_time: '',
      approve_reason: null,
      is_blacklisted: blacklistedIds.includes(id),
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
    mockRemoveFriend.mockReset();
    mockRemoveFriend.mockResolvedValue(undefined);
    mockAddBlacklist.mockReset();
    mockAddBlacklist.mockResolvedValue(undefined);
    mockRemoveBlacklist.mockReset();
    mockRemoveBlacklist.mockResolvedValue(undefined);
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

  it('好友：删除好友需二次确认，确认后调用 removeFriend + onFriendRemoved + onClose', async () => {
    setFriends(['dave']);
    mockGetPublicProfile.mockResolvedValue({ user_id: 'dave', user_nickname: 'Dave', user_signature: null, user_avatar_url: null });
    const onFriendRemoved = vi.fn();
    const onClose = vi.fn();
    render(<OtherProfilePanel userId="dave" onClose={onClose} onSendMessage={() => {}} onFriendRemoved={onFriendRemoved} />);
    await waitFor(() => expect(screen.getByText('已是好友')).toBeInTheDocument());

    // 第一步：点"删除好友"出现二次确认（此时还未调用 API）
    fireEvent.click(screen.getByRole('button', { name: /删除好友/ }));
    expect(mockRemoveFriend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /确认删除/ })).toBeInTheDocument();

    // 第二步：确认删除 → 调 API + 回调 + 关闭
    fireEvent.click(screen.getByRole('button', { name: /确认删除/ }));
    await waitFor(() => expect(mockRemoveFriend).toHaveBeenCalledTimes(1));
    expect(mockRemoveFriend).toHaveBeenCalledWith(mockApi, 'me', 'dave');
    await waitFor(() => expect(onFriendRemoved).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('删除好友失败：复位（不关闭、不回调，显示错误，按钮回到删除好友）', async () => {
    setFriends(['frank']);
    mockGetPublicProfile.mockResolvedValue({ user_id: 'frank', user_nickname: 'Frank', user_signature: null, user_avatar_url: null });
    mockRemoveFriend.mockRejectedValue(new Error('网络错误'));
    const onFriendRemoved = vi.fn();
    const onClose = vi.fn();
    render(<OtherProfilePanel userId="frank" onClose={onClose} onSendMessage={() => {}} onFriendRemoved={onFriendRemoved} />);
    await waitFor(() => expect(screen.getByText('已是好友')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /删除好友/ }));
    fireEvent.click(screen.getByRole('button', { name: /确认删除/ }));

    await waitFor(() => expect(screen.getByText('网络错误')).toBeInTheDocument());
    expect(onFriendRemoved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // 复位：确认区消失，回到"删除好友"按钮
    expect(screen.getByRole('button', { name: /删除好友/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /确认删除/ })).toBeNull();
  });

  it('非好友不显示删除好友（显示占位）', async () => {
    mockGetPublicProfile.mockResolvedValue({ user_id: 'eve', user_nickname: 'Eve', user_signature: null, user_avatar_url: null });
    render(<OtherProfilePanel userId="eve" onClose={() => {}} onSendMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText('非好友')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /删除好友/ })).toBeNull();
    expect(screen.getByText('更多操作开发中')).toBeInTheDocument();
  });

  it('查看自己时不显示操作区与 M3 占位', async () => {
    mockGetPublicProfile.mockResolvedValue({ user_id: 'me', user_nickname: 'Me', user_signature: null, user_avatar_url: null });
    render(<OtherProfilePanel userId="me" onClose={() => {}} onSendMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText('这是你自己')).toBeInTheDocument());
    expect(screen.queryByText('关系操作')).toBeNull();
    expect(screen.queryByRole('button', { name: /添加好友/ })).toBeNull();
  });

  it('好友：拉黑需二次确认，确认后调用 addBlacklist 并乐观更新 store', async () => {
    setFriends(['grace']);
    mockGetPublicProfile.mockResolvedValue({ user_id: 'grace', user_nickname: 'Grace', user_signature: null, user_avatar_url: null });
    render(<OtherProfilePanel userId="grace" onClose={() => {}} onSendMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText('已是好友')).toBeInTheDocument());

    // 第一步：点"拉黑"出现二次确认（此时未调用 API）
    fireEvent.click(screen.getByRole('button', { name: /^拉黑$/ }));
    expect(mockAddBlacklist).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /确认拉黑/ })).toBeInTheDocument();

    // 第二步：确认拉黑 → 调 API + 乐观更新 store + 按钮变"取消拉黑"
    fireEvent.click(screen.getByRole('button', { name: /确认拉黑/ }));
    await waitFor(() => expect(mockAddBlacklist).toHaveBeenCalledTimes(1));
    expect(mockAddBlacklist).toHaveBeenCalledWith(mockApi, 'grace');
    await waitFor(() => {
      const f = useChatStore.getState().friends.find((x) => x.friend_id === 'grace');
      expect(f?.is_blacklisted).toBe(true);
    });
    expect(screen.getByRole('button', { name: /取消拉黑/ })).toBeInTheDocument();
  });

  it('拉黑二次确认点"取消"：回到"拉黑"按钮且不调用 API', async () => {
    setFriends(['judy']);
    mockGetPublicProfile.mockResolvedValue({ user_id: 'judy', user_nickname: 'Judy', user_signature: null, user_avatar_url: null });
    render(<OtherProfilePanel userId="judy" onClose={() => {}} onSendMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText('已是好友')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^拉黑$/ }));
    expect(screen.getByRole('button', { name: /确认拉黑/ })).toBeInTheDocument();
    // 点"取消"取消确认条上的取消按钮（非"取消拉黑"）
    fireEvent.click(screen.getByRole('button', { name: /^取消$/ }));
    expect(mockAddBlacklist).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /确认拉黑/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^拉黑$/ })).toBeInTheDocument();
  });

  it('已拉黑好友显示"取消拉黑"，点击调用 removeBlacklist 并乐观更新 store', async () => {
    setFriends(['heidi'], ['heidi']);
    mockGetPublicProfile.mockResolvedValue({ user_id: 'heidi', user_nickname: 'Heidi', user_signature: null, user_avatar_url: null });
    render(<OtherProfilePanel userId="heidi" onClose={() => {}} onSendMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText('已是好友')).toBeInTheDocument());

    // 已拉黑 → 不显示"拉黑"，显示"取消拉黑"（直接执行，无需二次确认）
    expect(screen.queryByRole('button', { name: /^拉黑$/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /取消拉黑/ }));
    await waitFor(() => expect(mockRemoveBlacklist).toHaveBeenCalledTimes(1));
    expect(mockRemoveBlacklist).toHaveBeenCalledWith(mockApi, 'heidi');
    await waitFor(() => {
      const f = useChatStore.getState().friends.find((x) => x.friend_id === 'heidi');
      expect(f?.is_blacklisted).toBe(false);
    });
  });

  it('拉黑失败：保留确认态并显示错误，store 不变', async () => {
    setFriends(['ivan']);
    mockGetPublicProfile.mockResolvedValue({ user_id: 'ivan', user_nickname: 'Ivan', user_signature: null, user_avatar_url: null });
    mockAddBlacklist.mockRejectedValue(new Error('拉黑服务异常'));
    render(<OtherProfilePanel userId="ivan" onClose={() => {}} onSendMessage={() => {}} />);
    await waitFor(() => expect(screen.getByText('已是好友')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^拉黑$/ }));
    fireEvent.click(screen.getByRole('button', { name: /确认拉黑/ }));

    await waitFor(() => expect(screen.getByText('拉黑服务异常')).toBeInTheDocument());
    const f = useChatStore.getState().friends.find((x) => x.friend_id === 'ivan');
    expect(f?.is_blacklisted).toBe(false);
  });
});

/**
 * 他人公开资料页测试（分组信息 + 关系 + 操作区）
 *
 * 覆盖：
 * - profileViewStore：open/close 切换 userId
 * - OtherProfilePanel：拉公开资料展示公开字段（昵称/@ID/签名/性别/生日/地区/注册时间）；
 *   非好友显示"添加好友"并调用 sendFriendRequest；
 *   好友显示"发消息"直达 + 备注编辑 + 在线状态；查看自己不显示任何操作按钮；
 *   头像/背景经 resolveServerAvatarUrl 收口。
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
const mockSetFriendRemark = vi.hoisted(() => vi.fn());
vi.mock('../../src/api/friends', () => ({
  sendFriendRequest: mockSendFriendRequest,
  setFriendRemark: mockSetFriendRemark,
}));

// 头像收口点：用哨兵变换替代真实 resolveDisplayUrl（避开 secureProxy/tauri），
// 便于断言"公开资料头像/背景确实经过 resolveServerAvatarUrl 解析、而非裸后端 URL"。
vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (p: string | null | undefined) => (p ? `proxied://${p}` : null),
}));

import { OtherProfilePanel } from '../../src/chat/shared/OtherProfilePanel';

function setFriends(ids: string[]) {
  useChatStore.setState({
    friends: ids.map((id) => ({
      friend_id: id,
      friend_nickname: `nick_${id}`,
      friend_avatar_url: null,
      add_time: '2025-06-01T12:00:00Z',
      approve_reason: null,
      friend_remark: null,
      is_blacklisted: false,
      is_special_care: false,
    })),
  });
}

function fullProfile(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'x',
    user_nickname: 'X',
    user_signature: null,
    user_avatar_url: null,
    background_url: null,
    gender: null,
    birthday: null,
    region: null,
    created_at: '2025-11-25T12:00:00Z',
    ...overrides,
  };
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
    mockSetFriendRemark.mockReset();
    mockSetFriendRemark.mockResolvedValue(undefined);
    setFriends([]);
    useChatStore.getState().setFriendPresences([]);
  });

  it('展示公开字段（昵称/@ID/签名），非好友显示"添加好友"、无"发消息"', async () => {
    mockGetPublicProfile.mockResolvedValue(fullProfile({
      user_id: 'alice', user_nickname: 'Alice', user_signature: '签名内容',
    }));
    render(<OtherProfilePanel userId="alice" onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('签名内容')).toBeInTheDocument());
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('非好友')).toBeInTheDocument();
    // 加好友主行动统一到 AppButton（玻璃渐变 primary，全宽 block）
    const addBtn = screen.getByRole('button', { name: /添加好友/ });
    expect(addBtn).toHaveClass('app-btn', 'app-btn--primary', 'app-btn--block');
    expect(screen.queryByRole('button', { name: '发消息' })).toBeNull();
    // 可选富字段全空 → "未填写"提示可达（注册时间仍单独常显）
    expect(screen.getByText('该用户未填写性别 / 生日 / 地区')).toBeInTheDocument();
    expect(screen.getByText('2025年11月25日')).toBeInTheDocument();
  });

  it('展示富字段（性别/地区/注册时间）', async () => {
    mockGetPublicProfile.mockResolvedValue(fullProfile({
      user_id: 'alice', user_nickname: 'Alice', gender: 'female', region: '上海',
    }));
    render(<OtherProfilePanel userId="alice" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('女')).toBeInTheDocument());
    expect(screen.getByText('上海')).toBeInTheDocument();
    expect(screen.getByText('2025年11月25日')).toBeInTheDocument();
  });

  it('非好友点击加好友调用 sendFriendRequest', async () => {
    mockGetPublicProfile.mockResolvedValue(fullProfile({ user_id: 'bob', user_nickname: 'Bob' }));
    render(<OtherProfilePanel userId="bob" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /添加好友/ }));
    await waitFor(() => expect(mockSendFriendRequest).toHaveBeenCalledTimes(1));
    expect(mockSendFriendRequest).toHaveBeenCalledWith(mockApi, 'me', 'bob');
  });

  it('好友：显示"好友"关系，有"发消息"直达 + 备注入口，无加好友按钮', async () => {
    setFriends(['carol']);
    mockGetPublicProfile.mockResolvedValue(fullProfile({ user_id: 'carol', user_nickname: 'Carol' }));
    const onSendMessage = vi.fn();
    render(<OtherProfilePanel userId="carol" onClose={() => {}} onSendMessage={onSendMessage} />);
    await waitFor(() => expect(screen.getByText('好友')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /添加好友/ })).toBeNull();
    // 备注入口统一到 .subtle-btn（浅色扁平小按钮）；发消息主行动统一到 AppButton primary
    const remarkBtn = screen.getByRole('button', { name: '设置备注' });
    expect(remarkBtn).toHaveClass('subtle-btn', 'subtle-btn--primary');
    const sendBtn = screen.getByRole('button', { name: '发消息' });
    expect(sendBtn).toHaveClass('app-btn', 'app-btn--primary', 'app-btn--block');

    fireEvent.click(sendBtn);
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage.mock.calls[0][0].friend_id).toBe('carol');
  });

  it('好友：编辑并保存备注调用 setFriendRemark', async () => {
    setFriends(['dave']);
    mockGetPublicProfile.mockResolvedValue(fullProfile({ user_id: 'dave', user_nickname: 'Dave' }));
    render(<OtherProfilePanel userId="dave" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('好友')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '设置备注' }));
    const input = screen.getByPlaceholderText('设置备注名（仅自己可见）');
    fireEvent.change(input, { target: { value: '大学室友' } });
    const saveBtn = screen.getByRole('button', { name: '保存' });
    expect(saveBtn).toHaveClass('subtle-btn', 'subtle-btn--primary');
    expect(screen.getByRole('button', { name: '取消' })).toHaveClass('subtle-btn', 'subtle-btn--neutral');
    fireEvent.click(saveBtn);
    await waitFor(() => expect(mockSetFriendRemark).toHaveBeenCalledWith(mockApi, 'me', 'dave', '大学室友'));
  });

  it('好友在线时关系区显示"在线"', async () => {
    setFriends(['erin']);
    useChatStore.getState().setFriendPresence('erin', { online: true });
    mockGetPublicProfile.mockResolvedValue(fullProfile({ user_id: 'erin', user_nickname: 'Erin' }));
    render(<OtherProfilePanel userId="erin" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('在线')).toBeInTheDocument());
  });

  it('查看自己：显示"这是你自己"且无加好友/发消息按钮', async () => {
    mockGetPublicProfile.mockResolvedValue(fullProfile({ user_id: 'me', user_nickname: 'Me' }));
    render(<OtherProfilePanel userId="me" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('这是你自己')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /添加好友/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '发消息' })).toBeNull();
  });

  it('公开资料头像经 resolveServerAvatarUrl 收口（回归：不得直接用裸后端 URL）', async () => {
    mockGetPublicProfile.mockResolvedValue(fullProfile({
      user_id: 'me', user_nickname: 'Me', user_avatar_url: 'avatars/me.jpg?t=1',
    }));
    render(<OtherProfilePanel userId="me" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('这是你自己')).toBeInTheDocument());

    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('proxied://avatars/me.jpg?t=1');
  });
});

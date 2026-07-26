/**
 * PendingRequestsPanel 测试（req-24：四类合并成单一列表）
 *
 * mock：
 * - useApi / useSession（approveFriend 用 session.userId）返回稳定单例
 * - api/friends：getPendingRequests / getSentFriendRequests / approveFriendRequest / rejectFriendRequest
 * - api/groups：getGroupInvitations / getSentJoinRequests / acceptGroupInvitation / declineGroupInvitation
 * - resolveServerAvatarUrl 哨兵
 *
 * 覆盖（合并单列表，无「收到的/我发出的」分区标题）：
 * - 收到的好友申请：显示申请人 + 小字「向你发起的好友申请」+ 同意/拒绝；点「同意」调 approveFriendRequest(api,me,u1) + onFriendAdded + 行移除
 * - 收到的群邀请：显示群名 + 小字「<邀请人> 邀请你加入群聊」+ 接受/拒绝；点「接受」调 acceptGroupInvitation + addGroup 增量 member
 * - 我发出的好友申请：显示对方 + 小字「你发出的好友申请」+「待通过」标签，无任何操作按钮
 * - 我发出的加群申请：显示群名 + 小字「你发出的群聊申请」+「待通过」标签，无任何操作按钮
 * - 四类同时存在：合并在一个列表里，不再出现旧分区标题
 * - 全空：单一空态文案「没有待通过的申请」
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const sessionMock = vi.hoisted(() => ({ session: { userId: 'me' } }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => mockApi,
  useSession: () => sessionMock,
}));

const friendsApiMock = vi.hoisted(() => ({
  getPendingRequests: vi.fn(),
  getSentFriendRequests: vi.fn(),
  approveFriendRequest: vi.fn(),
  rejectFriendRequest: vi.fn(),
}));
vi.mock('../../src/api/friends', () => friendsApiMock);

const groupsApiMock = vi.hoisted(() => ({
  getGroupInvitations: vi.fn(),
  getSentJoinRequests: vi.fn(),
  acceptGroupInvitation: vi.fn(),
  declineGroupInvitation: vi.fn(),
}));
vi.mock('../../src/api/groups', () => groupsApiMock);

vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (p: string | null | undefined) => (p ? `proxied://${p}` : null),
}));

import { PendingRequestsPanel } from '../../src/components/unified/PendingRequestsPanel';

const friendReq = {
  request_id: 'r1',
  request_user_id: 'u1',
  request_message: 'hi',
  request_time: '2026-01-04T00:00:00Z',
  requester_nickname: 'Alice',
  requester_avatar_url: null,
};
const groupInv = {
  request_id: 'gi1',
  group_id: 'g1',
  group_name: '技术群',
  group_avatar_url: null,
  inviter_id: 'u9',
  inviter_nickname: 'Zoe',
  inviter_avatar_url: null,
  message: null,
  created_at: '2026-01-03T00:00:00Z',
  expires_at: '2026-02-01T00:00:00Z',
};
const sentFriend = {
  request_id: 's1',
  sent_to_user_id: 'u2',
  sent_message: null,
  sent_time: '2026-01-02T00:00:00Z',
  sent_to_nickname: 'Bob',
  sent_to_avatar_url: null,
};
const sentJoin = {
  request_id: 'sj1',
  group_id: 'g2',
  group_name: '游戏群',
  group_avatar_url: null,
  message: null,
  status: 'pending',
  created_at: '2026-01-01T00:00:00Z',
};

describe('PendingRequestsPanel（合并单列表）', () => {
  beforeEach(() => {
    cleanup();
    [...Object.values(friendsApiMock), ...Object.values(groupsApiMock)].forEach((m) => m.mockReset());
    friendsApiMock.getPendingRequests.mockResolvedValue([]);
    friendsApiMock.getSentFriendRequests.mockResolvedValue([]);
    friendsApiMock.approveFriendRequest.mockResolvedValue(undefined);
    friendsApiMock.rejectFriendRequest.mockResolvedValue(undefined);
    groupsApiMock.getGroupInvitations.mockResolvedValue({ invitations: [] });
    groupsApiMock.getSentJoinRequests.mockResolvedValue({ requests: [] });
  });

  it('收到的好友申请：小字「向你发起的好友申请」+ 同意/拒绝；点「同意」调 approveFriendRequest 并移除该行', async () => {
    friendsApiMock.getPendingRequests.mockResolvedValue([friendReq]);
    const onFriendAdded = vi.fn();
    render(<PendingRequestsPanel onClose={vi.fn()} onFriendAdded={onFriendAdded} />);

    const alice = await screen.findByText('Alice');
    const row = alice.closest('.pending-req-row') as HTMLElement;
    expect(within(row).getByText('向你发起的好友申请')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: '同意' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: '拒绝' })).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: '同意' }));

    await waitFor(() =>
      expect(friendsApiMock.approveFriendRequest).toHaveBeenCalledWith(mockApi, 'me', 'u1'),
    );
    expect(onFriendAdded).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument());
  });

  it('收到的群邀请：小字「Zoe 邀请你加入群聊」+ 接受/拒绝；点「接受」调 acceptGroupInvitation + addGroup 增量 member', async () => {
    groupsApiMock.getGroupInvitations.mockResolvedValue({ invitations: [groupInv] });
    groupsApiMock.acceptGroupInvitation.mockResolvedValue({ success: true, message: 'ok' });
    const addGroup = vi.fn();
    render(<PendingRequestsPanel onClose={vi.fn()} addGroup={addGroup} />);

    const row = (await screen.findByText('技术群')).closest('.pending-req-row') as HTMLElement;
    expect(within(row).getByText('Zoe 邀请你加入群聊')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: '接受' }));

    await waitFor(() => expect(groupsApiMock.acceptGroupInvitation).toHaveBeenCalledWith(mockApi, 'gi1'));
    expect(addGroup).toHaveBeenCalledWith(
      expect.objectContaining({ group_id: 'g1', group_name: '技术群', role: 'member' }),
    );
  });

  it('我发出的好友申请：小字「你发出的好友申请」+「待通过」标签，且该行无任何操作按钮', async () => {
    friendsApiMock.getSentFriendRequests.mockResolvedValue([sentFriend]);
    render(<PendingRequestsPanel onClose={vi.fn()} />);

    const row = (await screen.findByText('Bob')).closest('.pending-req-row') as HTMLElement;
    expect(within(row).getByText('你发出的好友申请')).toBeInTheDocument();
    expect(within(row).getByText('待通过')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('我发出的加群申请：小字「你发出的群聊申请」+「待通过」标签，且该行无任何操作按钮', async () => {
    groupsApiMock.getSentJoinRequests.mockResolvedValue({ requests: [sentJoin] });
    render(<PendingRequestsPanel onClose={vi.fn()} />);

    const row = (await screen.findByText('游戏群')).closest('.pending-req-row') as HTMLElement;
    expect(within(row).getByText('你发出的群聊申请')).toBeInTheDocument();
    expect(within(row).getByText('待通过')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('四类同时存在：合并在同一个列表里，不再有旧分区标题', async () => {
    friendsApiMock.getPendingRequests.mockResolvedValue([friendReq]);
    groupsApiMock.getGroupInvitations.mockResolvedValue({ invitations: [groupInv] });
    friendsApiMock.getSentFriendRequests.mockResolvedValue([sentFriend]);
    groupsApiMock.getSentJoinRequests.mockResolvedValue({ requests: [sentJoin] });
    render(<PendingRequestsPanel onClose={vi.fn()} />);

    await screen.findByText('Alice');
    // 四类各一行，同一个列表容器
    const list = document.querySelector('.pending-req-list') as HTMLElement;
    expect(within(list).getByText('Alice')).toBeInTheDocument();
    expect(within(list).getByText('技术群')).toBeInTheDocument();
    expect(within(list).getByText('Bob')).toBeInTheDocument();
    expect(within(list).getByText('游戏群')).toBeInTheDocument();
    expect(list.querySelectorAll('.pending-req-row')).toHaveLength(4);
    // 旧的两段分区标题不再出现
    expect(screen.queryByText('收到的（需处理）')).toBeNull();
    expect(screen.queryByText('我发出的（等待对方）')).toBeNull();
  });

  it('全空：单一空态文案「没有待通过的申请」', async () => {
    render(<PendingRequestsPanel onClose={vi.fn()} />);
    expect(await screen.findByText('没有待通过的申请')).toBeInTheDocument();
    expect(screen.queryByText('没有发出的申请')).toBeNull();
  });
});

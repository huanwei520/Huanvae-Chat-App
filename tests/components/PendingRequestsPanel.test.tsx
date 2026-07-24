/**
 * PendingRequestsPanel 测试（待通过申请：收到的需处理 + 我发出的仅展示）
 *
 * mock：
 * - useApi / useSession（handleApproveFriend 用 session.userId）返回稳定单例
 * - api/friends：getPendingRequests / getSentFriendRequests / approveFriendRequest / rejectFriendRequest
 * - api/groups：getGroupInvitations / getSentJoinRequests / acceptGroupInvitation / declineGroupInvitation
 * - resolveServerAvatarUrl 哨兵
 *
 * 覆盖：
 * - 收到的好友申请：显示申请人 + 同意/拒绝；点「同意」调 approveFriendRequest(api, me, u1) + onFriendAdded + 行移除
 * - 收到的群邀请：点「接受」调 acceptGroupInvitation + addGroup 增量添加 member 群
 * - 我发出的好友申请：显示对方 + 「好友申请 · 待通过」标签，该行无任何操作按钮（后端无撤回接口）
 * - 全空：两分区各显示空态文案
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

describe('PendingRequestsPanel', () => {
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

  it('收到的好友申请：显示申请人 + 同意/拒绝；点「同意」调 approveFriendRequest 并移除该行', async () => {
    friendsApiMock.getPendingRequests.mockResolvedValue([
      {
        request_id: 'r1',
        request_user_id: 'u1',
        request_message: 'hi',
        request_time: '2026-01-01T00:00:00Z',
        requester_nickname: 'Alice',
        requester_avatar_url: null,
      },
    ]);
    const onFriendAdded = vi.fn();
    render(<PendingRequestsPanel onClose={vi.fn()} onFriendAdded={onFriendAdded} />);

    const alice = await screen.findByText('Alice');
    const row = alice.closest('.pending-req-row') as HTMLElement;
    expect(within(row).getByRole('button', { name: '同意' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: '拒绝' })).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: '同意' }));

    await waitFor(() =>
      expect(friendsApiMock.approveFriendRequest).toHaveBeenCalledWith(mockApi, 'me', 'u1'),
    );
    expect(onFriendAdded).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument());
  });

  it('收到的群邀请：点「接受」调 acceptGroupInvitation + addGroup 增量添加 member 群', async () => {
    groupsApiMock.getGroupInvitations.mockResolvedValue({
      invitations: [
        {
          request_id: 'gi1',
          group_id: 'g1',
          group_name: '技术群',
          group_avatar_url: null,
          inviter_id: 'u9',
          inviter_nickname: 'Zoe',
          inviter_avatar_url: null,
          message: null,
          created_at: '2026-01-01T00:00:00Z',
          expires_at: '2026-02-01T00:00:00Z',
        },
      ],
    });
    groupsApiMock.acceptGroupInvitation.mockResolvedValue({ success: true, message: 'ok' });
    const addGroup = vi.fn();
    render(<PendingRequestsPanel onClose={vi.fn()} addGroup={addGroup} />);

    const row = (await screen.findByText('技术群')).closest('.pending-req-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: '接受' }));

    await waitFor(() => expect(groupsApiMock.acceptGroupInvitation).toHaveBeenCalledWith(mockApi, 'gi1'));
    expect(addGroup).toHaveBeenCalledWith(
      expect.objectContaining({ group_id: 'g1', group_name: '技术群', role: 'member' }),
    );
  });

  it('我发出的好友申请：显示对方 + 「好友申请 · 待通过」标签，且该行无任何操作按钮', async () => {
    friendsApiMock.getSentFriendRequests.mockResolvedValue([
      {
        request_id: 's1',
        sent_to_user_id: 'u2',
        sent_message: null,
        sent_time: '2026-01-01T00:00:00Z',
        sent_to_nickname: 'Bob',
        sent_to_avatar_url: null,
      },
    ]);
    render(<PendingRequestsPanel onClose={vi.fn()} />);

    const row = (await screen.findByText('Bob')).closest('.pending-req-row') as HTMLElement;
    expect(within(row).getByText('好友申请 · 待通过')).toBeInTheDocument();
    // 我发出的行仅展示、无同意/拒绝/撤回按钮
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('全空：两个分区各显示空态文案', async () => {
    render(<PendingRequestsPanel onClose={vi.fn()} />);

    expect(await screen.findByText('没有待处理的申请')).toBeInTheDocument();
    expect(screen.getByText('没有发出的申请')).toBeInTheDocument();
  });
});

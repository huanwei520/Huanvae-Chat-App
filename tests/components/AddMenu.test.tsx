/**
 * AddMenu 测试（侧边栏 "+" 轻量下拉：创建群聊 / 创建机器人 / 待通过申请）
 *
 * mock：
 * - useApi / useSession（PendingRequestsPanel 用 useSession）返回稳定单例
 * - api/groups.createGroup（+ 面板依赖的 4 个列表函数，全部 resolve 空，避免打开面板即报错）
 * - api/friends 的 4 个列表函数 resolve 空（PendingRequestsPanel 挂载时并行拉取）
 * - useBots（仅在「创建机器人」面板挂载时被调用）返回固定 { create, operatingId:null, error:null }
 * - resolveServerAvatarUrl 哨兵（PendingRequestsPanel 行头像用；空列表下不实际渲染）
 *
 * 覆盖：
 * - 红点计数（badgeText 三元：>99 → 99+，是 AddMenu 自身逻辑）
 * - 点「+」展开三项下拉
 * - 「创建群聊」→ CreateGroupPanel → createGroup 精确入参 + addGroup 增量添加 owner 群
 * - 「待通过申请」→ 打开 PendingRequestsPanel
 * - 「创建机器人」→ 打开 CreateBotDialog
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const sessionMock = vi.hoisted(() => ({ session: { userId: 'me' } }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => mockApi,
  useSession: () => sessionMock,
}));

const groupsApiMock = vi.hoisted(() => ({
  createGroup: vi.fn(),
  getGroupInvitations: vi.fn(),
  getSentJoinRequests: vi.fn(),
  acceptGroupInvitation: vi.fn(),
  declineGroupInvitation: vi.fn(),
}));
vi.mock('../../src/api/groups', () => groupsApiMock);

const friendsApiMock = vi.hoisted(() => ({
  getPendingRequests: vi.fn(),
  getSentFriendRequests: vi.fn(),
  approveFriendRequest: vi.fn(),
  rejectFriendRequest: vi.fn(),
}));
vi.mock('../../src/api/friends', () => friendsApiMock);

const useBotsMock = vi.hoisted(() => ({ create: vi.fn(), operatingId: null, error: null }));
vi.mock('../../src/hooks/useBots', () => ({ useBots: () => useBotsMock }));

vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (p: string | null | undefined) => (p ? `proxied://${p}` : null),
}));

import { AddMenu } from '../../src/components/unified/AddMenu';

function openMenu(container: HTMLElement) {
  fireEvent.click(container.querySelector('.header-add-btn') as HTMLElement);
}

describe('AddMenu', () => {
  beforeEach(() => {
    cleanup();
    Object.values(groupsApiMock).forEach((m) => m.mockReset());
    Object.values(friendsApiMock).forEach((m) => m.mockReset());
    groupsApiMock.getGroupInvitations.mockResolvedValue({ invitations: [] });
    groupsApiMock.getSentJoinRequests.mockResolvedValue({ requests: [] });
    friendsApiMock.getPendingRequests.mockResolvedValue([]);
    friendsApiMock.getSentFriendRequests.mockResolvedValue([]);
  });

  it('pendingNotificationCount 红点：显示计数，>99 显示 99+', () => {
    const { container, rerender } = render(<AddMenu pendingNotificationCount={3} />);
    expect(container.querySelector('.header-add-btn .notification-badge')?.textContent).toBe('3');

    rerender(<AddMenu pendingNotificationCount={150} />);
    expect(container.querySelector('.header-add-btn .notification-badge')?.textContent).toBe('99+');
  });

  it('pendingNotificationCount=0 时不渲染红点', () => {
    const { container } = render(<AddMenu pendingNotificationCount={0} />);
    expect(container.querySelector('.header-add-btn .notification-badge')).toBeNull();
  });

  it('点「+」展开下拉：创建群聊 / 创建机器人 / 待通过申请 三项', () => {
    const { container } = render(<AddMenu />);
    openMenu(container);

    expect(screen.getByText('创建群聊')).toBeInTheDocument();
    expect(screen.getByText('创建机器人')).toBeInTheDocument();
    expect(screen.getByText('待通过申请')).toBeInTheDocument();
  });

  it('创建群聊：填名点创建 → createGroup 精确入参 + addGroup 增量添加 owner 群', async () => {
    groupsApiMock.createGroup.mockResolvedValue({
      group_id: 'g_new',
      group_name: '我的群',
      created_at: '2026-01-01T00:00:00Z',
    });
    const addGroup = vi.fn();
    const { container } = render(<AddMenu addGroup={addGroup} />);

    openMenu(container);
    fireEvent.click(screen.getByText('创建群聊'));

    fireEvent.change(screen.getByPlaceholderText('给群聊起个名字'), { target: { value: '我的群' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() =>
      expect(groupsApiMock.createGroup).toHaveBeenCalledWith(
        mockApi,
        expect.objectContaining({ group_name: '我的群' }),
      ),
    );
    await waitFor(() =>
      expect(addGroup).toHaveBeenCalledWith(
        expect.objectContaining({ group_id: 'g_new', group_name: '我的群', role: 'owner' }),
      ),
    );
  });

  it('创建群聊：群名为空时「创建」禁用，不调 createGroup', () => {
    const { container } = render(<AddMenu />);
    openMenu(container);
    fireEvent.click(screen.getByText('创建群聊'));

    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
    expect(groupsApiMock.createGroup).not.toHaveBeenCalled();
  });

  it('点「待通过申请」打开 PendingRequestsPanel（标题「待通过申请」+ 空态文案）', async () => {
    const { container } = render(<AddMenu />);
    openMenu(container);
    fireEvent.click(screen.getByText('待通过申请'));

    expect(await screen.findByRole('heading', { name: '待通过申请' })).toBeInTheDocument();
    // 4 份列表全空 → 加载完成后两分区空态
    expect(await screen.findByText('没有待处理的申请')).toBeInTheDocument();
  });

  it('点「创建机器人」打开 CreateBotDialog（含 bot 用户名输入框）', () => {
    const { container } = render(<AddMenu />);
    openMenu(container);
    fireEvent.click(screen.getByText('创建机器人'));

    expect(
      screen.getByPlaceholderText('3-32 位字母 / 数字 / 下划线，且以 bot 结尾'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '创建机器人' })).toBeInTheDocument();
  });
});

/**
 * MobileAddPage 测试（req-24：移动端「+」= 菜单，对齐桌面 AddMenu 语义）
 *
 * 聚焦本页自身逻辑（视图状态机 / 角标 / 待通过打开即清红点 / 创建群聊接线）；
 * 待通过的加载/合并/动作纯逻辑由 usePendingRequests（被 mock）+ pendingRequests 单测覆盖。
 *
 * mock：
 * - SessionContext（useApi/useSession）、WebSocketContext（clearPendingNotification）稳定单例
 * - api/groups.createGroup
 * - hooks/usePendingRequests（返回固定 items + vi.fn 动作，引用稳定）
 * - hooks/useBots（CreateBotPanel 用）、CreateBotDialog（stub）
 * - resolveServerAvatarUrl 哨兵
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const sessionMock = vi.hoisted(() => ({ session: { userId: 'me' } }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => mockApi,
  useSession: () => sessionMock,
}));

const wsMock = vi.hoisted(() => ({ clearPendingNotification: vi.fn() }));
vi.mock('../../src/contexts/WebSocketContext', () => ({
  useWebSocket: () => wsMock,
}));

const groupsApiMock = vi.hoisted(() => ({ createGroup: vi.fn() }));
vi.mock('../../src/api/groups', () => groupsApiMock);

const pendingMock = vi.hoisted(() => ({
  approveFriend: vi.fn(),
  rejectFriend: vi.fn(),
  acceptInvite: vi.fn(),
  declineInvite: vi.fn(),
  state: {
    items: [] as unknown[],
    loading: false,
    error: null as string | null,
  },
}));
vi.mock('../../src/hooks/usePendingRequests', () => ({
  usePendingRequests: () => ({
    items: pendingMock.state.items,
    loading: pendingMock.state.loading,
    error: pendingMock.state.error,
    approveFriend: pendingMock.approveFriend,
    rejectFriend: pendingMock.rejectFriend,
    acceptInvite: pendingMock.acceptInvite,
    declineInvite: pendingMock.declineInvite,
  }),
}));

const useBotsMock = vi.hoisted(() => ({ create: vi.fn(), operatingId: null, error: null }));
vi.mock('../../src/hooks/useBots', () => ({ useBots: () => useBotsMock }));

vi.mock('../../src/components/bots/CreateBotDialog', () => ({
  CreateBotDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="create-bot-dialog">
      <button onClick={onClose}>bot-dialog-close</button>
    </div>
  ),
}));

vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (p: string | null | undefined) => (p ? `proxied://${p}` : null),
}));

import { MobileAddPage } from '../../src/pages/mobile/MobileAddPage';

const receivedFriendItem = {
  key: 'rf-r1',
  kind: 'received-friend' as const,
  direction: 'received' as const,
  name: 'Alice',
  avatarPath: null,
  message: null,
  label: '向你发起的好友申请',
  time: '2026-01-01T00:00:00Z',
  raw: { request_id: 'r1', request_user_id: 'u1' },
};

const sentFriendItem = {
  key: 'sf-s1',
  kind: 'sent-friend' as const,
  direction: 'sent' as const,
  name: 'Bob',
  avatarPath: null,
  message: null,
  label: '你发出的好友申请',
  time: '2026-01-02T00:00:00Z',
  raw: { request_id: 's1' },
};

describe('MobileAddPage（+菜单）', () => {
  beforeEach(() => {
    cleanup();
    wsMock.clearPendingNotification.mockReset();
    groupsApiMock.createGroup.mockReset();
    [pendingMock.approveFriend, pendingMock.rejectFriend, pendingMock.acceptInvite, pendingMock.declineInvite].forEach((m) => m.mockReset());
    pendingMock.state.items = [];
    pendingMock.state.loading = false;
    pendingMock.state.error = null;
  });

  it('菜单渲染三项：创建群聊 / 创建机器人 / 待通过申请', () => {
    render(<MobileAddPage onClose={vi.fn()} />);
    expect(screen.getByText('创建群聊')).toBeInTheDocument();
    expect(screen.getByText('创建机器人')).toBeInTheDocument();
    expect(screen.getByText('待通过申请')).toBeInTheDocument();
  });

  it('pendingNotificationCount>0 → 待通过项显示角标；=0 → 无角标', () => {
    const { rerender } = render(<MobileAddPage onClose={vi.fn()} pendingNotificationCount={3} />);
    expect(document.querySelector('.mobile-add-menu-badge')?.textContent).toBe('3');

    // rerender 原地更新同一根（不能先 cleanup，否则根已卸载）
    rerender(<MobileAddPage onClose={vi.fn()} pendingNotificationCount={0} />);
    expect(document.querySelector('.mobile-add-menu-badge')).toBeNull();
  });

  it('角标 >99 显示 99+', () => {
    render(<MobileAddPage onClose={vi.fn()} pendingNotificationCount={150} />);
    expect(document.querySelector('.mobile-add-menu-badge')?.textContent).toBe('99+');
  });

  it('点「创建群聊」→ 标题切换 + 出现群名输入；创建调 createGroup + addGroup 增量 owner 群', async () => {
    groupsApiMock.createGroup.mockResolvedValue({ group_id: 'g1', group_name: '测试群' });
    const addGroup = vi.fn();
    render(<MobileAddPage onClose={vi.fn()} addGroup={addGroup} />);

    fireEvent.click(screen.getByText('创建群聊'));
    const input = await screen.findByPlaceholderText('输入群名称');
    expect(screen.getByRole('heading', { name: '创建群聊' })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '测试群' } });
    fireEvent.click(screen.getByRole('button', { name: '创建群聊' }));

    await waitFor(() =>
      expect(groupsApiMock.createGroup).toHaveBeenCalledWith(mockApi, {
        group_name: '测试群',
        group_description: undefined,
      }),
    );
    expect(addGroup).toHaveBeenCalledWith(expect.objectContaining({ group_id: 'g1', role: 'owner' }));
  });

  it('点「待通过申请」→ 清 3 类通知红点 + 渲染合并列表项（收到=同意/拒绝，发出=待通过标签）', async () => {
    pendingMock.state.items = [receivedFriendItem, sentFriendItem];
    render(<MobileAddPage onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('待通过申请'));

    expect(wsMock.clearPendingNotification).toHaveBeenCalledWith('friendRequests');
    expect(wsMock.clearPendingNotification).toHaveBeenCalledWith('groupInvites');
    expect(wsMock.clearPendingNotification).toHaveBeenCalledWith('groupJoinRequests');

    const aliceRow = (await screen.findByText('Alice')).closest('.mobile-add-item') as HTMLElement;
    expect(within(aliceRow).getByText('向你发起的好友申请')).toBeInTheDocument();
    expect(within(aliceRow).getByRole('button', { name: '同意' })).toBeInTheDocument();
    fireEvent.click(within(aliceRow).getByRole('button', { name: '同意' }));
    expect(pendingMock.approveFriend).toHaveBeenCalledWith(receivedFriendItem.raw);

    const bobRow = screen.getByText('Bob').closest('.mobile-add-item') as HTMLElement;
    expect(within(bobRow).getByText('待通过')).toBeInTheDocument();
    expect(within(bobRow).queryByRole('button')).toBeNull();
  });

  it('待通过为空 → 空态文案「没有待通过的申请」', async () => {
    pendingMock.state.items = [];
    render(<MobileAddPage onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('待通过申请'));
    expect(await screen.findByText('没有待通过的申请')).toBeInTheDocument();
  });

  it('创建群聊页点返回 → 回到菜单（标题「添加」）', async () => {
    render(<MobileAddPage onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('创建群聊'));
    await screen.findByPlaceholderText('输入群名称');

    // 顶栏返回按钮（非「创建群聊」提交按钮）
    const backBtn = document.querySelector('.mobile-add-back') as HTMLElement;
    fireEvent.click(backBtn);
    expect(await screen.findByRole('heading', { name: '添加' })).toBeInTheDocument();
  });

  it('菜单点返回 → 调 onClose', () => {
    const onClose = vi.fn();
    render(<MobileAddPage onClose={onClose} />);
    fireEvent.click(document.querySelector('.mobile-add-back') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点「创建机器人」→ 渲染 CreateBotDialog', () => {
    render(<MobileAddPage onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('创建机器人'));
    expect(screen.getByTestId('create-bot-dialog')).toBeInTheDocument();
  });
});

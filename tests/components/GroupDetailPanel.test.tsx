/**
 * GroupDetailPanel 测试（群详情面板：多态主按钮 进入/加入/申请/待通过/不可加入）
 *
 * mock：
 * - api/groups 的 getPublicGroupInfo / applyToJoinGroup / getSentJoinRequests（hoisted）
 * - useApi 返回稳定单例 mockApi
 * - resolveServerAvatarUrl 哨兵（本组件 info.group_avatar_url 为 null，仅避开真实 secureProxy/tauri）
 * - 成员身份读真实 useChatStore（用 setState 注入 groups）
 *
 * 覆盖按钮多态与关系判定：
 * - 未加入 + open + 无 pending → 「加入群聊」→ 点击调 applyToJoinGroup + onRefreshGroups
 * - 未加入 + approval_required → 「申请加群」→ 点击后翻「待通过」禁用
 * - 未加入但「我发出的」已含该群 → 「待通过」禁用（open 也被翻转），不触发 applyToJoinGroup
 * - 已加入 → 「进入群聊」→ 点击 onEnterGroup(group) + onClose（且不查 getSentJoinRequests）
 * - 未加入 + closed → 「不可加入」禁用
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('../../src/contexts/SessionContext', () => ({ useApi: () => mockApi }));

const groupsApiMock = vi.hoisted(() => ({
  getPublicGroupInfo: vi.fn(),
  applyToJoinGroup: vi.fn(),
  getSentJoinRequests: vi.fn(),
}));
vi.mock('../../src/api/groups', () => groupsApiMock);

vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (p: string | null | undefined) => (p ? `proxied://${p}` : null),
}));

import { GroupDetailPanel } from '../../src/chat/shared/GroupDetailPanel';
import { useChatStore } from '../../src/stores';

function groupInfo(overrides: Record<string, unknown> = {}) {
  return {
    group_id: 'grp1',
    group_name: '测试群',
    group_avatar_url: null,
    group_description: null,
    creator_id: 'owner1',
    created_at: '2026-01-01T00:00:00Z',
    join_mode: 'open',
    status: 'active',
    member_count: 10,
    ...overrides,
  };
}

describe('GroupDetailPanel', () => {
  beforeEach(() => {
    cleanup();
    Object.values(groupsApiMock).forEach((m) => m.mockReset());
    groupsApiMock.getSentJoinRequests.mockResolvedValue({ requests: [] });
    groupsApiMock.applyToJoinGroup.mockResolvedValue({ message: 'ok' });
    useChatStore.setState({ groups: [] });
  });

  it('未加入 + open + 无 pending：按钮「加入群聊」，点击调 applyToJoinGroup 并刷新群列表', async () => {
    groupsApiMock.getPublicGroupInfo.mockResolvedValue(groupInfo({ group_id: 'grp1', join_mode: 'open' }));
    const onRefreshGroups = vi.fn();
    render(<GroupDetailPanel groupId="grp1" onClose={vi.fn()} onRefreshGroups={onRefreshGroups} />);

    const joinBtn = await screen.findByRole('button', { name: '加入群聊' });
    fireEvent.click(joinBtn);

    await waitFor(() => expect(groupsApiMock.applyToJoinGroup).toHaveBeenCalledWith(mockApi, 'grp1'));
    expect(onRefreshGroups).toHaveBeenCalledTimes(1);
  });

  it('未加入 + approval_required：按钮「申请加群」，点击后翻「待通过」并禁用', async () => {
    groupsApiMock.getPublicGroupInfo.mockResolvedValue(
      groupInfo({ group_id: 'grp2', join_mode: 'approval_required' }),
    );
    render(<GroupDetailPanel groupId="grp2" onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '申请加群' }));
    await waitFor(() => expect(groupsApiMock.applyToJoinGroup).toHaveBeenCalledWith(mockApi, 'grp2'));

    const pendingBtn = await screen.findByRole('button', { name: '待通过' });
    expect(pendingBtn).toBeDisabled();
  });

  it('未加入但「我发出的」已含该群：按钮「待通过」禁用，且不触发 applyToJoinGroup', async () => {
    // join_mode=open 本应显示「加入群聊」；已有 pending 申请必须把它翻成「待通过」
    groupsApiMock.getPublicGroupInfo.mockResolvedValue(groupInfo({ group_id: 'grp3', join_mode: 'open' }));
    groupsApiMock.getSentJoinRequests.mockResolvedValue({
      requests: [
        {
          request_id: 'sj1',
          group_id: 'grp3',
          group_name: '测试群',
          group_avatar_url: null,
          message: null,
          status: 'pending',
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    });
    render(<GroupDetailPanel groupId="grp3" onClose={vi.fn()} />);

    const pendingBtn = await screen.findByRole('button', { name: '待通过' });
    expect(pendingBtn).toBeDisabled();
    expect(screen.queryByRole('button', { name: '加入群聊' })).toBeNull();
    expect(groupsApiMock.applyToJoinGroup).not.toHaveBeenCalled();
  });

  it('已加入（chatStore.groups 含该群）：按钮「进入群聊」，点击回调 onEnterGroup + onClose', async () => {
    useChatStore.setState({
      groups: [
        {
          group_id: 'grp4',
          group_name: '我的群',
          group_avatar_url: '',
          role: 'member',
          unread_count: 0,
          last_message_content: null,
          last_message_time: null,
        },
      ],
    });
    groupsApiMock.getPublicGroupInfo.mockResolvedValue(groupInfo({ group_id: 'grp4' }));
    const onEnterGroup = vi.fn();
    const onClose = vi.fn();
    render(<GroupDetailPanel groupId="grp4" onClose={onClose} onEnterGroup={onEnterGroup} />);

    fireEvent.click(await screen.findByRole('button', { name: '进入群聊' }));

    expect(onEnterGroup).toHaveBeenCalledTimes(1);
    expect(onEnterGroup.mock.calls[0][0]).toMatchObject({ group_id: 'grp4', role: 'member' });
    expect(onClose).toHaveBeenCalledTimes(1);
    // 已加入不查询「我发出的加群申请」
    expect(groupsApiMock.getSentJoinRequests).not.toHaveBeenCalled();
  });

  it('未加入 + closed：按钮「不可加入」禁用', async () => {
    groupsApiMock.getPublicGroupInfo.mockResolvedValue(groupInfo({ group_id: 'grp5', join_mode: 'closed' }));
    render(<GroupDetailPanel groupId="grp5" onClose={vi.fn()} />);

    const btn = await screen.findByRole('button', { name: '不可加入' });
    expect(btn).toBeDisabled();
    expect(groupsApiMock.applyToJoinGroup).not.toHaveBeenCalled();
  });
});

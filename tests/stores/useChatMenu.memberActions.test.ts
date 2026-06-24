/**
 * useChatMenu 群成员操作面板 handler 测试（M1）
 *
 * 覆盖成员列表点成员后的统一操作面板逻辑：
 * - handleMemberClick：任何成员（除自己）都可打开 member-action（含群主，管理操作另行 gating）
 * - handleViewMemberProfile：openProfileView(成员id) + 关闭菜单
 * - handleToggleMemberBlock：先 await API 成功再写 store（await-first；用未决 promise 锁写序）
 * - canModerateSelectedMember：普通成员对群主/其它成员无管理权限
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useChatStore } from '../../src/stores/chatStore';
import { useProfileViewStore } from '../../src/stores';
import type { GroupMember } from '../../src/api/groups';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => mockApi,
  useSession: () => ({ session: { userId: 'me' } }),
}));
vi.mock('../../src/components/common/AvatarCropModal', () => ({
  useAvatarCrop: () => ({ requestCrop: vi.fn(), cropModal: null }),
}));
const friendsApi = vi.hoisted(() => ({
  removeFriend: vi.fn(), setFriendRemark: vi.fn(), addBlacklist: vi.fn(),
  removeBlacklist: vi.fn(), getBlacklistTimes: vi.fn(), addSpecialCare: vi.fn(), removeSpecialCare: vi.fn(),
}));
vi.mock('../../src/api/friends', () => friendsApi);
const groupsApi = vi.hoisted(() => ({
  updateGroup: vi.fn(), inviteToGroup: vi.fn(), leaveGroup: vi.fn(), getGroupMembers: vi.fn(),
  uploadGroupAvatar: vi.fn(), removeMember: vi.fn(), setAdmin: vi.fn(), removeAdmin: vi.fn(),
  muteMember: vi.fn(), unmuteMember: vi.fn(), disbandGroup: vi.fn(), transferOwner: vi.fn(),
  getGroupNotices: vi.fn(), createGroupNotice: vi.fn(), deleteGroupNotice: vi.fn(),
  generateInviteCode: vi.fn(), getInviteCodes: vi.fn(), revokeInviteCode: vi.fn(),
  updateGroupNickname: vi.fn(), addGroupMessageBlock: vi.fn(), removeGroupMessageBlock: vi.fn(),
  addGroupSpecialCare: vi.fn(), removeGroupSpecialCare: vi.fn(),
  setGroupMemberRemark: vi.fn(), removeGroupMemberRemark: vi.fn(),
}));
vi.mock('../../src/api/groups', () => groupsApi);

import { useChatMenu } from '../../src/chat/group/useChatMenu';

function makeMember(o: Partial<GroupMember> = {}): GroupMember {
  return {
    user_id: 'u2', user_nickname: 'Bob', user_avatar_url: null,
    role: 'member', group_nickname: null, muted_until: null, joined_at: '',
    ...o,
  } as GroupMember;
}

const groupTarget = { type: 'group' as const, data: { group_id: 'g-1', role: 'member' } as never };
const groupTargetAs = (role: 'owner' | 'admin' | 'member') =>
  ({ type: 'group' as const, data: { group_id: 'g-1', role } as never });
const blocks = () => useChatStore.getState().groupMessageBlocks['g-1'] ?? [];

describe('useChatMenu 群成员操作面板', () => {
  beforeEach(() => {
    Object.values(groupsApi).forEach((m) => { m.mockReset(); m.mockResolvedValue(undefined); });
    Object.values(friendsApi).forEach((m) => { m.mockReset(); m.mockResolvedValue(undefined); });
    groupsApi.getGroupMembers.mockResolvedValue([]);
    useChatStore.setState({ groupMessageBlocks: {}, groupSpecialCares: {}, groupMemberRemarks: {}, groups: [] });
    useProfileViewStore.setState({ open: vi.fn() });
  });

  it('handleMemberClick：非自己 → 进入 member-action 并设 selectedMember；自己 → 忽略', () => {
    const { result } = renderHook(() => useChatMenu({ target: groupTarget }));
    act(() => { result.current.handleMemberClick(makeMember({ user_id: 'me' })); });
    expect(result.current.view).not.toBe('member-action');
    act(() => { result.current.handleMemberClick(makeMember({ user_id: 'u2' })); });
    expect(result.current.view).toBe('member-action');
    expect(result.current.selectedMember?.user_id).toBe('u2');
  });

  it('handleMemberClick：群主成员也可点开；普通成员视角对群主无管理权限', () => {
    const { result } = renderHook(() => useChatMenu({ target: groupTarget }));
    act(() => { result.current.handleMemberClick(makeMember({ user_id: 'owner-1', role: 'owner' })); });
    expect(result.current.view).toBe('member-action');
    expect(result.current.canModerateSelectedMember).toBe(false);
  });

  it('handleViewMemberProfile：openProfileView(成员id) + 关闭菜单', () => {
    const openMock = vi.fn();
    useProfileViewStore.setState({ open: openMock });
    const { result } = renderHook(() => useChatMenu({ target: groupTarget }));
    act(() => { result.current.handleMemberClick(makeMember({ user_id: 'u2' })); });
    act(() => { result.current.handleViewMemberProfile(); });
    expect(openMock).toHaveBeenCalledWith('u2');
    expect(result.current.isOpen).toBe(false);
  });

  it('canModerateSelectedMember 矩阵：admin 对 admin → 否；owner 对 admin → 是；admin 对普通成员 → 是', () => {
    // admin 视角对另一 admin：不可管理
    const r1 = renderHook(() => useChatMenu({ target: groupTargetAs('admin') }));
    act(() => { r1.result.current.handleMemberClick(makeMember({ user_id: 'a2', role: 'admin' })); });
    expect(r1.result.current.canModerateSelectedMember).toBe(false);

    // owner 视角对 admin：可管理
    const r2 = renderHook(() => useChatMenu({ target: groupTargetAs('owner') }));
    act(() => { r2.result.current.handleMemberClick(makeMember({ user_id: 'a2', role: 'admin' })); });
    expect(r2.result.current.canModerateSelectedMember).toBe(true);

    // admin 视角对普通成员：可管理
    const r3 = renderHook(() => useChatMenu({ target: groupTargetAs('admin') }));
    act(() => { r3.result.current.handleMemberClick(makeMember({ user_id: 'm2', role: 'member' })); });
    expect(r3.result.current.canModerateSelectedMember).toBe(true);
  });

  it('handleToggleMemberBlock：API 失败 → store 不写入 + 设置错误', async () => {
    groupsApi.addGroupMessageBlock.mockRejectedValueOnce(new Error('net'));
    const { result } = renderHook(() => useChatMenu({ target: groupTarget }));
    act(() => { result.current.handleMemberClick(makeMember({ user_id: 'u2' })); });
    await act(async () => { await result.current.handleToggleMemberBlock(); });
    expect(blocks()).not.toContain('u2');
    expect(result.current.error).toBeTruthy();
  });

  it('handleToggleMemberBlock：API 未决期间 store 不写，resolve 后才写（await-first）', async () => {
    let resolve!: () => void;
    groupsApi.addGroupMessageBlock.mockReturnValueOnce(new Promise<void>((r) => { resolve = () => r(); }));
    const { result } = renderHook(() => useChatMenu({ target: groupTarget }));
    act(() => { result.current.handleMemberClick(makeMember({ user_id: 'u2' })); });
    let p!: Promise<void>;
    act(() => { p = result.current.handleToggleMemberBlock(); });
    await waitFor(() => expect(groupsApi.addGroupMessageBlock).toHaveBeenCalledWith(mockApi, 'g-1', 'u2'));
    expect(blocks()).not.toContain('u2'); // 未决期间不写
    await act(async () => { resolve(); await p; });
    expect(blocks()).toContain('u2'); // resolve 成功后才写
  });
});

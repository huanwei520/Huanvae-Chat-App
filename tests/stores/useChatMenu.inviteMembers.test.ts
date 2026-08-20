/**
 * useChatMenu.handleInviteMembers 测试（好友选择器接进来之后的邀请动作）
 *
 * 被测：src/chat/group/useChatMenu.ts
 *
 * 覆盖三条，都是本轮改动引入的语义：
 * ① **多人**：选择器给的是数组，原样传给 `inviteToGroup` 第三参（该参数本来就是 string[]，
 *    旧实现却只塞一个手输 ID —— 只断言长度 1 会把这条契约放过去）。
 * ② **失败向上抛**：与本 hook 其它 handler 相反，这里**不吞异常**——调用方是盖在面板之上的
 *    浮层，面板底部那条 error 条在它下面看不见，只有 reject 才能让文案落在浮层里。
 *    同时断言 `error` 状态**没有**被写（证明是"抛"而不是"抛+写"）。
 * ③ 成功后**不切回主菜单**：切了的话选择器会被连带卸载、用户看不到任何成功反馈。
 *
 * 另有一条防回归：手输 ID 的状态（inviteUserId / setInviteUserId）已从返回值删除。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChatStore } from '../../src/stores/chatStore';

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
  updateGroupNickname: vi.fn(), addGroupMessageBlock: vi.fn(), removeGroupMessageBlock: vi.fn(),
  addGroupSpecialCare: vi.fn(), removeGroupSpecialCare: vi.fn(),
  setGroupMemberRemark: vi.fn(), removeGroupMemberRemark: vi.fn(),
  getGroupJoinRequests: vi.fn(), approveGroupJoinRequest: vi.fn(), rejectGroupJoinRequest: vi.fn(),
}));
vi.mock('../../src/api/groups', () => groupsApi);

import { useChatMenu } from '../../src/chat/group/useChatMenu';

const groupTarget = { type: 'group' as const, data: { group_id: 'g-1', role: 'owner' } as never };

describe('useChatMenu.handleInviteMembers', () => {
  beforeEach(() => {
    Object.values(groupsApi).forEach((m) => { m.mockReset(); m.mockResolvedValue(undefined); });
    Object.values(friendsApi).forEach((m) => { m.mockReset(); m.mockResolvedValue(undefined); });
    groupsApi.getGroupMembers.mockResolvedValue({ members: [] });
    groupsApi.getGroupJoinRequests.mockResolvedValue({ requests: [] });
    useChatStore.setState({ groups: [] });
  });

  it('① 多人：数组原样传给 inviteToGroup 第三参，附言经 trim 作第四参', async () => {
    const { result } = renderHook(() => useChatMenu({ target: groupTarget }));

    act(() => { result.current.setInviteMessage('  一起来玩  '); });
    await act(async () => { await result.current.handleInviteMembers(['f1', 'f2', 'f3']); });

    expect(groupsApi.inviteToGroup).toHaveBeenCalledTimes(1);
    expect(groupsApi.inviteToGroup).toHaveBeenCalledWith(mockApi, 'g-1', ['f1', 'f2', 'f3'], '一起来玩');
  });

  it('① 附言为空白 → 第四参为 undefined（不给后端塞一个空串附言）', async () => {
    const { result } = renderHook(() => useChatMenu({ target: groupTarget }));

    await act(async () => { await result.current.handleInviteMembers(['f1']); });

    expect(groupsApi.inviteToGroup).toHaveBeenCalledWith(mockApi, 'g-1', ['f1'], undefined);
  });

  it('① 空数组 → 一次请求都不发（选择器理论上不会给空，但别把空请求打到后端）', async () => {
    const { result } = renderHook(() => useChatMenu({ target: groupTarget }));

    await act(async () => { await result.current.handleInviteMembers([]); });

    expect(groupsApi.inviteToGroup).not.toHaveBeenCalled();
  });

  it('② 失败向上抛（不吞），且不写 error 状态 —— 错误展示归浮层所有', async () => {
    groupsApi.inviteToGroup.mockRejectedValueOnce(new Error('你没有邀请权限'));
    const { result } = renderHook(() => useChatMenu({ target: groupTarget }));

    await act(async () => {
      await expect(result.current.handleInviteMembers(['f1'])).rejects.toThrow('你没有邀请权限');
    });

    expect(result.current.error).toBeNull();
    // 抛出后 loading 必须放回去（finally），否则「从好友列表选择」按钮永久置灰
    expect(result.current.loading).toBe(false);
  });

  it('③ 成功后不切回主菜单（否则选择器被连带卸载、成功反馈看不见），但附言已清空', async () => {
    const { result } = renderHook(() => useChatMenu({ target: groupTarget }));

    act(() => { result.current.handleSetView('invite'); });
    expect(result.current.view).toBe('invite');

    act(() => { result.current.setInviteMessage('hi'); });
    await act(async () => { await result.current.handleInviteMembers(['f1']); });

    expect(result.current.view).toBe('invite');
    expect(result.current.success).toBe('邀请已发送');
    expect(result.current.inviteMessage).toBe('');
  });

  it('防回归：手输 user ID 的状态已从 hook 返回值删除（不留第二条路）', () => {
    const { result } = renderHook(() => useChatMenu({ target: groupTarget }));
    const keys = Object.keys(result.current);

    expect(keys).not.toContain('inviteUserId');
    expect(keys).not.toContain('setInviteUserId');
    expect(keys).not.toContain('handleInviteMember');
    // 正对照：新口子在（证明上面三个 not.toContain 不是因为 hook 整体没返回东西）
    expect(keys).toContain('handleInviteMembers');
    expect(keys).toContain('inviteMessage');
  });

  it('防回归：邀请码那一整套 handler / 状态已从 hook 返回值删除', () => {
    const { result } = renderHook(() => useChatMenu({ target: groupTarget }));
    const keys = Object.keys(result.current);

    for (const gone of [
      'inviteCodes', 'loadingCodes',
      'handleLoadInviteCodes', 'handleGenerateCode', 'handleRevokeCode', 'handleCopyCode',
    ]) {
      expect(keys).not.toContain(gone);
    }
    // 正对照：同族仍在的公告 handler（证明判据能命中真实存在的键）
    expect(keys).toContain('handleLoadNotices');
  });
});

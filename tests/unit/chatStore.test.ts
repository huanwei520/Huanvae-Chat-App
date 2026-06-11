/**
 * 聊天状态管理单元测试
 *
 * 测试 chatStore 的核心功能：
 * - 初始状态
 * - 好友/群聊 CRUD
 * - 聊天目标
 * - 禁言状态
 * - 选择器
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useChatStore,
  selectGroupRole,
  selectFriend,
  selectGroup,
  selectIsGroupOwnerOrAdmin,
  selectIsGroupOwner,
  selectCurrentMuteStatus,
} from '../../src/stores/chatStore';
import type { Friend, Group, ChatTarget } from '../../src/types/chat';

const mockFriend: Friend = {
  friend_id: 'f1',
  friend_nickname: '好友1',
  friend_avatar_url: null,
  add_time: '2024-01-01',
  approve_reason: null,
  friend_remark: null,
};

const mockGroup: Group = {
  group_id: 'g1',
  group_name: '群1',
  group_avatar_url: '',
  role: 'member',
  unread_count: 0,
  last_message_content: null,
  last_message_time: null,
};

describe('聊天状态管理 (chatStore)', () => {
  beforeEach(() => {
    useChatStore.setState({
      friends: [],
      friendsLoading: true,
      friendsError: null,
      groups: [],
      groupsLoading: true,
      groupsError: null,
      chatTarget: null,
      muteStatus: {},
    });
  });

  describe('初始状态', () => {
    it('应有正确的默认值', () => {
      const state = useChatStore.getState();
      expect(state.friends).toEqual([]);
      expect(state.friendsLoading).toBe(true);
      expect(state.friendsError).toBeNull();
      expect(state.groups).toEqual([]);
      expect(state.groupsLoading).toBe(true);
      expect(state.groupsError).toBeNull();
      expect(state.chatTarget).toBeNull();
      expect(state.muteStatus).toEqual({});
    });
  });

  describe('setFriends / setGroups', () => {
    it('setFriends 应替换好友列表', () => {
      useChatStore.getState().setFriends([mockFriend]);
      expect(useChatStore.getState().friends).toEqual([mockFriend]);

      const friend2 = { ...mockFriend, friend_id: 'f2' };
      useChatStore.getState().setFriends([mockFriend, friend2]);
      expect(useChatStore.getState().friends).toHaveLength(2);
    });

    it('setGroups 应替换群聊列表', () => {
      useChatStore.getState().setGroups([mockGroup]);
      expect(useChatStore.getState().groups).toEqual([mockGroup]);

      const group2 = { ...mockGroup, group_id: 'g2' };
      useChatStore.getState().setGroups([mockGroup, group2]);
      expect(useChatStore.getState().groups).toHaveLength(2);
    });
  });

  describe('addFriend', () => {
    it('应添加新好友', () => {
      useChatStore.getState().addFriend(mockFriend);
      expect(useChatStore.getState().friends).toEqual([mockFriend]);
    });

    it('应防止重复添加相同 friend_id', () => {
      useChatStore.getState().addFriend(mockFriend);
      useChatStore.getState().addFriend(mockFriend);
      expect(useChatStore.getState().friends).toHaveLength(1);
    });

    it('新好友应插入列表头部', () => {
      useChatStore.getState().addFriend(mockFriend);
      const friend2 = { ...mockFriend, friend_id: 'f2' };
      useChatStore.getState().addFriend(friend2);
      expect(useChatStore.getState().friends[0].friend_id).toBe('f2');
    });
  });

  describe('removeFriend', () => {
    it('应按 friend_id 移除好友', () => {
      useChatStore.getState().setFriends([mockFriend, { ...mockFriend, friend_id: 'f2' }]);
      useChatStore.getState().removeFriend('f1');
      expect(useChatStore.getState().friends).toHaveLength(1);
      expect(useChatStore.getState().friends[0].friend_id).toBe('f2');
    });

    it('移除不存在的 friend_id 应无副作用', () => {
      useChatStore.getState().setFriends([mockFriend]);
      useChatStore.getState().removeFriend('nonexistent');
      expect(useChatStore.getState().friends).toHaveLength(1);
    });
  });

  describe('addGroup', () => {
    it('应添加新群聊', () => {
      useChatStore.getState().addGroup(mockGroup);
      expect(useChatStore.getState().groups).toEqual([mockGroup]);
    });

    it('应防止重复添加相同 group_id', () => {
      useChatStore.getState().addGroup(mockGroup);
      useChatStore.getState().addGroup(mockGroup);
      expect(useChatStore.getState().groups).toHaveLength(1);
    });

    it('新群聊应插入列表头部', () => {
      useChatStore.getState().addGroup(mockGroup);
      const group2 = { ...mockGroup, group_id: 'g2' };
      useChatStore.getState().addGroup(group2);
      expect(useChatStore.getState().groups[0].group_id).toBe('g2');
    });
  });

  describe('removeGroup', () => {
    it('应按 group_id 移除群聊', () => {
      useChatStore.getState().setGroups([mockGroup, { ...mockGroup, group_id: 'g2' }]);
      useChatStore.getState().removeGroup('g1');
      expect(useChatStore.getState().groups).toHaveLength(1);
      expect(useChatStore.getState().groups[0].group_id).toBe('g2');
    });
  });

  describe('updateGroup', () => {
    it('应部分更新指定群聊', () => {
      useChatStore.getState().setGroups([mockGroup, { ...mockGroup, group_id: 'g2' }]);
      useChatStore.getState().updateGroup('g1', { group_name: '新群名', role: 'admin' });

      const groups = useChatStore.getState().groups;
      const g1 = groups.find((g) => g.group_id === 'g1');
      expect(g1?.group_name).toBe('新群名');
      expect(g1?.role).toBe('admin');
      expect(groups.find((g) => g.group_id === 'g2')).toEqual({ ...mockGroup, group_id: 'g2' });
    });
  });

  describe('setChatTarget', () => {
    it('应设置好友聊天目标', () => {
      const target: ChatTarget = { type: 'friend', data: mockFriend };
      useChatStore.getState().setChatTarget(target);
      expect(useChatStore.getState().chatTarget).toEqual(target);
    });

    it('应设置群聊聊天目标', () => {
      const target: ChatTarget = { type: 'group', data: mockGroup };
      useChatStore.getState().setChatTarget(target);
      expect(useChatStore.getState().chatTarget).toEqual(target);
    });

    it('应支持清空聊天目标', () => {
      useChatStore.getState().setChatTarget({ type: 'friend', data: mockFriend });
      useChatStore.getState().setChatTarget(null);
      expect(useChatStore.getState().chatTarget).toBeNull();
    });
  });

  describe('updateChatTargetRole', () => {
    it('当 chatTarget 为匹配群时应更新 role', () => {
      const target: ChatTarget = { type: 'group', data: mockGroup };
      useChatStore.getState().setChatTarget(target);
      useChatStore.getState().updateChatTargetRole('g1', 'admin');

      const updated = useChatStore.getState().chatTarget;
      expect(updated?.type).toBe('group');
      expect((updated as { type: 'group'; data: Group }).data.role).toBe('admin');
    });

    it('当 chatTarget 为其他群时不应更新', () => {
      const target: ChatTarget = { type: 'group', data: mockGroup };
      useChatStore.getState().setChatTarget(target);
      useChatStore.getState().updateChatTargetRole('g2', 'admin');

      const updated = useChatStore.getState().chatTarget;
      expect((updated as { type: 'group'; data: Group }).data.role).toBe('member');
    });

    it('当 chatTarget 为 friend 时不应更新', () => {
      useChatStore.getState().setChatTarget({ type: 'friend', data: mockFriend });
      useChatStore.getState().updateChatTargetRole('g1', 'admin');

      const updated = useChatStore.getState().chatTarget;
      expect(updated?.type).toBe('friend');
    });
  });

  describe('setMuteStatus / clearMuteStatus', () => {
    it('应设置禁言状态', () => {
      const mutedUntil = new Date(Date.now() + 60000).toISOString();
      useChatStore.getState().setMuteStatus('g1', mutedUntil, '违规');
      expect(useChatStore.getState().muteStatus['g1']).toEqual({
        mutedUntil,
        reason: '违规',
      });
    });

    it('应清除禁言状态', () => {
      useChatStore.getState().setMuteStatus('g1', new Date().toISOString());
      useChatStore.getState().clearMuteStatus('g1');
      expect(useChatStore.getState().muteStatus['g1']).toBeUndefined();
    });
  });

  describe('getMuteRemaining', () => {
    it('未禁言时应返回 0', () => {
      expect(useChatStore.getState().getMuteRemaining('g1')).toBe(0);
    });

    it('已过期时应返回 0', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();
      useChatStore.getState().setMuteStatus('g1', pastTime);
      expect(useChatStore.getState().getMuteRemaining('g1')).toBe(0);
    });

    it('禁言中时应返回剩余毫秒数', () => {
      const futureTime = new Date(Date.now() + 5000).toISOString();
      useChatStore.getState().setMuteStatus('g1', futureTime);
      const remaining = useChatStore.getState().getMuteRemaining('g1');
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(5000);
    });
  });

  describe('选择器', () => {
    it('selectGroupRole 应返回指定群的角色', () => {
      useChatStore.setState({ groups: [mockGroup] });
      const state = useChatStore.getState();
      expect(selectGroupRole('g1')(state)).toBe('member');
      expect(selectGroupRole('g2')(state)).toBeUndefined();
    });

    it('selectFriend 应返回指定好友', () => {
      useChatStore.setState({ friends: [mockFriend] });
      const state = useChatStore.getState();
      expect(selectFriend('f1')(state)).toEqual(mockFriend);
      expect(selectFriend('f2')(state)).toBeUndefined();
    });

    it('selectGroup 应返回指定群聊', () => {
      useChatStore.setState({ groups: [mockGroup] });
      const state = useChatStore.getState();
      expect(selectGroup('g1')(state)).toEqual(mockGroup);
      expect(selectGroup('g2')(state)).toBeUndefined();
    });

    it('selectIsGroupOwnerOrAdmin 群主/管理员时应为 true', () => {
      useChatStore.setState({
        chatTarget: { type: 'group', data: { ...mockGroup, role: 'owner' } },
      });
      expect(selectIsGroupOwnerOrAdmin(useChatStore.getState())).toBe(true);

      useChatStore.setState({
        chatTarget: { type: 'group', data: { ...mockGroup, role: 'admin' } },
      });
      expect(selectIsGroupOwnerOrAdmin(useChatStore.getState())).toBe(true);
    });

    it('selectIsGroupOwnerOrAdmin 普通成员时应为 false', () => {
      useChatStore.setState({
        chatTarget: { type: 'group', data: mockGroup },
      });
      expect(selectIsGroupOwnerOrAdmin(useChatStore.getState())).toBe(false);
    });

    it('selectIsGroupOwner 仅群主时为 true', () => {
      useChatStore.setState({
        chatTarget: { type: 'group', data: { ...mockGroup, role: 'owner' } },
      });
      expect(selectIsGroupOwner(useChatStore.getState())).toBe(true);

      useChatStore.setState({
        chatTarget: { type: 'group', data: { ...mockGroup, role: 'admin' } },
      });
      expect(selectIsGroupOwner(useChatStore.getState())).toBe(false);
    });

    it('selectCurrentMuteStatus 应返回当前群的禁言状态', () => {
      const mutedUntil = new Date().toISOString();
      useChatStore.setState({
        chatTarget: { type: 'group', data: mockGroup },
        muteStatus: { g1: { mutedUntil, reason: 'test' } },
      });
      expect(selectCurrentMuteStatus(useChatStore.getState())).toEqual({
        mutedUntil,
        reason: 'test',
      });
    });

    it('selectCurrentMuteStatus 非群聊目标时应返回 undefined', () => {
      useChatStore.setState({
        chatTarget: { type: 'friend', data: mockFriend },
        muteStatus: { g1: { mutedUntil: new Date().toISOString() } },
      });
      expect(selectCurrentMuteStatus(useChatStore.getState())).toBeUndefined();
    });
  });
});

/**
 * 聊天状态管理 Store (Zustand)
 *
 * 集中管理聊天应用的核心状态：
 * - friends: 好友列表
 * - groups: 群聊列表
 * - chatTarget: 当前聊天目标
 * - muteStatus: 当前用户在各群的禁言状态
 *
 * 优势：
 * - 细粒度订阅：组件只订阅需要的状态片段，避免不必要的重渲染
 * - React 外部访问：WebSocket 回调中可直接使用 getState() 和 set()
 * - 无 Provider：即插即用，无需包裹组件
 * - 类型安全：完整的 TypeScript 支持
 *
 * 使用方式：
 * ```typescript
 * // 订阅整个 friends 数组
 * const friends = useChatStore(state => state.friends)
 *
 * // 订阅特定群的角色（细粒度）
 * const role = useChatStore(state =>
 *   state.groups.find(g => g.group_id === groupId)?.role
 * )
 *
 * // 在 WebSocket 回调中使用（React 外部）
 * useChatStore.getState().updateGroupRole(groupId, 'admin')
 *
 * // 检查禁言状态
 * const muteInfo = useChatStore(selectCurrentMuteStatus)
 * ```
 */

import { create } from 'zustand';
import type { Friend, Group, ChatTarget } from '../types/chat';

// ============================================
// 类型定义
// ============================================

/** 禁言信息 */
interface MuteInfo {
  /** 禁言结束时间（ISO 字符串） */
  mutedUntil: string;
  /** 禁言原因 */
  reason?: string;
}

interface ChatState {
  // ==================== 好友状态 ====================
  /** 好友列表 */
  friends: Friend[];
  /** 好友加载中 */
  friendsLoading: boolean;
  /** 好友加载错误 */
  friendsError: string | null;

  // ==================== 群聊状态 ====================
  /** 群聊列表 */
  groups: Group[];
  /** 群聊加载中 */
  groupsLoading: boolean;
  /** 群聊加载错误 */
  groupsError: string | null;

  // ==================== 聊天目标 ====================
  /** 当前聊天目标 */
  chatTarget: ChatTarget | null;

  // ==================== 禁言状态 ====================
  /**
   * 当前用户在各群的禁言状态
   * key: groupId, value: MuteInfo
   */
  muteStatus: Record<string, MuteInfo>;
}

interface ChatActions {
  // ==================== 好友操作 ====================
  /** 设置好友列表 */
  setFriends: (friends: Friend[]) => void;
  /** 设置好友加载状态 */
  setFriendsLoading: (loading: boolean) => void;
  /** 设置好友加载错误 */
  setFriendsError: (error: string | null) => void;
  /** 添加好友（WebSocket 通知时使用） */
  addFriend: (friend: Friend) => void;
  /** 移除好友（WebSocket 通知时使用） */
  removeFriend: (friendId: string) => void;

  // ==================== 群聊操作 ====================
  /** 设置群聊列表 */
  setGroups: (groups: Group[]) => void;
  /** 设置群聊加载状态 */
  setGroupsLoading: (loading: boolean) => void;
  /** 设置群聊加载错误 */
  setGroupsError: (error: string | null) => void;
  /** 添加群聊（WebSocket 通知时使用） */
  addGroup: (group: Group) => void;
  /** 移除群聊（WebSocket 通知时使用） */
  removeGroup: (groupId: string) => void;
  /**
   * 更新群聊信息（WebSocket 通知时使用）
   * 细粒度更新，只修改指定群的属性，不影响其他群
   */
  updateGroup: (groupId: string, updates: Partial<Group>) => void;

  // ==================== 聊天目标操作 ====================
  /** 设置当前聊天目标 */
  setChatTarget: (target: ChatTarget | null) => void;
  /**
   * 更新当前聊天目标的群角色
   * 用于 WebSocket 通知时同步更新 chatTarget
   */
  updateChatTargetRole: (groupId: string, role: 'owner' | 'admin' | 'member') => void;

  // ==================== 禁言操作 ====================
  /**
   * 设置用户在某群的禁言状态
   * @param groupId 群ID
   * @param mutedUntil 禁言结束时间（ISO 字符串）
   * @param reason 禁言原因（可选）
   */
  setMuteStatus: (groupId: string, mutedUntil: string, reason?: string) => void;
  /**
   * 清除用户在某群的禁言状态
   * @param groupId 群ID
   */
  clearMuteStatus: (groupId: string) => void;
  /**
   * 检查用户在某群是否被禁言
   * @param groupId 群ID
   * @returns 如果被禁言返回剩余时间（毫秒），否则返回 0
   */
  getMuteRemaining: (groupId: string) => number;
}

export type ChatStore = ChatState & ChatActions;

// ============================================
// Store 实现
// ============================================

export const useChatStore = create<ChatStore>((set, get) => ({
  // ==================== 初始状态 ====================
  friends: [],
  friendsLoading: true,
  friendsError: null,

  groups: [],
  groupsLoading: true,
  groupsError: null,

  chatTarget: null,

  muteStatus: {},

  // ==================== 好友操作 ====================
  setFriends: (friends) => set({ friends }),

  setFriendsLoading: (loading) => set({ friendsLoading: loading }),

  setFriendsError: (error) => set({ friendsError: error }),

  addFriend: (friend) => set((state) => {
    // 避免重复添加
    if (state.friends.some((f) => f.friend_id === friend.friend_id)) {
      return state;
    }
    return { friends: [friend, ...state.friends] };
  }),

  removeFriend: (friendId) => set((state) => ({
    friends: state.friends.filter((f) => f.friend_id !== friendId),
  })),

  // ==================== 群聊操作 ====================
  setGroups: (groups) => set({ groups }),

  setGroupsLoading: (loading) => set({ groupsLoading: loading }),

  setGroupsError: (error) => set({ groupsError: error }),

  addGroup: (group) => set((state) => {
    // 避免重复添加
    if (state.groups.some((g) => g.group_id === group.group_id)) {
      return state;
    }
    return { groups: [group, ...state.groups] };
  }),

  removeGroup: (groupId) => set((state) => ({
    groups: state.groups.filter((g) => g.group_id !== groupId),
  })),

  updateGroup: (groupId, updates) => set((state) => ({
    groups: state.groups.map((g) =>
      g.group_id === groupId ? { ...g, ...updates } : g,
    ),
  })),

  // ==================== 聊天目标操作 ====================
  setChatTarget: (target) => set({ chatTarget: target }),

  updateChatTargetRole: (groupId, role) => {
    const { chatTarget } = get();
    if (
      chatTarget?.type === 'group' &&
      chatTarget.data.group_id === groupId
    ) {
      set({
        chatTarget: {
          type: 'group',
          data: { ...chatTarget.data, role },
        },
      });
    }
  },

  // ==================== 禁言操作 ====================
  setMuteStatus: (groupId, mutedUntil, reason) => set((state) => ({
    muteStatus: {
      ...state.muteStatus,
      [groupId]: { mutedUntil, reason },
    },
  })),

  clearMuteStatus: (groupId) => set((state) => {
    const newStatus = { ...state.muteStatus };
    delete newStatus[groupId];
    return { muteStatus: newStatus };
  }),

  getMuteRemaining: (groupId) => {
    const { muteStatus } = get();
    const info = muteStatus[groupId];
    if (!info) { return 0; }

    const remaining = new Date(info.mutedUntil).getTime() - Date.now();
    return remaining > 0 ? remaining : 0;
  },
}));

// ============================================
// 选择器（Selectors）- 用于细粒度订阅
// ============================================

/**
 * 获取指定群的角色
 * 用于细粒度订阅，只在该群角色变化时触发重渲染
 */
export const selectGroupRole = (groupId: string) => (state: ChatStore) =>
  state.groups.find((g) => g.group_id === groupId)?.role;

/**
 * 获取指定好友
 */
export const selectFriend = (friendId: string) => (state: ChatStore) =>
  state.friends.find((f) => f.friend_id === friendId);

/**
 * 获取指定群聊
 */
export const selectGroup = (groupId: string) => (state: ChatStore) =>
  state.groups.find((g) => g.group_id === groupId);

/**
 * 判断当前聊天目标是否为指定群主/管理员
 */
export const selectIsGroupOwnerOrAdmin = (state: ChatStore) =>
  state.chatTarget?.type === 'group' &&
  (state.chatTarget.data.role === 'owner' || state.chatTarget.data.role === 'admin');

/**
 * 判断当前聊天目标是否为群主
 */
export const selectIsGroupOwner = (state: ChatStore) =>
  state.chatTarget?.type === 'group' && state.chatTarget.data.role === 'owner';

/**
 * 获取当前群的禁言状态
 * @returns MuteInfo 或 undefined
 */
export const selectCurrentMuteStatus = (state: ChatStore) => {
  if (state.chatTarget?.type !== 'group') { return undefined; }
  return state.muteStatus[state.chatTarget.data.group_id];
};

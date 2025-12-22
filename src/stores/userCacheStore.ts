/**
 * 用户信息缓存 Store (Zustand)
 *
 * 缓存用户信息（昵称、头像等），避免重复请求
 * - 群成员信息
 * - 好友信息
 * - 在线状态
 */

import { create } from 'zustand';

// ============================================
// 类型定义
// ============================================

export interface CachedUser {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  isOnline?: boolean;
  lastSeen?: string;
  /** 缓存时间 */
  cachedAt: number;
}

interface UserCacheState {
  /** 用户缓存 key: userId */
  users: Record<string, CachedUser>;
  /** 群成员映射 key: groupId, value: userId[] */
  groupMembers: Record<string, string[]>;
}

interface UserCacheActions {
  /** 设置用户信息 */
  setUser: (user: CachedUser) => void;
  /** 批量设置用户信息 */
  setUsers: (users: CachedUser[]) => void;
  /** 获取用户信息 */
  getUser: (userId: string) => CachedUser | undefined;
  /** 更新用户信息 */
  updateUser: (userId: string, updates: Partial<CachedUser>) => void;
  /** 设置用户在线状态 */
  setOnlineStatus: (userId: string, isOnline: boolean) => void;
  /** 设置群成员 */
  setGroupMembers: (groupId: string, memberIds: string[]) => void;
  /** 获取群成员 */
  getGroupMembers: (groupId: string) => CachedUser[];
  /** 检查缓存是否过期（默认 10 分钟） */
  isUserStale: (userId: string, maxAge?: number) => boolean;
  /** 清除用户缓存 */
  clearUser: (userId: string) => void;
  /** 清除所有缓存 */
  clearAll: () => void;
}

export type UserCacheStore = UserCacheState & UserCacheActions;

// ============================================
// Store 实现
// ============================================

export const useUserCacheStore = create<UserCacheStore>((set, get) => ({
  users: {},
  groupMembers: {},

  setUser: (user) => set((state) => ({
    users: {
      ...state.users,
      [user.userId]: user,
    },
  })),

  setUsers: (users) => set((state) => {
    const newUsers = { ...state.users };
    for (const user of users) {
      newUsers[user.userId] = user;
    }
    return { users: newUsers };
  }),

  getUser: (userId) => get().users[userId],

  updateUser: (userId, updates) => set((state) => {
    const existing = state.users[userId];
    if (!existing) return state;
    return {
      users: {
        ...state.users,
        [userId]: { ...existing, ...updates },
      },
    };
  }),

  setOnlineStatus: (userId, isOnline) => set((state) => {
    const existing = state.users[userId];
    if (!existing) return state;
    return {
      users: {
        ...state.users,
        [userId]: { 
          ...existing, 
          isOnline,
          lastSeen: isOnline ? undefined : new Date().toISOString(),
        },
      },
    };
  }),

  setGroupMembers: (groupId, memberIds) => set((state) => ({
    groupMembers: {
      ...state.groupMembers,
      [groupId]: memberIds,
    },
  })),

  getGroupMembers: (groupId) => {
    const state = get();
    const memberIds = state.groupMembers[groupId] || [];
    return memberIds.map((id) => state.users[id]).filter(Boolean) as CachedUser[];
  },

  isUserStale: (userId, maxAge = 10 * 60 * 1000) => {
    const user = get().users[userId];
    if (!user) return true;
    return Date.now() - user.cachedAt > maxAge;
  },

  clearUser: (userId) => set((state) => {
    const newUsers = { ...state.users };
    delete newUsers[userId];
    return { users: newUsers };
  }),

  clearAll: () => set({ users: {}, groupMembers: {} }),
}));

// ============================================
// 选择器
// ============================================

/** 获取用户 */
export const selectUser = (userId: string) => (state: UserCacheStore) =>
  state.users[userId];

/** 获取用户昵称 */
export const selectNickname = (userId: string) => (state: UserCacheStore) =>
  state.users[userId]?.nickname;

/** 获取用户头像 */
export const selectAvatar = (userId: string) => (state: UserCacheStore) =>
  state.users[userId]?.avatarUrl;

/** 获取用户在线状态 */
export const selectOnlineStatus = (userId: string) => (state: UserCacheStore) =>
  state.users[userId]?.isOnline ?? false;


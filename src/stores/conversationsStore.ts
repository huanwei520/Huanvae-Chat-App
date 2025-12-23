/**
 * 会话列表状态管理 Store (Zustand)
 *
 * 管理会话列表状态，支持跨组件更新：
 * - 收到新消息时更新最后一条消息
 * - 未读数管理
 * - WebSocket 回调中直接使用
 */

import { create } from 'zustand';
import type { LocalConversation } from '../db';

// ============================================
// 类型定义
// ============================================

interface ConversationsState {
  /** 会话列表 */
  conversations: LocalConversation[];
  /** 加载中 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 是否已初始化 */
  initialized: boolean;
}

interface ConversationsActions {
  /** 设置会话列表 */
  setConversations: (conversations: LocalConversation[]) => void;
  /** 添加会话 */
  addConversation: (conversation: LocalConversation) => void;
  /** 更新会话 */
  updateConversation: (id: string, updates: Partial<LocalConversation>) => void;
  /** 删除会话 */
  removeConversation: (id: string) => void;
  /** 更新最后消息 */
  updateLastMessage: (id: string, message: string, messageType: string, time: string) => void;
  /** 增加未读数 */
  incrementUnread: (id: string) => void;
  /** 清零未读数 */
  clearUnread: (id: string) => void;
  /** 设置加载状态 */
  setLoading: (loading: boolean) => void;
  /** 设置错误 */
  setError: (error: string | null) => void;
  /** 标记已初始化 */
  setInitialized: (initialized: boolean) => void;
  /** 获取会话 */
  getConversation: (id: string) => LocalConversation | undefined;
  /** 按更新时间排序 */
  sortByUpdateTime: () => void;
}

export type ConversationsStore = ConversationsState & ConversationsActions;

// ============================================
// Store 实现
// ============================================

export const useConversationsStore = create<ConversationsStore>((set, get) => ({
  // 初始状态
  conversations: [],
  loading: false,
  error: null,
  initialized: false,

  // 设置会话列表
  setConversations: (conversations) => set({
    conversations,
    initialized: true,
  }),

  // 添加会话
  addConversation: (conversation) => set((state) => {
    // 避免重复
    if (state.conversations.some((c) => c.id === conversation.id)) {
      return state;
    }
    return {
      conversations: [conversation, ...state.conversations],
    };
  }),

  // 更新会话
  updateConversation: (id, updates) => set((state) => ({
    conversations: state.conversations.map((c) =>
      c.id === id ? { ...c, ...updates } : c,
    ),
  })),

  // 删除会话
  removeConversation: (id) => set((state) => ({
    conversations: state.conversations.filter((c) => c.id !== id),
  })),

  // 更新最后消息
  updateLastMessage: (id, message, messageType, time) => set((state) => {
    // 格式化消息预览
    let preview = message;
    if (messageType === 'image') { preview = '[图片]'; }
    else if (messageType === 'video') { preview = '[视频]'; }
    else if (messageType === 'file') { preview = '[文件]'; }

    const updatedConversations = state.conversations.map((c) =>
      c.id === id
        ? {
          ...c,
          last_message: preview,
          last_message_time: time,
          updated_at: time,
        }
        : c,
    );

    // 按更新时间排序（置顶的在前，然后按时间）
    updatedConversations.sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) { return -1; }
      if (!a.is_pinned && b.is_pinned) { return 1; }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    return { conversations: updatedConversations };
  }),

  // 增加未读数
  incrementUnread: (id) => set((state) => ({
    conversations: state.conversations.map((c) =>
      c.id === id ? { ...c, unread_count: c.unread_count + 1 } : c,
    ),
  })),

  // 清零未读数
  clearUnread: (id) => set((state) => ({
    conversations: state.conversations.map((c) =>
      c.id === id ? { ...c, unread_count: 0 } : c,
    ),
  })),

  // 设置加载状态
  setLoading: (loading) => set({ loading }),

  // 设置错误
  setError: (error) => set({ error }),

  // 标记已初始化
  setInitialized: (initialized) => set({ initialized }),

  // 获取会话
  getConversation: (id) => get().conversations.find((c) => c.id === id),

  // 按更新时间排序
  sortByUpdateTime: () => set((state) => {
    const sorted = [...state.conversations].sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) { return -1; }
      if (!a.is_pinned && b.is_pinned) { return 1; }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    return { conversations: sorted };
  }),
}));

// ============================================
// 选择器
// ============================================

/** 获取指定会话 */
export const selectConversation = (id: string) => (state: ConversationsStore) =>
  state.conversations.find((c) => c.id === id);

/** 获取未读总数 */
export const selectTotalUnread = (state: ConversationsStore) =>
  state.conversations.reduce((sum, c) => sum + c.unread_count, 0);

/** 获取好友会话列表 */
export const selectFriendConversations = (state: ConversationsStore) =>
  state.conversations.filter((c) => c.type === 'friend');

/** 获取群聊会话列表 */
export const selectGroupConversations = (state: ConversationsStore) =>
  state.conversations.filter((c) => c.type === 'group');

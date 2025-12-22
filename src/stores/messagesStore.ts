/**
 * 消息缓存状态管理 Store (Zustand)
 *
 * 缓存已加载的消息，避免切换聊天时重复请求
 * - 按会话 ID 存储消息
 * - 支持添加、更新、删除消息
 * - 支持标记消息撤回
 */

import { create } from 'zustand';
import type { Message } from '../types/chat';
import type { GroupMessage } from '../api/groupMessages';

// ============================================
// 类型定义
// ============================================

/** 统一的消息类型 */
export interface CachedMessage {
  message_uuid: string;
  conversation_id: string;
  conversation_type: 'friend' | 'group';
  sender_id: string;
  sender_name: string | null;
  sender_avatar: string | null;
  content: string;
  content_type: string;
  file_uuid: string | null;
  file_url: string | null;
  file_size: number | null;
  file_hash: string | null;
  seq: number;
  send_time: string;
  is_recalled: boolean;
}

interface ConversationCache {
  messages: CachedMessage[];
  hasMore: boolean;
  loading: boolean;
  lastLoadTime: number;
}

interface MessagesState {
  /** 消息缓存 key: conversationId */
  cache: Record<string, ConversationCache>;
}

interface MessagesActions {
  /** 设置会话的消息 */
  setMessages: (conversationId: string, messages: CachedMessage[], hasMore: boolean) => void;
  /** 添加新消息到开头（最新的） */
  addMessage: (conversationId: string, message: CachedMessage) => void;
  /** 追加历史消息到末尾 */
  appendMessages: (conversationId: string, messages: CachedMessage[], hasMore: boolean) => void;
  /** 更新消息 */
  updateMessage: (conversationId: string, messageUuid: string, updates: Partial<CachedMessage>) => void;
  /** 删除消息 */
  removeMessage: (conversationId: string, messageUuid: string) => void;
  /** 标记消息撤回 */
  markRecalled: (conversationId: string, messageUuid: string) => void;
  /** 获取会话消息 */
  getMessages: (conversationId: string) => CachedMessage[];
  /** 检查是否有缓存 */
  hasCache: (conversationId: string) => boolean;
  /** 检查缓存是否过期（默认 5 分钟） */
  isCacheStale: (conversationId: string, maxAge?: number) => boolean;
  /** 设置加载状态 */
  setLoading: (conversationId: string, loading: boolean) => void;
  /** 清除会话缓存 */
  clearCache: (conversationId: string) => void;
  /** 清除所有缓存 */
  clearAllCache: () => void;
}

export type MessagesStore = MessagesState & MessagesActions;

// ============================================
// 辅助函数
// ============================================

/** 将 Message 转换为 CachedMessage */
export function messageToCached(msg: Message, conversationId: string): CachedMessage {
  return {
    message_uuid: msg.message_uuid,
    conversation_id: conversationId,
    conversation_type: 'friend',
    sender_id: msg.sender_id,
    sender_name: null,
    sender_avatar: null,
    content: msg.message_content,
    content_type: msg.message_type,
    file_uuid: msg.file_uuid,
    file_url: msg.file_url,
    file_size: msg.file_size,
    file_hash: msg.file_hash,
    seq: msg.seq || 0,
    send_time: msg.send_time,
    is_recalled: false,
  };
}

/** 将 GroupMessage 转换为 CachedMessage */
export function groupMessageToCached(msg: GroupMessage): CachedMessage {
  return {
    message_uuid: msg.message_uuid,
    conversation_id: msg.group_id,
    conversation_type: 'group',
    sender_id: msg.sender_id,
    sender_name: msg.sender_nickname || null,
    sender_avatar: msg.sender_avatar_url || null,
    content: msg.message_content,
    content_type: msg.message_type,
    file_uuid: msg.file_uuid,
    file_url: msg.file_url,
    file_size: msg.file_size,
    file_hash: msg.file_hash,
    seq: msg.seq,
    send_time: msg.send_time,
    is_recalled: msg.is_recalled || false,
  };
}

// ============================================
// Store 实现
// ============================================

export const useMessagesStore = create<MessagesStore>((set, get) => ({
  cache: {},

  setMessages: (conversationId, messages, hasMore) => set((state) => ({
    cache: {
      ...state.cache,
      [conversationId]: {
        messages,
        hasMore,
        loading: false,
        lastLoadTime: Date.now(),
      },
    },
  })),

  addMessage: (conversationId, message) => set((state) => {
    const existing = state.cache[conversationId];
    if (!existing) {
      return {
        cache: {
          ...state.cache,
          [conversationId]: {
            messages: [message],
            hasMore: false,
            loading: false,
            lastLoadTime: Date.now(),
          },
        },
      };
    }

    // 检查是否已存在
    if (existing.messages.some((m) => m.message_uuid === message.message_uuid)) {
      return state;
    }

    return {
      cache: {
        ...state.cache,
        [conversationId]: {
          ...existing,
          messages: [message, ...existing.messages],
          lastLoadTime: Date.now(),
        },
      },
    };
  }),

  appendMessages: (conversationId, messages, hasMore) => set((state) => {
    const existing = state.cache[conversationId];
    if (!existing) {
      return {
        cache: {
          ...state.cache,
          [conversationId]: {
            messages,
            hasMore,
            loading: false,
            lastLoadTime: Date.now(),
          },
        },
      };
    }

    // 过滤重复消息
    const existingUuids = new Set(existing.messages.map((m) => m.message_uuid));
    const newMessages = messages.filter((m) => !existingUuids.has(m.message_uuid));

    return {
      cache: {
        ...state.cache,
        [conversationId]: {
          ...existing,
          messages: [...existing.messages, ...newMessages],
          hasMore,
          lastLoadTime: Date.now(),
        },
      },
    };
  }),

  updateMessage: (conversationId, messageUuid, updates) => set((state) => {
    const existing = state.cache[conversationId];
    if (!existing) return state;

    return {
      cache: {
        ...state.cache,
        [conversationId]: {
          ...existing,
          messages: existing.messages.map((m) =>
            m.message_uuid === messageUuid ? { ...m, ...updates } : m
          ),
        },
      },
    };
  }),

  removeMessage: (conversationId, messageUuid) => set((state) => {
    const existing = state.cache[conversationId];
    if (!existing) return state;

    return {
      cache: {
        ...state.cache,
        [conversationId]: {
          ...existing,
          messages: existing.messages.filter((m) => m.message_uuid !== messageUuid),
        },
      },
    };
  }),

  markRecalled: (conversationId, messageUuid) => set((state) => {
    const existing = state.cache[conversationId];
    if (!existing) return state;

    return {
      cache: {
        ...state.cache,
        [conversationId]: {
          ...existing,
          messages: existing.messages.filter((m) => m.message_uuid !== messageUuid),
        },
      },
    };
  }),

  getMessages: (conversationId) => {
    const cache = get().cache[conversationId];
    return cache?.messages || [];
  },

  hasCache: (conversationId) => {
    return conversationId in get().cache;
  },

  isCacheStale: (conversationId, maxAge = 5 * 60 * 1000) => {
    const cache = get().cache[conversationId];
    if (!cache) return true;
    return Date.now() - cache.lastLoadTime > maxAge;
  },

  setLoading: (conversationId, loading) => set((state) => {
    const existing = state.cache[conversationId];
    if (!existing) {
      return {
        cache: {
          ...state.cache,
          [conversationId]: {
            messages: [],
            hasMore: false,
            loading,
            lastLoadTime: 0,
          },
        },
      };
    }
    return {
      cache: {
        ...state.cache,
        [conversationId]: { ...existing, loading },
      },
    };
  }),

  clearCache: (conversationId) => set((state) => {
    const newCache = { ...state.cache };
    delete newCache[conversationId];
    return { cache: newCache };
  }),

  clearAllCache: () => set({ cache: {} }),
}));

// ============================================
// 选择器
// ============================================

/** 获取会话的消息 */
export const selectMessages = (conversationId: string) => (state: MessagesStore) =>
  state.cache[conversationId]?.messages || [];

/** 获取会话是否还有更多消息 */
export const selectHasMore = (conversationId: string) => (state: MessagesStore) =>
  state.cache[conversationId]?.hasMore ?? false;

/** 获取会话加载状态 */
export const selectLoading = (conversationId: string) => (state: MessagesStore) =>
  state.cache[conversationId]?.loading ?? false;


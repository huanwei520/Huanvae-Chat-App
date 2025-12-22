/**
 * 本地优先消息加载 Hook
 *
 * 实现离线优先策略：
 * 1. 先从本地 SQLite 加载消息并立即显示
 * 2. 后台同步服务器增量消息
 * 3. 新消息通过 WebSocket 实时更新
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import * as db from '../db';
import type { LocalMessage, LocalConversation, ConversationType } from '../db';
import { initSyncService, getSyncService } from '../services/syncService';
import { useSession } from '../contexts/SessionContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { createApiClient } from '../api/client';

// ============================================================================
// 类型定义
// ============================================================================

export interface UseLocalMessagesOptions {
  conversationId: string;
  conversationType: ConversationType;
  /** 是否自动同步服务器消息，默认 true */
  autoSync?: boolean;
  /** 每页消息数量，默认 50 */
  pageSize?: number;
}

export interface UseLocalMessagesReturn {
  /** 消息列表 */
  messages: LocalMessage[];
  /** 是否正在加载 */
  loading: boolean;
  /** 是否正在同步 */
  syncing: boolean;
  /** 是否有更多历史消息 */
  hasMore: boolean;
  /** 错误信息 */
  error: string | null;
  /** 加载更多历史消息 */
  loadMore: () => Promise<void>;
  /** 刷新消息（重新从本地加载并同步） */
  refresh: () => Promise<void>;
  /** 手动触发同步 */
  sync: () => Promise<void>;
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useLocalMessages(options: UseLocalMessagesOptions): UseLocalMessagesReturn {
  const { conversationId, conversationType, autoSync = true, pageSize = 50 } = options;

  const { session } = useSession();
  const ws = useWebSocket();

  // 状态
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const syncServiceInitialized = useRef(false);
  const conversationRef = useRef<LocalConversation | null>(null);

  // ============================================
  // 初始化数据库和加载本地消息
  // ============================================

  const loadLocalMessages = useCallback(async () => {
    if (!session) {
      console.log('[LocalMessages] 未登录，跳过加载');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // 注意：数据库在登录时已由 useAuth 初始化，这里不需要再初始化

      // 加载本地消息
      const localMessages = await db.getMessages(conversationId, pageSize);
      setMessages(localMessages);
      setHasMore(localMessages.length >= pageSize);

      // 获取会话信息
      conversationRef.current = await db.getConversation(conversationId);

      console.log('[LocalMessages] 加载本地消息', {
        conversationId,
        count: localMessages.length,
      });
    } catch (err) {
      console.error('[LocalMessages] 加载失败:', err);
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [conversationId, pageSize]);

  // ============================================
  // 同步服务器消息
  // ============================================

  const syncMessages = useCallback(async () => {
    if (!session || syncing) { return; }

    try {
      setSyncing(true);

      // 初始化同步服务
      if (!syncServiceInitialized.current) {
        const api = createApiClient({
          baseUrl: session.serverUrl,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
        });
        initSyncService(api);
        syncServiceInitialized.current = true;
      }

      const syncService = getSyncService();
      if (!syncService) { return; }

      // 获取当前会话信息
      let conversation = conversationRef.current;
      if (!conversation) {
        // 如果本地没有会话记录，创建一个
        conversation = {
          id: conversationId,
          type: conversationType,
          name: '',
          avatar_url: null,
          last_message: null,
          last_message_time: null,
          last_seq: 0,
          unread_count: 0,
          is_muted: false,
          is_pinned: false,
          updated_at: new Date().toISOString(),
          synced_at: null,
        };
        await db.saveConversation(conversation);
        conversationRef.current = conversation;
      }

      // 执行增量同步
      const result = await syncService.syncMessages([conversation]);

      if (result.updatedConversations.includes(conversationId)) {
        // 重新加载本地消息
        const updatedMessages = await db.getMessages(conversationId, pageSize);
        setMessages(updatedMessages);
        setHasMore(updatedMessages.length >= pageSize);

        console.log('[LocalMessages] 同步完成，新消息数:', result.newMessagesCount);
      }
    } catch (err) {
      console.error('[LocalMessages] 同步失败:', err);
      // 同步失败不影响本地消息显示，只记录错误
    } finally {
      setSyncing(false);
    }
  }, [session, syncing, conversationId, conversationType, pageSize]);

  // ============================================
  // 加载更多历史消息
  // ============================================

  const loadMore = useCallback(async () => {
    if (!hasMore || loading) { return; }

    try {
      // 消息按倒序排列 [新→旧]，最后一个是最旧的
      const oldestMessage = messages[messages.length - 1];
      if (!oldestMessage) { return; }

      const olderMessages = await db.getMessages(
        conversationId,
        pageSize,
        oldestMessage.seq,
      );

      if (olderMessages.length > 0) {
        // 更老的消息添加到数组末尾
        setMessages(prev => [...prev, ...olderMessages]);
      }

      setHasMore(olderMessages.length >= pageSize);

      console.log('[LocalMessages] 加载更多', {
        count: olderMessages.length,
        hasMore: olderMessages.length >= pageSize,
      });
    } catch (err) {
      console.error('[LocalMessages] 加载更多失败:', err);
    }
  }, [hasMore, loading, messages, conversationId, pageSize]);

  // ============================================
  // 刷新消息
  // ============================================

  const refresh = useCallback(async () => {
    await loadLocalMessages();
    if (autoSync) {
      await syncMessages();
    }
  }, [loadLocalMessages, autoSync, syncMessages]);

  // ============================================
  // 监听实时消息
  // ============================================

  useEffect(() => {
    // 监听新消息
    const unsubscribeNew = ws.onNewMessage(msg => {
      if (msg.source_id === conversationId) {
        // 新消息已经在 wsHandlers 中保存到本地
        // 这里只需要更新 UI
        const newMessage: LocalMessage = {
          message_uuid: msg.message_uuid,
          conversation_id: msg.source_id,
          conversation_type: msg.source_type,
          sender_id: msg.sender_id,
          sender_name: msg.sender_nickname || null,
          sender_avatar: msg.sender_avatar_url || null,
          content: msg.content || msg.preview || '',
          content_type: msg.message_type,
          file_uuid: msg.file_uuid || null,
          file_url: msg.file_url || null,
          file_size: msg.file_size || null,
          file_hash: msg.file_hash || null,
          seq: msg.seq || 0,
          reply_to: null,
          is_recalled: false,
          is_deleted: false,
          send_time: msg.timestamp,
          created_at: new Date().toISOString(),
        };

        setMessages(prev => [...prev, newMessage]);
      }
    });

    // 监听消息撤回
    const unsubscribeRecalled = ws.onMessageRecalled(msg => {
      setMessages(prev =>
        prev.map(m =>
          m.message_uuid === msg.message_uuid
            ? { ...m, is_recalled: true, content: '[消息已撤回]' }
            : m,
        ),
      );
    });

    return () => {
      unsubscribeNew();
      unsubscribeRecalled();
    };
  }, [ws, conversationId]);

  // ============================================
  // 初始化加载
  // ============================================

  useEffect(() => {
    loadLocalMessages().then(() => {
      if (autoSync) {
        syncMessages();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  return {
    messages,
    loading,
    syncing,
    hasMore,
    error,
    loadMore,
    refresh,
    sync: syncMessages,
  };
}

// ============================================================================
// 说明：数据库初始化
// ============================================================================
// 数据库在用户登录时由 useAuth 中的 createSessionAndLogin 初始化
// 具体流程：
// 1. 用户登录成功
// 2. setCurrentUser(userId, serverUrl) - 创建用户数据目录
// 3. initDatabase() - 初始化用户专属数据库
// 所以其他地方不需要再调用 initDatabase()
// ============================================================================

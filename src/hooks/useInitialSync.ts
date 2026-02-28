/**
 * 初始同步 Hook
 *
 * 登录后对所有好友和群聊进行统一的增量消息同步
 *
 * 功能：
 * 1. 获取所有好友和群聊列表
 * 2. 为每个好友/群聊确保本地会话存在
 * 3. 调用 syncService 进行增量消息同步
 * 4. 更新本地会话的最后消息预览
 *
 * 重连同步：
 * - 订阅 WebSocket 重连成功事件（onReconnected）
 * - 断线重连后自动执行与登录一致的全列表消息增量更新
 *
 * 通知生命周期管理：
 * - notification 由本 hook 完整管理（生产 + 消费 + 清除）
 * - SyncStatusBanner 只做纯展示，不持有去重状态
 * - 通知在自动隐藏后由 clearNotification 清除，不受组件挂载/卸载影响
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useSession, useApi } from '../contexts/SessionContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import * as db from '../db';
import type { LocalConversation, ConversationType } from '../db';
import { getSyncService, initSyncService } from '../services/syncService';
import { getFriendConversationId } from '../utils/conversationId';

/**
 * 同步触发原因
 * - 'initial': 登录后首次同步
 * - 'reconnect': WebSocket 断线重连后同步
 */
export type SyncTrigger = 'initial' | 'reconnect';

/**
 * 待显示的同步通知（一次性事件，显示后由 clearNotification 清除）
 * - syncing: 正在同步中
 * - success: 同步成功，携带新消息数
 * - error: 同步失败，携带错误信息
 */
export type SyncNotification =
  | { type: 'syncing'; progress: number; total: number; synced: number }
  | { type: 'success'; newMessagesCount: number }
  | { type: 'error'; message: string };

interface UseInitialSyncProps {
  /** 好友列表是否加载完成 */
  friendsLoaded: boolean;
  /** 群聊列表是否加载完成 */
  groupsLoaded: boolean;
}

interface UseInitialSyncReturn {
  /** 待显示的通知（null 表示无需显示） */
  notification: SyncNotification | null;
  /** 清除当前通知（由 SyncStatusBanner 在自动隐藏后调用） */
  clearNotification: () => void;
  /** 手动触发同步 */
  triggerSync: () => Promise<void>;
}

export function useInitialSync({ friendsLoaded, groupsLoaded }: UseInitialSyncProps): UseInitialSyncReturn {
  const { session } = useSession();
  const api = useApi();
  const { onReconnected } = useWebSocket();
  const syncRef = useRef(false);
  const [notification, setNotification] = useState<SyncNotification | null>(null);

  const clearNotification = useCallback(() => {
    setNotification(null);
  }, []);

  /**
   * 确保会话存在，如果不存在则创建
   */
  const ensureConversation = useCallback(async (
    conversationId: string,
    type: ConversationType,
    name: string,
    avatarUrl: string | null,
  ): Promise<LocalConversation> => {
    // 先尝试获取现有会话
    const existing = await db.getConversation(conversationId);
    if (existing) {
      return existing;
    }

    // 创建新会话
    const newConversation: Omit<LocalConversation, 'synced_at'> = {
      id: conversationId,
      type,
      name,
      avatar_url: avatarUrl,
      last_message: null,
      last_message_time: null,
      last_seq: 0,
      unread_count: 0,
      is_muted: false,
      is_pinned: false,
      updated_at: new Date().toISOString(),
    };

    await db.saveConversation(newConversation);
    return { ...newConversation, synced_at: null };
  }, []);

  /**
   * 执行全量增量同步
   * 仅在登录首次同步和断线重连时调用，其余场景不触发通知
   */
  const performSync = useCallback(async (trigger?: SyncTrigger) => {
    if (!session || !api) {
      return;
    }

    const syncService = getSyncService() ?? initSyncService(api);

    if (trigger) {
      setNotification({ type: 'syncing', progress: 0, total: 0, synced: 0 });
    }

    try {
      const [localFriends, localGroups] = await Promise.all([
        db.getFriends(),
        db.getGroups(),
      ]);

      const totalCount = localFriends.length + localGroups.length;

      if (totalCount === 0) {
        if (trigger) {
          setNotification({ type: 'success', newMessagesCount: 0 });
        }
        return;
      }

      if (trigger) {
        setNotification({ type: 'syncing', progress: 0, total: totalCount, synced: 0 });
      }

      const friendConversations: LocalConversation[] = [];
      for (const friend of localFriends) {
        const conversationId = getFriendConversationId(session.userId, friend.friend_id);
        // eslint-disable-next-line no-await-in-loop
        const conv = await ensureConversation(
          conversationId,
          'friend',
          friend.nickname || friend.username,
          friend.avatar_url,
        );
        friendConversations.push(conv);
      }

      const groupConversations: LocalConversation[] = [];
      for (const group of localGroups) {
        // eslint-disable-next-line no-await-in-loop
        const conv = await ensureConversation(
          group.group_id,
          'group',
          group.name,
          group.avatar_url,
        );
        groupConversations.push(conv);
      }

      const allConversations = [...friendConversations, ...groupConversations];

      const result = await syncService.syncMessages(allConversations);

      if (trigger) {
        setNotification({ type: 'success', newMessagesCount: result.newMessagesCount });
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '同步失败';
      console.error('[InitialSync] 同步失败:', error);
      if (trigger) {
        setNotification({ type: 'error', message: errorMessage });
      }
    }
  }, [session, api, ensureConversation]);

  // 好友和群聊列表加载完成后自动执行一次同步（登录首次）
  useEffect(() => {
    if (!session || syncRef.current || !friendsLoaded || !groupsLoaded) {
      return;
    }
    syncRef.current = true;
    performSync('initial');
  }, [session, friendsLoaded, groupsLoaded, performSync]);

  // 订阅 WebSocket 重连事件（断线重连后同步 — 仅此两处触发通知）
  useEffect(() => {
    const unsubscribe = onReconnected(() => {
      console.warn('[InitialSync] 收到重连事件，执行消息增量同步');
      performSync('reconnect');
    });
    return unsubscribe;
  }, [onReconnected, performSync]);

  // 手动重试（错误横幅上点击），传入 trigger 以显示通知
  const triggerSync = useCallback(async () => {
    await performSync('initial');
  }, [performSync]);

  return {
    notification,
    clearNotification,
    triggerSync,
  };
}

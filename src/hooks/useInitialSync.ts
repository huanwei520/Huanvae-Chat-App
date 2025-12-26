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
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSession } from '../contexts/SessionContext';
import * as db from '../db';
import type { LocalConversation, ConversationType } from '../db';
import { getSyncService } from '../services/syncService';
import { getFriendConversationId } from '../utils/conversationId';

/** 同步状态 */
interface SyncStatus {
  /** 是否正在同步 */
  syncing: boolean;
  /** 同步进度（0-100） */
  progress: number;
  /** 同步的会话总数 */
  totalConversations: number;
  /** 已同步的会话数 */
  syncedConversations: number;
  /** 新消息总数 */
  newMessagesCount: number;
  /** 错误信息 */
  error: string | null;
  /** 最后同步时间 */
  lastSyncTime: Date | null;
}

interface UseInitialSyncProps {
  /** 好友列表是否加载完成 */
  friendsLoaded: boolean;
  /** 群聊列表是否加载完成 */
  groupsLoaded: boolean;
}

interface UseInitialSyncReturn {
  /** 同步状态 */
  status: SyncStatus;
  /** 手动触发同步 */
  triggerSync: () => Promise<void>;
}

export function useInitialSync({ friendsLoaded, groupsLoaded }: UseInitialSyncProps): UseInitialSyncReturn {
  const { session } = useSession();
  const syncRef = useRef(false);
  const [status, setStatus] = useState<SyncStatus>({
    syncing: false,
    progress: 0,
    totalConversations: 0,
    syncedConversations: 0,
    newMessagesCount: 0,
    error: null,
    lastSyncTime: null,
  });

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
   */
  const performSync = useCallback(async () => {
    if (!session) {
      return;
    }

    const syncService = getSyncService();
    if (!syncService) {
      console.warn('[InitialSync] SyncService 未初始化');
      return;
    }

    setStatus(prev => ({
      ...prev,
      syncing: true,
      progress: 0,
      error: null,
    }));

    try {
      // 1. 获取本地好友和群聊列表
      const [localFriends, localGroups] = await Promise.all([
        db.getFriends(),
        db.getGroups(),
      ]);

      const totalCount = localFriends.length + localGroups.length;
      console.log('[InitialSync] 开始同步', {
        好友数: localFriends.length,
        群聊数: localGroups.length,
        总计: totalCount,
      });

      if (totalCount === 0) {
        setStatus(prev => ({
          ...prev,
          syncing: false,
          progress: 100,
          lastSyncTime: new Date(),
        }));
        return;
      }

      setStatus(prev => ({
        ...prev,
        totalConversations: totalCount,
      }));

      // 2. 为每个好友确保会话存在
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

      // 3. 为每个群聊确保会话存在
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

      // 4. 合并所有会话
      const allConversations = [...friendConversations, ...groupConversations];

      setStatus(prev => ({
        ...prev,
        progress: 30,
      }));

      // 5. 调用 syncService 进行增量同步
      console.log('[InitialSync] 开始增量同步', {
        会话数: allConversations.length,
      });

      const result = await syncService.syncMessages(allConversations);

      console.log('[InitialSync] 同步完成', {
        更新的会话: result.updatedConversations.length,
        新消息数: result.newMessagesCount,
      });

      setStatus({
        syncing: false,
        progress: 100,
        totalConversations: totalCount,
        syncedConversations: result.updatedConversations.length,
        newMessagesCount: result.newMessagesCount,
        error: null,
        lastSyncTime: new Date(),
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '同步失败';
      console.error('[InitialSync] 同步失败:', error);
      setStatus(prev => ({
        ...prev,
        syncing: false,
        error: errorMessage,
      }));
    }
  }, [session, ensureConversation]);

  // 好友和群聊列表加载完成后自动执行一次同步
  useEffect(() => {
    // 必须登录、未同步过、且两个列表都加载完成
    if (!session || syncRef.current || !friendsLoaded || !groupsLoaded) {
      return;
    }

    syncRef.current = true;
    console.log('[InitialSync] 列表加载完成，开始同步消息');
    performSync();
  }, [session, friendsLoaded, groupsLoaded, performSync]);

  return {
    status,
    triggerSync: performSync,
  };
}


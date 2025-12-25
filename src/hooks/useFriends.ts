/**
 * 好友管理 Hook
 *
 * 基于 Zustand store 的好友状态管理，支持本地优先加载
 *
 * 功能：
 * - 本地优先：先从本地数据库加载，立即显示
 * - 后台同步：同时从服务器获取最新列表，更新本地和 UI
 * - 提供 store 中好友操作方法的便捷访问
 *
 * 加载流程：
 * 1. 先从本地 SQLite 加载好友列表 → 立即显示
 * 2. 同时从服务器获取最新列表
 * 3. 更新本地数据库和 UI
 */

import { useEffect, useCallback, useRef } from 'react';
import { useApi } from '../contexts/SessionContext';
import { useChatStore } from '../stores';
import { getFriends as getFriendsFromApi } from '../api/friends';
import * as db from '../db';
import type { Friend } from '../types/chat';

interface UseFriendsReturn {
  /** 好友列表 */
  friends: Friend[];
  /** 加载中状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 刷新好友列表 */
  refresh: () => Promise<void>;
  /** 添加好友（WebSocket 通知时使用） */
  addFriend: (friend: Friend) => void;
  /** 移除好友（WebSocket 通知时使用） */
  removeFriend: (friendId: string) => void;
}

/** 将本地好友转换为 UI 好友类型 */
function localFriendToFriend(local: db.LocalFriend): Friend {
  return {
    friend_id: local.friend_id,
    username: local.username,
    nickname: local.nickname || undefined,
    avatar_url: local.avatar_url || undefined,
    status: local.status || undefined,
    created_at: local.created_at,
  };
}

/** 将 UI 好友类型转换为本地好友 */
function friendToLocalFriend(friend: Friend): db.LocalFriend {
  return {
    friend_id: friend.friend_id,
    username: friend.username,
    nickname: friend.nickname || null,
    avatar_url: friend.avatar_url || null,
    status: friend.status || null,
    created_at: friend.created_at,
    updated_at: null,
  };
}

export function useFriends(): UseFriendsReturn {
  const api = useApi();

  // 从 store 获取状态和操作方法
  const friends = useChatStore((state) => state.friends);
  const loading = useChatStore((state) => state.friendsLoading);
  const error = useChatStore((state) => state.friendsError);
  const setFriends = useChatStore((state) => state.setFriends);
  const setLoading = useChatStore((state) => state.setFriendsLoading);
  const setError = useChatStore((state) => state.setFriendsError);
  const addFriend = useChatStore((state) => state.addFriend);
  const removeFriend = useChatStore((state) => state.removeFriend);

  // 从本地数据库加载好友
  const loadLocalFriends = useCallback(async (): Promise<Friend[]> => {
    try {
      const localFriends = await db.getFriends();
      return localFriends.map(localFriendToFriend);
    } catch (err) {
      console.warn('[Friends] 加载本地好友失败:', err);
      return [];
    }
  }, []);

  // 从服务器加载好友并保存到本地
  const loadServerFriends = useCallback(async (): Promise<Friend[]> => {
    const response = await getFriendsFromApi(api);
    const serverFriends = response.items || [];

    // 保存到本地数据库
    try {
      const localFriends = serverFriends.map(friendToLocalFriend);
      await db.saveFriends(localFriends);
      console.log('[Friends] 保存好友到本地:', serverFriends.length);
    } catch (err) {
      console.warn('[Friends] 保存好友到本地失败:', err);
    }

    return serverFriends;
  }, [api]);

  // 加载好友列表（本地优先 + 后台同步）
  const loadFriends = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      // 1. 先从本地加载并立即显示
      const localFriends = await loadLocalFriends();
      if (localFriends.length > 0) {
        setFriends(localFriends);
        console.log('[Friends] 从本地加载好友:', localFriends.length);
      }

      // 2. 从服务器获取最新列表
      const serverFriends = await loadServerFriends();
      setFriends(serverFriends);
      console.log('[Friends] 从服务器加载好友:', serverFriends.length);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[Friends] 加载好友失败:', errorMsg);
      setError(errorMsg);
      // 如果服务器失败，保持本地数据显示
    } finally {
      setLoading(false);
    }
  }, [loadLocalFriends, loadServerFriends, setFriends, setLoading, setError]);

  // 初始化加载（只执行一次）
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) { return; }
    initRef.current = true;
    loadFriends();
  }, [loadFriends]);

  return {
    friends,
    loading,
    error,
    refresh: loadFriends,
    addFriend,
    removeFriend,
  };
}

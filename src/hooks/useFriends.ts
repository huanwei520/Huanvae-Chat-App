/**
 * 好友管理 Hook
 *
 * 基于 Zustand store 的好友状态管理
 *
 * 功能：
 * - 好友列表加载和刷新（调用 API 并更新 store）
 * - 提供 store 中好友操作方法的便捷访问
 *
 * 状态存储在 useChatStore 中，本 hook 主要负责：
 * 1. 初始化时加载好友列表
 * 2. 提供 refresh 方法重新加载
 * 3. 代理 store 中的操作方法
 */

import { useEffect, useCallback, useRef } from 'react';
import { useApi } from '../contexts/SessionContext';
import { useChatStore } from '../stores';
import { getFriends } from '../api/friends';
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

  // 加载好友列表
  const loadFriends = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const response = await getFriends(api);
      // 服务器返回格式: { items: Friend[] }
      setFriends(response.items || []);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      setFriends([]);
    } finally {
      setLoading(false);
    }
  }, [api, setFriends, setLoading, setError]);

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

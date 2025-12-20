/**
 * 好友管理 Hook
 *
 * 功能：
 * - 好友列表加载和刷新
 * - 增量添加好友（配合 WebSocket 通知）
 * - 增量移除好友（配合 AnimatePresence 触发退出动画）
 */

import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../contexts/SessionContext';
import { getFriends } from '../api/friends';
import type { Friend } from '../types/chat';

export function useFriends() {
  const api = useApi();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** 加载好友列表 */
  const loadFriends = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await getFriends(api);
      // 服务器返回格式: { items: Friend[] }
      setFriends(response.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFriends([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  /** 刷新好友列表 */
  const refresh = useCallback(() => {
    return loadFriends();
  }, [loadFriends]);

  /**
   * 增量添加好友
   * 用于 WebSocket 收到 friend_request_approved 通知时直接插入新好友
   */
  const addFriend = useCallback((newFriend: Friend) => {
    setFriends((prev) => {
      // 避免重复添加
      if (prev.some((f) => f.friend_id === newFriend.friend_id)) {
        return prev;
      }
      // 插入到列表头部
      return [newFriend, ...prev];
    });
  }, []);

  /**
   * 增量移除好友
   * 用于删除好友后直接从列表移除，配合 AnimatePresence 触发退出动画
   */
  const removeFriend = useCallback((friendId: string) => {
    setFriends((prev) => prev.filter((f) => f.friend_id !== friendId));
  }, []);

  // 初始加载
  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  return {
    friends,
    loading,
    error,
    refresh,
    addFriend,
    removeFriend,
  };
}

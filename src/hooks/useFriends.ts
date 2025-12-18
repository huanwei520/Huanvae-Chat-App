/**
 * 好友管理 Hook
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

  // 初始加载
  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  return {
    friends,
    loading,
    error,
    refresh,
  };
}

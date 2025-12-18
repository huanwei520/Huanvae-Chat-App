/**
 * 群聊列表 Hook
 *
 * 提供群聊列表的状态管理和 API 调用
 */

import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../contexts/SessionContext';
import { getMyGroups } from '../api/groups';
import type { Group } from '../types/chat';

interface UseGroupsReturn {
  groups: Group[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useGroups(): UseGroupsReturn {
  const api = useApi();

  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await getMyGroups(api);
      setGroups(response.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载群聊失败');
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  return {
    groups,
    loading,
    error,
    refresh: loadGroups,
  };
}

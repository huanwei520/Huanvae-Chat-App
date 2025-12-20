/**
 * 群聊列表 Hook
 *
 * 功能：
 * - 群聊列表加载和刷新
 * - 增量添加群聊（配合 WebSocket 通知）
 * - 增量移除群聊（配合 AnimatePresence 触发退出动画）
 * - 增量更新群聊信息（群名、头像、角色等）
 */

import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../contexts/SessionContext';
import { getMyGroups } from '../api/groups';
import type { Group } from '../types/chat';

interface UseGroupsReturn {
  groups: Group[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<Group[]>;
  addGroup: (group: Group) => void;
  removeGroup: (groupId: string) => void;
  updateGroup: (groupId: string, updates: Partial<Group>) => void;
}

export function useGroups(): UseGroupsReturn {
  const api = useApi();

  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGroups = useCallback(async (): Promise<Group[]> => {
    setLoading(true);
    setError(null);

    try {
      const response = await getMyGroups(api);
      const newGroups = response.data || [];
      setGroups(newGroups);
      return newGroups;
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载群聊失败');
      setGroups([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [api]);

  /**
   * 增量添加群聊
   * 用于 WebSocket 收到 group_join_approved 通知时直接插入新群聊
   */
  const addGroup = useCallback((newGroup: Group) => {
    setGroups((prev) => {
      // 避免重复添加
      if (prev.some((g) => g.group_id === newGroup.group_id)) {
        return prev;
      }
      // 插入到列表头部
      return [newGroup, ...prev];
    });
  }, []);

  /**
   * 增量移除群聊
   * 用于 WebSocket 收到 group_removed/group_disbanded 通知时直接移除
   * 配合 AnimatePresence 触发退出动画
   */
  const removeGroup = useCallback((groupId: string) => {
    setGroups((prev) => prev.filter((g) => g.group_id !== groupId));
  }, []);

  /**
   * 增量更新群聊信息
   * 用于 WebSocket 收到 group_info_updated/group_avatar_updated/角色变更等通知时更新
   */
  const updateGroup = useCallback((groupId: string, updates: Partial<Group>) => {
    setGroups((prev) => prev.map((g) =>
      g.group_id === groupId ? { ...g, ...updates } : g,
    ));
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  return {
    groups,
    loading,
    error,
    refresh: loadGroups,
    addGroup,
    removeGroup,
    updateGroup,
  };
}

/**
 * 群聊列表 Hook
 *
 * 基于 Zustand store 的群聊状态管理
 *
 * 功能：
 * - 群聊列表加载和刷新（调用 API 并更新 store）
 * - 提供 store 中群聊操作方法的便捷访问
 *
 * 状态存储在 useChatStore 中，本 hook 主要负责：
 * 1. 初始化时加载群聊列表
 * 2. 提供 refresh 方法重新加载
 * 3. 代理 store 中的操作方法
 */

import { useEffect, useCallback, useRef } from 'react';
import { useApi } from '../contexts/SessionContext';
import { useChatStore } from '../stores';
import { getMyGroups } from '../api/groups';
import type { Group } from '../types/chat';

interface UseGroupsReturn {
  /** 群聊列表 */
  groups: Group[];
  /** 加载中状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 刷新群聊列表 */
  refresh: () => Promise<Group[]>;
  /** 添加群聊（WebSocket 通知时使用） */
  addGroup: (group: Group) => void;
  /** 移除群聊（WebSocket 通知时使用） */
  removeGroup: (groupId: string) => void;
  /** 更新群聊信息（WebSocket 通知时使用） */
  updateGroup: (groupId: string, updates: Partial<Group>) => void;
}

export function useGroups(): UseGroupsReturn {
  const api = useApi();

  // 从 store 获取状态和操作方法
  const groups = useChatStore((state) => state.groups);
  const loading = useChatStore((state) => state.groupsLoading);
  const error = useChatStore((state) => state.groupsError);
  const setGroups = useChatStore((state) => state.setGroups);
  const setLoading = useChatStore((state) => state.setGroupsLoading);
  const setError = useChatStore((state) => state.setGroupsError);
  const addGroup = useChatStore((state) => state.addGroup);
  const removeGroup = useChatStore((state) => state.removeGroup);
  const updateGroup = useChatStore((state) => state.updateGroup);

  // 加载群聊列表
  const loadGroups = useCallback(async (): Promise<Group[]> => {
    setLoading(true);
    setError(null);

    try {
      const response = await getMyGroups(api);
      const newGroups = response.data || [];
      setGroups(newGroups);
      return newGroups;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '加载群聊失败';
      setError(errorMsg);
      setGroups([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [api, setGroups, setLoading, setError]);

  // 初始化加载（只执行一次）
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) { return; }
    initRef.current = true;
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

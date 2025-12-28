/**
 * 群聊列表 Hook
 *
 * 基于 Zustand store 的群聊状态管理，支持本地优先加载
 *
 * 功能：
 * - 本地优先：先从本地数据库加载，立即显示，loading 立即关闭
 * - 后台同步：服务器请求在后台静默进行，不阻塞 UI
 * - 提供 store 中群聊操作方法的便捷访问
 *
 * 加载流程：
 * 1. 先从本地 SQLite 加载群聊列表 → 立即显示 + loading=false
 * 2. 后台从服务器获取最新列表（静默更新）
 * 3. 更新本地数据库和 UI
 */

import { useEffect, useCallback, useRef } from 'react';
import { useApi } from '../contexts/SessionContext';
import { useChatStore } from '../stores';
import { getMyGroups } from '../api/groups';
import * as db from '../db';
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

/** 将本地群组转换为 UI Group 类型 */
function localGroupToGroup(local: db.LocalGroup): Group {
  return {
    group_id: local.group_id,
    group_name: local.name,
    group_avatar_url: local.avatar_url || '',
    role: (local.my_role as Group['role']) || 'member',
    unread_count: null,
    last_message_content: null,
    last_message_time: null,
  };
}

/** 将 UI Group 类型转换为本地群组 */
function groupToLocalGroup(group: Group): db.LocalGroup {
  return {
    group_id: group.group_id,
    name: group.group_name,
    avatar_url: group.group_avatar_url || null,
    owner_id: '', // 服务器响应中可能没有，使用空字符串
    member_count: 0, // 服务器响应中可能没有
    my_role: group.role,
    created_at: new Date().toISOString(),
    updated_at: null,
  };
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

  // 从本地数据库加载群聊
  const loadLocalGroups = useCallback(async (): Promise<Group[]> => {
    try {
      const localGroups = await db.getGroups();
      return localGroups.map(localGroupToGroup);
    } catch (err) {
      console.warn('[Groups] 加载本地群聊失败:', err);
      return [];
    }
  }, []);

  // 从服务器加载群聊并保存到本地
  const loadServerGroups = useCallback(async (): Promise<Group[]> => {
    const response = await getMyGroups(api);
    const serverGroups = response.data || [];

    // 保存到本地数据库
    try {
      const localGroups = serverGroups.map(groupToLocalGroup);
      await db.saveGroups(localGroups);
      // 保存成功
    } catch (err) {
      console.warn('[Groups] 保存群聊到本地失败:', err);
    }

    return serverGroups;
  }, [api]);

  // 加载群聊列表（本地优先 + 后台同步）
  const loadGroups = useCallback(async (): Promise<Group[]> => {
    setLoading(true);
    setError(null);

    try {
      // 1. 先从本地加载并立即显示
      const localGroups = await loadLocalGroups();
      if (localGroups.length > 0) {
        setGroups(localGroups);
        setLoading(false); // 本地数据显示后立即关闭 loading
        // 本地数据加载完成
      }

      // 2. 从服务器获取最新列表（后台静默更新）
      const serverGroups = await loadServerGroups();
      setGroups(serverGroups);
      // 服务器数据加载完成
      return serverGroups;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[Groups] 加载群聊失败:', errorMsg);
      setError(errorMsg);
      // 如果服务器失败，保持本地数据显示
      return groups;
    } finally {
      setLoading(false); // 确保最终关闭 loading（无论成功失败）
    }
  }, [loadLocalGroups, loadServerGroups, setGroups, setLoading, setError, groups]);

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

/**
 * ============================================================================
 * 账号管理 Hook
 * ============================================================================
 *
 * 提供账号的增删改查功能。
 * 使用 Tauri 本地存储 + 系统密码链进行数据持久化。
 */

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { SavedAccount } from '../types/account';

export function useAccounts() {
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ==========================================================================
  // 加载账号列表
  // ==========================================================================

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const savedAccounts = await invoke<SavedAccount[]>('get_saved_accounts');
      setAccounts(savedAccounts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ==========================================================================
  // 保存账号
  // ==========================================================================

  const saveAccount = useCallback(async (
    userId: string,
    nickname: string,
    serverUrl: string,
    password: string,
    avatarPath?: string | null,
  ) => {
    await invoke('save_account', {
      userId,
      nickname,
      serverUrl,
      password,
      avatarPath: avatarPath || null,
    });

    await loadAccounts();
  }, [loadAccounts]);

  // ==========================================================================
  // 获取密码
  // ==========================================================================

  const getPassword = useCallback(async (
    serverUrl: string,
    userId: string,
  ): Promise<string> => {
    const password = await invoke<string>('get_account_password', {
      serverUrl,
      userId,
    });

    if (!password) {
      throw new Error('未找到保存的密码');
    }
    return password;
  }, []);

  // ==========================================================================
  // 删除账号
  // ==========================================================================

  const deleteAccount = useCallback(async (serverUrl: string, userId: string) => {
    await invoke('delete_account', { serverUrl, userId });
    await loadAccounts();
  }, [loadAccounts]);

  // ==========================================================================
  // 更新头像
  // ==========================================================================

  const updateAvatar = useCallback(async (
    serverUrl: string,
    userId: string,
    avatarUrl: string,
  ): Promise<string | null> => {
    const localPath = await invoke<string>('update_account_avatar', {
      serverUrl,
      userId,
      avatarUrl,
    });

    await loadAccounts();
    return localPath;
  }, [loadAccounts]);

  // ==========================================================================
  // 初始化
  // ==========================================================================

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // ==========================================================================
  // 返回值
  // ==========================================================================

  return {
    /** 账号列表 */
    accounts,
    /** 是否正在加载 */
    loading,
    /** 错误信息 */
    error,
    /** 重新加载账号列表 */
    loadAccounts,
    /** 保存账号 */
    saveAccount,
    /** 获取账号密码 */
    getPassword,
    /** 删除账号 */
    deleteAccount,
    /** 更新账号头像 */
    updateAvatar,
  };
}

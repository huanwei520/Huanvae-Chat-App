/**
 * ============================================================================
 * 账号管理 Hook
 * ============================================================================
 *
 * 提供账号的增删改查功能。
 *
 * ## 平台差异
 * - macOS：App 私有 AES 加密文件存密码（无系统钥匙串弹框；v1.1.24 起登录读密码也不再要 Touch ID）
 * - Windows/Linux：使用 Tauri 后端 + 系统密钥链（keyring）存储密码
 * - 移动端：使用 Tauri 后端存储账号信息 + plugin-store 安全存储密码
 */

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { directIpUrl } from '../services/discovery';
import { resolveStorageUrl } from '../utils/network';
import { isMobile } from '../utils/platform';
import {
  storePassword as mobileStorePassword,
  retrievePassword as mobileRetrievePassword,
  removePassword as mobileRemovePassword,
} from '../services/mobileKeystore';
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
    // 1. 保存账号信息到后端（账号列表）
    await invoke('save_account', {
      userId,
      nickname,
      serverUrl,
      password, // 桌面端后端会保存密码，移动端后端会忽略
      avatarPath: avatarPath || null,
    });

    // 2. 移动端：检查密码是否需要更新
    if (isMobile()) {
      try {
        const existingPassword = await mobileRetrievePassword(serverUrl, userId);
        if (existingPassword === password) {
          console.warn('[Accounts] 移动端密码未变化，跳过保存');
        } else {
          // 密码不存在或已变化，需要保存
          await mobileStorePassword(serverUrl, userId, password);
          console.warn('[Accounts] 移动端密码已安全存储');
        }
      } catch {
        try {
          await mobileStorePassword(serverUrl, userId, password);
          console.warn('[Accounts] 移动端密码已安全存储（首次）');
        } catch (storeErr) {
          console.warn('[Accounts] 移动端密码存储失败:', storeErr);
        }
      }
    }

    await loadAccounts();
  }, [loadAccounts]);

  // ==========================================================================
  // 获取密码
  // ==========================================================================

  const getPassword = useCallback(async (
    serverUrl: string,
    userId: string,
  ): Promise<string> => {
    // 移动端：从本地安全存储获取
    if (isMobile()) {
      const password = await mobileRetrievePassword(serverUrl, userId);
      if (password) {
        return password;
      }
      throw new Error('未找到保存的密码，请手动输入');
    }

    // 桌面端：从后端获取
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
    // 1. 删除后端账号信息
    await invoke('delete_account', { serverUrl, userId });

    // 2. 移动端：同时删除安全存储中的密码
    if (isMobile()) {
      try {
        await mobileRemovePassword(serverUrl, userId);
        console.warn('[Accounts] 移动端密码已删除');
      } catch (err) {
        console.warn('[Accounts] 删除移动端密码失败:', err);
      }
    }

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
    // avatarUrl 传后端返回的相对路径或逻辑域名 URL(不是显示用的回环代理 URL):
    // 先解析为 https 逻辑域名完整 URL, 再 directIpUrl 改写主机为源站 IP(不发 SNI 绕 ICP),
    // 交 Rust secure_net 钉 CA 客户端下载到本地缓存(供 asset:// 显示)。
    const downloadUrl = directIpUrl(resolveStorageUrl(avatarUrl, serverUrl) ?? avatarUrl);
    const localPath = await invoke<string>('update_account_avatar', {
      serverUrl,
      userId,
      avatarUrl: downloadUrl,
    });

    await loadAccounts();
    return localPath;
  }, [loadAccounts]);

  // ==========================================================================
  // 更新昵称
  // ==========================================================================

  const updateNickname = useCallback(async (
    serverUrl: string,
    userId: string,
    nickname: string,
  ): Promise<void> => {
    await invoke('update_account_nickname', {
      serverUrl,
      userId,
      nickname,
    });

    await loadAccounts();
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
    /** 更新账号昵称 */
    updateNickname,
  };
}

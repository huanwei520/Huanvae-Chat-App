/**
 * 认证相关的 Hook
 *
 * 处理登录、注册、账号选择等逻辑
 */

import { useState, useCallback } from 'react';
import { useAccounts } from './useAccounts';
import { useSession } from '../contexts/SessionContext';
import { login, register, getProfile } from '../api/auth';
import type { SavedAccount } from '../types/account';
import type { Session } from '../types/session';

interface UseAuthReturn {
  // 状态
  isLoading: boolean;
  error: string | null;
  selectedAccount: SavedAccount | null;

  // 账号管理
  accounts: SavedAccount[];
  accountsLoading: boolean;

  // 操作方法
  handleLogin: (serverUrl: string, userId: string, password: string) => Promise<void>;
  handleRegister: (serverUrl: string, userId: string, nickname: string, password: string, email?: string) => Promise<void>;
  handleSelectAccount: (account: SavedAccount) => Promise<void>;
  handleDeleteAccount: (account: SavedAccount) => Promise<void>;

  // 状态设置
  setSelectedAccount: (account: SavedAccount | null) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export function useAuth(): UseAuthReturn {
  const {
    accounts,
    loading: accountsLoading,
    saveAccount,
    getPassword,
    deleteAccount,
    updateAvatar,
  } = useAccounts();

  const { setSession } = useSession();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<SavedAccount | null>(null);

  /**
   * 创建会话并登录
   */
  const createSessionAndLogin = useCallback(async (
    serverUrl: string,
    userId: string,
    accessToken: string,
    refreshToken: string,
    avatarPath: string | null,
  ) => {
    // 获取用户资料
    const profileResponse = await getProfile(serverUrl, accessToken);
    const profile = profileResponse.data;

    // 设置当前用户数据目录（这会创建目录结构）
    console.log('[Auth] 开始初始化用户数据目录...');
    const { setCurrentUser, initDatabase } = await import('../db');
    
    console.log('[Auth] 调用 setCurrentUser:', userId, serverUrl);
    await setCurrentUser(userId, serverUrl);
    console.log('[Auth] setCurrentUser 完成');
    
    // 初始化用户数据库
    console.log('[Auth] 调用 initDatabase...');
    await initDatabase();
    console.log('[Auth] initDatabase 完成');

    // 创建会话
    const newSession: Session = {
      serverUrl,
      userId,
      accessToken,
      refreshToken,
      profile,
      avatarPath,
    };

    // 设置会话（这将触发界面切换到主页面）
    setSession(newSession);
  }, [setSession]);

  // 处理账号选择（点击头像直接登录）
  const handleSelectAccount = useCallback(async (account: SavedAccount) => {
    setIsLoading(true);
    setError(null);

    try {
      // 1. 从密钥链获取密码
      let password: string;
      try {
        password = await getPassword(account.server_url, account.user_id);
      } catch {
        // 密钥链中没有密码，需要让用户重新输入
        setSelectedAccount(account);
        setIsLoading(false);
        setError('密码未保存，请重新输入密码登录');
        throw new Error('PASSWORD_NOT_FOUND');
      }

      // 2. 调用登录 API
      const loginResponse = await login(account.server_url, account.user_id, password);

      // 3. 获取最新用户资料并更新头像
      const profileResponse = await getProfile(account.server_url, loginResponse.access_token);
      const profile = profileResponse.data;

      let avatarPath = account.avatar_path;
      if (profile.user_avatar_url) {
        try {
          avatarPath = await updateAvatar(account.server_url, account.user_id, profile.user_avatar_url);
        } catch {
          // 头像更新失败不影响登录
        }
      }

      // 4. 更新保存的账号信息
      await saveAccount(
        account.user_id,
        profile.user_nickname,
        account.server_url,
        password,
        avatarPath,
      );

      // 5. 创建会话并登录
      await createSessionAndLogin(
        account.server_url,
        account.user_id,
        loginResponse.access_token,
        loginResponse.refresh_token,
        avatarPath,
      );

    } catch (err) {
      if (err instanceof Error && err.message === 'PASSWORD_NOT_FOUND') {
        // 已经处理过了，不需要再设置错误
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [getPassword, updateAvatar, saveAccount, createSessionAndLogin]);

  // 处理新登录
  const handleLogin = useCallback(async (
    serverUrl: string,
    userId: string,
    password: string,
  ) => {
    setIsLoading(true);
    setError(null);

    try {
      // 1. 调用登录 API
      const loginResponse = await login(serverUrl, userId, password);

      // 2. 获取用户资料
      const profileResponse = await getProfile(serverUrl, loginResponse.access_token);
      const profile = profileResponse.data;

      // 3. 下载并保存头像
      let avatarPath: string | null = null;
      if (profile.user_avatar_url) {
        try {
          avatarPath = await updateAvatar(serverUrl, userId, profile.user_avatar_url);
        } catch {
          // 头像下载失败不影响登录
          console.warn('头像下载失败');
        }
      }

      // 4. 保存账号信息
      await saveAccount(
        userId,
        profile.user_nickname,
        serverUrl,
        password,
        avatarPath,
      );

      // 5. 创建会话并登录
      await createSessionAndLogin(
        serverUrl,
        userId,
        loginResponse.access_token,
        loginResponse.refresh_token,
        avatarPath,
      );

    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [saveAccount, updateAvatar, createSessionAndLogin]);

  // 处理注册
  const handleRegister = useCallback(async (
    serverUrl: string,
    userId: string,
    nickname: string,
    password: string,
    email?: string,
  ) => {
    setIsLoading(true);
    setError(null);

    try {
      // 1. 调用注册 API
      await register(serverUrl, {
        server_url: serverUrl,
        user_id: userId,
        nickname,
        password,
        email,
      });

      // 2. 注册成功后自动登录
      await handleLogin(serverUrl, userId, password);

    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsLoading(false);
    }
  }, [handleLogin]);

  // 处理删除账号
  const handleDeleteAccount = useCallback(async (account: SavedAccount) => {
    try {
      await deleteAccount(account.server_url, account.user_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [deleteAccount]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    isLoading,
    error,
    selectedAccount,
    accounts,
    accountsLoading,
    handleLogin,
    handleRegister,
    handleSelectAccount,
    handleDeleteAccount,
    setSelectedAccount,
    setError,
    clearError,
  };
}

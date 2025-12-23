/**
 * Huanvae Chat 应用主入口
 *
 * 应用启动流程：
 * 1. 检查本地是否有存储记录
 * 2. 有记录 → 显示用户选择页面
 * 3. 无记录 → 显示登录页面
 * 4. 登录成功 → 创建会话，进入主界面
 *
 * 会话管理：
 * - 使用 SessionContext 管理登录状态
 * - 所有 API 请求自动使用当前会话的 serverUrl 和 token
 */

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccounts } from './hooks/useAccounts';
import { useSession } from './contexts/SessionContext';
import { AccountSelector } from './pages/AccountSelector';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Main } from './pages/Main';
import { LoadingOverlay } from './components/common/LoadingOverlay';
import { ErrorToast } from './components/common/ErrorToast';
import { login, register, getProfile } from './api/auth';
import { cardVariants, cardContentVariants, cardContentTransition } from './constants/authAnimations';
import type { AppPage, SavedAccount } from './types/account';
import type { Session } from './types/session';
import './styles/index.css';

// 认证表单类型：登录或注册
type AuthFormType = 'login' | 'register';

function App() {
  const {
    accounts,
    loading: accountsLoading,
    saveAccount,
    getPassword,
    deleteAccount,
    updateAvatar,
  } = useAccounts();

  const { session, setSession, isLoggedIn } = useSession();

  const [currentPage, setCurrentPage] = useState<AppPage>('loading');
  const [authForm, setAuthForm] = useState<AuthFormType>('login');
  const [formDirection, setFormDirection] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 切换到注册表单
  const goToRegister = useCallback(() => {
    setFormDirection(1);
    setError(null);
    setAuthForm('register');
  }, []);

  // 切换到登录表单
  const goToLogin = useCallback(() => {
    setFormDirection(-1);
    setError(null);
    setAuthForm('login');
  }, []);

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
    const { setCurrentUser, initDatabase } = await import('./db');

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

  // 选中的账号（用于密码丢失时重新输入）
  const [selectedAccount, setSelectedAccount] = useState<SavedAccount | null>(null);

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
        // 密钥链中没有密码，跳转到登录页面让用户重新输入
        setSelectedAccount(account);
        setAuthForm('login');
        setCurrentPage('login');
        setIsLoading(false);
        setError('密码未保存，请重新输入密码登录');
        return;
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

      // 如果删除后没有账号了，跳转到登录页
      if (accounts.length <= 1) {
        setCurrentPage('login');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accounts.length, deleteAccount]);

  // 监听账号加载完成
  if (currentPage === 'loading' && !accountsLoading) {
    setCurrentPage(accounts.length > 0 ? 'account-selector' : 'login');
  }

  // 如果已登录，显示主界面
  if (isLoggedIn && session) {
    return <Main />;
  }

  // 加载中显示
  if (currentPage === 'loading' || accountsLoading) {
    return (
      <div className="login-container">
        <div className="floating-orb orb-1" />
        <div className="floating-orb orb-2" />
        <div className="floating-orb orb-3" />
        <motion.div
          className="loading-spinner"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            className="spinner-icon"
          >
            ⟳
          </motion.div>
          <p>加载中...</p>
        </motion.div>
      </div>
    );
  }

  // 账号选择页面（使用与登录相同的容器和卡片样式）
  if (currentPage === 'account-selector') {
    return (
      <div className="login-container">
        {/* 装饰性浮动元素 */}
        <div className="floating-orb orb-1" />
        <div className="floating-orb orb-2" />
        <div className="floating-orb orb-3" />

        <motion.div
          className="glass-card auth-card"
          variants={cardVariants}
          initial="hidden"
          animate="visible"
        >
          <AccountSelector
            accounts={accounts}
            onSelectAccount={handleSelectAccount}
            onAddAccount={() => {
              setAuthForm('login');
              setCurrentPage('login');
            }}
            onDeleteAccount={handleDeleteAccount}
          />
        </motion.div>

        {/* 全局加载遮罩 */}
        {isLoading && <LoadingOverlay />}
        {/* 错误提示 */}
        {error && <ErrorToast message={error} onClose={() => setError(null)} />}
      </div>
    );
  }

  // 登录/注册页面（共用外层容器，只切换卡片内容）
  return (
    <div className="login-container">
      {/* 动态流动背景装饰 */}
      <div className="flowing-bg" />

      {/* 装饰性浮动元素 */}
      <div className="floating-orb orb-1" />
      <div className="floating-orb orb-2" />
      <div className="floating-orb orb-3" />
      <div className="floating-orb orb-4" />
      <div className="floating-orb orb-5" />

      <motion.div
        className="glass-card auth-card"
        variants={cardVariants}
        initial="hidden"
        animate="visible"
      >
        <AnimatePresence mode="wait" custom={formDirection}>
          {authForm === 'login' ? (
            <motion.div
              key="login-form"
              custom={formDirection}
              variants={cardContentVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={cardContentTransition}
              className="auth-form-content"
            >
              <Login
                onLogin={handleLogin}
                onGoToRegister={goToRegister}
                onBack={accounts.length > 0 ? () => {
                  setCurrentPage('account-selector');
                  setSelectedAccount(null);
                  setError(null);
                } : undefined}
                hasAccounts={accounts.length > 0}
                isLoading={isLoading}
                error={error}
                prefillAccount={selectedAccount ? {
                  serverUrl: selectedAccount.server_url,
                  userId: selectedAccount.user_id,
                } : null}
              />
            </motion.div>
          ) : (
            <motion.div
              key="register-form"
              custom={formDirection}
              variants={cardContentVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={cardContentTransition}
              className="auth-form-content"
            >
              <Register
                onRegister={handleRegister}
                onGoToLogin={goToLogin}
                isLoading={isLoading}
                error={error}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* 全局加载遮罩 */}
      {isLoading && <LoadingOverlay />}
    </div>
  );
}

export default App;

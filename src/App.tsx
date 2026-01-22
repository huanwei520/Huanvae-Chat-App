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

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccounts } from './hooks/useAccounts';
import { useSession } from './contexts/SessionContext';
import { AccountSelector } from './pages/AccountSelector';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Main } from './pages/Main';
import { MobileMain } from './pages/mobile';
import { LoadingOverlay } from './components/common/LoadingOverlay';
import { ErrorToast } from './components/common/ErrorToast';
import { login, register, getProfile } from './api/auth';
import { checkAndHandleSessionConflict, createSessionLock } from './services/sessionLock';
import { getDeviceInfo } from './services/deviceInfo';
import { isMobile } from './utils/platform';
import { cardVariants, cardContentVariants, cardContentTransition } from './constants/authAnimations';
import type { AppPage, SavedAccount } from './types/account';
import type { Session } from './types/session';
import { setCurrentUser, initDatabase } from './db';
import { restoreSession, hasPersistedSession } from './services/sessionPersist';
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

  // 用于标记是否已尝试恢复会话
  const sessionRestoreAttempted = useRef(false);

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
   *
   * 登录成功后：
   * 1. 获取用户资料
   * 2. 设置用户数据目录
   * 3. 初始化数据库
   * 4. 创建会话锁（防止同账户重复登录）
   * 5. 设置会话进入主界面
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
    await setCurrentUser(userId, serverUrl);

    // 初始化用户数据库
    await initDatabase();

    // 创建会话锁（防止同账户在同设备上多次登录）
    try {
      await createSessionLock(serverUrl, userId);
    } catch (lockError) {
      console.warn('[SessionLock] 创建会话锁失败:', lockError);
      // 不阻止登录，仅记录警告
    }

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
      // 0. 检查是否有同账户实例已在运行
      const { canProceed, message } = await checkAndHandleSessionConflict(
        account.server_url,
        account.user_id,
      );
      if (!canProceed) {
        setError(message || '该账户已在其他窗口登录');
        setIsLoading(false);
        return;
      }

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

      // 2. 获取设备信息
      const { deviceInfo, macAddress } = await getDeviceInfo();

      // 3. 调用登录 API（传递设备信息）
      const loginResponse = await login(
        account.server_url,
        account.user_id,
        password,
        deviceInfo,
        macAddress,
      );

      // 4. 获取最新用户资料并更新头像
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

      // 5. 更新保存的账号信息
      await saveAccount(
        account.user_id,
        profile.user_nickname,
        account.server_url,
        password,
        avatarPath,
      );

      // 6. 创建会话并登录
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
      // 0. 检查是否有同账户实例已在运行
      const { canProceed, message } = await checkAndHandleSessionConflict(serverUrl, userId);
      if (!canProceed) {
        setError(message || '该账户已在其他窗口登录');
        setIsLoading(false);
        return;
      }

      // 1. 获取设备信息
      const { deviceInfo, macAddress } = await getDeviceInfo();

      // 2. 调用登录 API（传递设备信息）
      const loginResponse = await login(serverUrl, userId, password, deviceInfo, macAddress);

      // 3. 获取用户资料
      const profileResponse = await getProfile(serverUrl, loginResponse.access_token);
      const profile = profileResponse.data;

      // 4. 下载并保存头像
      let avatarPath: string | null = null;
      if (profile.user_avatar_url) {
        try {
          avatarPath = await updateAvatar(serverUrl, userId, profile.user_avatar_url);
        } catch {
          // 头像下载失败不影响登录
          console.warn('头像下载失败');
        }
      }

      // 5. 保存账号信息
      await saveAccount(
        userId,
        profile.user_nickname,
        serverUrl,
        password,
        avatarPath,
      );

      // 6. 创建会话并登录
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

  // 移动端：尝试恢复持久化的会话
  useEffect(() => {
    // 仅在移动端、账号加载完成、未尝试恢复时执行
    if (!isMobile() || accountsLoading || sessionRestoreAttempted.current) {
      return;
    }

    sessionRestoreAttempted.current = true;

    async function tryRestoreSession() {
      try {
        // 检查是否有持久化会话
        const hasSaved = await hasPersistedSession();
        if (!hasSaved) {
          console.warn('[App] 无持久化会话');
          setCurrentPage(accounts.length > 0 ? 'account-selector' : 'login');
          return;
        }

        setIsLoading(true);
        console.warn('[App] 正在恢复会话...');

        // 尝试恢复会话（会弹出生物识别验证）
        const savedSession = await restoreSession();
        if (!savedSession) {
          console.warn('[App] 会话恢复失败或用户取消');
          setIsLoading(false);
          setCurrentPage(accounts.length > 0 ? 'account-selector' : 'login');
          return;
        }

        // 验证 Token 是否仍然有效
        try {
          const profileResponse = await getProfile(savedSession.serverUrl, savedSession.accessToken);
          const profile = profileResponse.data;

          // Token 有效，恢复会话
          await setCurrentUser(savedSession.userId, savedSession.serverUrl);
          await initDatabase();

          // 更新 profile 并设置会话
          const restoredSession: Session = {
            ...savedSession,
            profile, // 使用最新的 profile
          };
          setSession(restoredSession);
          console.warn('[App] 会话已恢复, userId:', savedSession.userId);
        } catch {
          // Token 过期，需要重新登录
          console.warn('[App] Token 已过期，需要重新登录');
          setError('登录已过期，请重新登录');
          setCurrentPage(accounts.length > 0 ? 'account-selector' : 'login');
        }
      } catch (err) {
        console.error('[App] 恢复会话出错:', err);
        setCurrentPage(accounts.length > 0 ? 'account-selector' : 'login');
      } finally {
        setIsLoading(false);
      }
    }

    tryRestoreSession();
  }, [accountsLoading, accounts.length, setSession]);

  // 监听账号加载完成（桌面端，或移动端恢复失败后）
  if (currentPage === 'loading' && !accountsLoading && !isMobile()) {
    setCurrentPage(accounts.length > 0 ? 'account-selector' : 'login');
  }

  // 如果已登录，根据平台显示对应主界面
  if (isLoggedIn && session) {
    return isMobile() ? <MobileMain /> : <Main />;
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

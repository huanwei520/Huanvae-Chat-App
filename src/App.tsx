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
import type { Session, UserProfile } from './types/session';
import { setCurrentUser, initDatabase } from './db';
import { restoreSession } from './services/sessionPersist';
import { discoverEndpoints } from './services/discovery';
import { resolveServerAvatarUrl } from './utils/avatar';
import { UpdateToast, useStartupUpdateCheck, useUpdateToastProps } from './update';
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
    updateNickname,
  } = useAccounts();

  const { session, setSession, isLoggedIn, restoreSession: restoreSessionToContext } = useSession();

  // 全局更新弹窗 props（所有平台共用，防止多实例）
  const updateToastProps = useUpdateToastProps();

  // 启动时更新检查（mount 后 5s 触发一次检测；登录后 Main 的 3s 检测仍照旧，由 store 双锁兜底保证只一次有效检测）
  useStartupUpdateCheck();

  const [currentPage, setCurrentPage] = useState<AppPage>('loading');
  const [authForm, setAuthForm] = useState<AuthFormType>('login');
  const [formDirection, setFormDirection] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 用于标记会话恢复状态
  const sessionRestoreAttempted = useRef(false);  // 是否已开始尝试
  // 使用 useState 而非 useRef，确保状态变化触发重渲染
  const [sessionRestoreCompleted, setSessionRestoreCompleted] = useState(false);  // 是否已完成（成功或失败）

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
   * 1. 设置用户数据目录
   * 2. 初始化数据库
   * 3. 创建会话锁（防止同账户重复登录）
   * 4. 设置会话进入主界面
   */
  const createSessionAndLogin = useCallback(async (
    serverUrl: string,
    userId: string,
    accessToken: string,
    refreshToken: string,
    profile: UserProfile,
    avatarPath: string | null,
  ) => {
    // 设置当前用户数据目录（这会创建目录结构）
    await setCurrentUser(userId, serverUrl);

    // 初始化数据库 与 创建会话锁 互不依赖，并行执行
    await Promise.all([
      initDatabase(),
      createSessionLock(serverUrl, userId).catch(e =>
        console.warn('[SessionLock] 创建会话锁失败:', e),
      ),
    ]);

    // 解析头像相对路径为完整 URL
    const resolvedProfile = {
      ...profile,
      user_avatar_url: resolveServerAvatarUrl(profile.user_avatar_url),
    };

    // 创建会话（触发界面切换到主页面）
    setSession({
      serverUrl,
      userId,
      accessToken,
      refreshToken,
      profile: resolvedProfile,
      avatarPath,
    });
  }, [setSession]);

  // 选中的账号（用于密码丢失时重新输入）
  const [selectedAccount, setSelectedAccount] = useState<SavedAccount | null>(null);

  // 处理账号选择（点击头像直接登录）
  const handleSelectAccount = useCallback(async (account: SavedAccount) => {
    setIsLoading(true);
    setError(null);

    try {
      // 0. 先发现后端 IP + CA(设置 secureHttp 注入层 active + 回环反代目标);失败不阻塞(退化用内置 CA)。
      //    desktop 账号选择登录链路无 session 恢复,必须在此发现,否则 login/头像/上传 拿不到 active。
      await discoverEndpoints().catch(() => undefined);

      // 0.1 检查是否有同账户实例已在运行
      const { canProceed, message } = await checkAndHandleSessionConflict(
        account.server_url,
        account.user_id,
      );
      if (!canProceed) {
        setError(message || '该账户已在其他窗口登录');
        setIsLoading(false);
        return;
      }

      // 1. 从密钥链/安全存储获取密码
      let password!: string;
      if (isMobile()) {
        // 移动端：getPassword 触发生物认证，失败时自动重试，
        // 直到成功、用户取消或达到最大重试次数
        const MAX_BIO_RETRIES = 5;
        let bioAttempt = 0;
        let bioSuccess = false;

        while (!bioSuccess) {
          try {
            // eslint-disable-next-line no-await-in-loop
            password = await getPassword(account.server_url, account.user_id);
            bioSuccess = true;
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            if (errMsg.includes('未找到保存的密码')) {
              setSelectedAccount(account);
              setAuthForm('login');
              setCurrentPage('login');
              setIsLoading(false);
              setError('密码未保存，请重新输入密码登录');
              return;
            }

            bioAttempt++;
            const errLower = errMsg.toLowerCase();
            const userCancelled = errLower.includes('cancel') ||
              errLower.includes('取消') ||
              errLower.includes('user_canceled') ||
              errLower.includes('negative');

            if (userCancelled || bioAttempt >= MAX_BIO_RETRIES) {
              setIsLoading(false);
              setError(
                bioAttempt >= MAX_BIO_RETRIES
                  ? '验证失败次数过多，请稍后重试'
                  : '验证已取消',
              );
              return;
            }

            // 非主动取消的失败，短暂延迟后自动重新弹出生物认证
            // eslint-disable-next-line no-await-in-loop
            await new Promise<void>(r => { setTimeout(r, 600); });
          }
        }
      } else {
        // 桌面：getPassword = 系统钥匙串读，弹一次系统密码框。读失败（未保存/用户
        // 拒绝/ACL 不信任）不重试——钥匙串弹框不是可重试的生物认证，重试只会反复
        // 弹框（曾导致一次登录弹 5 次密码）；直接转手动输密码登录。
        try {
          password = await getPassword(account.server_url, account.user_id);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          setSelectedAccount(account);
          setAuthForm('login');
          setCurrentPage('login');
          setIsLoading(false);
          setError(
            errMsg.includes('未找到保存的密码')
              ? '密码未保存，请重新输入密码登录'
              : '读取保存的密码失败，请手动登录',
          );
          return;
        }
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

      // 4. 获取最新用户资料
      const profileResponse = await getProfile(account.server_url, loginResponse.access_token);
      const profile = profileResponse.data;

      // 5. 刷新账号元数据（昵称）与 创建会话 并行执行。
      //    密码刚从钥匙串读出、未变化，**不再重写钥匙串**（避免多余的系统密码框）；
      //    昵称走 updateNickname（仅改 JSON 元数据，不碰钥匙串）。
      await Promise.all([
        updateNickname(account.server_url, account.user_id, profile.user_nickname),
        createSessionAndLogin(
          account.server_url,
          account.user_id,
          loginResponse.access_token,
          loginResponse.refresh_token,
          profile,
          account.avatar_path,
        ),
      ]);

      // 7. 后台异步更新头像（不阻塞登录）：updateAvatar 已把头像路径持久化到账号元数据
      //    （update_account_avatar，不碰钥匙串），无需再 saveAccount 重写密码。
      if (profile.user_avatar_url) {
        updateAvatar(account.server_url, account.user_id, profile.user_avatar_url)
          .catch(() => {});
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [getPassword, updateAvatar, updateNickname, createSessionAndLogin]);

  // 处理新登录
  const handleLogin = useCallback(async (
    userId: string,
    password: string,
  ) => {
    setIsLoading(true);
    setError(null);

    try {
      // serverUrl 不再由用户输入:重登录(密码丢失)沿用所选账号的逻辑域名;
      // 新登录由发现服务(ca.huanvae.cn → 内置 CA)择最快域名。物理直连 IP 由 secureHttp 注入层处理。
      const serverUrl = selectedAccount?.server_url ?? `https://${(await discoverEndpoints()).domain}`;

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

      // 4. 保存账号 与 创建会话 并行执行（账号保存非进入主界面的前置条件）
      await Promise.all([
        saveAccount(userId, profile.user_nickname, serverUrl, password, null),
        createSessionAndLogin(
          serverUrl,
          userId,
          loginResponse.access_token,
          loginResponse.refresh_token,
          profile,
          null,
        ),
      ]);

      // 6. 后台异步下载头像并更新账号（不阻塞登录）：updateAvatar 已把头像路径持久化
      //    到账号元数据（不碰钥匙串），无需再 saveAccount 重写密码。
      if (profile.user_avatar_url) {
        updateAvatar(serverUrl, userId, profile.user_avatar_url)
          .catch(() => {});
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [saveAccount, updateAvatar, createSessionAndLogin, selectedAccount]);

  // 处理注册
  const handleRegister = useCallback(async (
    userId: string,
    nickname: string,
    password: string,
    email?: string,
  ) => {
    setIsLoading(true);
    setError(null);

    try {
      // serverUrl 由发现服务择最快域名(不再由用户输入)
      const serverUrl = `https://${(await discoverEndpoints()).domain}`;

      // 1. 调用注册 API
      await register(serverUrl, {
        server_url: serverUrl,
        user_id: userId,
        nickname,
        password,
        email,
      });

      // 2. 注册成功后自动登录(handleLogin 内部重新发现, 命中缓存为同一域名)
      await handleLogin(userId, password);

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

  // 移动端：尝试恢复持久化的会话（优化：不等待 accounts 加载）
  useEffect(() => {
    // 仅在移动端、未尝试恢复时执行
    if (!isMobile() || sessionRestoreAttempted.current) {
      return;
    }

    sessionRestoreAttempted.current = true;

    async function tryRestoreSession() {
      console.warn('[App] 移动端启动，尝试恢复会话...');

      try {
        // 先跑发现服务(刷新可用域名 + CA,设置 secureHttp 注入层的 active);失败不阻塞(secureHttp 退化用内置 CA)
        await discoverEndpoints().catch(() => undefined);

        // 从本地存储恢复会话（与 QQ/微信 体验一致）
        const savedSession = await restoreSession();

        if (!savedSession) {
          console.warn('[App] 无持久化会话，等待账号加载完成');
          // 无保存的会话，标记完成，等待 accounts 加载后决定显示哪个页面
          setSessionRestoreCompleted(true);
          return;
        }

        // 优化：先用保存的 profile 显示 UI，再后台验证 Token
        // 这样用户能更快看到界面
        console.warn('[App] 快速恢复会话（使用缓存的 profile）');

        // 并行执行：初始化数据库 + 验证 Token
        const [, profileResult] = await Promise.all([
          // 初始化数据库（必须）
          (async () => {
            await setCurrentUser(savedSession.userId, savedSession.serverUrl);
            await initDatabase();
          })(),
          // 验证 Token（可能失败）
          getProfile(savedSession.serverUrl, savedSession.accessToken)
            .then(res => ({ success: true, profile: res.data }))
            .catch(() => ({ success: false, profile: null })),
        ]);

        if (profileResult.success && profileResult.profile) {
          // Token 有效，使用最新的 profile（解析头像相对路径）
          const restoredSession: Session = {
            ...savedSession,
            profile: {
              ...profileResult.profile,
              user_avatar_url: resolveServerAvatarUrl(profileResult.profile.user_avatar_url),
            },
          };
          restoreSessionToContext(restoredSession);
          console.warn('[App] 会话已恢复（Token 有效）, userId:', savedSession.userId);
        } else {
          // Token 过期，但仍使用缓存的 profile 进入主界面（解析头像相对路径）
          const restoredSession: Session = {
            ...savedSession,
            profile: {
              ...savedSession.profile,
              user_avatar_url: resolveServerAvatarUrl(savedSession.profile.user_avatar_url),
            },
          };
          restoreSessionToContext(restoredSession);
          console.warn('[App] 会话已恢复（Token 待刷新）, userId:', savedSession.userId);
        }
      } catch (err) {
        console.error('[App] 恢复会话出错:', err);
        // 恢复失败，标记完成，等待 accounts 加载完成后显示登录页
        setSessionRestoreCompleted(true);
      } finally {
        setIsLoading(false);
      }
    }

    tryRestoreSession();
  }, [restoreSessionToContext]);

  // 移动端：无保存会话时，等待 accounts 加载完成后显示登录页
  useEffect(() => {
    if (!isMobile() || accountsLoading || isLoggedIn) {
      return;
    }
    // 只有在会话恢复**完成**且未登录时才设置页面
    // sessionRestoreCompleted 是 useState，变化时会触发重渲染
    if (sessionRestoreCompleted && currentPage === 'loading') {
      setCurrentPage(accounts.length > 0 ? 'account-selector' : 'login');
      setIsLoading(false);
    }
  }, [accountsLoading, accounts.length, isLoggedIn, currentPage, sessionRestoreCompleted]);

  // 用于追踪上一次的登录状态，检测退出登录
  const prevLoggedInRef = useRef(isLoggedIn);

  // 监听退出登录（isLoggedIn 从 true 变为 false）
  useEffect(() => {
    const wasLoggedIn = prevLoggedInRef.current;
    prevLoggedInRef.current = isLoggedIn;

    // 检测退出登录：之前已登录，现在未登录
    if (wasLoggedIn && !isLoggedIn) {
      console.warn('[App] 检测到退出登录，跳转到账号选择页面');
      // 重置会话恢复状态，避免卡在 loading
      setSessionRestoreCompleted(true);
      // 根据是否有保存的账号决定显示哪个页面
      setCurrentPage(accounts.length > 0 ? 'account-selector' : 'login');
      setIsLoading(false);
      setError(null);
    }
  }, [isLoggedIn, accounts.length]);

  // 监听账号加载完成（桌面端，或移动端恢复失败后）
  if (currentPage === 'loading' && !accountsLoading && !isMobile()) {
    setCurrentPage(accounts.length > 0 ? 'account-selector' : 'login');
  }

  // 如果已登录，根据平台显示对应主界面
  if (isLoggedIn && session) {
    return (
      <>
        {/* 全局更新提示弹窗 - 灵动岛风格（所有平台唯一实例） */}
        <UpdateToast {...updateToastProps} />
        {isMobile() ? <MobileMain /> : <Main />}
      </>
    );
  }

  const mobileClass = isMobile() ? 'login-container mobile' : 'login-container';

  // 加载中显示
  if (currentPage === 'loading' || accountsLoading) {
    return (
      <div className={mobileClass}>
        {/* 全局更新提示弹窗 - 与已登录分支共用 store，分支互斥不会重叠 */}
        <UpdateToast {...updateToastProps} />
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
      <div className={mobileClass}>
        {/* 全局更新提示弹窗 - 与已登录分支共用 store，分支互斥不会重叠 */}
        <UpdateToast {...updateToastProps} />
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
    <div className={mobileClass}>
      {/* 全局更新提示弹窗 - 与已登录分支共用 store，分支互斥不会重叠 */}
      <UpdateToast {...updateToastProps} />

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

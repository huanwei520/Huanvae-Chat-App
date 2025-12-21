/**
 * 登录页面内容
 * 只渲染卡片内部内容，外层容器由 App.tsx 统一管理
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

/** 预填充账号信息 */
interface PrefillAccount {
  serverUrl: string;
  userId: string;
}

interface LoginProps {
  onLogin: (serverUrl: string, userId: string, password: string) => Promise<void>;
  onGoToRegister: () => void;
  onBack?: () => void;
  hasAccounts: boolean;
  isLoading: boolean;
  error: string | null;
  /** 预填充的账号信息（用于密码丢失时重新输入） */
  prefillAccount?: PrefillAccount | null;
}

// 动画配置
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: [0.4, 0, 0.2, 1] as const,
    },
  },
};

const buttonVariants = {
  hover: {
    scale: 1.02,
    y: -3,
    transition: {
      type: 'spring' as const,
      stiffness: 400,
      damping: 25,
    },
  },
  tap: {
    scale: 0.98,
    y: -1,
    transition: {
      type: 'spring' as const,
      stiffness: 500,
      damping: 30,
    },
  },
};

// 服务器图标组件
const ServerIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z"
    />
  </svg>
);

// 返回图标
const BackIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
    />
  </svg>
);

export function Login({
  onLogin,
  onGoToRegister,
  onBack,
  hasAccounts,
  isLoading,
  error,
  prefillAccount,
}: LoginProps) {
  const [protocol, setProtocol] = useState<'https://' | 'http://'>('https://');
  const [serverHost, setServerHost] = useState('');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');

  // 当有预填充账号时，自动填充服务器和账号
  useEffect(() => {
    if (prefillAccount) {
      // 解析协议和主机
      if (prefillAccount.serverUrl.startsWith('https://')) {
        setProtocol('https://');
        setServerHost(prefillAccount.serverUrl.replace('https://', ''));
      } else if (prefillAccount.serverUrl.startsWith('http://')) {
        setProtocol('http://');
        setServerHost(prefillAccount.serverUrl.replace('http://', ''));
      } else {
        setServerHost(prefillAccount.serverUrl);
      }
      setUserId(prefillAccount.userId);
      setPassword(''); // 密码需要重新输入
    }
  }, [prefillAccount]);

  // 是否为重新登录模式（有预填充账号）
  const isReloginMode = !!prefillAccount;

  const toggleProtocol = () => {
    setProtocol(prev => prev === 'https://' ? 'http://' : 'https://');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullUrl = protocol + serverHost;
    await onLogin(fullUrl, userId, password);
  };

  return (
    <>
      {/* 返回按钮 */}
      {hasAccounts && onBack && (
        <motion.button
          className="back-button"
          onClick={onBack}
          variants={itemVariants}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <BackIcon />
        </motion.button>
      )}

      {/* 图标 */}
      <motion.div className="icon-wrapper" variants={itemVariants}>
        <ServerIcon />
      </motion.div>

      {/* 标题 */}
      <motion.h1 className="login-title" variants={itemVariants}>
        Huanvae Chat
      </motion.h1>
      <motion.p className="login-subtitle" variants={itemVariants}>
        {isReloginMode ? '请重新输入密码' : '选择你的HuanvaeChat登陆节点'}
      </motion.p>

      {/* 错误提示 */}
      {error && (
        <motion.div
          className="error-message"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {error}
        </motion.div>
      )}

      {/* 表单 */}
      <form onSubmit={handleSubmit}>
        {/* 服务器地址 */}
        <motion.div className="form-group" variants={itemVariants}>
          <label className="form-label" htmlFor="server-url">
            服务器地址
          </label>
          <div className="input-with-prefix">
            <button
              type="button"
              className="protocol-toggle"
              onClick={toggleProtocol}
              disabled={isLoading || isReloginMode}
              title="点击切换协议"
            >
              {protocol}
            </button>
            <motion.input
              type="text"
              id="server-url"
              className="glass-input with-prefix"
              placeholder="example.com"
              value={serverHost}
              onChange={(e) => setServerHost(e.target.value)}
              whileFocus={{ scale: 1.01 }}
              required
              disabled={isLoading || isReloginMode}
              readOnly={isReloginMode}
            />
          </div>
        </motion.div>

        {/* 账号 */}
        <motion.div className="form-group" variants={itemVariants}>
          <label className="form-label" htmlFor="user-id">
            账号
          </label>
          <motion.input
            type="text"
            id="user-id"
            className="glass-input"
            placeholder="请输入账号"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            whileFocus={{ scale: 1.01 }}
            required
            disabled={isLoading || isReloginMode}
            readOnly={isReloginMode}
          />
        </motion.div>

        {/* 密码 */}
        <motion.div className="form-group" variants={itemVariants}>
          <label className="form-label" htmlFor="password">
            密码
          </label>
          <motion.input
            type="password"
            id="password"
            className="glass-input"
            placeholder="请输入密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            whileFocus={{ scale: 1.01 }}
            required
            disabled={isLoading}
          />
        </motion.div>

        {/* 提交按钮 */}
        <motion.div variants={itemVariants}>
          <motion.button
            type="submit"
            className="glass-button"
            disabled={isLoading}
            variants={buttonVariants}
            whileHover={!isLoading ? 'hover' : undefined}
            whileTap={!isLoading ? 'tap' : undefined}
          >
            {isLoading ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  style={{ display: 'inline-block' }}
                >
                  ⟳
                </motion.span>
                登陆中...
              </span>
            ) : (
              '登陆'
            )}
          </motion.button>
        </motion.div>
      </form>

      {/* 注册链接 */}
      <motion.p className="auth-link" variants={itemVariants}>
        还没有账号？{' '}
        <button type="button" onClick={onGoToRegister} disabled={isLoading}>
          注册新账号
        </button>
      </motion.p>

      {/* 底部文字 */}
      <motion.p className="footer-text" variants={itemVariants}>
        Huanvae Chat · 安全加密连接
      </motion.p>
    </>
  );
}

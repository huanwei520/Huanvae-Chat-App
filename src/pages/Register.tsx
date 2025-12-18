/**
 * 注册页面 - 分步骤注册
 *
 * 步骤1: 服务器地址
 * 步骤2: 账号、昵称、邮箱
 * 步骤3: 密码确认
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface RegisterProps {
  onRegister: (
    serverUrl: string,
    userId: string,
    nickname: string,
    password: string,
    email?: string
  ) => Promise<void>;
  onGoToLogin: () => void;
  isLoading: boolean;
  error: string | null;
}

type RegisterStep = 1 | 2 | 3;

// 动画配置
const stepVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 100 : -100,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -100 : 100,
    opacity: 0,
  }),
};

const stepTransition = {
  type: 'tween',
  ease: 'easeInOut',
  duration: 0.3,
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.4, 0, 0.2, 1],
    },
  },
};

const buttonVariants = {
  hover: {
    scale: 1.02,
    y: -3,
    transition: {
      type: 'spring',
      stiffness: 400,
      damping: 25,
    },
  },
  tap: {
    scale: 0.98,
    y: -1,
    transition: {
      type: 'spring',
      stiffness: 500,
      damping: 30,
    },
  },
};

// 注册图标
const RegisterIcon = () => (
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
      d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z"
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

// 箭头图标
const ArrowRightIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    style={{ width: 20, height: 20 }}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
    />
  </svg>
);

export function Register({
  onRegister,
  onGoToLogin,
  isLoading,
  error,
}: RegisterProps) {
  const [step, setStep] = useState<RegisterStep>(1);
  const [direction, setDirection] = useState(1);

  // 表单数据
  const [protocol, setProtocol] = useState<'https://' | 'http://'>('https://');
  const [serverHost, setServerHost] = useState('');

  const toggleProtocol = () => {
    setProtocol(prev => prev === 'https://' ? 'http://' : 'https://');
  };
  const [userId, setUserId] = useState('');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const goToStep = (newStep: RegisterStep) => {
    setDirection(newStep > step ? 1 : -1);
    setLocalError(null);
    setStep(newStep);
  };

  const handleStep1Submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverHost.trim()) {
      setLocalError('请输入服务器地址');
      return;
    }
    goToStep(2);
  };

  const handleStep2Submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId.trim()) {
      setLocalError('请输入账号');
      return;
    }
    if (!nickname.trim()) {
      setLocalError('请输入昵称');
      return;
    }
    goToStep(3);
  };

  const handleStep3Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (password.length < 6) {
      setLocalError('密码至少需要6个字符');
      return;
    }

    if (password !== confirmPassword) {
      setLocalError('两次输入的密码不一致');
      return;
    }

    const fullUrl = protocol + serverHost;
    await onRegister(fullUrl, userId, nickname, password, email || undefined);
  };

  const handleBack = () => {
    if (step === 1) {
      onGoToLogin();
    } else {
      goToStep((step - 1) as RegisterStep);
    }
  };

  const displayError = localError || error;

  const stepTitles = {
    1: '选择服务器',
    2: '填写信息',
    3: '设置密码',
  };

  return (
    <>
      {/* 返回按钮 */}
      <motion.button
        className="back-button"
        onClick={handleBack}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
      >
        <BackIcon />
      </motion.button>

      {/* 图标 */}
      <motion.div className="icon-wrapper" variants={itemVariants}>
        <RegisterIcon />
      </motion.div>

      {/* 标题 */}
      <motion.h1 className="login-title" variants={itemVariants}>
        Huanvae Chat
      </motion.h1>
      <motion.p className="login-subtitle" variants={itemVariants}>
        注册新账号 · {stepTitles[step]}
      </motion.p>

      {/* 步骤指示器 */}
      <motion.div className="step-indicator" variants={itemVariants}>
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`step-dot ${s === step ? 'active' : ''} ${s < step ? 'completed' : ''}`}
          />
        ))}
      </motion.div>

      {/* 错误提示 */}
      {displayError && (
        <motion.div
          className="error-message"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {displayError}
        </motion.div>
      )}

      {/* 分步表单 */}
      <div className="step-container">
        <AnimatePresence mode="wait" custom={direction}>
          {step === 1 && (
            <motion.form
              key="step1"
              onSubmit={handleStep1Submit}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={stepTransition}
            >
              <motion.div className="form-group" variants={itemVariants}>
                <label className="form-label" htmlFor="reg-server-url">
                  服务器地址
                </label>
                <div className="input-with-prefix">
                  <button
                    type="button"
                    className="protocol-toggle"
                    onClick={toggleProtocol}
                    title="点击切换协议"
                  >
                    {protocol}
                  </button>
                  <motion.input
                    type="text"
                    id="reg-server-url"
                    className="glass-input with-prefix"
                    placeholder="example.com"
                    value={serverHost}
                    onChange={(e) => setServerHost(e.target.value)}
                    whileFocus={{ scale: 1.01 }}
                    required
                    autoFocus
                  />
                </div>
              </motion.div>

              <motion.div variants={itemVariants}>
                <motion.button
                  type="submit"
                  className="glass-button"
                  variants={buttonVariants}
                  whileHover="hover"
                  whileTap="tap"
                >
                  <span className="button-content">
                    下一步
                    <ArrowRightIcon />
                  </span>
                </motion.button>
              </motion.div>
            </motion.form>
          )}

          {step === 2 && (
            <motion.form
              key="step2"
              onSubmit={handleStep2Submit}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={stepTransition}
            >
              <motion.div className="form-group" variants={itemVariants}>
                <label className="form-label" htmlFor="reg-user-id">
                  账号
                </label>
                <motion.input
                  type="text"
                  id="reg-user-id"
                  className="glass-input"
                  placeholder="请输入账号（user_id）"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  whileFocus={{ scale: 1.01 }}
                  required
                  autoFocus
                />
              </motion.div>

              <motion.div className="form-group" variants={itemVariants}>
                <label className="form-label" htmlFor="reg-nickname">
                  昵称
                </label>
                <motion.input
                  type="text"
                  id="reg-nickname"
                  className="glass-input"
                  placeholder="请输入昵称"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  whileFocus={{ scale: 1.01 }}
                  required
                />
              </motion.div>

              <motion.div className="form-group" variants={itemVariants}>
                <label className="form-label" htmlFor="reg-email">
                  邮箱 <span className="optional-label">（可选）</span>
                </label>
                <motion.input
                  type="email"
                  id="reg-email"
                  className="glass-input"
                  placeholder="请输入邮箱（可选）"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  whileFocus={{ scale: 1.01 }}
                />
              </motion.div>

              <motion.div variants={itemVariants}>
                <motion.button
                  type="submit"
                  className="glass-button"
                  variants={buttonVariants}
                  whileHover="hover"
                  whileTap="tap"
                >
                  <span className="button-content">
                    下一步
                    <ArrowRightIcon />
                  </span>
                </motion.button>
              </motion.div>
            </motion.form>
          )}

          {step === 3 && (
            <motion.form
              key="step3"
              onSubmit={handleStep3Submit}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={stepTransition}
            >
              <motion.div className="form-group" variants={itemVariants}>
                <label className="form-label" htmlFor="reg-password">
                  密码
                </label>
                <motion.input
                  type="password"
                  id="reg-password"
                  className="glass-input"
                  placeholder="请输入密码（至少6位）"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  whileFocus={{ scale: 1.01 }}
                  required
                  minLength={6}
                  autoFocus
                />
              </motion.div>

              <motion.div className="form-group" variants={itemVariants}>
                <label className="form-label" htmlFor="reg-confirm-password">
                  确认密码
                </label>
                <motion.input
                  type="password"
                  id="reg-confirm-password"
                  className="glass-input"
                  placeholder="请再次输入密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  whileFocus={{ scale: 1.01 }}
                  required
                />
              </motion.div>

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
                      注册中...
                    </span>
                  ) : (
                    '注册'
                  )}
                </motion.button>
              </motion.div>
            </motion.form>
          )}
        </AnimatePresence>
      </div>

      {/* 登录链接 */}
      <motion.p className="auth-link" variants={itemVariants}>
        已有账号？{' '}
        <button type="button" onClick={onGoToLogin} disabled={isLoading}>
          返回登陆
        </button>
      </motion.p>

      {/* 底部文字 */}
      <motion.p className="footer-text" variants={itemVariants}>
        Huanvae Chat · 安全加密连接
      </motion.p>
    </>
  );
}

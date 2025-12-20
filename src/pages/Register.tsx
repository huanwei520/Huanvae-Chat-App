/**
 * 注册页面 - 分步骤注册
 *
 * 步骤1: 服务器地址
 * 步骤2: 账号、昵称、邮箱
 * 步骤3: 密码确认
 *
 * 表单状态管理已提取到 useRegisterForm Hook
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useRegisterForm } from '../hooks/useRegisterForm';

// ============================================
// 类型定义
// ============================================

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

// ============================================
// 动画配置
// ============================================

const stepVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 100 : -100,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({
    x: direction > 0 ? -100 : 100,
    opacity: 0,
  }),
};

const stepTransition = { type: 'tween', ease: 'easeInOut', duration: 0.3 };

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] },
  },
};

const buttonVariants = {
  hover: { scale: 1.02, y: -3, transition: { type: 'spring', stiffness: 400, damping: 25 } },
  tap: { scale: 0.98, y: -1, transition: { type: 'spring', stiffness: 500, damping: 30 } },
};

// ============================================
// 图标组件
// ============================================

const RegisterIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
  </svg>
);

const BackIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" style={{ width: 20, height: 20 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
  </svg>
);

// ============================================
// 主组件
// ============================================

export function Register({ onRegister, onGoToLogin, isLoading, error }: RegisterProps) {
  const form = useRegisterForm();

  const handleStep1Submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.validateStep1()) {
      form.goToStep(2);
    }
  };

  const handleStep2Submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.validateStep2()) {
      form.goToStep(3);
    }
  };

  const handleStep3Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    form.setLocalError(null);
    if (form.validateStep3()) {
      await onRegister(
        form.getFullServerUrl(),
        form.userId,
        form.nickname,
        form.password,
        form.email || undefined,
      );
    }
  };

  const handleBack = () => {
    if (form.step === 1) {
      onGoToLogin();
    } else {
      form.goBack();
    }
  };

  const displayError = form.localError || error;
  const stepTitles = { 1: '选择服务器', 2: '填写信息', 3: '设置密码' };

  return (
    <>
      <motion.button className="back-button" onClick={handleBack} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
        <BackIcon />
      </motion.button>

      <motion.div className="icon-wrapper" variants={itemVariants}>
        <RegisterIcon />
      </motion.div>

      <motion.h1 className="login-title" variants={itemVariants}>
        Huanvae Chat
      </motion.h1>
      <motion.p className="login-subtitle" variants={itemVariants}>
        注册新账号 · {stepTitles[form.step]}
      </motion.p>

      <motion.div className="step-indicator" variants={itemVariants}>
        {[1, 2, 3].map((s) => (
          <div key={s} className={`step-dot ${s === form.step ? 'active' : ''} ${s < form.step ? 'completed' : ''}`} />
        ))}
      </motion.div>

      {displayError && (
        <motion.div className="error-message" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          {displayError}
        </motion.div>
      )}

      <div className="step-container">
        <AnimatePresence mode="wait" custom={form.direction}>
          {form.step === 1 && (
            <motion.form key="step1" onSubmit={handleStep1Submit} custom={form.direction} variants={stepVariants} initial="enter" animate="center" exit="exit" transition={stepTransition}>
              <motion.div className="form-group" variants={itemVariants}>
                <label className="form-label" htmlFor="reg-server-url">服务器地址</label>
                <div className="input-with-prefix">
                  <button type="button" className="protocol-toggle" onClick={form.toggleProtocol} title="点击切换协议">
                    {form.protocol}
                  </button>
                  <motion.input
                    type="text"
                    id="reg-server-url"
                    className="glass-input with-prefix"
                    placeholder="example.com"
                    value={form.serverHost}
                    onChange={(e) => form.setServerHost(e.target.value)}
                    whileFocus={{ scale: 1.01 }}
                    required
                    autoFocus
                  />
                </div>
              </motion.div>
              <motion.div variants={itemVariants}>
                <motion.button type="submit" className="glass-button" variants={buttonVariants} whileHover="hover" whileTap="tap">
                  <span className="button-content">下一步 <ArrowRightIcon /></span>
                </motion.button>
              </motion.div>
            </motion.form>
          )}

          {form.step === 2 && (
            <motion.form key="step2" onSubmit={handleStep2Submit} custom={form.direction} variants={stepVariants} initial="enter" animate="center" exit="exit" transition={stepTransition}>
              <motion.div className="form-group" variants={itemVariants}>
                <label className="form-label" htmlFor="reg-user-id">账号</label>
                <motion.input type="text" id="reg-user-id" className="glass-input" placeholder="请输入账号（user_id）" value={form.userId} onChange={(e) => form.setUserId(e.target.value)} whileFocus={{ scale: 1.01 }} required autoFocus />
              </motion.div>
              <motion.div className="form-group" variants={itemVariants}>
                <label className="form-label" htmlFor="reg-nickname">昵称</label>
                <motion.input type="text" id="reg-nickname" className="glass-input" placeholder="请输入昵称" value={form.nickname} onChange={(e) => form.setNickname(e.target.value)} whileFocus={{ scale: 1.01 }} required />
              </motion.div>
              <motion.div className="form-group" variants={itemVariants}>
                <label className="form-label" htmlFor="reg-email">邮箱 <span className="optional-label">(可选)</span></label>
                <motion.input type="email" id="reg-email" className="glass-input" placeholder="请输入邮箱" value={form.email} onChange={(e) => form.setEmail(e.target.value)} whileFocus={{ scale: 1.01 }} />
              </motion.div>
              <motion.div variants={itemVariants}>
                <motion.button type="submit" className="glass-button" variants={buttonVariants} whileHover="hover" whileTap="tap">
                  <span className="button-content">下一步 <ArrowRightIcon /></span>
                </motion.button>
              </motion.div>
            </motion.form>
          )}

          {form.step === 3 && (
            <motion.form key="step3" onSubmit={handleStep3Submit} custom={form.direction} variants={stepVariants} initial="enter" animate="center" exit="exit" transition={stepTransition}>
              <motion.div className="form-group" variants={itemVariants}>
                <label className="form-label" htmlFor="reg-password">密码</label>
                <motion.input type="password" id="reg-password" className="glass-input" placeholder="请输入密码（至少6位）" value={form.password} onChange={(e) => form.setPassword(e.target.value)} whileFocus={{ scale: 1.01 }} required autoFocus />
              </motion.div>
              <motion.div className="form-group" variants={itemVariants}>
                <label className="form-label" htmlFor="reg-confirm-password">确认密码</label>
                <motion.input type="password" id="reg-confirm-password" className="glass-input" placeholder="请再次输入密码" value={form.confirmPassword} onChange={(e) => form.setConfirmPassword(e.target.value)} whileFocus={{ scale: 1.01 }} required />
              </motion.div>
              <motion.div variants={itemVariants}>
                <motion.button type="submit" className="glass-button" disabled={isLoading} variants={buttonVariants} whileHover="hover" whileTap="tap">
                  {isLoading ? '注册中...' : '注册'}
                </motion.button>
              </motion.div>
            </motion.form>
          )}
        </AnimatePresence>
      </div>

      <motion.p className="auth-link" variants={itemVariants}>
        已有账号？ <button type="button" onClick={onGoToLogin}>返回登录</button>
      </motion.p>

      <motion.p className="footer-text" variants={itemVariants}>
        Huanvae Chat · 安全加密连接
      </motion.p>
    </>
  );
}

/**
 * 用户选择页面 - 3D 堆叠卡片效果
 *
 * @description 使用 Framer Motion 实现 3D 堆叠卡片轮播效果
 *
 * 功能特性：
 * - 3D 堆叠效果（当前卡片在前，其他在后）
 * - 切换时卡片从后方放大进入，当前卡片缩小退到后方
 * - 单个卡片也能循环展示
 * - 无限循环滚动
 * - 鼠标滚轮控制
 * - 平滑动画过渡
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { SavedAccount } from '../types/account';

interface AccountSelectorProps {
  accounts: SavedAccount[];
  onSelectAccount: (account: SavedAccount) => void;
  onAddAccount: () => void;
  onDeleteAccount: (account: SavedAccount) => void;
}

// 容器动画配置
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

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

// 默认头像 SVG
const DefaultAvatar = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="default-avatar-icon"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
    />
  </svg>
);

// 用户图标
const UserIcon = () => (
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
      d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
    />
  </svg>
);

// 删除图标
const TrashIcon = () => (
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
      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
    />
  </svg>
);

// 获取循环索引
function getLoopIndex(index: number, length: number): number {
  if (length === 0) { return 0; }
  return ((index % length) + length) % length;
}

// ============================================================================
// 卡片动画配置
// ============================================================================

/**
 * 3D 堆叠卡片动画（使用 custom 传递方向）
 *
 * direction 含义：
 * - direction = 1:  向下滚动，显示下一个账号
 *                   新卡片从下方(y=80)进入，旧卡片退出到上方(y=-80)
 * - direction = -1: 向上滚动，显示上一个账号
 *                   新卡片从上方(y=-80)进入，旧卡片退出到下方(y=80)
 */
const cardVariants = {
  // 初始状态：从后方进入
  initial: (direction: number) => ({
    scale: 0.85,
    y: direction * 80,  // direction=1 从下方进入, direction=-1 从上方进入
    opacity: 0,
    zIndex: 0,
  }),
  // 当前卡片（在最前方）
  center: {
    scale: 1,
    y: 0,
    opacity: 1,
    zIndex: 10,
  },
  // 退出状态：退出到相反方向
  exit: (direction: number) => ({
    scale: 0.85,
    y: direction * -80,  // direction=1 退出到上方, direction=-1 退出到下方
    opacity: 0,
    zIndex: 0,
  }),
};

const cardTransition = {
  type: 'spring',
  stiffness: 320,   // 较高刚度，支持连续滚动
  damping: 30,      // 适中阻尼
  mass: 0.8,        // 较低质量，响应更快
} as const;

// ============================================================================
// 背景卡片组件（装饰用）
// ============================================================================

interface BackgroundCardProps {
  account: SavedAccount;
  offset: number;     // -1 上方, 1 下方
  direction: number;  // 当前滚动方向: 1 向下, -1 向上
  onClick?: () => void;
}

/**
 * 背景卡片动画逻辑：
 * - 向下滚动 (direction=1): 下方卡片即将被抽取，显示"待抽取"效果（稍大、更亮）
 * - 向上滚动 (direction=-1): 上方卡片即将被抽取，显示"待抽取"效果
 * - 另一张卡片保持正常的背景效果
 */
function BackgroundCard({ account, offset, direction, onClick }: BackgroundCardProps) {
  // 使用 useMemo 同步计算头像 URL，避免异步设置导致的闪烁
  const avatarSrc = useMemo(() => {
    if (account.avatar_path) {
      try {
        return convertFileSrc(account.avatar_path);
      } catch {
        return null;
      }
    }
    return null;
  }, [account.avatar_path]);

  // 判断这张卡片是否是"即将被抽取"的卡片
  // 向下滚动时，下方卡片(offset=1)即将被抽取
  // 向上滚动时，上方卡片(offset=-1)即将被抽取
  const isNextCard = (direction === 1 && offset === 1) || (direction === -1 && offset === -1);

  return (
    <motion.div
      className={`stack-card stack-card-background ${isNextCard ? 'stack-card-ready' : ''}`}
      animate={{
        y: offset * 70,
        scale: isNextCard ? 0.94 : 0.85,     // 即将被抽取的卡片稍大
        opacity: isNextCard ? 0.7 : 0.35,    // 即将被抽取的卡片更亮
        zIndex: isNextCard ? 2 : 1,
      }}
      transition={cardTransition}
      onClick={onClick}
    >
      <div className="stack-account-card">
        <div className="stack-card-avatar">
          {avatarSrc ? (
            <img src={avatarSrc} alt={account.nickname} />
          ) : (
            <DefaultAvatar />
          )}
        </div>
        <div className="stack-card-info">
          <div className="stack-card-nickname">{account.nickname}</div>
          <div className="stack-card-id">{account.user_id}</div>
          <div className="stack-card-server">{account.server_url}</div>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// 主卡片组件（带动画）
// ============================================================================

interface MainCardProps {
  account: SavedAccount;
  direction: number; // 1: 向下滚动, -1: 向上滚动
}

function MainCard({ account, direction }: MainCardProps) {
  const [avatarFailed, setAvatarFailed] = useState(false);

  // 使用 useMemo 同步计算头像 URL，避免异步设置导致的闪烁
  const avatarSrc = useMemo(() => {
    if (account.avatar_path) {
      try {
        return convertFileSrc(account.avatar_path);
      } catch {
        return null;
      }
    }
    return null;
  }, [account.avatar_path]);

  return (
    <motion.div
      className="stack-card stack-card-main"
      custom={direction}
      initial="initial"
      animate="center"
      exit="exit"
      variants={cardVariants}
      transition={cardTransition}
    >
      <div className="stack-account-card">
        <div className="stack-card-avatar">
          {avatarSrc && !avatarFailed ? (
            <img
              src={avatarSrc}
              alt={account.nickname}
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <DefaultAvatar />
          )}
        </div>
        <div className="stack-card-info">
          <div className="stack-card-nickname">{account.nickname}</div>
          <div className="stack-card-id">{account.user_id}</div>
          <div className="stack-card-server">{account.server_url}</div>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

// 拖动阈值（像素）
const DRAG_THRESHOLD = 30;

export function AccountSelector({
  accounts,
  onSelectAccount,
  onAddAccount,
  onDeleteAccount,
}: AccountSelectorProps) {
  // 使用组合状态确保 index 和 direction 同步更新
  const [state, setState] = useState({ index: 0, direction: 1, key: 0 });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const isScrolling = useRef(false);

  // 拖动状态
  const dragStartY = useRef<number | null>(null);
  const isDragging = useRef(false);

  const currentIndex = state.index;
  const direction = state.direction;
  const currentAccount = accounts[currentIndex];
  const accountCount = accounts.length;

  // 计算背景卡片索引
  const prevIndex = getLoopIndex(currentIndex - 1, accountCount);
  const nextIndex = getLoopIndex(currentIndex + 1, accountCount);

  // 切换到上一个
  const goToPrev = useCallback(() => {
    if (isScrolling.current || accountCount < 1) { return; }
    isScrolling.current = true;
    setState((prev) => ({
      index: getLoopIndex(prev.index - 1, accountCount),
      direction: -1,
      key: prev.key + 1,
    }));
    setShowDeleteConfirm(false);
    setTimeout(() => { isScrolling.current = false; }, 150); // 缩短防抖，支持连续滚动
  }, [accountCount]);

  // 切换到下一个
  const goToNext = useCallback(() => {
    if (isScrolling.current || accountCount < 1) { return; }
    isScrolling.current = true;
    setState((prev) => ({
      index: getLoopIndex(prev.index + 1, accountCount),
      direction: 1,
      key: prev.key + 1,
    }));
    setShowDeleteConfirm(false);
    setTimeout(() => { isScrolling.current = false; }, 150); // 缩短防抖，支持连续滚动
  }, [accountCount]);

  // 处理滚轮事件
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY > 0) {
      goToNext();
    } else if (e.deltaY < 0) {
      goToPrev();
    }
  }, [goToNext, goToPrev]);

  // 处理拖动开始（鼠标）
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragStartY.current = e.clientY;
    isDragging.current = false;
  }, []);

  // 处理拖动移动（鼠标）
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragStartY.current === null) { return; }

    const deltaY = e.clientY - dragStartY.current;

    if (Math.abs(deltaY) > DRAG_THRESHOLD) {
      isDragging.current = true;
      if (deltaY < 0) {
        goToNext();
      } else {
        goToPrev();
      }
      dragStartY.current = e.clientY; // 重置起点，支持连续拖动
    }
  }, [goToNext, goToPrev]);

  // 处理拖动结束（鼠标）
  const handleMouseUp = useCallback(() => {
    dragStartY.current = null;
  }, []);

  // 处理触摸开始
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    isDragging.current = false;
  }, []);

  // 处理触摸移动
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current === null) { return; }

    const deltaY = e.touches[0].clientY - dragStartY.current;

    if (Math.abs(deltaY) > DRAG_THRESHOLD) {
      isDragging.current = true;
      if (deltaY < 0) {
        goToNext();
      } else {
        goToPrev();
      }
      dragStartY.current = e.touches[0].clientY;
    }
  }, [goToNext, goToPrev]);

  // 处理触摸结束
  const handleTouchEnd = useCallback(() => {
    dragStartY.current = null;
  }, []);

  // 登录操作
  const handleSelect = useCallback(() => {
    if (currentAccount && !showDeleteConfirm) {
      onSelectAccount(currentAccount);
    }
  }, [currentAccount, showDeleteConfirm, onSelectAccount]);

  // 删除操作
  const handleDelete = useCallback(() => {
    if (currentAccount) {
      onDeleteAccount(currentAccount);
      setShowDeleteConfirm(false);
      if (currentIndex >= accountCount - 1 && currentIndex > 0) {
        setState((prev) => ({
          ...prev,
          index: prev.index - 1,
          key: prev.key + 1,
        }));
      }
    }
  }, [currentAccount, onDeleteAccount, currentIndex, accountCount]);

  return (
    <motion.div
      className="account-selector-content"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* 图标 */}
      <motion.div className="icon-wrapper" variants={itemVariants}>
        <UserIcon />
      </motion.div>

      {/* 标题 */}
      <motion.h1 className="login-title" variants={itemVariants}>
        Huanvae Chat
      </motion.h1>
      <motion.p className="login-subtitle" variants={itemVariants}>
        选择一个账号登录
      </motion.p>

      {/* 3D 堆叠卡片选择器 */}
      <motion.div
        className="stack-selector"
        variants={itemVariants}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="stack-container">
          {/* 背景卡片 - 上方 */}
          {accountCount > 1 && (
            <BackgroundCard
              key={`bg-prev-${accounts[prevIndex].user_id}`}
              account={accounts[prevIndex]}
              offset={-1}
              direction={direction}
              onClick={goToPrev}
            />
          )}

          {/* 主卡片 - 仅展示，点击登录按钮才能登录 */}
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <MainCard
              key={`main-${state.key}`}
              account={accounts[currentIndex]}
              direction={direction}
            />
          </AnimatePresence>

          {/* 背景卡片 - 下方 */}
          {accountCount > 1 && (
            <BackgroundCard
              key={`bg-next-${accounts[nextIndex].user_id}`}
              account={accounts[nextIndex]}
              offset={1}
              direction={direction}
              onClick={goToNext}
            />
          )}

          {/* 单个账号时的装饰卡片 */}
          {accountCount === 1 && (
            <>
              <motion.div
                className="stack-card stack-card-ghost"
                animate={{ y: -70, scale: 0.88, opacity: 0.2 }}
              >
                <div className="stack-account-card">
                  <div className="stack-card-avatar"><DefaultAvatar /></div>
                  <div className="stack-card-info">
                    <div className="stack-card-nickname">添加更多账号</div>
                    <div className="stack-card-id">点击下方按钮</div>
                  </div>
                </div>
              </motion.div>
              <motion.div
                className="stack-card stack-card-ghost"
                animate={{ y: 70, scale: 0.88, opacity: 0.2 }}
              >
                <div className="stack-account-card">
                  <div className="stack-card-avatar"><DefaultAvatar /></div>
                  <div className="stack-card-info">
                    <div className="stack-card-nickname">添加更多账号</div>
                    <div className="stack-card-id">支持多账号切换</div>
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </div>

        {/* 账号计数 */}
        <div className="stack-counter">
          {currentIndex + 1} / {accountCount}
        </div>
      </motion.div>

      {/* 登录按钮 */}
      <motion.div variants={itemVariants}>
        <motion.button
          type="button"
          className="glass-button"
          onClick={handleSelect}
          disabled={!currentAccount || showDeleteConfirm}
          whileHover={{ scale: 1.02, y: -3 }}
          whileTap={{ scale: 0.98 }}
        >
          登陆
        </motion.button>
      </motion.div>

      {/* 删除操作 */}
      <motion.div className="wheel-actions" variants={itemVariants}>
        {!showDeleteConfirm ? (
          <button
            type="button"
            className="delete-text-btn"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={!currentAccount}
          >
            <TrashIcon />
            删除此账号
          </button>
        ) : (
          <div className="delete-confirm-row">
            <span>确认删除 {currentAccount?.nickname}？</span>
            <div className="delete-confirm-buttons">
              <button type="button" className="confirm-delete-btn" onClick={handleDelete}>
                删除
              </button>
              <button type="button" className="cancel-delete-btn" onClick={() => setShowDeleteConfirm(false)}>
                取消
              </button>
            </div>
          </div>
        )}
      </motion.div>

      {/* 添加账号链接 */}
      <motion.p className="auth-link" variants={itemVariants}>
        其他账号？{' '}
        <button type="button" onClick={onAddAccount}>
          添加新账号
        </button>
      </motion.p>

      {/* 底部文字 */}
      <motion.p className="footer-text" variants={itemVariants}>
        Huanvae Chat · 安全加密连接
      </motion.p>
    </motion.div>
  );
}

/**
 * 用户选择页面 - 真正的多卡片联动动画
 *
 * @description 使用动画偏移机制实现多卡片联动动画
 *
 * 核心原理：
 * 1. 5个固定槽位，基础位置分别是 0, 1, 2, 3, 4
 * 2. 滚动时，positionOffset 变化（0 → ±1）
 * 3. 每个槽位的实际位置 = 基础位置 + positionOffset
 * 4. 位置变化触发动画
 * 5. 动画完成后，重置 positionOffset，更新 mainIndex
 *
 * 使用 useReducer 确保状态原子更新，避免中间状态
 */

import { useCallback, useRef, useMemo, useLayoutEffect, useReducer } from 'react';
import { motion } from 'framer-motion';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { SavedAccount } from '../types/account';

interface AccountSelectorProps {
  accounts: SavedAccount[];
  onSelectAccount: (account: SavedAccount) => void;
  onAddAccount: () => void;
  onDeleteAccount: (account: SavedAccount) => void;
}

// ============================================================================
// 动画配置
// ============================================================================

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

// 位置样式配置
interface PositionStyle {
  y: number;
  scale: number;
  opacity: number;
  zIndex: number;
  blur: number;
}

function getPositionStyle(positionIndex: number): PositionStyle {
  const coreStyles: PositionStyle[] = [
    { y: -140, scale: 0.65, opacity: 0, zIndex: 0, blur: 2 },      // 0: exit-top
    { y: -75, scale: 0.82, opacity: 0.45, zIndex: 2, blur: 0.5 },  // 1: bg-top
    { y: 0, scale: 1, opacity: 1, zIndex: 10, blur: 0 },           // 2: main
    { y: 75, scale: 0.82, opacity: 0.45, zIndex: 2, blur: 0.5 },   // 3: bg-bottom
    { y: 140, scale: 0.65, opacity: 0, zIndex: 0, blur: 2 },       // 4: exit-bottom
  ];

  if (positionIndex < 0) {
    return { y: -200, scale: 0.5, opacity: 0, zIndex: 0, blur: 3 };
  }
  if (positionIndex > 4) {
    return { y: 200, scale: 0.5, opacity: 0, zIndex: 0, blur: 3 };
  }

  return coreStyles[positionIndex];
}

// 卡片过渡动画配置
const cardTransition = {
  type: 'spring',
  stiffness: 200,
  damping: 24,
  mass: 0.9,
} as const;

// 动画持续时间（毫秒）
const ANIMATION_DURATION = 400;

// ============================================================================
// 状态管理 - 使用 useReducer 确保原子更新
// ============================================================================

interface CardState {
  mainIndex: number;
  positionOffset: number;
  // 标记是否正在动画中（用于 transition 选择）
  // 'idle': 静止状态，无动画
  // 'animating': 正在执行滚动动画
  // 'resetting': 正在重置（瞬间完成）
  phase: 'idle' | 'animating' | 'resetting';
}

type CardAction =
  | { type: 'START_PREV' }
  | { type: 'START_NEXT' }
  | { type: 'COMPLETE_PREV'; accountCount: number }
  | { type: 'COMPLETE_NEXT'; accountCount: number }
  | { type: 'FINISH_RESET' }
  | { type: 'SET_INDEX'; index: number };

function getLoopIndex(index: number, length: number): number {
  if (length === 0) { return 0; }
  return ((index % length) + length) % length;
}

function cardReducer(state: CardState, action: CardAction): CardState {
  switch (action.type) {
    case 'START_PREV':
      return { ...state, positionOffset: 1, phase: 'animating' };
    case 'START_NEXT':
      return { ...state, positionOffset: -1, phase: 'animating' };
    case 'COMPLETE_PREV':
      return {
        mainIndex: getLoopIndex(state.mainIndex - 1, action.accountCount),
        positionOffset: 0,
        phase: 'resetting',
      };
    case 'COMPLETE_NEXT':
      return {
        mainIndex: getLoopIndex(state.mainIndex + 1, action.accountCount),
        positionOffset: 0,
        phase: 'resetting',
      };
    case 'FINISH_RESET':
      return { ...state, phase: 'idle' };
    case 'SET_INDEX':
      return { ...state, mainIndex: action.index };
    default:
      return state;
  }
}

// ============================================================================
// 图标组件
// ============================================================================

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

// ============================================================================
// 单个卡片组件
// ============================================================================

interface CardSlotProps {
  account: SavedAccount;
  positionIndex: number;
  phase: 'idle' | 'animating' | 'resetting';
  onClick?: () => void;
}

function CardSlot({ account, positionIndex, phase, onClick }: CardSlotProps) {
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

  const style = getPositionStyle(positionIndex);
  const isMain = positionIndex === 2;
  const isBgTop = positionIndex === 1;
  const isBgBottom = positionIndex === 3;
  const isInteractive = isBgTop || isBgBottom;

  // 根据 phase 决定 transition
  // animating: 使用 spring 动画
  // resetting: 瞬间完成（duration: 0）
  // idle: 使用 spring 动画（用于后续交互）
  const transition = phase === 'resetting'
    ? { type: 'tween' as const, duration: 0 }
    : cardTransition;

  return (
    <motion.div
      className={`stack-card ${isMain ? 'stack-card-main' : 'stack-card-background'}`}
      animate={{
        y: style.y,
        scale: style.scale,
        opacity: style.opacity,
        zIndex: style.zIndex,
        filter: `blur(${style.blur}px)`,
      }}
      initial={false}
      transition={transition}
      onClick={isInteractive ? onClick : undefined}
      style={{
        pointerEvents: isInteractive || isMain ? 'auto' : 'none',
        cursor: isInteractive ? 'pointer' : 'default',
      }}
    >
      <div className="stack-account-card">
        <div className="stack-card-avatar">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={account.nickname}
              draggable={false}
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
// 卡片堆叠组件
// ============================================================================

interface CardStackProps {
  accounts: SavedAccount[];
  mainIndex: number;
  positionOffset: number;
  phase: 'idle' | 'animating' | 'resetting';
  onPrev: () => void;
  onNext: () => void;
}

function CardStack({
  accounts,
  mainIndex,
  positionOffset,
  phase,
  onPrev,
  onNext,
}: CardStackProps) {
  const accountCount = accounts.length;

  const slots = useMemo(() => {
    const result = [];
    for (let slotIdx = 0; slotIdx < 5; slotIdx++) {
      const basePosition = slotIdx;
      const actualPosition = basePosition + positionOffset;
      const accountOffset = slotIdx - 2;
      const accountIndex = getLoopIndex(mainIndex + accountOffset, accountCount);

      result.push({
        slotIdx,
        account: accounts[accountIndex],
        positionIndex: actualPosition,
      });
    }
    return result;
  }, [accounts, mainIndex, accountCount, positionOffset]);

  const getClickHandler = useCallback((posIndex: number) => {
    if (posIndex === 1) { return onPrev; }
    if (posIndex === 3) { return onNext; }
    return undefined;
  }, [onPrev, onNext]);

  return (
    <div className="stack-container">
      {slots.map((slot) => (
        <CardSlot
          key={`slot-${slot.slotIdx}`}
          account={slot.account}
          positionIndex={slot.positionIndex}
          phase={phase}
          onClick={getClickHandler(slot.positionIndex)}
        />
      ))}
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

const DRAG_THRESHOLD = 30;

export function AccountSelector({
  accounts,
  onSelectAccount,
  onAddAccount,
  onDeleteAccount,
}: AccountSelectorProps) {
  // 使用 useReducer 确保状态原子更新
  const [cardState, dispatch] = useReducer(cardReducer, {
    mainIndex: 0,
    positionOffset: 0,
    phase: 'idle',
  });

  const [showDeleteConfirm, setShowDeleteConfirm] = useReducer(
    (_: boolean, action: boolean) => action,
    false,
  );

  const animationLock = useRef(false);
  const dragStartY = useRef<number | null>(null);

  const accountCount = accounts.length;
  const { mainIndex, positionOffset, phase } = cardState;
  const currentAccount = accounts[mainIndex];
  const isAnimating = phase !== 'idle';

  // 处理账号数量变化
  useLayoutEffect(() => {
    if (mainIndex >= accountCount && accountCount > 0) {
      dispatch({ type: 'SET_INDEX', index: accountCount - 1 });
    }
  }, [accountCount, mainIndex]);

  // 当 phase 变为 'resetting' 后，下一帧恢复为 'idle'
  useLayoutEffect(() => {
    if (phase === 'resetting') {
      const frameId = requestAnimationFrame(() => {
        dispatch({ type: 'FINISH_RESET' });
      });
      return () => cancelAnimationFrame(frameId);
    }
  }, [phase]);

  const goToPrev = useCallback(() => {
    if (animationLock.current || accountCount < 1) { return; }
    animationLock.current = true;

    dispatch({ type: 'START_PREV' });

    setTimeout(() => {
      dispatch({ type: 'COMPLETE_PREV', accountCount });
      animationLock.current = false;
    }, ANIMATION_DURATION);

    setShowDeleteConfirm(false);
  }, [accountCount]);

  const goToNext = useCallback(() => {
    if (animationLock.current || accountCount < 1) { return; }
    animationLock.current = true;

    dispatch({ type: 'START_NEXT' });

    setTimeout(() => {
      dispatch({ type: 'COMPLETE_NEXT', accountCount });
      animationLock.current = false;
    }, ANIMATION_DURATION);

    setShowDeleteConfirm(false);
  }, [accountCount]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY > 0) {
      goToNext();
    } else if (e.deltaY < 0) {
      goToPrev();
    }
  }, [goToNext, goToPrev]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragStartY.current = e.clientY;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragStartY.current === null) { return; }
    const deltaY = e.clientY - dragStartY.current;
    if (Math.abs(deltaY) > DRAG_THRESHOLD) {
      if (deltaY < 0) {
        goToNext();
      } else {
        goToPrev();
      }
      dragStartY.current = e.clientY;
    }
  }, [goToNext, goToPrev]);

  const handleMouseUp = useCallback(() => {
    dragStartY.current = null;
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current === null) { return; }
    const deltaY = e.touches[0].clientY - dragStartY.current;
    if (Math.abs(deltaY) > DRAG_THRESHOLD) {
      if (deltaY < 0) {
        goToNext();
      } else {
        goToPrev();
      }
      dragStartY.current = e.touches[0].clientY;
    }
  }, [goToNext, goToPrev]);

  const handleTouchEnd = useCallback(() => {
    dragStartY.current = null;
  }, []);

  const handleSelect = useCallback(() => {
    if (currentAccount && !showDeleteConfirm && !isAnimating) {
      onSelectAccount(currentAccount);
    }
  }, [currentAccount, showDeleteConfirm, isAnimating, onSelectAccount]);

  const handleDelete = useCallback(() => {
    if (currentAccount) {
      onDeleteAccount(currentAccount);
      setShowDeleteConfirm(false);
    }
  }, [currentAccount, onDeleteAccount]);

  // 显示的 mainIndex
  const getDisplayMainIndex = (): number => {
    if (positionOffset === 0) { return mainIndex; }
    if (positionOffset === -1) { return mainIndex; }
    return getLoopIndex(mainIndex - 1, accountCount);
  };
  const displayMainIndex = getDisplayMainIndex();

  return (
    <motion.div
      className="account-selector-content"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div className="icon-wrapper" variants={itemVariants}>
        <UserIcon />
      </motion.div>

      <motion.h1 className="login-title" variants={itemVariants}>
        Huanvae Chat
      </motion.h1>
      <motion.p className="login-subtitle" variants={itemVariants}>
        选择一个账号登录
      </motion.p>

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
        <CardStack
          accounts={accounts}
          mainIndex={mainIndex}
          positionOffset={positionOffset}
          phase={phase}
          onPrev={goToPrev}
          onNext={goToNext}
        />

        <div className="stack-counter">
          {displayMainIndex + 1} / {accountCount}
        </div>
      </motion.div>

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

      <motion.p className="auth-link" variants={itemVariants}>
        其他账号？{' '}
        <button type="button" onClick={onAddAccount}>
          添加新账号
        </button>
      </motion.p>

      <motion.p className="footer-text" variants={itemVariants}>
        Huanvae Chat · 安全加密连接
      </motion.p>
    </motion.div>
  );
}

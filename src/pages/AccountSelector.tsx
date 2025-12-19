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

import { useCallback, useRef, useMemo, useLayoutEffect, useReducer, useEffect } from 'react';
import { motion } from 'framer-motion';
import { convertFileSrc } from '@tauri-apps/api/core';
import { DefaultAvatarIcon, UserIcon, TrashIcon } from '../components/common/Icons';
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
  phase: 'idle' | 'animating';
  // 重置计数器：每次动画完成后递增，用于生成新的 key 让 React 重新创建 DOM
  resetCounter: number;
}

type CardAction =
  | { type: 'START_PREV' }
  | { type: 'START_NEXT' }
  | { type: 'COMPLETE_PREV'; accountCount: number }
  | { type: 'COMPLETE_NEXT'; accountCount: number }
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
      // 递增 resetCounter 让 React 重新创建 DOM，避免复用导致的位置跳跃
      return {
        mainIndex: getLoopIndex(state.mainIndex - 1, action.accountCount),
        positionOffset: 0,
        phase: 'idle',
        resetCounter: state.resetCounter + 1,
      };
    case 'COMPLETE_NEXT':
      // 递增 resetCounter 让 React 重新创建 DOM，避免复用导致的位置跳跃
      return {
        mainIndex: getLoopIndex(state.mainIndex + 1, action.accountCount),
        positionOffset: 0,
        phase: 'idle',
        resetCounter: state.resetCounter + 1,
      };
    case 'SET_INDEX':
      return { ...state, mainIndex: action.index };
    default:
      return state;
  }
}

// ============================================================================
// 单个卡片组件
// ============================================================================

interface CardSlotProps {
  account: SavedAccount;
  positionIndex: number;
  onClick?: () => void;
}

function CardSlot({ account, positionIndex, onClick }: CardSlotProps) {
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
      transition={cardTransition}
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
            <DefaultAvatarIcon />
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
  resetCounter: number;
  onPrev: () => void;
  onNext: () => void;
}

function CardStack({
  accounts,
  mainIndex,
  positionOffset,
  resetCounter,
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
          // 使用 resetCounter 作为 key 的一部分
          // 当动画完成后 resetCounter 递增，React 会销毁旧 DOM 并创建新 DOM
          // 新 DOM 因为 initial={false} 会直接以目标位置渲染，不会有闪烁
          key={`slot-${slot.slotIdx}-${resetCounter}`}
          account={slot.account}
          positionIndex={slot.positionIndex}
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
    resetCounter: 0,
  });

  const [showDeleteConfirm, setShowDeleteConfirm] = useReducer(
    (_: boolean, action: boolean) => action,
    false,
  );

  const animationLock = useRef(false);
  const dragStartY = useRef<number | null>(null);
  const stackSelectorRef = useRef<HTMLDivElement>(null);

  const accountCount = accounts.length;
  const { mainIndex, positionOffset, phase, resetCounter } = cardState;
  const currentAccount = accounts[mainIndex];
  const isAnimating = phase !== 'idle';

  // 处理账号数量变化
  useLayoutEffect(() => {
    if (mainIndex >= accountCount && accountCount > 0) {
      dispatch({ type: 'SET_INDEX', index: accountCount - 1 });
    }
  }, [accountCount, mainIndex]);


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

  // 使用 useEffect 添加非 passive 的 wheel 事件监听器
  // 这样可以正常调用 preventDefault() 阻止页面滚动
  useEffect(() => {
    const element = stackSelectorRef.current;
    if (!element) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY > 0) {
        goToNext();
      } else if (e.deltaY < 0) {
        goToPrev();
      }
    };

    // 添加非 passive 的事件监听器
    element.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      element.removeEventListener('wheel', handleWheel);
    };
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
        ref={stackSelectorRef}
        className="stack-selector"
        variants={itemVariants}
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
          resetCounter={resetCounter}
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

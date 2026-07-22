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
 * 卡片组件已提取到 components/account/
 */

import { useCallback, useRef, useLayoutEffect, useReducer, useEffect } from 'react';
import { motion } from 'framer-motion';
import { MotionAppButton } from '../components/common/AppButton';
import { UserIcon, TrashIcon } from '../components/common/Icons';
import { CardStack, getLoopIndex } from '../components/account';
import type { SavedAccount } from '../types/account';

// ============================================
// 类型定义
// ============================================

interface AccountSelectorProps {
  accounts: SavedAccount[];
  onSelectAccount: (account: SavedAccount) => void;
  onAddAccount: () => void;
  onDeleteAccount: (account: SavedAccount) => void;
}

// ============================================
// 动画配置
// ============================================

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

const ANIMATION_DURATION = 400;
const DRAG_THRESHOLD = 30;

// 滚轮口径(手势级去抖 + 位移阈值,修"滑一下连跳多张"):
// 一次连续手势(相邻事件间隔 ≤ WHEEL_GESTURE_GAP_MS)只切一张,手势结束后才可再切;
// 手势内累计 |deltaY| 达 WHEEL_SWITCH_THRESHOLD(px)才算一次切换意图,与 DRAG_THRESHOLD 同口径
const WHEEL_SWITCH_THRESHOLD = 30;
const WHEEL_GESTURE_GAP_MS = 200;

// ============================================
// 状态管理
// ============================================

interface CardState {
  mainIndex: number;
  positionOffset: number;
  phase: 'idle' | 'animating';
  resetCounter: number;
}

type CardAction =
  | { type: 'START_PREV' }
  | { type: 'START_NEXT' }
  | { type: 'COMPLETE_PREV'; accountCount: number }
  | { type: 'COMPLETE_NEXT'; accountCount: number }
  | { type: 'SET_INDEX'; index: number };

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
        phase: 'idle',
        resetCounter: state.resetCounter + 1,
      };
    case 'COMPLETE_NEXT':
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

// ============================================
// 主组件
// ============================================

export function AccountSelector({
  accounts,
  onSelectAccount,
  onAddAccount,
  onDeleteAccount,
}: AccountSelectorProps) {
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
  const wheelAccumulatedDelta = useRef(0);
  const wheelGestureFired = useRef(false);
  const lastWheelEventAt = useRef(0);

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

  // 滚轮事件处理
  useEffect(() => {
    const element = stackSelectorRef.current;
    if (!element) { return; }

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      // 相邻事件间隔超阈 = 上一手势已结束:重置手势状态,允许本次新手势触发一次切换
      if (now - lastWheelEventAt.current > WHEEL_GESTURE_GAP_MS) {
        wheelGestureFired.current = false;
        wheelAccumulatedDelta.current = 0;
      }
      lastWheelEventAt.current = now;

      // 一个手势只切一张:已触发后,该手势的后续/惯性事件全部忽略
      if (wheelGestureFired.current) { return; }
      // 动画进行中忽略新输入:不累计、不消耗手势(动画结束后的滚动仍可按阈值触发)
      if (animationLock.current) { return; }

      // 手势内按净位移累计(方向由净值符号决定,过滤触控板抖动/方向噪声)
      wheelAccumulatedDelta.current += e.deltaY;
      if (Math.abs(wheelAccumulatedDelta.current) < WHEEL_SWITCH_THRESHOLD) { return; }

      wheelGestureFired.current = true;
      if (wheelAccumulatedDelta.current > 0) {
        goToNext();
      } else {
        goToPrev();
      }
    };

    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => { element.removeEventListener('wheel', handleWheel); };
  }, [goToNext, goToPrev]);

  // 拖拽事件处理
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

  // 键盘导航：方向键切换账号（与滚轮/拖拽语义一致：↓/→ 下一个、↑/← 上一个），
  // 回车登录当前账号，Delete 触发删除确认（不直接删，保留二次确认）。
  // 防抖复用 goToPrev/goToNext 内部的 animationLock，无需额外处理。
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault();
        goToPrev();
        break;
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        goToNext();
        break;
      case 'Enter':
        e.preventDefault();
        handleSelect();
        break;
      case 'Delete':
        e.preventDefault();
        if (currentAccount && !showDeleteConfirm) {
          setShowDeleteConfirm(true);
        }
        break;
      default:
        break;
    }
  }, [goToPrev, goToNext, handleSelect, currentAccount, showDeleteConfirm]);

  // 计算显示的索引
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
        role="group"
        aria-label="账号切换：方向键切换账号，回车登录，Delete 删除"
        tabIndex={0}
        onKeyDown={handleKeyDown}
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
        <MotionAppButton
          type="button"
          variant="primary"
          size="lg"
          block
          onClick={handleSelect}
          disabled={!currentAccount || showDeleteConfirm}
          whileHover={{ scale: 1.02, y: -3 }}
          whileTap={{ scale: 0.98 }}
        >
          登陆
        </MotionAppButton>
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

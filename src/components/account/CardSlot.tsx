/**
 * 单个账户卡片组件
 *
 * 用于账号选择器的卡片动画显示
 */

import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { convertFileSrc } from '@tauri-apps/api/core';
import { AvatarPlaceholder } from '../common/AvatarPlaceholder';
import type { SavedAccount } from '../../types/account';

// ============================================
// 动画配置
// ============================================

interface PositionStyle {
  y: number;
  scale: number;
  opacity: number;
  zIndex: number;
  blur: number;
}

export function getPositionStyle(positionIndex: number): PositionStyle {
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

export const cardTransition = {
  type: 'spring',
  stiffness: 200,
  damping: 24,
  mass: 0.9,
} as const;

/**
 * 槽位「换人」过渡：同一个槽位绑定的账号变了时，内容淡出→淡入，而不是瞬间跳变
 *
 * 触发场景是账号列表本身变了 —— 按上次登录时间重排、删除账号后列表收缩。
 * **卡片轮换（上一个/下一个）不走这里**：轮换完成时整个 CardSlot 会因 key 里的
 * resetCounter 变化而重新挂载，配合 `<AnimatePresence initial={false}>`，重挂载不播过渡，
 * 免得每次轮换都多出一层无谓的淡入淡出。
 *
 * 属性归属（见 .claude/rules/animation.md 规则一）：这里逐帧写的是 `.stack-account-card`
 * 的 opacity + transform；外层 `.stack-card` 的 y/scale/opacity/filter 由 cardTransition
 * 单独接管，两者作用在不同元素上，互不抢帧。
 */
export const cardSwapVariants = {
  enter: { opacity: 0, y: 10 },
  center: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: [0.4, 0, 0.2, 1] as const },
  },
  leave: {
    opacity: 0,
    y: -10,
    transition: { duration: 0.12, ease: [0.4, 0, 1, 1] as const },
  },
};

// ============================================
// 组件
// ============================================

interface CardSlotProps {
  account: SavedAccount;
  positionIndex: number;
  onClick?: () => void;
}

export function CardSlot({ account, positionIndex, onClick }: CardSlotProps) {
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
      {/* key 变化 = 本槽位换了个账号（列表重排 / 删除）→ 播一次淡出淡入；
          initial={false} 让 CardSlot 因轮换重挂载时不播过渡 */}
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={`${account.server_url}::${account.user_id}`}
          className="stack-account-card"
          variants={cardSwapVariants}
          initial="enter"
          animate="center"
          exit="leave"
        >
          <div className="stack-card-avatar">
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt={account.nickname}
                draggable={false}
              />
            ) : (
              <AvatarPlaceholder name={account.nickname || account.user_id} fontSize={20} />
            )}
          </div>
          <div className="stack-card-info">
            <div className="stack-card-nickname">{account.nickname}</div>
            <div className="stack-card-id">{account.user_id}</div>
          </div>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

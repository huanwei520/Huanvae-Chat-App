/**
 * 单个账户卡片组件
 *
 * 用于账号选择器的卡片动画显示
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { convertFileSrc } from '@tauri-apps/api/core';
import { DefaultAvatarIcon } from '../common/Icons';
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

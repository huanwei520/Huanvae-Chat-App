/**
 * 移动端会议悬浮图标组件
 *
 * 功能：
 * - 会议最小化时显示的圆形悬浮图标（不加载视频）
 * - 绿色脉冲指示器表示会议进行中
 * - 可拖拽移动位置
 * - 点击展开恢复全屏
 * - 长按显示操作菜单（返回会议/结束会议）
 *
 * 仅移动端使用，桌面端不显示
 *
 * @module pages/mobile/MeetingFloatingWindow
 */

import { useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PhoneEndIcon } from '../../components/common/Icons';
import '../../styles/mobile/meeting-floating.css';

interface MeetingFloatingWindowProps {
  /** 会议名称 */
  roomName?: string;
  /** 参与者数量 */
  participantCount?: number;
  /** 点击展开回调 */
  onExpand: () => void;
  /** 结束会议回调 */
  onEnd: () => void;
}

// 会议图标
const MeetingIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="28"
    height="28"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
    />
  </svg>
);

export function MeetingFloatingWindow({
  roomName,
  participantCount,
  onExpand,
  onEnd,
}: MeetingFloatingWindowProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 拖拽状态 - 使用绝对像素位置
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showEndMenu, setShowEndMenu] = useState(false);
  const dragStartRef = useRef({ touchX: 0, touchY: 0, elemX: 0, elemY: 0 });
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMoved = useRef(false);

  // 触摸开始
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const container = containerRef.current;
    if (!container) { return; }

    // 获取当前元素的绝对位置
    const rect = container.getBoundingClientRect();

    dragStartRef.current = {
      touchX: touch.clientX,
      touchY: touch.clientY,
      elemX: rect.left,
      elemY: rect.top,
    };
    hasMoved.current = false;
    setIsDragging(true);

    // 长按检测（500ms）
    longPressTimerRef.current = setTimeout(() => {
      if (!hasMoved.current) {
        setShowEndMenu(true);
      }
    }, 500);
  }, []);

  // 触摸移动
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) { return; }

    const touch = e.touches[0];
    const deltaX = touch.clientX - dragStartRef.current.touchX;
    const deltaY = touch.clientY - dragStartRef.current.touchY;

    // 判断是否移动了
    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
      hasMoved.current = true;
      // 取消长按
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }

      // 计算新位置
      const container = containerRef.current;
      if (container) {
        const iconSize = 56;
        const maxX = window.innerWidth - iconSize;
        const maxY = window.innerHeight - iconSize - 60; // 底部留出 tab bar 空间

        const newX = Math.max(0, Math.min(maxX, dragStartRef.current.elemX + deltaX));
        const newY = Math.max(0, Math.min(maxY, dragStartRef.current.elemY + deltaY));

        setPosition({ x: newX, y: newY });
      }
    }
  }, [isDragging]);

  // 触摸结束
  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    // 如果没有移动且没有显示菜单，则展开
    if (!hasMoved.current && !showEndMenu) {
      onExpand();
    }
  }, [showEndMenu, onExpand]);

  // 挂断确认
  const handleEndConfirm = useCallback(() => {
    setShowEndMenu(false);
    onEnd();
  }, [onEnd]);

  // 取消挂断
  const handleEndCancel = useCallback(() => {
    setShowEndMenu(false);
  }, []);

  // 计算样式：未拖动时用默认位置，拖动后用绝对位置
  const positionStyle = position
    ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' }
    : { right: 16, bottom: 100, left: 'auto', top: 'auto' };

  return (
    <>
      <motion.div
        ref={containerRef}
        className="meeting-floating-icon"
        style={positionStyle}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <MeetingIcon />
        {/* 会议进行中指示器 */}
        <span className="floating-pulse" />
        {/* 参与者数量 */}
        {participantCount !== undefined && participantCount > 1 && (
          <span className="floating-participant-badge">{participantCount}</span>
        )}
      </motion.div>

      {/* 挂断确认菜单 */}
      <AnimatePresence>
        {showEndMenu && (
          <motion.div
            className="floating-end-menu-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleEndCancel}
          >
            <motion.div
              className="floating-end-menu"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              {roomName && <p className="floating-end-menu-title">{roomName}</p>}
              <button className="floating-end-menu-btn expand" onClick={() => { setShowEndMenu(false); onExpand(); }}>
                返回会议
              </button>
              <button className="floating-end-menu-btn end" onClick={handleEndConfirm}>
                <PhoneEndIcon />
                结束会议
              </button>
              <button className="floating-end-menu-btn cancel" onClick={handleEndCancel}>
                取消
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

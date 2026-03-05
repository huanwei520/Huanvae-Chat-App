/**
 * AI 语音通话浮窗组件
 *
 * 桌面端：固定在顶部的通话条（绿色脉冲 + 时长 + 点击返回）
 * 移动端：可拖拽圆形浮窗（点击返回，长按显示挂断菜单）
 */

import { useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { isMobile } from '../../../utils/platform';

interface VoiceCallFloatingProps {
  duration: number;
  onRestore: () => void;
  onDisconnect: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 桌面端通话条 */
function DesktopCallBar({ duration, onRestore }: {
  duration: number;
  onRestore: () => void;
}) {
  return (
    <motion.div
      className="voice-call-bar"
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -40, opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      onClick={onRestore}
    >
      <span className="voice-call-bar-dot" />
      <span className="voice-call-bar-label">语音通话中</span>
      <span className="voice-call-bar-duration">{formatDuration(duration)}</span>
      <span className="voice-call-bar-action">返回通话</span>
    </motion.div>
  );
}

/** 移动端圆形浮窗 */
function MobileCallFloating({ duration, onRestore, onDisconnect }: VoiceCallFloatingProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const dragStartRef = useRef({ touchX: 0, touchY: 0, elemX: 0, elemY: 0 });
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMoved = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const el = containerRef.current;
    const rect = el?.getBoundingClientRect();
    dragStartRef.current = {
      touchX: touch.clientX,
      touchY: touch.clientY,
      elemX: rect?.left ?? 0,
      elemY: rect?.top ?? 0,
    };
    hasMoved.current = false;

    longPressTimerRef.current = setTimeout(() => {
      if (!hasMoved.current) {
        setShowMenu(true);
      }
    }, 500);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const dx = touch.clientX - dragStartRef.current.touchX;
    const dy = touch.clientY - dragStartRef.current.touchY;

    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      hasMoved.current = true;
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }

      let newX = dragStartRef.current.elemX + dx;
      let newY = dragStartRef.current.elemY + dy;
      newX = Math.max(0, Math.min(newX, window.innerWidth - 56));
      newY = Math.max(0, Math.min(newY, window.innerHeight - 56));
      setPosition({ x: newX, y: newY });
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (!hasMoved.current && !showMenu) {
      onRestore();
    }
  }, [showMenu, onRestore]);

  const positionStyle = position
    ? { left: position.x, top: position.y, right: 'auto' as const, bottom: 'auto' as const }
    : { right: 16, bottom: 100, left: 'auto' as const, top: 'auto' as const };

  return (
    <>
      <motion.div
        ref={containerRef}
        className="voice-call-floating"
        style={positionStyle}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <PhoneIcon />
        <span className="voice-call-floating-pulse" />
        <span className="voice-call-floating-time">{formatDuration(duration)}</span>
      </motion.div>

      <AnimatePresence>
        {showMenu && (
          <motion.div
            className="voice-call-floating-menu-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowMenu(false)}
          >
            <motion.div
              className="voice-call-floating-menu"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button onClick={() => { setShowMenu(false); onRestore(); }}>
                返回通话
              </button>
              <button className="destructive" onClick={() => { setShowMenu(false); onDisconnect(); }}>
                结束通话
              </button>
              <button onClick={() => setShowMenu(false)}>
                取消
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function VoiceCallFloating(props: VoiceCallFloatingProps) {
  const mobile = isMobile();

  return mobile
    ? <MobileCallFloating {...props} />
    : <DesktopCallBar duration={props.duration} onRestore={props.onRestore} />;
}

function PhoneIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2z" />
    </svg>
  );
}

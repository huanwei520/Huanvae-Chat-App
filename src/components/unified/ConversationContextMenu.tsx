/**
 * 会话卡片右键/长按菜单
 *
 * 极简单项菜单：「置顶 / 取消置顶」。桌面端由 UnifiedList 右键触发，
 * 移动端由 MobileChatList 长按（500ms）触发。
 *
 * 复用 MessageContextMenu 的模式与样式类（.message-context-menu / .context-menu-item，
 * 见 src/styles/pages/main.css）：createPortal 渲染到 body + fixed 定位 +
 * 点击外部 / 触摸外部 / 滚动 / ESC 关闭。
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface ConversationContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  /** 目标会话当前是否已置顶（决定文案：置顶 / 取消置顶） */
  isPinned: boolean;
  onTogglePin: () => void;
  onClose: () => void;
}

/** 图钉图标（14px，stroke currentColor）——菜单项与列表卡片置顶标识共用 */
export const PinFlagIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={14} height={14}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 3.75l5.25 5.25m-9.62-.87l4.99 4.99m-8.4 3.42l-3.47 3.46m3.47-3.46l-1.6-1.6a2.25 2.25 0 01-.05-3.13l.09-.09a2.25 2.25 0 012.02-.62l1.5.3 4.35-4.35-.3-1.5a2.25 2.25 0 01.62-2.02l.09-.09a2.25 2.25 0 013.13.05l4.4 4.4a2.25 2.25 0 01.05 3.13l-.09.09a2.25 2.25 0 01-2.02.62l-1.5-.3-4.35 4.35.3 1.5a2.25 2.25 0 01-.62 2.02l-.09.09a2.25 2.25 0 01-3.13-.05l-1.6-1.6" />
  </svg>
);

export function ConversationContextMenu({
  isOpen,
  position,
  isPinned,
  onTogglePin,
  onClose,
}: ConversationContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击/触摸外部、滚动、ESC 关闭（同 MessageContextMenu 模式）
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleTouchOutside = (e: TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleScroll = () => {
      onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      // 延迟注册，避免触发菜单的右键/长按事件本身立即关闭菜单
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleTouchOutside, { passive: true });
        document.addEventListener('scroll', handleScroll, true);
        document.addEventListener('keydown', handleKeyDown);
      }, 100);

      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('touchstart', handleTouchOutside);
        document.removeEventListener('scroll', handleScroll, true);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, onClose]);

  // 单项菜单尺寸估算，夹紧到视口内
  const getMenuStyle = (): React.CSSProperties => {
    const padding = 10;
    const menuWidth = 160;
    const menuHeight = 48;

    let x = position.x;
    let y = position.y;
    if (x + menuWidth > window.innerWidth - padding) {
      x = window.innerWidth - menuWidth - padding;
    }
    if (y + menuHeight > window.innerHeight - padding) {
      y = window.innerHeight - menuHeight - padding;
    }
    if (x < padding) { x = padding; }
    if (y < padding) { y = padding; }

    return { position: 'fixed', left: x, top: y, zIndex: 99999 };
  };

  const menuContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          className="message-context-menu"
          style={getMenuStyle()}
          initial={{ opacity: 0, scale: 0.9, y: -5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -5 }}
          transition={{ duration: 0.15, ease: [0, 0, 0.2, 1] }}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              onTogglePin();
            }}
          >
            <PinFlagIcon />
            <span>{isPinned ? '取消置顶' : '置顶'}</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(menuContent, document.body);
}

/**
 * 我的文件右键/长按菜单
 *
 * 触发：桌面端 onContextMenu / 移动端长按 500ms
 * 渲染：createPortal 到 document.body，复用 .message-context-menu CSS
 * 关闭：clickoutside / scroll / escape / 触发 action 后自动关闭
 *
 * 菜单项由调用方按文件状态决定（callback 存在 = 显示对应项）：
 * - onOpenInFolder：已下载文件 → 「在文件夹中显示」（移动端文案为「打开」）
 * - onDownload：未下载文档 → 「下载文件」
 * - onDelete：始终显示
 *
 * 设计：纯展示组件，不订阅 useFileCache / fileCacheStore。状态/可用性由调用方决定，
 * 这样图片/视频卡片（无下载工作流）可以仅传 onOpenInFolder + onDelete。
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { isMobile } from '../../utils/platform';

interface FileContextMenuProps {
  isOpen: boolean;
  /** 桌面端：鼠标点击位置 */
  position: { x: number; y: number };
  /** 移动端：卡片矩形，菜单显示在卡片上方居中 */
  cardRect?: DOMRect | null;
  /** 已下载时调用（在文件夹中显示）— callback 存在则渲染该菜单项 */
  onOpenInFolder?: () => void;
  /** 未下载时调用（触发后台下载）— callback 存在则渲染该菜单项 */
  onDownload?: () => void;
  /** 删除文件 — 始终渲染 */
  onDelete: () => void;
  onClose: () => void;
}

export function FileContextMenu({
  isOpen,
  position,
  cardRect,
  onOpenInFolder,
  onDownload,
  onDelete,
  onClose,
}: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const mobile = isMobile();

  // 点击/触摸外部 + scroll + escape 关闭
  useEffect(() => {
    if (!isOpen) { return; }

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
    const handleScroll = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); }
    };

    // 100ms 延迟，避免触发事件本身关闭菜单
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
  }, [isOpen, onClose]);

  // 菜单项数量（用于位置计算）
  const hasActionItem = !!onOpenInFolder || !!onDownload;
  const totalItems = (hasActionItem ? 1 : 0) + 1; // + 删除

  // 位置计算
  const getMenuStyle = (): React.CSSProperties => {
    const padding = 10;

    // 移动端：基于卡片矩形居中（仿 MessageContextMenu mobile-horizontal）
    if (mobile && cardRect) {
      const menuWidth = totalItems * 52 + 16;
      const menuHeight = 44;
      const cardCenterX = cardRect.left + cardRect.width / 2;
      let x = cardCenterX - menuWidth / 2;
      if (x < padding) { x = padding; }
      if (x + menuWidth > window.innerWidth - padding) {
        x = window.innerWidth - menuWidth - padding;
      }
      let y = cardRect.top - menuHeight - 8;
      if (y < padding) { y = cardRect.bottom + 8; }
      return { position: 'fixed', left: x, top: y, zIndex: 99999 };
    }

    // 桌面端：使用点击位置
    const menuWidth = 160;
    const menuHeight = totalItems * 36 + 28;
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
          className={`message-context-menu file-context-menu ${mobile ? 'mobile-horizontal' : ''}`}
          style={getMenuStyle()}
          initial={{ opacity: 0, scale: 0.9, y: mobile ? 5 : -5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: mobile ? 5 : -5 }}
          transition={{ duration: 0.15, ease: [0, 0, 0.2, 1] }}
        >
          {onOpenInFolder && (
            <button
              className="context-menu-item"
              onClick={() => { onOpenInFolder(); onClose(); }}
            >
              <FolderIcon />
              <span>{mobile ? '打开' : '在文件夹中显示'}</span>
            </button>
          )}
          {onDownload && (
            <button
              className="context-menu-item"
              onClick={() => { onDownload(); onClose(); }}
            >
              <DownloadIcon />
              <span>下载文件</span>
            </button>
          )}
          {hasActionItem && <div className="context-menu-divider" />}
          <button
            className="context-menu-item"
            onClick={() => { onDelete(); onClose(); }}
          >
            <DeleteIcon />
            <span>删除文件</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(menuContent, document.body);
}

const FolderIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  </svg>
);

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);

const DeleteIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);

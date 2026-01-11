/**
 * 消息右键菜单组件
 *
 * 功能：
 * - 撤回消息（自己发送的消息，2分钟内）
 * - 删除消息（本地删除）
 * - 进入多选模式
 * - 在文件夹中显示（仅文件消息且有本地缓存时）
 *
 * 使用 createPortal 渲染到 body，避免被其他元素遮挡
 */

import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';

interface MessageContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  canRecall: boolean;
  /** 本地文件路径（如果有，则显示"在文件夹中显示"选项） */
  localPath?: string | null;
  onRecall: () => void;
  onDelete: () => void;
  onMultiSelect: () => void;
  onClose: () => void;
}

export function MessageContextMenu({
  isOpen,
  position,
  canRecall,
  localPath,
  onRecall,
  onDelete,
  onMultiSelect,
  onClose,
}: MessageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // 在文件夹中显示
  const handleShowInFolder = useCallback(async () => {
    if (!localPath) { return; }
    try {
      await invoke('show_in_folder', { path: localPath });
    } catch (error) {
      console.error('[ContextMenu] 打开文件夹失败:', error);
    }
    onClose();
  }, [localPath, onClose]);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
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
      // 使用 setTimeout 延迟添加事件监听，避免右键事件本身触发关闭
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('scroll', handleScroll, true);
        document.addEventListener('keydown', handleKeyDown);
      }, 0);

      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('scroll', handleScroll, true);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, onClose]);

  // 计算菜单项数量以确定高度
  const hasLocalPath = !!localPath;

  // 计算菜单位置，确保不超出视口
  const getMenuStyle = (): React.CSSProperties => {
    const menuWidth = 160;
    // 基础高度（删除 + 多选 + 分隔线）约 100，每增加一项约 36
    let menuHeight = 100;
    if (canRecall) { menuHeight += 36; }
    if (hasLocalPath) { menuHeight += 36; }
    const padding = 10;

    let x = position.x;
    let y = position.y;

    // 防止超出右边界
    if (x + menuWidth > window.innerWidth - padding) {
      x = window.innerWidth - menuWidth - padding;
    }

    // 防止超出下边界
    if (y + menuHeight > window.innerHeight - padding) {
      y = window.innerHeight - menuHeight - padding;
    }

    // 防止超出左边界
    if (x < padding) {
      x = padding;
    }

    // 防止超出上边界
    if (y < padding) {
      y = padding;
    }

    return {
      position: 'fixed',
      left: x,
      top: y,
      zIndex: 99999,
    };
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
          {canRecall && (
            <button
              className="context-menu-item"
              onClick={() => {
                onRecall();
                onClose();
              }}
            >
              <RecallIcon />
              <span>撤回</span>
            </button>
          )}
          <button
            className="context-menu-item"
            onClick={() => {
              onDelete();
              onClose();
            }}
          >
            <DeleteIcon />
            <span>删除</span>
          </button>
          {hasLocalPath && (
            <button
              className="context-menu-item"
              onClick={handleShowInFolder}
            >
              <FolderIcon />
              <span>在文件夹中显示</span>
            </button>
          )}
          <div className="context-menu-divider" />
          <button
            className="context-menu-item"
            onClick={() => {
              onMultiSelect();
              onClose();
            }}
          >
            <MultiSelectIcon />
            <span>多选</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // 使用 createPortal 渲染到 body
  return createPortal(menuContent, document.body);
}

// 撤回图标
const RecallIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
  </svg>
);

// 删除图标
const DeleteIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);

// 多选图标
const MultiSelectIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

// 文件夹图标
const FolderIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  </svg>
);

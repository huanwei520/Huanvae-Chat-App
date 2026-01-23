/**
 * 消息右键菜单组件
 *
 * 功能：
 * - 复制消息（文本消息）
 * - 选取文字（移动端专属，打开全屏预览页面以便选择复制）
 * - 撤回消息（自己发送的消息，2分钟内）
 * - 删除消息（本地删除）
 * - 进入多选模式
 * - 在文件夹中显示（仅桌面端，文件消息且有本地缓存时）
 *
 * 使用 createPortal 渲染到 body，避免被其他元素遮挡
 * 桌面端通过右键触发，移动端通过长按触发
 *
 * 移动端特性（微信风格）：
 * - 菜单显示在气泡上方，水平排列
 * - "选取文字"选项打开全屏预览页面（用于自由选择文字复制）
 * - 触摸其他地方自动关闭菜单（菜单互斥）
 */

import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { isMobile } from '../../utils/platform';

interface MessageContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  /** 气泡元素的位置信息（用于移动端将菜单显示在气泡上方） */
  bubbleRect?: DOMRect | null;
  canRecall: boolean;
  /** 本地文件路径（如果有，则显示"在文件夹中显示"选项） */
  localPath?: string | null;
  /** 消息文本内容（用于复制，仅文本消息有效） */
  messageContent?: string | null;
  onRecall: () => void;
  onDelete: () => void;
  onMultiSelect: () => void;
  /** 选取文字（移动端专属，打开全屏消息预览页面） */
  onSelectText?: () => void;
  onClose: () => void;
}

export function MessageContextMenu({
  isOpen,
  position,
  bubbleRect,
  canRecall,
  localPath,
  messageContent,
  onRecall,
  onDelete,
  onMultiSelect,
  onSelectText,
  onClose,
}: MessageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const mobile = isMobile();

  // 复制消息内容（移动端优先复制选中的文字）
  const handleCopy = useCallback(async () => {
    let textToCopy = messageContent || '';

    // 移动端：检查是否有选中的文字
    if (mobile && window.getSelection) {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();
      if (selectedText) {
        textToCopy = selectedText;
      }
    }

    if (!textToCopy) { return; }

    try {
      await navigator.clipboard.writeText(textToCopy);
      // 清除选择
      if (mobile && window.getSelection) {
        window.getSelection()?.removeAllRanges();
      }
    } catch (error) {
      console.error('[ContextMenu] 复制失败:', error);
    }
    onClose();
  }, [messageContent, mobile, onClose]);

  // 在文件夹中显示（桌面端专用）
  const handleShowInFolder = useCallback(async () => {
    if (!localPath) { return; }
    try {
      await invoke('show_in_folder', { path: localPath });
    } catch (error) {
      console.error('[ContextMenu] 打开文件夹失败:', error);
    }
    onClose();
  }, [localPath, onClose]);

  // 点击/触摸外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // 移动端：触摸其他地方关闭菜单（解决菜单互斥问题）
    const handleTouchOutside = (e: TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        // 清除文本选择
        if (window.getSelection) {
          window.getSelection()?.removeAllRanges();
        }
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
      // 使用 setTimeout 延迟添加事件监听，避免右键/长按事件本身触发关闭
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleTouchOutside, { passive: true });
        document.addEventListener('scroll', handleScroll, true);
        document.addEventListener('keydown', handleKeyDown);
      }, 100); // 移动端需要更长延迟避免长按结束时触发

      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('touchstart', handleTouchOutside);
        document.removeEventListener('scroll', handleScroll, true);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, onClose]);

  // 计算菜单项数量以确定高度
  const hasLocalPath = !!localPath && !mobile; // 在文件夹中显示仅桌面端
  const hasMessageContent = !!messageContent;

  // 计算菜单位置，确保不超出视口
  const getMenuStyle = (): React.CSSProperties => {
    const padding = 10;

    // 移动端：菜单显示在气泡上方居中（微信风格）
    if (mobile && bubbleRect) {
      // 移动端水平菜单宽度估算（每个按钮约 50px）
      let itemCount = 2; // 删除 + 多选
      if (hasMessageContent) { itemCount += 1; } // 复制
      if (hasMessageContent && onSelectText) { itemCount += 1; } // 选取文字
      if (canRecall) { itemCount += 1; }
      const menuWidth = itemCount * 52 + 16; // 每项 52px + padding
      const menuHeight = 44;

      // 气泡中心位置
      const bubbleCenterX = bubbleRect.left + bubbleRect.width / 2;

      // 菜单 x 位置：居中对齐气泡
      let x = bubbleCenterX - menuWidth / 2;

      // 防止超出左右边界
      if (x < padding) {
        x = padding;
      }
      if (x + menuWidth > window.innerWidth - padding) {
        x = window.innerWidth - menuWidth - padding;
      }

      // 菜单 y 位置：气泡上方
      let y = bubbleRect.top - menuHeight - 8; // 8px 间距

      // 如果上方空间不足，显示在下方
      if (y < padding) {
        y = bubbleRect.bottom + 8;
      }

      return {
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 99999,
      };
    }

    // 桌面端：使用点击位置
    const menuWidth = 160;
    // 基础高度（删除 + 多选 + 分隔线）约 100，每增加一项约 36
    let menuHeight = 100;
    if (hasMessageContent) { menuHeight += 36; } // 复制
    if (canRecall) { menuHeight += 36; }
    if (hasLocalPath) { menuHeight += 36; }

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
          className={`message-context-menu ${mobile ? 'mobile-horizontal' : ''}`}
          style={getMenuStyle()}
          initial={{ opacity: 0, scale: 0.9, y: mobile ? 5 : -5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: mobile ? 5 : -5 }}
          transition={{ duration: 0.15, ease: [0, 0, 0.2, 1] }}
        >
          {/* 复制（仅文本消息） */}
          {hasMessageContent && (
            <button
              className="context-menu-item"
              onClick={handleCopy}
            >
              <CopyIcon />
              <span>复制</span>
            </button>
          )}
          {/* 选取文字（移动端专属，打开全屏预览以便选择复制） */}
          {mobile && hasMessageContent && onSelectText && (
            <button
              className="context-menu-item"
              onClick={() => {
                onSelectText();
                onClose();
              }}
            >
              <SelectTextIcon />
              <span>选取</span>
            </button>
          )}
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
          {/* 在文件夹中显示（仅桌面端） */}
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

// 复制图标
const CopyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
  </svg>
);

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

// 选取文字图标（移动端专属）
const SelectTextIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
  </svg>
);

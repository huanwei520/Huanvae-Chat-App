/**
 * 移动端全屏消息预览组件
 *
 * 功能：
 * - 双击文本消息后全屏显示，方便阅读长文本
 * - 毛玻璃背景遮罩
 * - 消息内容可滚动
 * - 底部复制按钮
 * - 支持返回手势关闭
 *
 * 仅移动端使用，桌面端不显示
 */

import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useMobileBackHandler } from '../../hooks/useMobileBackHandler';

interface MobileMessageFullPreviewProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 消息内容 */
  content: string;
  /** 发送者名称 */
  senderName?: string;
  /** 发送时间 */
  sendTime?: string;
  /** 关闭回调 */
  onClose: () => void;
}

export function MobileMessageFullPreview({
  isOpen,
  content,
  senderName,
  sendTime,
  onClose,
}: MobileMessageFullPreviewProps) {
  // 返回手势关闭
  useMobileBackHandler(() => {
    if (isOpen) {
      onClose();
      return true;
    }
    return false;
  });

  // 复制消息
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      console.warn('[MessagePreview] 消息已复制');
      // TODO: 可以添加 Toast 提示
    } catch (error) {
      console.error('[MessagePreview] 复制失败:', error);
    }
  }, [content]);

  // 点击背景关闭
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  const previewContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="mobile-message-preview-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={handleBackdropClick}
        >
          {/* 顶部栏 */}
          <motion.div
            className="mobile-message-preview-header"
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            transition={{ duration: 0.2, delay: 0.05 }}
          >
            <button
              className="mobile-message-preview-back"
              onClick={onClose}
              type="button"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                width="24"
                height="24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 19.5L8.25 12l7.5-7.5"
                />
              </svg>
            </button>
            <span className="mobile-message-preview-title">消息详情</span>
            <div className="mobile-message-preview-placeholder" />
          </motion.div>

          {/* 消息内容卡片 */}
          <motion.div
            className="mobile-message-preview-card"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.2, delay: 0.05 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 发送者信息 */}
            {(senderName || sendTime) && (
              <div className="mobile-message-preview-meta">
                {senderName && <span className="mobile-message-preview-sender">{senderName}</span>}
                {sendTime && <span className="mobile-message-preview-time">{sendTime}</span>}
              </div>
            )}

            {/* 消息内容（可滚动） */}
            <div className="mobile-message-preview-content">
              {content}
            </div>
          </motion.div>

          {/* 底部操作栏 */}
          <motion.div
            className="mobile-message-preview-actions"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.2, delay: 0.1 }}
          >
            <button
              className="mobile-message-preview-copy-btn"
              onClick={handleCopy}
              type="button"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                width="20"
                height="20"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"
                />
              </svg>
              <span>复制</span>
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(previewContent, document.body);
}

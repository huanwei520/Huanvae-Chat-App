/**
 * 同步状态横幅组件
 *
 * 在消息列表顶部显示消息同步进度，提供以下功能：
 * - 同步中：显示旋转图标 + 进度文字
 * - 完成：显示成功图标 + 新消息数量，1.5 秒后自动淡出
 * - 错误：显示警告图标 + 错误信息，点击可重试
 *
 * 设计原则：
 * - 紧凑设计（高度 32px），不占用过多空间
 * - 不阻断用户操作，自动消失
 * - 桌面端和移动端共用同一组件
 *
 * 触发控制：
 * - 只响应有明确 trigger 的同步事件（initial/reconnect）
 * - 组件挂载/卸载不会触发重复显示
 * - 使用 lastHandledSyncRef 防止同一次同步重复显示
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import '../../styles/components/sync-banner.css';

// 从 useInitialSync 导入类型
import type { SyncStatus, SyncTrigger } from '../../hooks/useInitialSync';

// 重新导出类型，保持向后兼容
export type { SyncStatus, SyncTrigger };

interface SyncStatusBannerProps {
  /** 同步状态 */
  status: SyncStatus;
  /** 重试回调 */
  onRetry?: () => void;
}

/** 同步图标（旋转动画） */
function SyncIcon() {
  return (
    <motion.svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </motion.svg>
  );
}

/** 成功图标 */
function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/** 警告图标 */
function AlertIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

export function SyncStatusBanner({ status, onRetry }: SyncStatusBannerProps) {
  const [visible, setVisible] = useState(false);
  const [completedMessage, setCompletedMessage] = useState<string | null>(null);
  // 记录已处理过的同步时间戳，避免组件挂载时重复显示
  const lastHandledSyncRef = useRef<number | null>(null);

  // 控制显示逻辑 - 只响应有明确 trigger 的同步事件
  useEffect(() => {
    // 正在同步且有触发原因：显示进度
    if (status.syncing && status.trigger) {
      setVisible(true);
      setCompletedMessage(null);
      return;
    }

    // 有错误且有触发原因：显示错误
    if (status.error && status.trigger) {
      setVisible(true);
      return;
    }

    // 同步完成：只有当 trigger 不为 null 且是新的同步结果时才显示
    if (
      status.trigger &&
      status.lastSyncTime &&
      !status.syncing &&
      lastHandledSyncRef.current !== status.lastSyncTime
    ) {
      // 标记此次同步已处理
      lastHandledSyncRef.current = status.lastSyncTime;

      if (status.newMessagesCount > 0) {
        setCompletedMessage(`已同步 ${status.newMessagesCount} 条新消息`);
      } else {
        setCompletedMessage('消息已是最新');
      }
      setVisible(true);

      // 自动隐藏
      const timer = setTimeout(() => {
        setVisible(false);
      }, status.newMessagesCount > 0 ? 1500 : 1000);

      return () => clearTimeout(timer);
    }
  }, [status.syncing, status.error, status.lastSyncTime, status.newMessagesCount, status.trigger]);

  // 渲染内容
  const renderContent = () => {
    if (status.error) {
      return (
        <div
          className="sync-banner-content sync-banner-error"
          onClick={onRetry}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onRetry?.()}
        >
          <AlertIcon />
          <span className="sync-banner-text">同步失败，点击重试</span>
        </div>
      );
    }

    if (status.syncing) {
      const progressText = status.totalConversations > 0
        ? ` (${status.syncedConversations}/${status.totalConversations})`
        : '';
      return (
        <div className="sync-banner-content sync-banner-syncing">
          <SyncIcon />
          <span className="sync-banner-text">正在同步消息...{progressText}</span>
        </div>
      );
    }

    if (completedMessage) {
      return (
        <div className="sync-banner-content sync-banner-success">
          <CheckIcon />
          <span className="sync-banner-text">{completedMessage}</span>
        </div>
      );
    }

    return null;
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="sync-status-banner"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
        >
          {renderContent()}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

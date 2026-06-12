/**
 * 同步状态横幅组件（纯展示）
 *
 * 在消息列表顶部显示消息同步进度：
 * - syncing: 旋转图标 + 进度文字
 * - success: 成功图标 + 新消息数量
 * - error: 警告图标 + 错误信息，点击可重试
 *
 * 纯展示组件，不持有任何定时器或状态。
 * 通知的完整生命周期（产生 → 自动清除）由 useInitialSync 管理，
 * 组件的挂载/卸载不影响通知的清除时机。
 */

import { motion, AnimatePresence } from 'framer-motion';
import '../../styles/components/sync-banner.css';

import type { SyncNotification } from '../../hooks/useInitialSync';

interface SyncStatusBannerProps {
  /** 待显示的同步通知（null 时不显示） */
  notification: SyncNotification | null;
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

export function SyncStatusBanner({ notification, onRetry }: SyncStatusBannerProps) {

  const renderContent = () => {
    if (!notification) { return null; }

    switch (notification.type) {
      case 'error':
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

      case 'syncing': {
        const progressText = notification.total > 0
          ? ` (${notification.synced}/${notification.total})`
          : '';
        return (
          <div className="sync-banner-content sync-banner-syncing">
            <SyncIcon />
            <span className="sync-banner-text">正在同步消息...{progressText}</span>
          </div>
        );
      }

      case 'success': {
        const message = notification.newMessagesCount > 0
          ? `已同步 ${notification.newMessagesCount} 条新消息`
          : '消息已是最新';
        return (
          <div className="sync-banner-content sync-banner-success">
            <CheckIcon />
            <span className="sync-banner-text">{message}</span>
          </div>
        );
      }
    }
  };

  return (
    <AnimatePresence>
      {notification && (
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

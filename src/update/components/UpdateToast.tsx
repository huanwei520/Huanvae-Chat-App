/**
 * 更新提示组件 - 灵动岛风格
 *
 * 设计特点：
 * - 顶部中间位置，类似灵动岛的胶囊形状
 * - 白色透明毛玻璃背景 + 蓝色字体
 * - 不阻塞用户操作，可点击交互
 * - 完全隔离样式，不受其他组件影响
 *
 * 状态流程：
 * 1. idle: 隐藏状态
 * 2. available: 显示有新版本可用，可点击更新
 * 3. downloading: 显示下载进度和代理链接
 * 4. ready: 下载完成，等待重启
 * 5. error: 显示错误信息
 */

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import './UpdateToast.css';

// ============================================
// 类型定义
// ============================================

export type UpdateToastStatus =
  | 'idle'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

export interface UpdateToastProps {
  /** 当前状态 */
  status: UpdateToastStatus;
  /** 新版本号 */
  version?: string;
  /** 更新说明 */
  notes?: string;
  /** 下载进度 (0-100) */
  progress?: number;
  /** 已下载大小 */
  downloaded?: number;
  /** 总大小 */
  total?: number;
  /** 当前使用的代理链接 */
  proxyUrl?: string;
  /** 错误信息 */
  errorMessage?: string;
  /** 点击更新按钮 */
  onUpdate?: () => void;
  /** 点击稍后按钮 */
  onDismiss?: () => void;
  /** 点击重启按钮 */
  onRestart?: () => void;
  /** 点击重试按钮 */
  onRetry?: () => void;
}

// ============================================
// 工具函数
// ============================================

function formatSize(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
  if (bytes < 1024 * 1024 * 1024) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function extractProxyHost(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

// ============================================
// 组件实现
// ============================================

export function UpdateToast({
  status,
  version,
  notes,
  progress = 0,
  downloaded = 0,
  total = 0,
  proxyUrl,
  errorMessage,
  onUpdate,
  onDismiss,
  onRestart,
  onRetry,
}: UpdateToastProps) {
  const isVisible = status !== 'idle';

  // 动画配置
  const toastVariants = {
    hidden: {
      y: -100,
      opacity: 0,
      scale: 0.8,
    },
    visible: {
      y: 0,
      opacity: 1,
      scale: 1,
      transition: {
        type: 'spring' as const,
        stiffness: 400,
        damping: 30,
      },
    },
    exit: {
      y: -50,
      opacity: 0,
      scale: 0.9,
      transition: {
        duration: 0.2,
      },
    },
  };

  // 渲染内容
  const renderContent = () => {
    switch (status) {
      case 'available':
        return (
          <>
            <div className="update-toast-icon">🚀</div>
            <div className="update-toast-info">
              <div className="update-toast-title">发现新版本 v{version}</div>
              {notes && <div className="update-toast-notes">{notes}</div>}
            </div>
            <div className="update-toast-actions">
              <button
                type="button"
                className="update-toast-btn update-toast-btn-secondary"
                onClick={onDismiss}
              >
                稍后
              </button>
              <button
                type="button"
                className="update-toast-btn update-toast-btn-primary"
                onClick={onUpdate}
              >
                更新
              </button>
            </div>
          </>
        );

      case 'downloading':
        return (
          <>
            <div className="update-toast-icon">
              <div className="update-toast-spinner" />
            </div>
            <div className="update-toast-info">
              <div className="update-toast-title">正在下载 v{version}</div>
              <div className="update-toast-progress-container">
                <div className="update-toast-progress-bar">
                  <motion.div
                    className="update-toast-progress-fill"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                <span className="update-toast-progress-text">{Math.round(progress)}%</span>
              </div>
              <div className="update-toast-meta">
                <span>{formatSize(downloaded)} / {formatSize(total)}</span>
                {proxyUrl && (
                  <span className="update-toast-proxy">
                    代理: {extractProxyHost(proxyUrl)}
                  </span>
                )}
              </div>
            </div>
          </>
        );

      case 'ready':
        return (
          <>
            <div className="update-toast-icon">✅</div>
            <div className="update-toast-info">
              <div className="update-toast-title">下载完成</div>
              <div className="update-toast-notes">重启应用以完成更新</div>
            </div>
            <div className="update-toast-actions">
              <button
                type="button"
                className="update-toast-btn update-toast-btn-primary"
                onClick={onRestart}
              >
                立即重启
              </button>
            </div>
          </>
        );

      case 'error':
        return (
          <>
            <div className="update-toast-icon">❌</div>
            <div className="update-toast-info">
              <div className="update-toast-title">更新失败</div>
              <div className="update-toast-error">{errorMessage}</div>
            </div>
            <div className="update-toast-actions">
              <button
                type="button"
                className="update-toast-btn update-toast-btn-secondary"
                onClick={onDismiss}
              >
                关闭
              </button>
              <button
                type="button"
                className="update-toast-btn update-toast-btn-primary"
                onClick={onRetry}
              >
                重试
              </button>
            </div>
          </>
        );

      default:
        return null;
    }
  };

  // 使用 Portal 渲染到 body，确保相对于整个 viewport 居中
  return createPortal(
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="update-toast-container"
          variants={toastVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <div className="update-toast">{renderContent()}</div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ============================================
// Hook: 更新弹窗状态管理
// ============================================

export interface UseUpdateToastReturn {
  status: UpdateToastStatus;
  version: string;
  notes: string;
  progress: number;
  downloaded: number;
  total: number;
  proxyUrl: string;
  errorMessage: string;
  showAvailable: (version: string, notes?: string) => void;
  startDownload: () => void;
  updateProgress: (progress: number, downloaded: number, total: number, proxyUrl?: string) => void;
  downloadComplete: () => void;
  showError: (message: string) => void;
  dismiss: () => void;
}

export function useUpdateToast(): UseUpdateToastReturn {
  const [status, setStatus] = useState<UpdateToastStatus>('idle');
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [progress, setProgress] = useState(0);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [proxyUrl, setProxyUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const showAvailable = useCallback((v: string, n?: string) => {
    setVersion(v);
    setNotes(n || '');
    setStatus('available');
  }, []);

  const startDownload = useCallback(() => {
    setProgress(0);
    setDownloaded(0);
    setTotal(0);
    setStatus('downloading');
  }, []);

  const updateProgress = useCallback(
    (p: number, d: number, t: number, proxy?: string) => {
      setProgress(p);
      setDownloaded(d);
      setTotal(t);
      if (proxy) {
        setProxyUrl(proxy);
      }
    },
    [],
  );

  const downloadComplete = useCallback(() => {
    setProgress(100);
    setStatus('ready');
  }, []);

  const showError = useCallback((msg: string) => {
    setErrorMessage(msg);
    setStatus('error');
  }, []);

  const dismiss = useCallback(() => {
    setStatus('idle');
  }, []);

  return {
    status,
    version,
    notes,
    progress,
    downloaded,
    total,
    proxyUrl,
    errorMessage,
    showAvailable,
    startDownload,
    updateProgress,
    downloadComplete,
    showError,
    dismiss,
  };
}

export default UpdateToast;

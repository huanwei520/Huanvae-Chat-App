/**
 * 更新提示组件 - 灵动岛风格
 *
 * 设计特点：
 * - 顶部中间位置，类似灵动岛的胶囊形状
 * - 白色透明毛玻璃背景 + 蓝色字体
 * - 不阻塞用户操作，可点击交互
 * - 完全隔离样式，不受其他组件影响
 *
 * 移动端下载状态优化：
 * - 下载时显示底部迷你进度卡片，不遮挡页面
 * - 类似聊天信息卡片的紧凑设计
 *
 * 状态流程：
 * 1. idle: 隐藏状态
 * 2. available: 显示有新版本可用，可点击更新
 * 3. downloading: 显示下载进度和代理链接（移动端底部迷你卡片）
 * 4. ready: 下载完成，等待重启
 * 5. error: 显示错误信息
 */

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { isMobile } from '../../utils/platform';
import { formatSize } from '../../utils/format';
import { extractHostname } from '../../utils/url';
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

/**
 * 一次进度上报的输入（store action 与本文件的 useUpdateToast 共用）。
 *
 * 🔴 用可选字段的对象而不是位置参数：位置参数逼着调用方给「未知」编一个数字
 * ——历史实现就是 `progress.percent || 0` / `progress.contentLength || 0`，
 * 把合法的 `undefined` 吃成 0，于是总长未知时进度条全程钉死 0%、
 * 直到 Finished 才跳 100%（本次修的就是它）。
 */
export interface UpdateProgressInput {
  /** 百分比（0-100）；总长未知时为 undefined —— 不要用 `|| 0` 兜底 */
  percent?: number;
  /** 已下载字节数 */
  downloaded?: number;
  /** 总字节数；未知时为 undefined */
  total?: number;
  /**
   * 不定态（总长未知，算不出百分比）。
   * 由数据源显式给出；未给时按「有没有拿到总长」推断。
   */
  indeterminate?: boolean;
  /** 当前下载源 URL */
  sourceUrl?: string;
}

export interface UpdateToastProps {
  /** 当前状态 */
  status: UpdateToastStatus;
  /** 新版本号 */
  version?: string;
  /** 更新说明 */
  notes?: string;
  /** 下载进度 (0-100)；**仅当 indeterminate=false 时有意义** */
  progress?: number;
  /** 已下载大小 */
  downloaded?: number;
  /** 总大小；0 表示未知 */
  total?: number;
  /**
   * 不定态：服务端没给 Content-Length，算不出百分比。
   * 此时显示滚动动画 + 已下载字节数，**不要**渲染一个钉死不动的 0%。
   */
  indeterminate?: boolean;
  /** 当前正在下载的源 URL（用于显示主机名） */
  sourceUrl?: string;
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
// 组件实现
// ============================================

export function UpdateToast({
  status,
  version,
  notes,
  progress = 0,
  downloaded = 0,
  total = 0,
  indeterminate = false,
  sourceUrl,
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
  // 注意：移动端下载状态使用 MobileDownloadCard 组件在消息列表中渲染，不在这里处理
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
        // 移动端使用底部迷你卡片，不在这里渲染
        if (isMobile()) {
          return null;
        }
        return (
          <>
            <div className="update-toast-icon">
              <div className="update-toast-spinner" />
            </div>
            <div className="update-toast-info">
              <div className="update-toast-title">正在下载 v{version}</div>
              <div className="update-toast-progress-container">
                <div className="update-toast-progress-bar">
                  {indeterminate ? (
                    // 总长未知：纯 CSS keyframes 滚动条（不用 framer-motion，
                    // 避免与 CSS 动画抢同一个 transform，见 .claude/rules/animation.md 规则一）
                    <div className="update-toast-progress-indeterminate" />
                  ) : (
                    <motion.div
                      className="update-toast-progress-fill"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  )}
                </div>
                <span className="update-toast-progress-text">
                  {indeterminate ? '下载中' : `${Math.round(progress)}%`}
                </span>
              </div>
              <div className="update-toast-meta">
                {/* 总长未知时只报已下载字节，不显示 "x / 0 B" 这种误导文案 */}
                <span>
                  {indeterminate
                    ? formatSize(downloaded)
                    : `${formatSize(downloaded)} / ${formatSize(total)}`}
                </span>
                {sourceUrl && (
                  <span className="update-toast-source">
                    源: {extractHostname(sourceUrl)}
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

  // 移动端下载状态使用 MobileDownloadCard 在消息列表中渲染，此处不显示
  const shouldShowTopToast = isVisible && !(isMobile() && status === 'downloading');

  // 使用 Portal 渲染到 body，确保相对于整个 viewport 居中
  return createPortal(
    <AnimatePresence>
      {shouldShowTopToast && (
        <motion.div
          className={`update-toast-container${isMobile() ? ' mobile' : ''}`}
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
  indeterminate: boolean;
  sourceUrl: string;
  errorMessage: string;
  showAvailable: (version: string, notes?: string) => void;
  startDownload: () => void;
  updateProgress: (input: UpdateProgressInput) => void;
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
  const [indeterminate, setIndeterminate] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
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
    // 起手总长还未知 ⇒ 不定态，避免先闪一个 0%
    setIndeterminate(true);
    setStatus('downloading');
  }, []);

  const updateProgress = useCallback(
    ({ percent, downloaded: d, total: t, indeterminate: ind, sourceUrl: source }: UpdateProgressInput) => {
      // 与 store 同一套语义：percent=0 是合法值，不能被 `||` 兜底吃掉
      const isIndeterminate = ind ?? (t === undefined || t <= 0);
      setIndeterminate(isIndeterminate);
      setProgress(isIndeterminate ? 0 : (percent ?? 0));
      if (d !== undefined) {
        setDownloaded(d);
      }
      if (t !== undefined) {
        setTotal(t);
      }
      if (source) {
        setSourceUrl(source);
      }
    },
    [],
  );

  const downloadComplete = useCallback(() => {
    setProgress(100);
    setIndeterminate(false);
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
    indeterminate,
    sourceUrl,
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

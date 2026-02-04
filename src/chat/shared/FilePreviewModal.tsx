/**
 * 文件预览模态框组件（移动端专用）
 *
 * 功能：
 * - 文件下载：未下载时显示"下载文件"按钮
 * - 文件打开：已下载时显示"打开文件"按钮，使用系统默认应用打开
 * - 返回手势：支持移动端返回手势关闭预览
 *
 * 注意：
 * - 图片和视频预览已移至 MobileMediaPreview 组件
 * - 此组件仅用于文档类型文件的预览
 * - 仅在移动端使用（桌面端使用独立窗口）
 *
 * @since 2024-01
 * @updated 2026-02-04 添加移动端"打开文件"功能
 * @updated 2026-02-04 添加返回手势支持
 * @updated 2026-02-04 修复 Android 文件打开：使用 AndroidFs.showViewFileDialog 替代不支持的 openPath
 */

import { useEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useFileCache } from '../../hooks/useFileCache';
import { useFileCacheStore, selectDownloadTask } from '../../stores/fileCacheStore';
import { triggerBackgroundDownload } from '../../services/fileCache';
import { formatFileSize } from '../../utils/format';
import { useMobileBackHandler } from '../../hooks/useMobileBackHandler';

// ============================================
// 类型定义
// ============================================

export interface FilePreviewModalProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 文件 UUID */
  fileUuid: string;
  /** 文件名 */
  filename: string;
  /** 文件类型 */
  contentType: string;
  /** 文件大小 */
  fileSize?: number;
  /** 本地文件路径（如果有） */
  localPath?: string | null;
  /** 文件哈希 */
  fileHash?: string | null;
  /** URL 类型 */
  urlType?: 'user' | 'friend' | 'group';
}

// ============================================
// 图标组件
// ============================================

const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const OpenIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

// ============================================
// 文件预览组件
// ============================================

function DocumentPreview({
  fileUuid,
  fileHash,
  filename,
  fileSize,
  urlType,
}: {
  fileUuid: string;
  fileHash: string | null | undefined;
  filename: string;
  fileSize: number | undefined;
  urlType: 'user' | 'friend' | 'group';
}) {
  const { src, isLocal, localPath } = useFileCache({
    fileUuid,
    fileHash,
    fileName: filename,
    fileType: 'document',
    fileSize,
    urlType,
    autoCache: false,
  });

  // 监听下载任务状态
  const downloadTask = useFileCacheStore(selectDownloadTask(fileHash ?? ''));

  // 打开文件错误状态
  const [openError, setOpenError] = useState<string | null>(null);

  // 判断下载状态
  const isDownloading = downloadTask && (
    downloadTask.status === 'pending' || downloadTask.status === 'downloading'
  );
  const isDownloaded = isLocal || downloadTask?.status === 'completed';
  const actualLocalPath = downloadTask?.localPath ?? localPath;

  // 下载文件
  const handleDownload = useCallback(() => {
    if (!src || !fileHash) return;
    triggerBackgroundDownload(src, fileHash, filename, 'document', fileSize);
  }, [src, fileHash, filename, fileSize]);

  // 打开文件（使用系统默认应用）
  // Android 上私有目录文件无法直接分享给其他应用，需要先复制到公共目录
  const handleOpen = useCallback(async () => {
    if (!actualLocalPath) return;
    setOpenError(null);
    try {
      const { openWithExternalApp } = await import('../../utils/openWithExternalApp');
      const result = await openWithExternalApp(actualLocalPath);
      if (!result.success) {
        setOpenError(result.message);
      }
    } catch (err) {
      console.error('[FilePreviewModal] 打开文件失败:', err);
      setOpenError(err instanceof Error ? err.message : '无法打开文件');
    }
  }, [actualLocalPath]);

  return (
    <div className="file-preview-content">
      <div className="file-preview-download">
        <div className="file-icon-large">📄</div>
        <p>{filename}</p>
        {fileSize && <p className="file-size">{formatFileSize(fileSize)}</p>}

        {/* 错误提示 */}
        {openError && (
          <p className="file-error-note">❌ {openError}</p>
        )}

        {/* 按钮：根据下载状态显示不同内容 */}
        {isDownloaded && actualLocalPath ? (
          // 已下载：显示"打开文件"按钮
          <button className="download-btn open" onClick={handleOpen}>
            <OpenIcon />
            打开文件
          </button>
        ) : isDownloading ? (
          // 下载中：显示进度
          <button className="download-btn" disabled>
            <span className="download-spinner" />
            下载中 {downloadTask?.percent ? `${Math.round(downloadTask.percent)}%` : '...'}
          </button>
        ) : (
          // 未下载：显示"下载文件"按钮
          <button className="download-btn" onClick={handleDownload}>
            <DownloadIcon />
            下载文件
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================
// 主组件
// ============================================

export function FilePreviewModal({
  isOpen,
  onClose,
  fileUuid,
  filename,
  contentType: _contentType, // 保留接口兼容性，实际只用于文档预览
  fileSize,
  localPath: _localPath, // 保留接口兼容性，实际使用 Hook 获取
  fileHash,
  urlType = 'friend',
}: FilePreviewModalProps) {
  // 移动端返回手势处理：预览打开时拦截返回操作
  useMobileBackHandler(() => {
    if (isOpen) {
      onClose();
      return true; // 已处理，不继续传递
    }
    return false; // 未打开，不处理
  });

  // ESC 键关闭
  useEffect(() => {
    if (!isOpen) { return; }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // 阻止滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="file-preview-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          {/* 顶部工具栏 */}
          <div className="file-preview-toolbar" onClick={(e) => e.stopPropagation()}>
            <div className="file-preview-info">
              <span className="file-preview-filename">{filename}</span>
              {fileSize && (
                <span className="file-preview-size">{formatFileSize(fileSize)}</span>
              )}
            </div>
            <div className="file-preview-actions">
              <button onClick={onClose} title="关闭">
                <CloseIcon />
              </button>
            </div>
          </div>

          {/* 内容区域 - 仅文档预览 */}
          <div className="file-preview-wrapper" onClick={(e) => e.stopPropagation()}>
            <DocumentPreview
              fileUuid={fileUuid}
              fileHash={fileHash}
              filename={filename}
              fileSize={fileSize}
              urlType={urlType}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

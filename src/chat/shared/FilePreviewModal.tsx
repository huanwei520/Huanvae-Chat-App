/**
 * 文件预览模态框组件
 *
 * 功能：
 * - 文件下载预览
 *
 * 注意：图片和视频预览已移至独立窗口 MediaPreviewPage
 * 此组件仅用于文档类型文件的预览和下载
 */

import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useFileCache } from '../../hooks/useFileCache';
import { formatFileSize } from '../../utils/format';

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
  const { src, isLocal, cacheFile } = useFileCache({
    fileUuid,
    fileHash,
    fileName: filename,
    fileType: 'document',
    fileSize,
    urlType,
    autoCache: false,
  });

  const handleDownload = useCallback(() => {
    if (!src) { return; }

    // 下载时触发缓存
    if (fileHash && !isLocal) {
      cacheFile();
    }

    const a = document.createElement('a');
    a.href = src;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [src, fileHash, isLocal, cacheFile, filename]);

  return (
    <div className="file-preview-content">
      <div className="file-preview-download">
        <div className="file-icon-large">📄</div>
        <p>{filename}</p>
        {fileSize && <p className="file-size">{formatFileSize(fileSize)}</p>}
        {isLocal && <p className="file-local-note">📁 本地文件</p>}
        <button className="download-btn" onClick={handleDownload}>
          <DownloadIcon />
          下载文件
        </button>
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

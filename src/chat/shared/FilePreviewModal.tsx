/**
 * 文件预览模态框组件
 *
 * 功能：
 * - 文档下载/打开：通过共享组件 DocumentDownloadAction（layout="centered"）实现，
 *   下载/打开行为与聊天文档消息、我的文件文档卡片完全一致
 * - 返回手势：支持移动端返回手势关闭预览
 *
 * 注意：
 * - 图片和视频预览已移至 MobileMediaPreview 组件
 * - 此组件仅用于文档类型文件的预览
 * - 移动端用于全屏文档预览；桌面端从「我的文件」点击文档时也走此弹窗
 *
 * @since 2024-01
 * @updated 2026-02-04 添加移动端"打开文件"功能
 * @updated 2026-02-04 添加返回手势支持
 * @updated 2026-02-04 修复 Android 文件打开：使用 AndroidFs.showViewFileDialog 替代不支持的 openPath
 * @updated 2026-05-07 抽出 DocumentDownloadAction 共享组件，桌面端「我的文件」也复用此弹窗
 */

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { formatFileSize } from '../../utils/format';
import { useMobileBackHandler } from '../../hooks/useMobileBackHandler';
import { DocumentDownloadAction } from './DocumentDownloadAction';

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
  /** 文件大小 */
  fileSize?: number;
  /**
   * **已知**的内容哈希。只有个人文件面（`GET /api/storage/files`）有；
   * 消息面（聊天文档气泡）**不传** —— 后端接收面已不再下发 `file_hash`，
   * 缓存查找与下载任务改以 `fileUuid` 为键（两层键，见 services/fileCache.fileIdentityKey）。
   */
  fileHash?: string | null;
  /** URL 类型（用于预签名端点选择） */
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

// ============================================
// 文档预览组件
// ============================================

/**
 * 下载/打开行为统一委托给 DocumentDownloadAction。
 * 移动端文件打开失败时，useFileCache.openInFolder 内置兜底（清除映射 + 重新下载），
 * 因此本组件不再维护 openError UI 状态 — 与桌面端「我的文件」行为对齐。
 */
function DocumentPreview({
  fileUuid,
  fileHash,
  filename,
  fileSize,
  urlType,
}: {
  fileUuid: string;
  /** 已知内容哈希：个人文件面有，消息面没有（见 FilePreviewModalProps.fileHash） */
  fileHash?: string | null;
  filename: string;
  fileSize: number | undefined;
  urlType: 'user' | 'friend' | 'group';
}) {
  return (
    <div className="file-preview-content">
      <div className="file-preview-download">
        <div className="file-icon-large">📄</div>
        <p>{filename}</p>
        {fileSize && <p className="file-size">{formatFileSize(fileSize)}</p>}

        <DocumentDownloadAction
          layout="centered"
          fileUuid={fileUuid}
          fileHash={fileHash}
          filename={filename}
          fileSize={fileSize}
          urlType={urlType}
        />
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
  fileSize,
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

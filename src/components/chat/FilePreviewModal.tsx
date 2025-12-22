/**
 * 文件预览模态框组件
 *
 * 功能：
 * - 图片全屏预览（支持缩放）
 * - 视频在线播放
 * - 文件下载
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useApi } from '../../contexts/SessionContext';
import { getPresignedUrl, formatFileSize } from '../../hooks/useFileUpload';

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

const ZoomInIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

const ZoomOutIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

// ============================================
// 组件实现
// ============================================

export function FilePreviewModal({
  isOpen,
  onClose,
  fileUuid,
  filename,
  contentType,
  fileSize,
  localPath,
}: FilePreviewModalProps) {
  const api = useApi();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [isLocalFile, setIsLocalFile] = useState(false);

  const isImage = contentType.startsWith('image/');
  const isVideo = contentType.startsWith('video/');

  // 加载预签名 URL（优先使用本地路径）
  useEffect(() => {
    if (!isOpen || !fileUuid) { return; }

    setLoading(true);
    setError(null);
    setScale(1);

    const loadUrl = async () => {
      try {
        // 如果有本地路径，优先使用
        if (localPath) {
          const { convertFileSrc } = await import('@tauri-apps/api/core');
          const localUrl = convertFileSrc(localPath);
          setUrl(localUrl);
          setIsLocalFile(true);
          console.log('[FilePreview] 使用本地文件', { localPath });
        } else {
          const remoteUrl = await getPresignedUrl(api, fileUuid);
          setUrl(remoteUrl);
          setIsLocalFile(false);
          console.log('[FilePreview] 使用远程文件', { fileUuid });
        }
      } catch (err) {
        console.error('[FilePreview] 加载失败:', err);
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
      }
    };

    loadUrl();
  }, [isOpen, fileUuid, api, localPath]);

  // 下载文件
  const handleDownload = useCallback(() => {
    if (!url) { return; }

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [url, filename]);

  // 缩放控制
  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + 0.25, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  }, []);

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
          {/* 工具栏 */}
          <div className="file-preview-toolbar" onClick={(e) => e.stopPropagation()}>
            <div className="file-preview-info">
              {isLocalFile && (
                <span className="file-preview-local-badge" title="本地文件">📁 本地</span>
              )}
              <span className="file-preview-filename">{filename}</span>
              {fileSize && (
                <span className="file-preview-size">{formatFileSize(fileSize)}</span>
              )}
            </div>
            <div className="file-preview-actions">
              {isImage && (
                <>
                  <button onClick={handleZoomOut} title="缩小">
                    <ZoomOutIcon />
                  </button>
                  <span className="zoom-level">{Math.round(scale * 100)}%</span>
                  <button onClick={handleZoomIn} title="放大">
                    <ZoomInIcon />
                  </button>
                </>
              )}
              <button onClick={handleDownload} title="下载">
                <DownloadIcon />
              </button>
              <button onClick={onClose} title="关闭">
                <CloseIcon />
              </button>
            </div>
          </div>

          {/* 内容区域 */}
          <div className="file-preview-content" onClick={(e) => e.stopPropagation()}>
            {loading && (
              <div className="file-preview-loading">
                <div className="spinner" />
                <span>加载中...</span>
              </div>
            )}

            {error && (
              <div className="file-preview-error">
                <span>加载失败: {error}</span>
              </div>
            )}

            {!loading && !error && url && (
              <>
                {isImage && (
                  <motion.img
                    src={url}
                    alt={filename}
                    className="file-preview-image"
                    style={{ transform: `scale(${scale})` }}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: scale }}
                    transition={{ duration: 0.2 }}
                    draggable={false}
                  />
                )}

                {isVideo && (
                  <video
                    src={url}
                    className="file-preview-video"
                    controls
                    autoPlay
                  />
                )}

                {!isImage && !isVideo && (
                  <div className="file-preview-download">
                    <div className="file-icon-large">📄</div>
                    <p>{filename}</p>
                    {fileSize && <p className="file-size">{formatFileSize(fileSize)}</p>}
                    <button className="download-btn" onClick={handleDownload}>
                      <DownloadIcon />
                      下载文件
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

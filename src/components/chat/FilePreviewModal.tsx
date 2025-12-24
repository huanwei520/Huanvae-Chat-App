/**
 * 文件预览模态框组件
 *
 * 功能：
 * - 图片全屏预览（支持缩放），加载后自动缓存
 * - 视频在线播放，边播边缓存，完成后保存本地
 * - 文件下载
 *
 * 使用 useFileCache Hook 实现本地优先和自动缓存
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useImageCache, useFileCache } from '../../hooks/useFileCache';
import { triggerBackgroundDownload } from '../../services/fileCache';
import { useFileCacheStore, selectDownloadTask } from '../../stores/fileCacheStore';
import { formatFileSize } from '../../hooks/useFileUpload';

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
// 图片预览组件
// ============================================

function ImagePreview({
  fileUuid,
  fileHash,
  filename,
  urlType,
}: {
  fileUuid: string;
  fileHash: string | null | undefined;
  filename: string;
  urlType: 'user' | 'friend' | 'group';
}) {
  const [scale, setScale] = useState(1);
  const { src, isLocal, loading, error, onLoad } = useImageCache(
    fileUuid,
    fileHash,
    filename,
    urlType,
  );

  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + 0.25, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  }, []);

  const handleDownload = useCallback(() => {
    if (!src) { return; }
    const a = document.createElement('a');
    a.href = src;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [src, filename]);

  return (
    <>
      {/* 工具栏扩展 */}
      <div className="file-preview-zoom-controls">
        <button onClick={handleZoomOut} title="缩小">
          <ZoomOutIcon />
        </button>
        <span className="zoom-level">{Math.round(scale * 100)}%</span>
        <button onClick={handleZoomIn} title="放大">
          <ZoomInIcon />
        </button>
        <button onClick={handleDownload} title="下载">
          <DownloadIcon />
        </button>
      </div>

      {/* 内容 */}
      <div className="file-preview-content">
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

        {!loading && !error && src && (
          <motion.img
            src={src}
            alt={filename}
            className="file-preview-image"
            style={{ transform: `scale(${scale})` }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: scale }}
            transition={{ duration: 0.2 }}
            draggable={false}
            onLoad={onLoad}
          />
        )}
      </div>

      {isLocal && <div className="file-preview-local-indicator">📁 本地文件</div>}
    </>
  );
}

// ============================================
// 视频预览组件（边播边缓存）
// ============================================

function VideoPreview({
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const downloadTriggeredRef = useRef(false);

  const { src, isLocal, loading, error } = useFileCache({
    fileUuid,
    fileHash,
    fileName: filename,
    fileType: 'video',
    fileSize,
    urlType,
    autoCache: false, // 手动控制缓存
  });

  // 监听下载进度
  const downloadTask = useFileCacheStore(selectDownloadTask(fileHash ?? ''));

  // 视频开始播放时，启动后台下载
  const handlePlay = useCallback(() => {
    if (isLocal || !fileHash || downloadTriggeredRef.current || !src) {
      return;
    }

    downloadTriggeredRef.current = true;
    triggerBackgroundDownload(src, fileHash, filename, 'video', fileSize);
  }, [isLocal, fileHash, src, filename, fileSize]);

  // 下载完成后，如果本地文件可用，更新视频源
  useEffect(() => {
    if (downloadTask?.status === 'completed' && downloadTask.localPath && videoRef.current) {
      const currentTime = videoRef.current.currentTime;
      const wasPlaying = !videoRef.current.paused;

      // 切换到本地文件
      videoRef.current.src = convertFileSrc(downloadTask.localPath);
      videoRef.current.currentTime = currentTime;

      if (wasPlaying) {
        videoRef.current.play();
      }
    }
  }, [downloadTask?.status, downloadTask?.localPath]);

  const handleDownload = useCallback(() => {
    if (!src) { return; }
    const a = document.createElement('a');
    a.href = src;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [src, filename]);

  return (
    <>
      {/* 工具栏扩展 */}
      <div className="file-preview-zoom-controls">
        <button onClick={handleDownload} title="下载">
          <DownloadIcon />
        </button>
      </div>

      {/* 下载进度条 */}
      {downloadTask && downloadTask.status === 'downloading' && (
        <div className="video-download-progress">
          <div
            className="video-download-progress-bar"
            style={{ width: `${downloadTask.percent}%` }}
          />
          <span className="video-download-progress-text">
            缓存中 {downloadTask.percent.toFixed(0)}%
          </span>
        </div>
      )}

      {/* 内容 */}
      <div className="file-preview-content">
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

        {!loading && !error && src && (
          <video
            ref={videoRef}
            src={src}
            className="file-preview-video"
            controls
            autoPlay
            onPlay={handlePlay}
          />
        )}
      </div>

      {isLocal && <div className="file-preview-local-indicator">📁 本地文件</div>}
      {downloadTask?.status === 'completed' && (
        <div className="file-preview-cached-indicator">✓ 已缓存</div>
      )}
    </>
  );
}

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
  contentType,
  fileSize,
  localPath: _localPath, // 保留接口兼容性，实际使用 Hook 获取
  fileHash,
  urlType = 'friend',
}: FilePreviewModalProps) {
  const isImage = contentType.startsWith('image/');
  const isVideo = contentType.startsWith('video/');

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

          {/* 内容区域 */}
          <div className="file-preview-wrapper" onClick={(e) => e.stopPropagation()}>
            {isImage && (
              <ImagePreview
                fileUuid={fileUuid}
                fileHash={fileHash}
                filename={filename}
                urlType={urlType}
              />
            )}

            {isVideo && (
              <VideoPreview
                fileUuid={fileUuid}
                fileHash={fileHash}
                filename={filename}
                fileSize={fileSize}
                urlType={urlType}
              />
            )}

            {!isImage && !isVideo && (
              <DocumentPreview
                fileUuid={fileUuid}
                fileHash={fileHash}
                filename={filename}
                fileSize={fileSize}
                urlType={urlType}
              />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

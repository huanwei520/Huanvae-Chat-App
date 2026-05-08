/**
 * 本地优先文件预览组件
 *
 * 基于 file_hash 检测本地是否有文件副本：
 * - 有本地文件：直接显示并渲染 <LocalBadge />（共享于 DocumentDownloadAction）
 * - 无本地文件：从服务器获取预签名 URL
 */

import { useState, useEffect, useCallback } from 'react';
import { getFileSource, type FileSource } from '../../services/fileService';
import { formatFileSize } from '../../utils/format';
import { LocalBadge } from './DocumentDownloadAction';

// ============================================================================
// 类型定义
// ============================================================================

interface LocalFilePreviewProps {
  /** 文件哈希（用于本地识别） */
  fileHash: string | null | undefined;
  /** 文件 UUID */
  fileUuid: string | null | undefined;
  /** 远程文件 URL */
  fileUrl: string | null | undefined;
  /** 文件名 */
  fileName: string;
  /** 文件大小（字节） */
  fileSize?: number | null;
  /** 文件类型 */
  contentType: string;
  /** 点击时的回调 */
  onClick?: () => void;
  /** 自定义类名 */
  className?: string;
}

// ============================================================================
// 组件实现
// ============================================================================

export function LocalFilePreview({
  fileHash,
  fileUuid,
  fileUrl,
  fileName,
  fileSize,
  contentType,
  onClick,
  className = '',
}: LocalFilePreviewProps) {
  const [source, setSource] = useState<FileSource>('checking');
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ============================================
  // 检测文件来源
  // ============================================

  const checkFileSource = useCallback(async () => {
    if (!fileUrl && !fileUuid) {
      setError('无文件信息');
      return;
    }

    try {
      setSource('checking');

      // 构建远程 URL
      const remoteUrl = fileUrl || `/api/storage/file/${fileUuid}`;

      // 检查是否有本地副本
      const result = await getFileSource(fileHash, remoteUrl, fileSize ?? undefined);

      setSource(result.source);
      setDisplayUrl(result.url);
      setLocalPath(result.localPath || null);

    } catch (err) {
      console.error('[FilePreview] 检测文件来源失败:', err);
      setSource('remote');
      setDisplayUrl(fileUrl || `/api/storage/file/${fileUuid}`);
    }
  }, [fileHash, fileUuid, fileUrl, fileSize]);

  useEffect(() => {
    checkFileSource();
  }, [checkFileSource]);

  // ============================================
  // 渲染
  // ============================================

  // 检测文件类型
  const isImage = contentType.startsWith('image/');
  const isVideo = contentType.startsWith('video/');
  const isAudio = contentType.startsWith('audio/');

  // 加载状态
  if (source === 'checking') {
    return (
      <div className={`file-preview file-preview--loading ${className}`}>
        <div className="file-preview__spinner" />
        <span className="file-preview__text">检测中...</span>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className={`file-preview file-preview--error ${className}`}>
        <span className="file-preview__error">{error}</span>
      </div>
    );
  }

  // 图片预览
  if (isImage && displayUrl) {
    return (
      <div
        className={`file-preview file-preview--image ${className}`}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && onClick?.()}
      >
        {source === 'local' && <LocalBadge />}
        <img
          src={displayUrl}
          alt={fileName}
          className="file-preview__image"
          loading="lazy"
        />
      </div>
    );
  }

  // 视频预览
  if (isVideo && displayUrl) {
    return (
      <div className={`file-preview file-preview--video ${className}`}>
        {source === 'local' && <LocalBadge />}
        <video
          src={displayUrl}
          controls
          className="file-preview__video"
          preload="metadata"
        />
        <div className="file-preview__filename">{fileName}</div>
      </div>
    );
  }

  // 音频预览
  if (isAudio && displayUrl) {
    return (
      <div className={`file-preview file-preview--audio ${className}`}>
        {source === 'local' && <LocalBadge />}
        <audio src={displayUrl} controls className="file-preview__audio" />
        <div className="file-preview__filename">{fileName}</div>
      </div>
    );
  }

  // 通用文件预览
  return (
    <div
      className={`file-preview file-preview--file ${className}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick?.()}
    >
      {source === 'local' && <LocalBadge />}
      <div className="file-preview__icon">📄</div>
      <div className="file-preview__info">
        <div className="file-preview__filename">{fileName}</div>
        {fileSize && (
          <div className="file-preview__size">{formatFileSize(fileSize)}</div>
        )}
        {localPath && (
          <div className="file-preview__path" title={localPath}>
            {localPath}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 样式（内联注入；本地标识由 ./DocumentDownloadAction 的 LocalBadge 统一渲染，
// 对应 .file-local-badge 全局样式见 styles/pages/main.css）
// ============================================================================

const styles = `
.file-preview {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--glass-bg, rgba(255, 255, 255, 0.1));
  backdrop-filter: blur(10px);
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-preview:hover {
  background: var(--glass-bg-hover, rgba(255, 255, 255, 0.15));
}

.file-preview--loading {
  opacity: 0.7;
}

.file-preview--error {
  color: var(--error-color, #ff4444);
}

.file-preview--image {
  padding: 4px;
  max-width: 300px;
}

.file-preview__image {
  max-width: 100%;
  max-height: 200px;
  border-radius: 6px;
  object-fit: contain;
}

.file-preview__video {
  max-width: 100%;
  max-height: 300px;
  border-radius: 6px;
}

.file-preview__audio {
  width: 100%;
}

.file-preview__icon {
  font-size: 24px;
}

.file-preview__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.file-preview__filename {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.file-preview__size {
  font-size: 12px;
  color: var(--text-secondary, rgba(255, 255, 255, 0.6));
}

.file-preview__path {
  font-size: 10px;
  color: var(--text-tertiary, rgba(255, 255, 255, 0.4));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.file-preview__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
`;

if (typeof document !== 'undefined') {
  const styleId = 'local-file-preview-styles';
  if (!document.getElementById(styleId)) {
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);
  }
}

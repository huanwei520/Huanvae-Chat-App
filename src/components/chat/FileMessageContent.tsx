/**
 * 文件消息内容组件
 *
 * 根据消息类型（图片/视频/文件）渲染不同的内容
 * - 图片：缩略图预览，点击放大
 * - 视频：视频缩略图，点击播放
 * - 文件：文件图标和名称，点击下载
 *
 * 本地优先加载：
 * - 如果有 file_hash，先检查本地是否有该文件
 * - 有本地文件则直接显示，无则从服务器获取
 *
 * 调试功能：
 * - [FileLoad] 前缀的日志用于跟踪文件加载过程
 */

import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../../contexts/SessionContext';
import { getPresignedUrl, formatFileSize } from '../../hooks/useFileUpload';
import { getFileSource, type FileSource } from '../../services/fileService';
import { FilePreviewModal } from './FilePreviewModal';
import type { MessageType } from '../../types/chat';

// ============================================
// 调试日志
// ============================================

const DEBUG = true;

function logFileLoad(action: string, data?: unknown) {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`%c[FileLoad] ${action}`, 'color: #9C27B0; font-weight: bold', data ?? '');
  }
}

// ============================================
// 类型定义
// ============================================

export interface FileMessageContentProps {
  /** 消息类型 */
  messageType: MessageType;
  /** 消息内容（文件名） */
  messageContent: string;
  /** 文件 UUID */
  fileUuid: string | null;
  /** 文件大小 */
  fileSize: number | null;
  /** 文件哈希（用于本地识别） */
  fileHash?: string | null;
}

// ============================================
// 图标组件
// ============================================

const PlayIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const FileIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

// ============================================
// 组件实现
// ============================================

export function FileMessageContent({
  messageType,
  messageContent,
  fileUuid,
  fileSize,
  fileHash,
}: FileMessageContentProps) {
  const api = useApi();
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [source, setSource] = useState<FileSource>('checking');
  const [localPath, setLocalPath] = useState<string | null>(null);

  // 从消息内容中提取文件名
  const filename = messageContent.replace(/^\[(图片|视频|文件)\]\s*/, '');

  // 获取内容类型
  const getContentType = () => {
    switch (messageType) {
      case 'image':
        return 'image/jpeg';
      case 'video':
        return 'video/mp4';
      default:
        return 'application/octet-stream';
    }
  };

  // 本地优先加载文件
  useEffect(() => {
    if (!fileUuid || messageType === 'file') {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(false);
    setSource('checking');

    const loadFile = async () => {
      try {
        logFileLoad('开始加载文件', {
          fileUuid,
          fileHash,
          messageType,
          fileName: filename,
        });

        // 尝试获取 fileHash（如果没有的话，从本地数据库查找）
        let effectiveFileHash = fileHash;
        if (!effectiveFileHash) {
          try {
            const { getFileHashByUuid } = await import('../../db');
            effectiveFileHash = await getFileHashByUuid(fileUuid);
            if (effectiveFileHash) {
              logFileLoad('从 UUID 映射查找到 fileHash', {
                fileUuid,
                fileHash: effectiveFileHash,
              });
            }
          } catch {
            // 查找失败，继续使用远程
          }
        }

        // 1. 如果有 fileHash，先检查本地
        if (effectiveFileHash) {
          logFileLoad('检查本地文件', { fileHash: effectiveFileHash });

          // 先获取远程 URL 作为备用
          const remoteUrl = await getPresignedUrl(api, fileUuid);

          // 检查本地是否有该文件
          const result = await getFileSource(effectiveFileHash, remoteUrl, fileSize ?? undefined);

          setSource(result.source);
          setLocalPath(result.localPath || null);
          setThumbnailUrl(result.url);

          if (result.source === 'local') {
            logFileLoad('✓ 使用本地文件', {
              fileHash: effectiveFileHash,
              localPath: result.localPath,
              fileName: filename,
            });
          } else {
            logFileLoad('✗ 本地无此文件，使用远程', {
              fileHash: effectiveFileHash,
              remoteUrl: `${result.url.substring(0, 100)}...`,
            });
          }
        } else {
          // 2. 没有 fileHash，直接从服务器获取
          logFileLoad('无 fileHash，从服务器获取', { fileUuid });

          const url = await getPresignedUrl(api, fileUuid);
          setThumbnailUrl(url);
          setSource('remote');

          logFileLoad('远程文件加载完成', {
            fileUuid,
            url: `${url.substring(0, 100)}...`,
          });
        }
      } catch (err) {
        console.error('[FileLoad] 加载失败:', err);
        setError(true);
        setSource('remote');
      } finally {
        setLoading(false);
      }
    };

    loadFile();
  }, [api, fileUuid, fileHash, fileSize, messageType, filename]);

  // 点击打开预览
  const handleClick = useCallback(() => {
    if (!fileUuid) { return; }
    setShowPreview(true);
  }, [fileUuid]);

  // 下载文件
  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fileUuid) { return; }

    try {
      const url = await getPresignedUrl(api, fileUuid);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('下载失败:', err);
    }
  }, [api, fileUuid, filename]);

  // 渲染图片消息
  if (messageType === 'image') {
    return (
      <>
        <div className="file-message image-message" onClick={handleClick}>
          {loading && <div className="file-message-loading">加载中...</div>}
          {error && <div className="file-message-error">加载失败</div>}
          {!loading && !error && thumbnailUrl && (
            <>
              {source === 'local' && <LocalBadge />}
              <img
                src={thumbnailUrl}
                alt={filename}
                className="message-image"
                draggable={false}
              />
            </>
          )}
        </div>

        <FilePreviewModal
          isOpen={showPreview}
          onClose={() => setShowPreview(false)}
          fileUuid={fileUuid || ''}
          filename={filename}
          contentType={getContentType()}
          fileSize={fileSize || undefined}
          localPath={localPath}
        />
      </>
    );
  }

  // 渲染视频消息
  if (messageType === 'video') {
    return (
      <>
        <div className="file-message video-message" onClick={handleClick}>
          {loading && <div className="file-message-loading">加载中...</div>}
          {error && <div className="file-message-error">加载失败</div>}
          {!loading && !error && thumbnailUrl && (
            <>
              {source === 'local' && <LocalBadge />}
              <video
                src={thumbnailUrl}
                className="message-video-thumbnail"
                preload="metadata"
              />
              <div className="video-play-overlay">
                <PlayIcon />
              </div>
            </>
          )}
        </div>

        <FilePreviewModal
          isOpen={showPreview}
          onClose={() => setShowPreview(false)}
          fileUuid={fileUuid || ''}
          filename={filename}
          contentType={getContentType()}
          fileSize={fileSize || undefined}
          localPath={localPath}
        />
      </>
    );
  }

  // 渲染普通文件消息
  return (
    <>
      <div className="file-message document-message" onClick={handleClick}>
        {source === 'local' && <LocalBadge />}
        <div className="document-icon">
          <FileIcon />
        </div>
        <div className="document-info">
          <span className="document-name" title={filename}>
            {filename.length > 20 ? `${filename.slice(0, 17)}...` : filename}
          </span>
          {fileSize && (
            <span className="document-size">{formatFileSize(fileSize)}</span>
          )}
          {localPath && (
            <span className="document-local-path" title={localPath}>
              📁 {localPath.split(/[/\\]/).pop()}
            </span>
          )}
        </div>
        <button className="document-download" onClick={handleDownload} title="下载">
          <DownloadIcon />
        </button>
      </div>

      <FilePreviewModal
        isOpen={showPreview}
        onClose={() => setShowPreview(false)}
        fileUuid={fileUuid || ''}
        filename={filename}
        contentType={getContentType()}
        fileSize={fileSize || undefined}
        localPath={localPath}
      />
    </>
  );
}

// ============================================
// 本地文件标识
// ============================================

function LocalBadge() {
  return (
    <span className="file-local-badge" title="本地文件">
      📁
    </span>
  );
}

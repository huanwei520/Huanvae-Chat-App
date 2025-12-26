/**
 * 文件消息内容组件
 *
 * 根据消息类型（图片/视频/文件）渲染不同的内容
 * - 图片：缩略图预览，点击打开独立窗口查看
 * - 视频：视频缩略图，点击打开独立窗口播放
 * - 文件：文件图标和名称，点击下载
 *
 * 使用 useFileCache Hook 实现本地优先加载和自动缓存
 * 图片和视频使用独立窗口预览，与 WebRTC 会议使用相同的架构
 */

import { useState, useCallback } from 'react';
import { useImageCache, useVideoCache, useFileCache } from '../../hooks/useFileCache';
import { formatFileSize } from '../../hooks/useFileUpload';
import { FilePreviewModal } from './FilePreviewModal';
import { openMediaWindow } from '../../media';
import { useSession } from '../../contexts/SessionContext';
import type { MessageType } from '../../types/chat';

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
  /** URL 类型（用于预签名 URL 请求） */
  urlType?: 'user' | 'friend' | 'group';
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
// 本地文件标识
// ============================================

function LocalBadge() {
  return (
    <span className="file-local-badge" title="本地文件">
      📁
    </span>
  );
}

// ============================================
// 图片消息组件
// ============================================

function ImageMessage({
  fileUuid,
  fileHash,
  filename,
  fileSize,
  urlType,
}: {
  fileUuid: string;
  fileHash: string | null | undefined;
  filename: string;
  fileSize: number | null;
  urlType: 'user' | 'friend' | 'group';
}) {
  const { session } = useSession();
  const { src, isLocal, loading, error, onLoad, localPath } = useImageCache(
    fileUuid,
    fileHash,
    filename,
    urlType,
  );

  // 点击打开独立预览窗口
  const handleClick = useCallback(() => {
    if (!session) return;

    openMediaWindow(
      {
        type: 'image',
        fileUuid,
        filename,
        fileSize: fileSize ?? undefined,
        fileHash,
        urlType,
        localPath,
      },
      {
        serverUrl: session.serverUrl,
        accessToken: session.accessToken,
      },
    );
  }, [session, fileUuid, filename, fileSize, fileHash, urlType, localPath]);

  return (
    <div className="file-message image-message" onClick={handleClick}>
      {loading && <div className="file-message-loading">加载中...</div>}
      {error && <div className="file-message-error">加载失败</div>}
      {!loading && !error && src && (
        <>
          {isLocal && <LocalBadge />}
          <img
            src={src}
            alt={filename}
            className="message-image"
            draggable={false}
            onLoad={onLoad}
          />
        </>
      )}
    </div>
  );
}

// ============================================
// 视频消息组件
// ============================================

function VideoMessage({
  fileUuid,
  fileHash,
  filename,
  fileSize,
  urlType,
}: {
  fileUuid: string;
  fileHash: string | null | undefined;
  filename: string;
  fileSize: number | null;
  urlType: 'user' | 'friend' | 'group';
}) {
  const { session } = useSession();
  const { src, isLocal, loading, error, onPlay, localPath } = useVideoCache(
    fileUuid,
    fileHash,
    filename,
    fileSize ?? undefined,
    urlType,
  );

  // 点击打开独立预览窗口
  const handleClick = useCallback(() => {
    if (!session) return;

    openMediaWindow(
      {
        type: 'video',
        fileUuid,
        filename,
        fileSize: fileSize ?? undefined,
        fileHash,
        urlType,
        localPath,
      },
      {
        serverUrl: session.serverUrl,
        accessToken: session.accessToken,
      },
    );
  }, [session, fileUuid, filename, fileSize, fileHash, urlType, localPath]);

  return (
    <div className="file-message video-message" onClick={handleClick}>
      {loading && <div className="file-message-loading">加载中...</div>}
      {error && <div className="file-message-error">加载失败</div>}
      {!loading && !error && src && (
        <>
          {isLocal && <LocalBadge />}
          <video
            src={src}
            className="message-video-thumbnail"
            preload="metadata"
            onPlay={onPlay}
          />
          <div className="video-play-overlay">
            <PlayIcon />
          </div>
        </>
      )}
    </div>
  );
}

// ============================================
// 文件消息组件
// ============================================

function DocumentMessage({
  fileUuid,
  fileHash,
  filename,
  fileSize,
  urlType,
}: {
  fileUuid: string;
  fileHash: string | null | undefined;
  filename: string;
  fileSize: number | null;
  urlType: 'user' | 'friend' | 'group';
}) {
  const [showPreview, setShowPreview] = useState(false);
  const { src, isLocal, localPath, cacheFile } = useFileCache({
    fileUuid,
    fileHash,
    fileName: filename,
    fileType: 'document',
    urlType,
    autoCache: false,
  });

  // 下载文件
  const handleDownload = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!src) { return; }

      // 如果有本地文件，触发缓存（确保映射正确）
      if (fileHash && !isLocal) {
        cacheFile();
      }

      const a = document.createElement('a');
      a.href = src;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
    [src, fileHash, isLocal, cacheFile, filename],
  );

  return (
    <>
      <div className="file-message document-message" onClick={() => setShowPreview(true)}>
        {isLocal && <LocalBadge />}
        <div className="document-icon">
          <FileIcon />
        </div>
        <div className="document-info">
          <span className="document-name" title={filename}>
            {filename.length > 20 ? `${filename.slice(0, 17)}...` : filename}
          </span>
          {fileSize && <span className="document-size">{formatFileSize(fileSize)}</span>}
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
        fileUuid={fileUuid}
        filename={filename}
        contentType="application/octet-stream"
        fileSize={fileSize ?? undefined}
        localPath={localPath}
        fileHash={fileHash}
        urlType={urlType}
      />
    </>
  );
}

// ============================================
// 主组件
// ============================================

export function FileMessageContent({
  messageType,
  messageContent,
  fileUuid,
  fileSize,
  fileHash,
  urlType = 'friend',
}: FileMessageContentProps) {
  // 从消息内容中提取文件名
  const filename = messageContent.replace(/^\[(图片|视频|文件)\]\s*/, '');

  // 没有 fileUuid 无法加载
  if (!fileUuid) {
    return (
      <div className="file-message file-message-error">
        文件不可用
      </div>
    );
  }

  // 根据消息类型渲染不同组件
  switch (messageType) {
    case 'image':
      return (
        <ImageMessage
          fileUuid={fileUuid}
          fileHash={fileHash}
          filename={filename}
          fileSize={fileSize}
          urlType={urlType}
        />
      );

    case 'video':
      return (
        <VideoMessage
          fileUuid={fileUuid}
          fileHash={fileHash}
          filename={filename}
          fileSize={fileSize}
          urlType={urlType}
        />
      );

    default:
      return (
        <DocumentMessage
          fileUuid={fileUuid}
          fileHash={fileHash}
          filename={filename}
          fileSize={fileSize}
          urlType={urlType}
        />
      );
  }
}

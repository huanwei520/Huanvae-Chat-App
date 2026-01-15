/**
 * 文件消息内容组件
 *
 * 根据消息类型（图片/视频/文件）渲染不同的内容
 * - 图片：缩略图预览，点击打开独立窗口查看
 * - 视频：视频缩略图，点击立即下载并打开独立窗口播放
 * - 文件：文件图标和名称，点击下载
 *
 * 视频下载流程：
 * 1. 点击视频缩略图 → 立即触发 triggerBackgroundDownload
 * 2. 缩略图显示圆形下载进度
 * 3. 同时打开独立窗口，传递预签名 URL
 * 4. 下载完成后发送跨窗口事件，独立窗口自动切换到本地文件
 *
 * 尺寸计算逻辑：
 * - 图片/视频：使用 imageWidth/imageHeight 计算显示尺寸
 * - 有尺寸信息时按比例缩放，不超过最大尺寸
 * - 无尺寸信息时使用默认占位尺寸
 *
 * 使用 useFileCache Hook 实现本地优先加载和自动缓存
 * 图片和视频使用独立窗口预览，与 WebRTC 会议使用相同的架构
 */

import { useState, useCallback } from 'react';
import { useImageCache, useVideoCache, useFileCache } from '../../hooks/useFileCache';
import { triggerBackgroundDownload } from '../../services/fileCache';
import { useFileCacheStore, selectDownloadTask } from '../../stores/fileCacheStore';
import { formatFileSize } from '../../hooks/useFileUpload';
import { FilePreviewModal } from './FilePreviewModal';
import { openMediaWindow } from '../../media';
import { useSession } from '../../contexts/SessionContext';
import { CircularProgress } from '../../components/common/CircularProgress';

/**
 * 计算显示尺寸（保持比例，限制最大尺寸）
 *
 * @param originalWidth - 原始宽度
 * @param originalHeight - 原始高度
 * @param maxWidth - 最大宽度（默认 280）
 * @param maxHeight - 最大高度（默认 300）
 * @returns 计算后的显示尺寸
 */
function calculateDisplaySize(
  originalWidth: number,
  originalHeight: number,
  maxWidth = 280,
  maxHeight = 300,
): { width: number; height: number } {
  if (originalWidth <= 0 || originalHeight <= 0) {
    return { width: maxWidth, height: maxHeight };
  }

  const aspectRatio = originalWidth / originalHeight;

  let displayWidth = originalWidth;
  let displayHeight = originalHeight;

  // 限制最大宽度
  if (displayWidth > maxWidth) {
    displayWidth = maxWidth;
    displayHeight = displayWidth / aspectRatio;
  }

  // 限制最大高度
  if (displayHeight > maxHeight) {
    displayHeight = maxHeight;
    displayWidth = displayHeight * aspectRatio;
  }

  return {
    width: Math.round(displayWidth),
    height: Math.round(displayHeight),
  };
}
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
  /** 好友 ID（用于错误上报） */
  friendId?: string;
  /** 图片宽度（像素），从消息中获取 */
  imageWidth?: number | null;
  /** 图片高度（像素），从消息中获取 */
  imageHeight?: number | null;
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

/** 图片显示的最大尺寸 */
const IMAGE_MAX_WIDTH = 280;
const IMAGE_MAX_HEIGHT = 300;

/** 没有尺寸信息时的默认占位尺寸 */
const IMAGE_DEFAULT_WIDTH = 200;
const IMAGE_DEFAULT_HEIGHT = 150;

function ImageMessage({
  fileUuid,
  fileHash,
  filename,
  fileSize,
  urlType,
  friendId,
  imageWidth,
  imageHeight,
}: {
  fileUuid: string;
  fileHash: string | null | undefined;
  filename: string;
  fileSize: number | null;
  urlType: 'user' | 'friend' | 'group';
  /** 好友 ID（用于错误上报） */
  friendId?: string;
  /** 消息中携带的图片宽度（后端返回） */
  imageWidth?: number | null;
  /** 消息中携带的图片高度（后端返回） */
  imageHeight?: number | null;
}) {
  const { session } = useSession();
  const { src, isLocal, loading, error, onLoad, localPath } = useImageCache(
    fileUuid,
    fileHash,
    filename,
    urlType,
    friendId,
  );

  // 是否有后端提供的尺寸信息
  const hasPresetDimensions = imageWidth && imageHeight && imageWidth > 0 && imageHeight > 0;

  // 计算容器显示尺寸（在渲染时就确定，不会因图片加载而改变）
  // 规则：
  // 1. 有尺寸信息：按比例缩放，不超过最大尺寸
  // 2. 无尺寸信息：使用默认占位尺寸
  const displaySize = hasPresetDimensions
    ? calculateDisplaySize(imageWidth, imageHeight, IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT)
    : { width: IMAGE_DEFAULT_WIDTH, height: IMAGE_DEFAULT_HEIGHT };

  // 点击打开独立预览窗口
  const handleClick = useCallback(() => {
    if (!session) { return; }

    openMediaWindow(
      {
        type: 'image',
        fileUuid,
        filename,
        fileSize: fileSize ?? undefined,
        fileHash,
        urlType,
        localPath,
        // 传递已获取的预签名 URL，避免独立窗口重复请求
        presignedUrl: isLocal ? undefined : src,
      },
      {
        serverUrl: session.serverUrl,
        accessToken: session.accessToken,
      },
    );
  }, [session, fileUuid, filename, fileSize, fileHash, urlType, localPath, isLocal, src]);

  // 容器样式：固定尺寸，不会因图片加载而改变
  const containerStyle: React.CSSProperties = {
    width: displaySize.width,
    height: displaySize.height,
  };

  return (
    <div
      className="file-message image-message"
      style={containerStyle}
      onClick={handleClick}
    >
      {/* 加载中显示占位符 */}
      {loading && (
        <div className="file-message-loading">
          <span>加载中...</span>
        </div>
      )}
      {/* 加载错误 */}
      {error && <div className="file-message-error">加载失败</div>}
      {/* 图片加载完成后显示 */}
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

/** 视频显示的最大尺寸 */
const VIDEO_MAX_WIDTH = 280;
const VIDEO_MAX_HEIGHT = 300;

/** 没有尺寸信息时的默认占位尺寸 */
const VIDEO_DEFAULT_WIDTH = 280;
const VIDEO_DEFAULT_HEIGHT = 160;

/**
 * 视频消息组件
 *
 * 功能：
 * - 显示视频缩略图
 * - 点击时立即触发下载并打开独立播放窗口
 * - 在缩略图上显示圆形下载进度
 * - 下载完成后自动切换到本地文件
 * - 独立窗口与主窗口使用同一预签名 URL
 */
function VideoMessage({
  fileUuid,
  fileHash,
  filename,
  fileSize,
  urlType,
  friendId,
  imageWidth,
  imageHeight,
}: {
  fileUuid: string;
  fileHash: string | null | undefined;
  filename: string;
  fileSize: number | null;
  urlType: 'user' | 'friend' | 'group';
  /** 好友 ID（用于错误上报） */
  friendId?: string;
  /** 消息中携带的视频宽度（后端返回） */
  imageWidth?: number | null;
  /** 消息中携带的视频高度（后端返回） */
  imageHeight?: number | null;
}) {
  const { session } = useSession();
  const { src, isLocal, loading, error, onPlay, localPath } = useVideoCache(
    fileUuid,
    fileHash,
    filename,
    fileSize ?? undefined,
    urlType,
    friendId,
  );

  // 监听下载任务状态（用于显示进度）
  const downloadTask = useFileCacheStore(selectDownloadTask(fileHash ?? ''));

  // 是否有后端提供的尺寸信息
  const hasPresetDimensions = imageWidth && imageHeight && imageWidth > 0 && imageHeight > 0;

  // 计算容器显示尺寸（与图片相同的逻辑）
  const displaySize = hasPresetDimensions
    ? calculateDisplaySize(imageWidth, imageHeight, VIDEO_MAX_WIDTH, VIDEO_MAX_HEIGHT)
    : { width: VIDEO_DEFAULT_WIDTH, height: VIDEO_DEFAULT_HEIGHT };

  // 判断是否正在下载
  const isDownloading = downloadTask && (
    downloadTask.status === 'pending' || downloadTask.status === 'downloading'
  );

  // 判断是否已下载完成（包括本地文件或下载完成）
  const isDownloaded = isLocal || downloadTask?.status === 'completed';

  // 获取实际的本地路径（优先使用下载完成的路径）
  const actualLocalPath = downloadTask?.localPath ?? localPath;

  // 点击：触发下载并打开独立预览窗口
  const handleClick = useCallback(() => {
    if (!session) { return; }

    // 如果文件未下载且有 fileHash 和 src，开始下载
    if (!isDownloaded && !isDownloading && fileHash && src) {
      triggerBackgroundDownload(
        src,
        fileHash,
        filename,
        'video',
        fileSize ?? undefined,
      );
    }

    // 打开独立窗口（传递预签名 URL 和本地路径）
    openMediaWindow(
      {
        type: 'video',
        fileUuid,
        filename,
        fileSize: fileSize ?? undefined,
        fileHash,
        urlType,
        localPath: actualLocalPath,
        // 传递已获取的预签名 URL，避免独立窗口重复请求
        presignedUrl: isLocal ? undefined : src,
      },
      {
        serverUrl: session.serverUrl,
        accessToken: session.accessToken,
      },
    );
  }, [
    session, fileUuid, filename, fileSize, fileHash, urlType,
    actualLocalPath, isLocal, src, isDownloaded, isDownloading,
  ]);

  // 容器样式
  const containerStyle: React.CSSProperties = {
    width: displaySize.width,
    height: displaySize.height,
  };

  return (
    <div className="file-message video-message" style={containerStyle} onClick={handleClick}>
      {/* 加载中显示占位符 */}
      {loading && (
        <div className="file-message-loading">
          <span>加载中...</span>
        </div>
      )}
      {/* 加载错误 */}
      {error && <div className="file-message-error">加载失败</div>}
      {/* 视频加载完成后显示 */}
      {!loading && !error && src && (
        <>
          {/* 本地文件标识 */}
          {isDownloaded && <LocalBadge />}

          {/* 视频缩略图 */}
          <video
            src={src}
            className="message-video-thumbnail"
            preload="metadata"
            onPlay={onPlay}
          />

          {/* 下载进度覆盖层 */}
          {isDownloading && downloadTask && (
            <div className="video-download-overlay">
              <CircularProgress progress={downloadTask.percent} />
            </div>
          )}

          {/* 播放按钮覆盖层（未下载时显示） */}
          {!isDownloading && (
            <div className="video-play-overlay">
              <PlayIcon />
            </div>
          )}
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
  friendId,
}: {
  fileUuid: string;
  fileHash: string | null | undefined;
  filename: string;
  fileSize: number | null;
  urlType: 'user' | 'friend' | 'group';
  /** 好友 ID（用于错误上报） */
  friendId?: string;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const { src, isLocal, localPath, cacheFile } = useFileCache({
    fileUuid,
    fileHash,
    fileName: filename,
    fileType: 'document',
    urlType,
    friendId,
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
  friendId,
  imageWidth,
  imageHeight,
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
          friendId={friendId}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
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
          friendId={friendId}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
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
          friendId={friendId}
        />
      );
  }
}

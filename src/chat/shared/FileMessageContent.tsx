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

import { useState, useCallback, useEffect } from 'react';
import { useImageCache, useVideoCache, useFileCache } from '../../hooks/useFileCache';
import { formatFileSize } from '../../hooks/useFileUpload';
import { FilePreviewModal } from './FilePreviewModal';
import { openMediaWindow } from '../../media';
import { useSession } from '../../contexts/SessionContext';
import {
  getImageDimensions,
  getImageDimensionsSync,
  saveImageDimensions,
  calculateDisplaySize,
  type ImageDimensions,
} from '../../services/imageDimensions';

/** 调试模式 */
const DEBUG_IMAGE = true;

/** 调试日志 */
function logImage(action: string, data?: Record<string, unknown>) {
  if (DEBUG_IMAGE) {
    // eslint-disable-next-line no-console
    console.log(`%c[ImageSize] ${action}`, 'color: #9C27B0; font-weight: bold', data ?? '');
  }
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

  // 生成文件标识（优先使用 fileHash，其次 fileUuid）
  const fileKey = fileHash || fileUuid;

  // 预设尺寸状态（初始化时同步获取内存缓存中的尺寸）
  const [presetSize, setPresetSize] = useState<ImageDimensions | null>(
    () => getImageDimensionsSync(fileKey),
  );

  // 加载预设尺寸，如果没有缓存且有本地路径则预读取
  useEffect(() => {
    if (!fileKey) { return; }

    let cancelled = false;

    const loadDimensions = async () => {
      logImage('加载尺寸开始', { fileKey, isLocal, hasSrc: !!src });

      // 先检查缓存
      const cached = await getImageDimensions(fileKey);
      if (cancelled) { return; }

      if (cached) {
        logImage('从缓存获取尺寸', { fileKey, cached });
        setPresetSize(cached);
        return;
      }

      logImage('无缓存', { fileKey, isLocal, hasSrc: !!src });

      // 如果没有缓存且有 src（本地图片），预读取尺寸
      if (src && isLocal) {
        logImage('预读取本地图片尺寸', { fileKey, src: src.substring(0, 50) });
        const img = new Image();
        img.onload = () => {
          if (cancelled) { return; }
          const { naturalWidth, naturalHeight } = img;
          logImage('预读取完成', { fileKey, naturalWidth, naturalHeight });
          if (naturalWidth > 0 && naturalHeight > 0) {
            saveImageDimensions(fileKey, naturalWidth, naturalHeight);
            setPresetSize({ width: naturalWidth, height: naturalHeight });
          }
        };
        img.src = src;
      }
    };

    loadDimensions();

    return () => { cancelled = true; };
  }, [fileKey, src, isLocal]);

  // 图片加载完成后保存尺寸
  const handleLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      const { naturalWidth, naturalHeight, offsetWidth, offsetHeight } = img;

      logImage('图片 onLoad', {
        fileKey,
        naturalWidth,
        naturalHeight,
        offsetWidth,
        offsetHeight,
        hadPresetSize: !!presetSize,
      });

      // 保存尺寸到缓存
      if (fileKey && naturalWidth > 0 && naturalHeight > 0) {
        saveImageDimensions(fileKey, naturalWidth, naturalHeight);
        // 更新预设尺寸（如果之前没有）
        if (!presetSize) {
          setPresetSize({ width: naturalWidth, height: naturalHeight });
        }
      }

      // 调用原有的 onLoad（触发缓存）
      onLoad();
    },
    [fileKey, presetSize, onLoad],
  );

  // 计算显示尺寸
  const displaySize = presetSize
    ? calculateDisplaySize(presetSize.width, presetSize.height)
    : null;

  // 调试：记录容器尺寸
  useEffect(() => {
    logImage('容器尺寸', {
      fileKey,
      hasPresetSize: !!presetSize,
      presetSize,
      displaySize,
      loading,
      error: !!error,
      hasSrc: !!src,
    });
  }, [fileKey, presetSize, displaySize, loading, error, src]);

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
      },
      {
        serverUrl: session.serverUrl,
        accessToken: session.accessToken,
      },
    );
  }, [session, fileUuid, filename, fileSize, fileHash, urlType, localPath]);

  // 容器样式：如果有预设尺寸则使用，否则使用默认最小尺寸
  const containerStyle: React.CSSProperties = displaySize
    ? { width: displaySize.width, height: displaySize.height }
    : { minWidth: 120, minHeight: 80 };

  return (
    <div
      className="file-message image-message"
      style={containerStyle}
      onClick={handleClick}
    >
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
            onLoad={handleLoad}
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
    if (!session) { return; }

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

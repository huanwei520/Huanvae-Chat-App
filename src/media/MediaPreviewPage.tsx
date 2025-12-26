/**
 * 媒体预览页面
 *
 * 作为独立窗口运行，用于显示图片和播放视频
 * 通过 localStorage 获取媒体数据和认证信息
 *
 * 不使用 SessionProvider 和 useApi，直接使用原始 fetch API
 *
 * 功能：
 * - 图片全屏预览（支持缩放）
 * - 视频播放（支持流式）
 * - 本地文件优先加载
 * - 下载按钮
 *
 * @see src/meeting/MeetingPage.tsx 参考类似架构
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { fetch } from '@tauri-apps/plugin-http';
import { loadMediaData, clearMediaData } from './api';
import { getCachedFilePath } from '../services/fileCache';
import { formatFileSize } from '../hooks/useFileUpload';
import './styles.css';

// ============================================================================
// 类型定义
// ============================================================================

interface MediaState {
  /** 媒体类型 */
  type: 'image' | 'video';
  /** 文件 UUID */
  fileUuid: string;
  /** 文件名 */
  filename: string;
  /** 文件大小 */
  fileSize?: number;
  /** 文件哈希 */
  fileHash?: string | null;
  /** URL 类型 */
  urlType: 'user' | 'friend' | 'group';
  /** 本地文件路径 */
  localPath?: string | null;
  /** 服务器地址 */
  serverUrl: string;
  /** 访问令牌 */
  accessToken: string;
}

// ============================================================================
// 图标组件
// ============================================================================

const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const LocalIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

// ============================================================================
// 预签名 URL 获取
// ============================================================================

async function getPresignedUrl(
  serverUrl: string,
  accessToken: string,
  fileUuid: string,
  urlType: 'user' | 'friend' | 'group',
): Promise<string> {
  let endpoint: string;
  switch (urlType) {
    case 'friend':
      endpoint = `${serverUrl}/api/storage/friends_file/${fileUuid}/presigned_url`;
      break;
    case 'group':
    default:
      endpoint = `${serverUrl}/api/storage/file/${fileUuid}/presigned_url`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ operation: 'preview' }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.presigned_url;
}

// ============================================================================
// 文件源获取
// ============================================================================

interface FileSource {
  src: string;
  isLocal: boolean;
}

async function getFileSource(
  state: MediaState,
): Promise<FileSource> {
  // 1. 检查本地缓存
  if (state.fileHash) {
    const localPath = await getCachedFilePath(state.fileHash);
    if (localPath) {
      return {
        src: convertFileSrc(localPath),
        isLocal: true,
      };
    }
  }

  // 2. 获取预签名 URL
  const url = await getPresignedUrl(
    state.serverUrl,
    state.accessToken,
    state.fileUuid,
    state.urlType,
  );

  return {
    src: url,
    isLocal: false,
  };
}

// ============================================================================
// 图片预览组件
// ============================================================================

function ImageViewer({ state }: { state: MediaState }) {
  const [src, setSrc] = useState<string | null>(null);
  const [isLocal, setIsLocal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // 加载图片
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const result = await getFileSource(state);
        if (!cancelled) {
          setSrc(result.src);
          setIsLocal(result.isLocal);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [state]);

  // 鼠标滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((prev) => Math.max(0.1, Math.min(10, prev * delta)));
  }, []);

  // 拖拽开始
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  }, [scale, position]);

  // 拖拽移动
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  }, [isDragging]);

  // 拖拽结束
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 双击重置
  const handleDoubleClick = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  // 下载
  const handleDownload = useCallback(() => {
    if (!src) return;
    const a = document.createElement('a');
    a.href = src;
    a.download = state.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [src, state.filename]);

  if (loading) {
    return (
      <div className="media-loading">
        <div className="media-spinner" />
        <span>加载中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="media-error">
        <span>加载失败: {error}</span>
      </div>
    );
  }

  return (
    <>
      {/* 工具栏扩展按钮 */}
      <div className="media-toolbar-extra">
        <button onClick={handleDownload} title="下载">
          <DownloadIcon />
        </button>
        {isLocal && (
          <span className="media-local-badge">
            <LocalIcon /> 本地文件
          </span>
        )}
      </div>

      {/* 图片容器 */}
      <div
        className="media-image-container"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
        <img
          src={src || ''}
          alt={state.filename}
          className="media-image"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
          }}
          draggable={false}
        />
      </div>

      {/* 缩放提示 */}
      {scale !== 1 && (
        <div className="media-zoom-indicator">
          {Math.round(scale * 100)}%
        </div>
      )}
    </>
  );
}

// ============================================================================
// 视频预览组件
// ============================================================================

function VideoPlayer({ state }: { state: MediaState }) {
  const [src, setSrc] = useState<string | null>(null);
  const [isLocal, setIsLocal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 加载视频
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const result = await getFileSource(state);
        if (!cancelled) {
          setSrc(result.src);
          setIsLocal(result.isLocal);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [state]);

  // 下载按钮
  const handleDownload = useCallback(() => {
    if (!src) return;
    const a = document.createElement('a');
    a.href = src;
    a.download = state.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [src, state.filename]);

  if (loading) {
    return (
      <div className="media-loading">
        <div className="media-spinner" />
        <span>加载中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="media-error">
        <span>加载失败: {error}</span>
      </div>
    );
  }

  return (
    <>
      {/* 工具栏扩展按钮 */}
      <div className="media-toolbar-extra">
        <button onClick={handleDownload} title="下载">
          <DownloadIcon />
        </button>
        {isLocal && (
          <span className="media-local-badge">
            <LocalIcon /> 本地文件
          </span>
        )}
      </div>

      {/* 视频播放器 */}
      <div className="media-video-container">
        <video
          src={src || ''}
          controls
          autoPlay
          className="media-video"
        />
      </div>
    </>
  );
}

// ============================================================================
// 主页面组件
// ============================================================================

export default function MediaPreviewPage() {
  const [mediaState, setMediaState] = useState<MediaState | null>(null);

  // 初始化：读取媒体数据
  useEffect(() => {
    const data = loadMediaData();
    if (!data || !data.serverUrl || !data.accessToken) {
      window.close();
      return;
    }
    setMediaState(data as MediaState);
  }, []);

  // 关闭窗口
  const handleClose = useCallback(() => {
    clearMediaData();
    window.close();
  }, []);

  // 键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  if (!mediaState) {
    return (
      <div className="media-page media-loading">
        <div className="media-spinner" />
        <span>加载中...</span>
      </div>
    );
  }

  return (
    <div className="media-page">
      {/* 顶部工具栏 */}
      <header className="media-header">
        <div className="media-info">
          <h1 className="media-filename">{mediaState.filename}</h1>
          {mediaState.fileSize && (
            <span className="media-filesize">{formatFileSize(mediaState.fileSize)}</span>
          )}
        </div>
        <div className="media-actions">
          <button className="media-close-btn" onClick={handleClose} title="关闭 (Esc)">
            <CloseIcon />
          </button>
        </div>
      </header>

      {/* 内容区域 */}
      <main className="media-content">
        {mediaState.type === 'image' && <ImageViewer state={mediaState} />}
        {mediaState.type === 'video' && <VideoPlayer state={mediaState} />}
      </main>
    </div>
  );
}

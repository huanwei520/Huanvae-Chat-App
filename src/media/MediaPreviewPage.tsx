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
 * - 监听主窗口下载完成事件，自动切换到本地文件
 * - 下载按钮
 *
 * 跨窗口通信：
 * - 主窗口点击视频缩略图时触发 triggerBackgroundDownload
 * - 主窗口下载完成后发送 'file-download-completed' 事件
 * - 本页面监听此事件，自动切换视频源为本地文件
 *
 * 缓存机制：
 * - 优先检查本地路径（使用 is_file_exists 验证文件是否存在）
 * - 主窗口传递预签名 URL，避免独立窗口重复请求
 * - 下载完成后更新数据库映射，再次访问时直接使用本地文件
 *
 * @see src/services/fileCache.ts 文件缓存服务
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { secureHttp } from '../services/secureFetch';
import { resolveForSecureHttp } from '../services/discovery';
import { loadMediaData, clearMediaData } from './api';
import {
  getCachedFilePath,
  downloadAndSaveFile,
  triggerBackgroundDownload,
  startProgressListener,
  isFileNotFoundError,
  type FileDownloadCompletedEvent,
} from '../services/fileCache';
import { useFileCacheStore, selectDownloadTask } from '../stores/fileCacheStore';
import { formatFileSize } from '../utils/format';
import {
  reportFriendPermissionError,
  createPresignedUrlErrorContext,
} from '../services/diagnosticService';
import { optimizePresignedUrl } from '../utils/network';
import { CircularProgress } from '../components/common/CircularProgress';
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
  /** 预获取的预签名 URL */
  presignedUrl?: string | null;
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

const FolderIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

/**
 * 错误展示视图
 *
 * 区分两类失败：
 * - 服务器端 404（文件已删除）→ 友好提示 + 关闭按钮，主窗口已被通知刷新列表
 * - 其他错误 → 原始错误信息
 */
function MediaErrorView({ error }: { error: string }) {
  const isFileGone = isFileNotFoundError(error);

  if (isFileGone) {
    return (
      <div className="media-error">
        <span>该文件已从服务器删除，无法预览。</span>
        <p style={{ margin: '8px 0 16px', fontSize: 13, opacity: 0.8 }}>
          主窗口的「我的文件」列表会自动刷新清理。
        </p>
        <button
          onClick={() => window.close()}
          style={{
            padding: '8px 24px',
            borderRadius: 6,
            border: '1px solid var(--border-color, #444)',
            background: 'var(--primary, #3b82f6)',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          关闭窗口
        </button>
      </div>
    );
  }

  return (
    <div className="media-error">
      <span>加载失败: {error}</span>
    </div>
  );
}

// ============================================================================
// 预签名 URL 获取
// ============================================================================

async function getPresignedUrl(
  serverUrl: string,
  accessToken: string,
  fileUuid: string,
  urlType: 'user' | 'friend' | 'group',
  fileType?: 'image' | 'video' | 'document',
): Promise<string> {
  // 验证必要参数
  if (!serverUrl) {
    throw new Error('服务器地址为空');
  }
  if (!accessToken) {
    throw new Error('访问令牌为空，请重新登录');
  }
  if (!fileUuid) {
    throw new Error('文件 UUID 为空');
  }

  let endpoint: string;
  switch (urlType) {
    case 'friend':
      endpoint = `${serverUrl}/api/storage/friends_file/${fileUuid}/presigned_url`;
      break;
    case 'group':
    case 'user':
    default:
      endpoint = `${serverUrl}/api/storage/file/${fileUuid}/presigned_url`;
  }

  // eslint-disable-next-line no-console
  console.log('[MediaPreview] 请求预签名 URL:', { endpoint, urlType, fileUuid });

  try {
    // 独立预览窗口:经 Rust secure_http(自签 + 内置 CA;窗口内 resolve 为 null 退化 pin_ca)
    const response = await secureHttp({
      method: 'POST',
      url: endpoint,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ operation: 'preview' }),
      ...(resolveForSecureHttp() ?? { pin_ca: true }),
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorData = response.json<{ error?: string; message?: string; data?: { error?: string } }>();
        // 兼容 ApiResponse wrapper（{ success: false, error/message }）+ 老格式
        errorMessage = errorData?.error ?? errorData?.message ?? errorData?.data?.error ?? errorMessage;
      } catch {
        // 响应不是 JSON，使用默认错误消息
      }

      if (response.status === 401) {
        throw new Error('登录已过期，请关闭窗口后重新登录');
      } else if (response.status === 403) {
        // 好友文件403错误：异步上报诊断日志（图片/视频都上报）
        if (urlType === 'friend') {
          reportFriendPermissionError(
            serverUrl,
            accessToken,
            createPresignedUrlErrorContext(fileUuid, errorMessage, {
              operation: 'preview',
              urlType,
              fileType,
              screen: 'media_preview',
              action: 'get_presigned_url',
            }),
          ).catch(() => {
            // 上报失败静默处理
          });
        }
        throw new Error('无权访问此文件');
      } else if (response.status === 404) {
        throw new Error('文件不存在');
      }
      throw new Error(errorMessage);
    }

    const data = response.json<{ data?: { presigned_url?: string }; presigned_url?: string }>();
    // 后端统一用 ApiResponse 包裹：{ success, code, data: { presigned_url, expires_at } }
    // 兼容老接口（无 wrapper）：{ presigned_url, expires_at }
    const presignedUrl: string | undefined = data?.data?.presigned_url ?? data?.presigned_url;
    if (!presignedUrl) {
      throw new Error('服务器未返回预签名 URL');
    }

    // 解析相对路径为完整 URL
    const resolvedUrl = optimizePresignedUrl(presignedUrl, serverUrl);

    // eslint-disable-next-line no-console
    console.log('[MediaPreview] 预签名 URL 获取成功');
    return resolvedUrl;
  } catch (err) {
    // 确保所有错误都是 Error 实例
    if (err instanceof Error) {
      throw err;
    }
    // 处理非标准异常（如 Tauri fetch 错误）
    const message = typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err);
    throw new Error(message || '网络请求失败');
  }
}

// ============================================================================
// 文件源获取
// ============================================================================

interface FileSource {
  src: string;
  isLocal: boolean;
  /** 预签名 URL（用于后台下载） */
  presignedUrl?: string;
  /** 是否需要缓存到本地 */
  shouldCache?: boolean;
  /** 本地路径（仅当 isLocal=true 时有值；用于"在文件夹中显示"） */
  localPath?: string;
}

async function getFileSource(
  state: MediaState,
): Promise<FileSource> {
  // eslint-disable-next-line no-console
  console.log('[MediaPreview] 获取文件源:', {
    fileUuid: state.fileUuid,
    fileHash: state.fileHash,
    urlType: state.urlType,
    localPath: state.localPath,
  });

  // 1. 优先使用传入的本地路径（需检查文件是否存在）
  if (state.localPath) {
    try {
      const exists = await invoke<boolean>('is_file_exists', { path: state.localPath });
      if (exists) {
        const src = convertFileSrc(state.localPath);
        // eslint-disable-next-line no-console
        console.log('[MediaPreview] 使用传入的本地路径:', state.localPath);
        return { src, isLocal: true, shouldCache: false, localPath: state.localPath };
      }
      console.warn('[MediaPreview] 本地路径文件不存在，尝试其他方式:', state.localPath);
    } catch (err) {
      console.warn('[MediaPreview] 检查本地路径失败:', err);
    }
  }

  // 2. 检查本地缓存（通过 fileHash）
  if (state.fileHash) {
    try {
      const localPath = await getCachedFilePath(state.fileHash);
      if (localPath) {
        const src = convertFileSrc(localPath);
        // eslint-disable-next-line no-console
        console.log('[MediaPreview] 使用缓存的本地文件:', localPath);
        return { src, isLocal: true, shouldCache: false, localPath };
      }
    } catch (err) {
      console.warn('[MediaPreview] 检查本地缓存失败:', err);
    }
  }

  // 3. 使用预获取的预签名 URL（如果有）
  if (state.presignedUrl) {
    // eslint-disable-next-line no-console
    console.log('[MediaPreview] 使用预获取的预签名 URL');
    return {
      src: state.presignedUrl,
      isLocal: false,
      presignedUrl: state.presignedUrl,
      shouldCache: !!state.fileHash, // 有 fileHash 才能缓存
    };
  }

  // 4. 获取预签名 URL
  // eslint-disable-next-line no-console
  console.log('[MediaPreview] 本地缓存不存在，获取预签名 URL...');
  const url = await getPresignedUrl(
    state.serverUrl,
    state.accessToken,
    state.fileUuid,
    state.urlType,
    state.type, // image 或 video
  );

  return {
    src: url,
    isLocal: false,
    presignedUrl: url,
    shouldCache: !!state.fileHash, // 有 fileHash 才能缓存
  };
}

// ============================================================================
// 图片预览组件
// ============================================================================

function ImageViewer({ state }: { state: MediaState }) {
  const [src, setSrc] = useState<string | null>(null);
  const [isLocal, setIsLocal] = useState(false);
  const [localPathState, setLocalPathState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // 文件源信息（用于后台下载）
  const fileSourceRef = useRef<FileSource | null>(null);
  const downloadTriggeredRef = useRef(false);

  // 订阅下载任务状态（用于工具栏按钮三态切换）
  const downloadTask = useFileCacheStore(selectDownloadTask(state.fileHash ?? ''));

  // 启动进度监听器（独立窗口需要自行启动一次）
  useEffect(() => {
    startProgressListener();
  }, []);

  // 加载图片
  useEffect(() => {
    let cancelled = false;
    downloadTriggeredRef.current = false; // 重置下载标记

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const result = await getFileSource(state);
        if (!cancelled) {
          setSrc(result.src);
          setIsLocal(result.isLocal);
          setLocalPathState(result.localPath ?? null);
          fileSourceRef.current = result;
        }
      } catch (err) {
        console.error('[MediaPreview] 图片加载失败:', err);
        if (!cancelled) {
          // 确保提取正确的错误消息
          let message = '加载失败';
          if (err instanceof Error) {
            message = err.message;
          } else if (typeof err === 'string') {
            message = err;
          } else if (typeof err === 'object' && err !== null && 'message' in err) {
            message = String((err as { message: unknown }).message);
          }
          setError(message);
          // 服务端 404：通知主窗口从「我的文件」列表中清理该条目
          if (isFileNotFoundError(err)) {
            emit('media-preview-file-unavailable', {
              fileUuid: state.fileUuid,
              fileHash: state.fileHash ?? null,
            }).catch(() => {
              // emit 失败不影响错误展示
            });
          }
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

  // 图片加载完成后触发后台下载
  const handleImageLoad = useCallback(() => {
    const fileSource = fileSourceRef.current;
    if (
      !downloadTriggeredRef.current &&
      fileSource &&
      !fileSource.isLocal &&
      fileSource.shouldCache &&
      fileSource.presignedUrl &&
      state.fileHash
    ) {
      downloadTriggeredRef.current = true;
      // eslint-disable-next-line no-console
      console.log('[MediaPreview] 图片加载完成，触发后台下载...');
      downloadAndSaveFile(
        fileSource.presignedUrl,
        state.fileHash,
        state.filename,
        'image',
        state.fileSize,
      ).then((localPath) => {
        // eslint-disable-next-line no-console
        console.log('[MediaPreview] 后台下载完成:', localPath);
        // 更新为本地路径
        setSrc(convertFileSrc(localPath));
        setIsLocal(true);
        setLocalPathState(localPath);
      }).catch((err) => {
        console.warn('[MediaPreview] 后台下载失败:', err);
      });
    }
  }, [state.fileHash, state.filename, state.fileSize]);

  // 鼠标滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((prev) => Math.max(0.1, Math.min(10, prev * delta)));
  }, []);

  // 拖拽开始
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1) { return; }
    setIsDragging(true);
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  }, [scale, position]);

  // 拖拽移动
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) { return; }
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

  // 下载（走项目统一后台下载链路，避免 <a download> 在 Tauri webview 跨域 URL 上被当作导航）
  const handleDownload = useCallback(() => {
    if (!state.fileHash) {
      console.warn('[MediaPreview] 无 fileHash，无法触发下载');
      return;
    }
    const presignedUrl = fileSourceRef.current?.presignedUrl ?? src;
    if (!presignedUrl) {
      console.warn('[MediaPreview] 无 presigned URL，无法触发下载');
      return;
    }
    triggerBackgroundDownload(
      presignedUrl,
      state.fileHash,
      state.filename,
      'image',
      state.fileSize,
    );
  }, [state.fileHash, state.filename, state.fileSize, src]);

  // 在文件夹中显示 —— 仅信任 localPathState（与 isLocal 同源），不 fallback 到
  // downloadTask?.localPath（store 内存遗迹，文件被外部删除后不刷新）
  const handleShowInFolder = useCallback(() => {
    if (!localPathState) { return; }
    invoke('show_in_folder', { path: localPathState }).catch((err) => {
      console.warn('[MediaPreview] 打开文件夹失败:', err);
    });
  }, [localPathState]);

  // 工具栏按钮三态判定 —— 仅依赖 isLocal（Rust stat 校验过的当前真相）
  const isCompleted = isLocal;
  const isDownloading =
    downloadTask?.status === 'pending' || downloadTask?.status === 'downloading';
  const downloadPercent = downloadTask?.percent ?? 0;

  if (loading) {
    return (
      <div className="media-loading">
        <div className="media-spinner" />
        <span>加载中...</span>
      </div>
    );
  }

  if (error) {
    return <MediaErrorView error={error} />;
  }

  return (
    <>
      {/* 工具栏扩展按钮 */}
      <div className="media-toolbar-extra">
        {isDownloading && (
          <div className="media-download-progress" title={`下载中 ${downloadPercent}%`}>
            <CircularProgress progress={downloadPercent} size={28} strokeWidth={3} />
          </div>
        )}
        {!isDownloading && isCompleted && (
          <button onClick={handleShowInFolder} title="在文件夹中显示">
            <FolderIcon />
          </button>
        )}
        {!isDownloading && !isCompleted && (
          <button onClick={handleDownload} title="下载">
            <DownloadIcon />
          </button>
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
            cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in', // eslint-disable-line no-nested-ternary
          }}
          draggable={false}
          onLoad={handleImageLoad}
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
  const [localPathState, setLocalPathState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 文件源信息（用于点击下载按钮时获取 presigned URL）
  const fileSourceRef = useRef<FileSource | null>(null);

  // 订阅下载任务状态（工具栏按钮三态切换）
  const downloadTask = useFileCacheStore(selectDownloadTask(state.fileHash ?? ''));

  // 启动进度监听器（独立窗口需要自行启动一次）
  useEffect(() => {
    startProgressListener();
  }, []);

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
          setLocalPathState(result.localPath ?? null);
          fileSourceRef.current = result;
        }
      } catch (err) {
        console.error('[MediaPreview] 视频加载失败:', err);
        if (!cancelled) {
          // 确保提取正确的错误消息
          let message = '加载失败';
          if (err instanceof Error) {
            message = err.message;
          } else if (typeof err === 'string') {
            message = err;
          } else if (typeof err === 'object' && err !== null && 'message' in err) {
            message = String((err as { message: unknown }).message);
          }
          setError(message);
          // 服务端 404：通知主窗口从「我的文件」列表中清理该条目
          if (isFileNotFoundError(err)) {
            emit('media-preview-file-unavailable', {
              fileUuid: state.fileUuid,
              fileHash: state.fileHash ?? null,
            }).catch(() => {
              // emit 失败不影响错误展示
            });
          }
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

  // 视频开始播放时的回调
  // 注意：不再触发下载，下载由主窗口统一管理，避免重复下载导致进度回撤
  const handleVideoPlay = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log('[MediaPreview] 视频开始播放');
  }, []);

  // 监听主窗口的下载完成事件（跨窗口通信）
  useEffect(() => {
    if (!state.fileHash || isLocal) { return; }

    let unlisten: (() => void) | null = null;

    listen<FileDownloadCompletedEvent>('file-download-completed', (event) => {
      const { fileHash, localPath } = event.payload;

      // 检查是否是当前视频的下载完成
      if (fileHash === state.fileHash) {
        // eslint-disable-next-line no-console
        console.log('[MediaPreview] 收到下载完成事件，切换到本地文件:', localPath);
        setSrc(convertFileSrc(localPath));
        setIsLocal(true);
        setLocalPathState(localPath);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) { unlisten(); }
    };
  }, [state.fileHash, isLocal]);

  // 下载按钮（走项目统一后台下载链路；<a download> 在 Tauri webview 跨域 URL 上会被当导航）
  const handleDownload = useCallback(() => {
    if (!state.fileHash) {
      console.warn('[MediaPreview] 无 fileHash，无法触发下载');
      return;
    }
    const presignedUrl = fileSourceRef.current?.presignedUrl ?? src;
    if (!presignedUrl) {
      console.warn('[MediaPreview] 无 presigned URL，无法触发下载');
      return;
    }
    triggerBackgroundDownload(
      presignedUrl,
      state.fileHash,
      state.filename,
      'video',
      state.fileSize,
    );
  }, [state.fileHash, state.filename, state.fileSize, src]);

  // 在文件夹中显示 —— 仅信任 localPathState（与 isLocal 同源），不 fallback 到
  // downloadTask?.localPath（store 内存遗迹，文件被外部删除后不刷新）
  const handleShowInFolder = useCallback(() => {
    if (!localPathState) { return; }
    invoke('show_in_folder', { path: localPathState }).catch((err) => {
      console.warn('[MediaPreview] 打开文件夹失败:', err);
    });
  }, [localPathState]);

  // 工具栏按钮三态判定 —— 仅依赖 isLocal（Rust stat 校验过的当前真相）
  const isCompleted = isLocal;
  const isDownloading =
    downloadTask?.status === 'pending' || downloadTask?.status === 'downloading';
  const downloadPercent = downloadTask?.percent ?? 0;

  if (loading) {
    return (
      <div className="media-loading">
        <div className="media-spinner" />
        <span>加载中...</span>
      </div>
    );
  }

  if (error) {
    return <MediaErrorView error={error} />;
  }

  return (
    <>
      {/* 工具栏扩展按钮 */}
      <div className="media-toolbar-extra">
        {isDownloading && (
          <div className="media-download-progress" title={`下载中 ${downloadPercent}%`}>
            <CircularProgress progress={downloadPercent} size={28} strokeWidth={3} />
          </div>
        )}
        {!isDownloading && isCompleted && (
          <button onClick={handleShowInFolder} title="在文件夹中显示">
            <FolderIcon />
          </button>
        )}
        {!isDownloading && !isCompleted && (
          <button onClick={handleDownload} title="下载">
            <DownloadIcon />
          </button>
        )}
      </div>

      {/* 视频播放器 */}
      <div className="media-video-container">
        <video
          src={src || ''}
          controls
          autoPlay
          className="media-video"
          onPlay={handleVideoPlay}
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

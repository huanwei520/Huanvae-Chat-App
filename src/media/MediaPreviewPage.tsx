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

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { secureHttp } from '../services/secureFetch';
import { resolveForSecureHttp } from '../services/discovery';
import { resolveDisplayUrl } from '../services/secureProxy';
import { takeMediaData, type MediaStorageData } from './api';
import {
  getCachedFilePath,
  downloadAndSaveFile,
  triggerBackgroundDownload,
  startProgressListener,
  isFileNotFoundError,
  fileIdentityKey,
  resolveContentHash,
  type FileDownloadCompletedEvent,
} from '../services/fileCache';
import { useFileCacheStore, selectDownloadTask } from '../stores/fileCacheStore';
import { formatFileSize } from '../utils/format';
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
  /**
   * **已知**的内容哈希。只有个人文件面（「我的文件」）的 handoff 带它；
   * 消息面（气泡 / 查找命中）**不带** —— 后端接收面已不再下发 `file_hash`。
   * 缓存查找与下载任务改以 `fileUuid` 为键（两层键，见 services/fileCache.fileIdentityKey）。
   */
  fileHash?: string | null;
  /** URL 类型 */
  urlType: 'user' | 'friend' | 'group';
  /**
   * 群文件预签名必填的 related_id（= 发起本次访问的群 ID），非群媒体为 null。
   * 由主窗口的 openMediaWindow 在 handoff 时写入（本窗口读不到 chatStore）。
   */
  groupId?: string | null;
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
 * - 服务器端 404（文件已删除）→ 友好提示，主窗口已被通知刷新列表（用原生标题栏关闭窗口）
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
  /** 群文件必填的 related_id（发起本次访问的群 ID）；非群路径传 null */
  groupId: string | null | undefined,
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

  // 群文件端点 2026-08-13 起 related_id 必填（= 发起本次访问的群 ID），缺失 / 非 UUID 一律 400。
  // 本窗口不解析、只消费 handoff 递来的值；拿不到就地抛错，别让它变成一句看不懂的 400。
  if (urlType === 'group' && !groupId) {
    throw new Error('群文件预签名缺少 related_id：预览窗未收到发起访问的群 ID');
  }

  let endpoint: string;
  switch (urlType) {
    case 'friend':
      endpoint = `${serverUrl}/api/storage/friends_file/${fileUuid}/presigned_url`;
      break;
    case 'group':
      // 群文件专用端点：实时校验活跃群成员（退群/新入群即时生效），不走通用静态授权端点。
      endpoint = `${serverUrl}/api/storage/group_file/${fileUuid}/presigned_url`;
      break;
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
      // 🔴 逐键显式构造：字段不写进这个字面量就是静默丢掉。
      // friend / user 两条路径的请求体必须逐字节保持 `{"operation":"preview"}`。
      body: JSON.stringify(
        urlType === 'group'
          ? { operation: 'preview', related_id: groupId }
          : { operation: 'preview' },
      ),
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
        // 这里曾经把好友文件 403 上报给 /api/diagnostic/report/friend-permission，
        // 2026-08-21 随 diagnosticService 整块删除：后端没有这个路由，该 POST 恒 404
        // 并被静默吞掉（成因与恢复条件见 services/fileCache.ts 同批注释）。
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

  // 2. 检查本地缓存：先做 uuid -> hash 那一跳（两层键），再照旧按内容哈希查 file_mappings
  const contentHash = await resolveContentHash(state.fileUuid, state.fileHash);
  if (contentHash) {
    try {
      const localPath = await getCachedFilePath(contentHash);
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
  //    显示 src 经 resolveDisplayUrl 反代（私有 CA）；presignedUrl 保持原始（下载需要）。
  if (state.presignedUrl) {
    // eslint-disable-next-line no-console
    console.log('[MediaPreview] 使用预获取的预签名 URL');
    return {
      src: resolveDisplayUrl(state.presignedUrl) ?? state.presignedUrl,
      isLocal: false,
      presignedUrl: state.presignedUrl,
      // 两层键下永远有键可用（消息面 = file_uuid），不再以"有没有哈希"为条件
      shouldCache: true,
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
    state.groupId,
  );

  return {
    src: resolveDisplayUrl(url) ?? url,
    isLocal: false,
    presignedUrl: url,
    // 同上：键恒存在
    shouldCache: true,
  };
}

// ============================================================================
// 图片预览组件
// ============================================================================

/** 触控板横向滑动累计到这个像素量就切一张（低于它当作误触，不切） */
const WHEEL_SWITCH_THRESHOLD_PX = 80;

/**
 * 左右边缘翻页热区（「边缘翻白」）：常驻 DOM 但默认整条透明，
 * 指针进入左/右边缘（:hover）才显出该侧的半透明白带 + 箭头，点击 = 切一张。
 * 显隐只由 CSS opacity 过渡负责，无任何 JS 逐帧写样式（animation.md 规则一）。
 *
 * 边界（首/末张）选择【不渲染】而非禁用态：禁用按钮仍占着边缘拦截指针事件，
 * 不渲染则边缘完全交还给图片交互；「到没到头」由顶部「3 / 12」位置指示承担。
 *
 * 🔴 放大态（yieldToPan）下热区 pointer-events: none 整层让位给拖拽平移 ——
 * 与移动端同一条矩阵（放大态横向手势是平移不是切图）；键盘 ← → 仍可用。
 */
function EdgeNavZones({
  canPrev,
  canNext,
  onStep,
  yieldToPan = false,
}: {
  canPrev: boolean;
  canNext: boolean;
  onStep: (delta: number) => void;
  /** 放大态让位给拖拽平移：热区不收任何指针事件 */
  yieldToPan?: boolean;
}) {
  const zoomedClass = yieldToPan ? ' media-nav--zoomed' : '';
  return (
    <>
      {canPrev && (
        <button
          className={`media-nav media-nav-prev${zoomedClass}`}
          onClick={() => onStep(-1)}
          title="上一张（←）"
          type="button"
        >
          ‹
        </button>
      )}
      {canNext && (
        <button
          className={`media-nav media-nav-next${zoomedClass}`}
          onClick={() => onStep(1)}
          title="下一张（→）"
          type="button"
        >
          ›
        </button>
      )}
    </>
  );
}

function ImageViewer({
  state,
  canPrev,
  canNext,
  onStep,
}: {
  state: MediaState;
  /** 序列里还有没有上一张（到边界时横向滑动不切图，也不循环） */
  canPrev: boolean;
  canNext: boolean;
  /** 切上一张 (-1) / 下一张 (+1) */
  onStep: (delta: number) => void;
}) {
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
  // 文件身份键：个人文件面 handoff 带哈希就用它，消息面用 file_uuid（两层键）
  const cacheKey = fileIdentityKey(state.fileUuid, state.fileHash);
  const downloadTask = useFileCacheStore(selectDownloadTask(cacheKey));

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
      fileSource.presignedUrl
    ) {
      downloadTriggeredRef.current = true;
      // eslint-disable-next-line no-console
      console.log('[MediaPreview] 图片加载完成，触发后台下载...');
      downloadAndSaveFile(
        fileSource.presignedUrl,
        cacheKey,
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
  }, [cacheKey, state.filename, state.fileSize]);

  // 横向滑动的累计量（触控板两指横扫是一串小 deltaX，攒够一屏才切一张）
  const wheelAccumRef = useRef(0);

  /**
   * 滚轮：纵向 = 缩放（原行为）；横向 = 「左右滑动」在桌面上的对应物。
   *
   * 🔴 与移动端同一条矩阵：**放大态（scale > 1）下横向滑动是平移图片，不切图**。
   * 未放大时横扫才切上一张 / 下一张；到边界不切也不循环（累计量清零，等于回弹）。
   */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();

    // 横向为主的滚动 = 触控板两指横扫
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      if (scale > 1) {
        // 放大态：横向滑动归平移，切图层让位
        setPosition((prev) => ({ x: prev.x - e.deltaX, y: prev.y }));
        return;
      }
      wheelAccumRef.current += e.deltaX;
      if (Math.abs(wheelAccumRef.current) < WHEEL_SWITCH_THRESHOLD_PX) { return; }
      const direction = wheelAccumRef.current > 0 ? 1 : -1;
      wheelAccumRef.current = 0;
      if (direction === -1 && !canPrev) { return; }
      if (direction === 1 && !canNext) { return; }
      onStep(direction);
      return;
    }

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((prev) => Math.max(0.1, Math.min(10, prev * delta)));
  }, [scale, canPrev, canNext, onStep]);

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
    // 下载必须用**原始** presigned URL（Rust directIpUrl 重写 host→IP）；
    // 不回退到 src —— src 现为反代 loopback URL，传给下载会被 directIpUrl 弄坏。
    const presignedUrl = fileSourceRef.current?.presignedUrl;
    if (!presignedUrl) {
      console.warn('[MediaPreview] 无 presigned URL，无法触发下载');
      return;
    }
    triggerBackgroundDownload(
      presignedUrl,
      cacheKey,
      state.filename,
      'image',
      state.fileSize,
    );
  }, [cacheKey, state.filename, state.fileSize]);

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
        {/* 热区挂在容器内：滚轮/双指手势经冒泡仍落容器处理器，不被热区吞掉 */}
        <EdgeNavZones canPrev={canPrev} canNext={canNext} onStep={onStep} yieldToPan={scale > 1} />
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

function VideoPlayer({
  state,
  canPrev,
  canNext,
  onStep,
}: {
  state: MediaState;
  canPrev: boolean;
  canNext: boolean;
  onStep: (delta: number) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [isLocal, setIsLocal] = useState(false);
  const [localPathState, setLocalPathState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 文件源信息（用于点击下载按钮时获取 presigned URL）
  const fileSourceRef = useRef<FileSource | null>(null);

  // 订阅下载任务状态（工具栏按钮三态切换）
  // 文件身份键：个人文件面 handoff 带哈希就用它，消息面用 file_uuid（两层键）
  const cacheKey = fileIdentityKey(state.fileUuid, state.fileHash);
  const downloadTask = useFileCacheStore(selectDownloadTask(cacheKey));

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
    if (isLocal) { return; }

    let unlisten: (() => void) | null = null;

    listen<FileDownloadCompletedEvent>('file-download-completed', (event) => {
      const { cacheKey: completedKey, localPath } = event.payload;

      // 检查是否是当前视频的下载完成（比的是同一把文件身份键）
      if (completedKey === cacheKey) {
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
  }, [cacheKey, isLocal]);

  // 下载按钮（走项目统一后台下载链路；<a download> 在 Tauri webview 跨域 URL 上会被当导航）
  const handleDownload = useCallback(() => {
    // 下载必须用**原始** presigned URL（Rust directIpUrl 重写）；不回退 src（现为反代 loopback）。
    const presignedUrl = fileSourceRef.current?.presignedUrl;
    if (!presignedUrl) {
      console.warn('[MediaPreview] 无 presigned URL，无法触发下载');
      return;
    }
    triggerBackgroundDownload(
      presignedUrl,
      cacheKey,
      state.filename,
      'video',
      state.fileSize,
    );
  }, [cacheKey, state.filename, state.fileSize]);

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
        <EdgeNavZones canPrev={canPrev} canNext={canNext} onStep={onStep} />
      </div>
    </>
  );
}

// ============================================================================
// 主页面组件
// ============================================================================

export default function MediaPreviewPage() {
  const [handoff, setHandoff] = useState<MediaStorageData | null>(null);
  const [index, setIndex] = useState(0);

  // 初始化：**取走**媒体数据（takeMediaData 读完即从 localStorage 删除）
  //
  // 🔴 handoff 里带着完整的 accessToken，而 localStorage 按 origin 共享且落盘 ——
  // 取走之后它只活在本窗口的内存里。为什么删了也不影响功能：数据已经进了 React state，
  // 而这个窗口每次都是主窗口「先写数据、关掉旧窗、再新建」出来的
  //（见 media/api.ts 的 openMediaWindow），不存在"重新读一次"的路径。
  //
  // 数据缺失时停留在加载态（该窗口仅在主窗口写入数据后创建，此路径实际不可达；
  // 窗口关闭一律走原生标题栏，DOM 层的 close 调用在 Tauri webview 里关不掉 OS 窗口）
  useEffect(() => {
    const data = takeMediaData();
    if (!data || !data.serverUrl || !data.accessToken || !data.sequence?.length) {
      return;
    }
    setHandoff(data);
    setIndex(Math.min(Math.max(data.index, 0), data.sequence.length - 1));
  }, []);

  const total = handoff?.sequence.length ?? 0;
  const canPrev = index > 0;
  const canNext = index < total - 1;

  // 边界：到头就是到头 —— 不循环、不跳转（与移动端 stepGalleryIndex 同口径）
  const step = useCallback((delta: number) => {
    setIndex((prev) => {
      const next = prev + delta;
      if (next < 0 || next >= total) { return prev; }
      return next;
    });
  }, [total]);

  // 键盘左右切图（独立预览窗没有别的键盘用途，直接挂 window）
  useEffect(() => {
    if (total <= 1) { return; }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { step(-1); }
      if (e.key === 'ArrowRight') { step(1); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step, total]);

  // 当前这一项 —— 必须 memo：ImageViewer / VideoPlayer 的加载 effect 依赖 [state]，
  // 每次 render 造新对象会让它们无限重新取源。
  const mediaState = useMemo<MediaState | null>(() => {
    if (!handoff) { return null; }
    const entry = handoff.sequence[index];
    if (!entry) { return null; }
    return {
      ...entry,
      serverUrl: handoff.serverUrl,
      accessToken: handoff.accessToken,
      groupId: handoff.groupId,
    };
  }, [handoff, index]);

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
        {/* 序列位置「3 / 12」：单张序列不显示。它同时是验收判据 ——
            光看画面换没换，分不清"切图生效"与"图片自己重载了" */}
        {total > 1 && (
          <span className="media-position">{index + 1} / {total}</span>
        )}
      </header>

      {/* 内容区域
          🔴 key 用 fileUuid：换一项就重挂，缩放 / 平移 / src 一并归零。
          这里可以放心重挂 —— 桌面预览窗没有 AnimatePresence，不会因此闪一次整块淡入。 */}
      <main className="media-content">
        {mediaState.type === 'image' && (
          <ImageViewer
            key={mediaState.fileUuid}
            state={mediaState}
            canPrev={canPrev}
            canNext={canNext}
            onStep={step}
          />
        )}
        {mediaState.type === 'video' && (
          <VideoPlayer
            key={mediaState.fileUuid}
            state={mediaState}
            canPrev={canPrev}
            canNext={canNext}
            onStep={step}
          />
        )}
      </main>

      {/* 左右切图由 EdgeNavZones 提供（挂在图片/视频容器内的 hover 显隐边缘热区）；
          键盘 ← → 与触控板横向滑动是同效入口（见 step / handleWheel） */}
    </div>
  );
}

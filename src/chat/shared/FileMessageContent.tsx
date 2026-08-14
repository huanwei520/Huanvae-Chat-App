/**
 * 文件消息内容组件
 *
 * 根据消息类型（图片/视频/文件）渲染不同的内容
 * - 图片：缩略图预览，点击打开独立窗口查看
 * - 视频：视频缩略图，点击立即下载并打开独立窗口播放
 * - 文件：文件图标和名称，点击下载，带进度显示
 *
 * 视频下载流程：
 * 1. 点击视频缩略图 → 立即触发 triggerBackgroundDownload
 * 2. 缩略图显示圆形下载进度
 * 3. 同时打开独立窗口，传递预签名 URL
 * 4. 下载完成后发送跨窗口事件，独立窗口自动切换到本地文件
 * 5. 下载完成后显示"打开文件夹"按钮
 *
 * 文档下载流程：
 * 1. 点击下载按钮 → 触发 triggerBackgroundDownload
 * 2. 下载按钮变为圆形进度条
 * 3. 下载完成后显示"打开文件夹"按钮
 * 4. 桌面端：点击按钮在文件夹中显示文件
 * 5. 移动端：点击按钮直接打开文件
 *
 * 尺寸计算逻辑：
 * - 图片/视频：使用 imageWidth/imageHeight 计算显示尺寸
 * - 有尺寸信息时按比例缩放，不超过最大尺寸
 * - 无尺寸信息时使用默认占位尺寸
 *
 * 使用 useFileCache Hook 实现本地优先加载和自动缓存
 * 图片和视频使用独立窗口预览，与 WebRTC 会议使用相同的架构
 */

import { useState, useCallback, useEffect } from 'react';
import { useImageCache, useVideoCache, useFileCache } from '../../hooks/useFileCache';
import { triggerBackgroundDownload } from '../../services/fileCache';
import { useFileCacheStore, selectDownloadTask } from '../../stores/fileCacheStore';
import { formatFileSize } from '../../utils/format';
import { FilePreviewModal } from './FilePreviewModal';
import { MobileMediaPreview } from './MobileMediaPreview';
import { VideoThumbnail } from './VideoThumbnail';
import { DocumentDownloadAction, LocalBadge } from './DocumentDownloadAction';
import { SendingMediaOverlay, useSendingMediaState } from './SendingMediaOverlay';
import { retrySendingItem, cancelSendingItem } from './sendingMediaActions';
import type { SendingMediaEntry } from '../../stores/sendingMediaStore';
import { openMediaWindow } from '../../media';
import { useSession } from '../../contexts/SessionContext';
import { CircularProgress } from '../../components/common/CircularProgress';
import { isMobile } from '../../utils/platform';
import { calculateDisplaySize, mediaContainerStyle } from './mediaDisplaySize';

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
  /**
   * 乐观消息的 clientId（真实历史消息为 undefined）。
   *
   * 给了它，本组件就会去 sendingMediaStore 查这一项还在不在途；在途 ⇒ 渲染
   * 「本地预览 + 覆盖层」而不是走正常取源路径。理由见下方 SendingMediaMessage 的注释。
   */
  clientId?: string;
  /** 图片宽度（像素），从消息中获取 */
  imageWidth?: number | null;
  /** 图片高度（像素），从消息中获取 */
  imageHeight?: number | null;
  /**
   * 显示形态：
   * - `bubble`（默认）气泡内按原始宽高比自适应，尺寸由 calculateDisplaySize 内联算出
   * - `album`   相册格子内铺满，尺寸交给外层 grid（内联宽高会跟 grid 打架，故此时不写）
   *
   * 相册**复用本组件**而不是另写一个缩略图，是为了不新增「显示点」——
   * 远程媒体必经安全反代那条不变量由 tests/secure-display-routing.test.ts 守着，
   * 每多一个直接渲染 <img> 的地方就多一处会漏的口子。
   */
  displayVariant?: 'bubble' | 'album';
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

// ============================================
// 图片消息组件
// ============================================

/** 图片显示的最大尺寸 */
const IMAGE_MAX_WIDTH = 280;
const IMAGE_MAX_HEIGHT = 320;

/** 没有尺寸信息时的默认占位尺寸 */
const IMAGE_DEFAULT_WIDTH = 200;
const IMAGE_DEFAULT_HEIGHT = 150;

/** 图片加载失败自动重试的最大次数 */
const IMAGE_MAX_RETRIES = 2;

function ImageMessage({
  fileUuid,
  fileHash,
  filename,
  fileSize,
  urlType,
  friendId,
  imageWidth,
  imageHeight,
  displayVariant,
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
  /** 显示形态：album 时铺满外层 grid 格子，不写内联宽高 */
  displayVariant?: 'bubble' | 'album';
}) {
  const { session } = useSession();
  const {
    src,
    isLocal,
    loading,
    error,
    onLoad,
    localPath,
    presignedUrl,
    retryWithNewUrl,
    openInFolder,
  } = useImageCache(fileUuid, fileHash, filename, urlType, friendId);
  // 订阅当前图片的下载任务状态，给 MobileMediaPreview 菜单决策用
  const imageDownloadTask = useFileCacheStore(selectDownloadTask(fileHash ?? ''));
  const imageIsDownloading =
    imageDownloadTask?.status === 'pending'
    || imageDownloadTask?.status === 'downloading';

  // 移动端预览模态框状态
  const [showMobilePreview, setShowMobilePreview] = useState(false);

  // 图片浏览器级别加载失败的重试状态
  const [imgRetryCount, setImgRetryCount] = useState(0);
  const [imgLoadFailed, setImgLoadFailed] = useState(false);

  // src 变化时重置失败状态（新 URL 到来，重新尝试加载）
  useEffect(() => {
    setImgLoadFailed(false);
  }, [src]);

  // 图片加载失败处理：清除 URL 缓存并重新获取预签名 URL
  const handleImageError = useCallback(() => {
    if (imgRetryCount < IMAGE_MAX_RETRIES) {
      console.warn('[ImageMessage] 图片加载失败，重试中...', {
        fileUuid: fileUuid.slice(0, 8),
        retry: imgRetryCount + 1,
      });
      setImgRetryCount((c) => c + 1);
      retryWithNewUrl();
    } else {
      console.error('[ImageMessage] 图片加载失败，已达最大重试次数', {
        fileUuid: fileUuid.slice(0, 8),
      });
      setImgLoadFailed(true);
    }
  }, [imgRetryCount, retryWithNewUrl, fileUuid]);

  // 手动点击重试
  const handleManualRetry = useCallback(() => {
    setImgRetryCount(0);
    setImgLoadFailed(false);
    retryWithNewUrl();
  }, [retryWithNewUrl]);

  // 是否有后端提供的尺寸信息
  const hasPresetDimensions = imageWidth && imageHeight && imageWidth > 0 && imageHeight > 0;

  // 计算容器显示尺寸（在渲染时就确定，不会因图片加载而改变）
  // 规则：
  // 1. 有尺寸信息：按比例缩放，不超过最大尺寸
  // 2. 无尺寸信息：使用默认占位尺寸
  const displaySize = hasPresetDimensions
    ? calculateDisplaySize(imageWidth, imageHeight, IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT)
    : { width: IMAGE_DEFAULT_WIDTH, height: IMAGE_DEFAULT_HEIGHT };

  // 点击预览（移动端使用全屏模态框，桌面端使用独立窗口）
  const handleClick = useCallback(() => {
    if (!src || imgLoadFailed) { return; }

    // 移动端：使用全屏模态框预览
    if (isMobile()) {
      setShowMobilePreview(true);
      return;
    }

    // 桌面端：打开独立预览窗口
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
        // 传递**原始** presigned URL（非反代 src）：预览窗自己经其反代显示；
        // 传反代 URL 会把回环端口烘进跨窗字符串，且预览窗下载需原始 URL。
        presignedUrl: isLocal ? undefined : presignedUrl,
      },
      {
        serverUrl: session.serverUrl,
        accessToken: session.accessToken,
      },
    );
  }, [session, fileUuid, filename, fileSize, fileHash, urlType, localPath, isLocal, src, presignedUrl, imgLoadFailed]);

  // 容器样式：气泡态固定尺寸（不会因图片加载而改变）；相册态铺满格子（尺寸归外层 grid）
  const containerStyle: React.CSSProperties = displayVariant === 'album'
    ? { width: '100%', height: '100%' }
    : mediaContainerStyle(displaySize);

  // 合并 API 级别和浏览器级别的错误
  const showError = error || imgLoadFailed;

  return (
    <>
      <div
        className="file-message image-message"
        style={containerStyle}
        onClick={showError ? handleManualRetry : handleClick}
      >
        {/* 加载中显示占位符 */}
        {loading && (
          <div className="file-message-loading">
            <span>加载中...</span>
          </div>
        )}
        {/* 加载错误（API 错误或图片加载失败） */}
        {showError && (
          <div className="file-message-error" style={{ flexDirection: 'column', cursor: 'pointer' }}>
            <span>加载失败</span>
            <span style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>点击重试</span>
          </div>
        )}
        {/* 图片加载完成后显示 */}
        {!loading && !showError && src && (
          <>
            {isLocal && <LocalBadge />}
            <img
              key={imgRetryCount}
              src={src}
              alt={filename}
              className="message-image"
              draggable={false}
              onLoad={onLoad}
              onError={handleImageError}
            />
          </>
        )}
      </div>

      {/* 移动端全屏预览 */}
      {src && (
        <MobileMediaPreview
          isOpen={showMobilePreview}
          type="image"
          src={src}
          filename={filename}
          localPath={localPath}
          downloadProgress={imageDownloadTask?.percent ?? 0}
          isDownloading={imageIsDownloading}
          onClose={() => setShowMobilePreview(false)}
          onOpenWith={localPath ? () => openInFolder(localPath) : undefined}
          onDownload={
            !isLocal && fileHash && src
              ? () => triggerBackgroundDownload(presignedUrl ?? src, fileHash, filename, 'image', undefined)
              : undefined
          }
        />
      )}
    </>
  );
}

// ============================================
// 视频消息组件
// ============================================

/** 视频显示的最大尺寸 */
const VIDEO_MAX_WIDTH = 280;
const VIDEO_MAX_HEIGHT = 320;

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
 * - 下载完成后显示"打开文件夹"按钮
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
  displayVariant,
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
  /** 显示形态：album 时铺满外层 grid 格子，不写内联宽高 */
  displayVariant?: 'bubble' | 'album';
}) {
  const { session } = useSession();
  const { src, isLocal, loading, error, onPlay, localPath, presignedUrl, openInFolder } = useVideoCache(
    fileUuid,
    fileHash,
    filename,
    fileSize ?? undefined,
    urlType,
    friendId,
  );

  // 移动端预览模态框状态
  const [showMobilePreview, setShowMobilePreview] = useState(false);

  // 监听下载任务状态（用于显示进度）
  const downloadTask = useFileCacheStore(selectDownloadTask(fileHash ?? ''));

  // 调试：移动端视频源信息
  useEffect(() => {
    if (isMobile() && src) {
      const info = {
        filename,
        fileHash: fileHash?.substring(0, 16),
        src: src.substring(0, 80) + (src.length > 80 ? '...' : ''),
        isLocal,
        localPath: localPath?.substring(0, 50),
        loading,
        error,
        isAsset: src.startsWith('asset://'),
        isHttps: src.startsWith('https://'),
      };
      // eslint-disable-next-line no-console
      console.log('[VideoMessage] 视频源信息:', JSON.stringify(info, null, 0));
    }
  }, [src, isLocal, localPath, loading, error, filename, fileHash]);

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

  // 判断是否已下载完成 —— 唯一真相来自 useFileCache.isLocal（其内部走 Rust stat 校验）。
  // 不要 OR downloadTask?.status === 'completed'：那是 store 里的内存遗迹，文件被
  // 外部删除后不会失效，会让徽章卡住。
  const isDownloaded = isLocal;

  // 本地路径直接来自 useFileCache.localPath（与 isLocal 同源，下载完成后由
  // loadSource 的 Rust 校验产生），无需再 fallback 到 downloadTask?.localPath。
  const actualLocalPath = localPath;

  // 点击预览（移动端使用全屏模态框，桌面端使用独立窗口）
  const handleClick = useCallback(() => {
    if (!src) { return; }

    // 移动端：使用全屏模态框预览
    if (isMobile()) {
      // 打开预览的同时触发后台下载（与桌面端行为一致）
      // 这样消息列表中可以显示下载进度
      if (!isDownloaded && !isDownloading && fileHash && src) {
        triggerBackgroundDownload(
          presignedUrl ?? src,
          fileHash,
          filename,
          'video',
          fileSize ?? undefined,
        );
      }
      setShowMobilePreview(true);
      return;
    }

    // 桌面端：触发下载并打开独立窗口
    if (!session) { return; }

    // 如果文件未下载且有 fileHash 和 src，开始下载
    if (!isDownloaded && !isDownloading && fileHash && src) {
      triggerBackgroundDownload(
        presignedUrl ?? src,
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
        // 传递**原始** presigned URL（非反代 src）：预览窗自己经其反代显示 + 下载需原始 URL。
        presignedUrl: isLocal ? undefined : presignedUrl,
      },
      {
        serverUrl: session.serverUrl,
        accessToken: session.accessToken,
      },
    );
  }, [
    session, fileUuid, filename, fileSize, fileHash, urlType,
    actualLocalPath, isLocal, src, presignedUrl, isDownloaded, isDownloading,
  ]);

  // 容器样式（同 ImageMessage：相册态铺满格子）
  const containerStyle: React.CSSProperties = displayVariant === 'album'
    ? { width: '100%', height: '100%' }
    : mediaContainerStyle(displaySize);

  return (
    <>
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

            {/* 视频缩略图：全仓唯一那处 <video> 封面（取源 / #t=0.1 / preload / muted /
                playsInline 全在组件里），详见 chat/shared/VideoThumbnail.tsx。
                这里递**裸** src —— 片段由组件内部追。
                fileHash 是本地封面缓存的键（与图片本地缓存同一把键）：给了它，封面截一次就
                落盘，之后本组件渲染 <img> 走本地、不再建 <video>，杀掉 App 重开也立刻有画面。
                「查找记录 → 视频」那处（components/search/ConversationSearchHit.tsx）递的是
                同一个 file_hash ⇒ 两处命中**同一个封面文件**，天然是同一帧。 */}
            <VideoThumbnail
              src={src}
              fileHash={fileHash}
              className="message-video-thumbnail"
              onPlay={onPlay}
            />

            {/* 下载进度覆盖层 */}
            {isDownloading && downloadTask && (
              <div className="video-download-overlay">
                <CircularProgress progress={downloadTask.percent} />
              </div>
            )}

            {/* 播放按钮覆盖层 */}
            {!isDownloading && (
              <div className="video-play-overlay">
                <PlayIcon />
              </div>
            )}
          </>
        )}
      </div>

      {/* 移动端全屏预览 —— 这里喂**裸** src，不是 videoPosterSrc(src)：
          #t=0.1 只给缩略图，加到播放器上会让视频从 0.1s 开始播。 */}
      {src && (
        <MobileMediaPreview
          isOpen={showMobilePreview}
          type="video"
          src={src}
          filename={filename}
          localPath={actualLocalPath}
          downloadProgress={downloadTask?.percent ?? 0}
          isDownloading={isDownloading}
          onClose={() => setShowMobilePreview(false)}
          onOpenWith={actualLocalPath ? () => openInFolder(actualLocalPath) : undefined}
          onDownload={
            !isLocal && fileHash && src
              ? () => triggerBackgroundDownload(presignedUrl ?? src, fileHash, filename, 'video', fileSize ?? undefined)
              : undefined
          }
        />
      )}
    </>
  );
}

// ============================================
// 文件消息组件
// ============================================

/**
 * 文档消息组件
 *
 * 功能：
 * - 显示文件图标、名称和大小
 * - 点击下载按钮触发后台下载（带进度显示）
 * - 下载完成后显示"打开文件夹"按钮
 * - 移动端：直接打开文件；桌面端：在文件夹中显示
 */
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
  const { src, presignedUrl, isLocal, localPath, openInFolder } = useFileCache({
    fileUuid,
    fileHash,
    fileName: filename,
    fileType: 'document',
    urlType,
    friendId,
    autoCache: false,
  });

  // 监听下载任务状态（用于卡片层判断 isDownloaded / isDownloading 与本地路径展示）
  const downloadTask = useFileCacheStore(selectDownloadTask(fileHash ?? ''));

  const isDownloading = !!downloadTask && (
    downloadTask.status === 'pending' || downloadTask.status === 'downloading'
  );
  // 仅依赖 isLocal（useFileCache 内走 Rust stat），不 OR downloadTask?.status === 'completed'
  // —— store 中的 completed 是内存遗迹，文件被外部删除后不会刷新。
  const isDownloaded = isLocal;
  const actualLocalPath = localPath;

  // 桌面端点击卡片：已下载打开文件夹，未下载触发下载（与 inline 下载按钮行为一致）
  // 移动端点击卡片：打开预览
  const handleDocumentClick = useCallback(() => {
    if (isMobile()) {
      setShowPreview(true);
    } else if (isDownloaded && actualLocalPath) {
      openInFolder(actualLocalPath);
    } else if (!isDownloading && src && fileHash) {
      triggerBackgroundDownload(
        presignedUrl ?? src,
        fileHash,
        filename,
        'document',
        fileSize ?? undefined,
      );
    }
  }, [isDownloaded, actualLocalPath, isDownloading, src, presignedUrl, fileHash, filename, fileSize, openInFolder]);

  return (
    <>
      <div className="file-message document-message" onClick={handleDocumentClick}>
        {/* 不渲染 LocalBadge：白底文档气泡白勾不可见；已下载状态通过下方本地路径文本 + 下载按钮消失体现 */}

        <div className="document-icon">
          <FileIcon />
        </div>

        <div className="document-info">
          <span className="document-name" title={filename}>
            {filename.length > 20 ? `${filename.slice(0, 17)}...` : filename}
          </span>
          {fileSize && <span className="document-size">{formatFileSize(fileSize)}</span>}
          {actualLocalPath && (
            <span className="document-local-path" title={actualLocalPath}>
              📁 {actualLocalPath.split(/[/\\]/).pop()}
            </span>
          )}
        </div>

        <DocumentDownloadAction
          layout="inline"
          variant="chat-document"
          fileUuid={fileUuid}
          fileHash={fileHash}
          filename={filename}
          fileSize={fileSize}
          urlType={urlType}
          friendId={friendId}
        />
      </div>

      {/* 移动端全屏预览 */}
      {isMobile() && (
        <FilePreviewModal
          isOpen={showPreview}
          onClose={() => setShowPreview(false)}
          fileUuid={fileUuid}
          filename={filename}
          fileSize={fileSize ?? undefined}
          fileHash={fileHash}
          urlType={urlType}
        />
      )}
    </>
  );
}

// ============================================
// 在途发送项（乐观消息）
// ============================================

/**
 * 还在上传中的那一条：本地预览 + 覆盖层（类 Telegram「媒体自己在原地转圈」）
 *
 * ## 为什么必须有这个分支
 *
 * 乐观消息是上传**开始前**就插进列表的，此刻服务端还没建消息 ⇒ 它的 `file_uuid` / `file_url`
 * 恒为 null。走正常取源路径的话，`FileMessageContent` 会在 `!fileUuid` 那里早返回一个
 * **「文件不可用」**的错误块 —— 用户发出去的每一张图在上传期间都会显示成"不可用"。
 * 所以在途项必须走本地预览：`entry.preview.previewUrl` 是待发区就生成好的 object URL。
 *
 * ## 覆盖层的宿主就是这里的容器
 *
 * `<SendingMediaOverlay>` 对宿主的唯一要求是父元素非 static。这里复用的三个类名里
 * `.image-message` / `.video-message` 本来就是 `position: relative`（它们要放播放按钮 /
 * 下载进度覆盖层）；`.document-message` 本来不是，已在 pages/main.css 里补上，
 * 并由 tests/styles/SendingOverlayHost.test.ts 钉住。
 *
 * ## 🔴 判据是「与完成态逐像素同形，唯一差别是进度圈」（huanwei 2026-08-13 08:16）
 *
 * 他的原话：「发出去上传进度条中就以图片/视频封面来进行显示，保证上传进度条和上传完成的
 * 样式完全一致」。所以这一支不是"另画一个占位"，而是**把完成态那套渲染原样搭一遍**，
 * 只把取源换成本地那份。三处逐条对齐（改动一处就会重新出现跳变）：
 *
 * | | 完成态 | 在途（本组件） |
 * |---|---|---|
 * | 容器尺寸 | `calculateDisplaySize(image_width, image_height, MAX…)` | **同一个函数、同一组数字**（`preview.width/height` 由待发区提前探测，与上传链路共用 `readMediaDimensions`） |
 * | 类名 | `.image-message` / `.video-message` + `.message-image` / `.message-video-thumbnail` | 逐字相同 ⇒ 圆角、`object-fit: contain`、黑底全部同一条 CSS |
 * | 视频画面 | `<VideoThumbnail>`（`#t=0.1` 逼引擎 seek 首帧） | **同一个组件**（不传 `fileHash` ⇒ 恒走 `<video>` 分支，不读也不写封面库） |
 *
 * | 播放角标 | `.video-play-overlay` | **同样画**（见下方注释：少画它就是第二处差别，违反验收口径） |
 *
 * ## 三条「不要踩」（接线契约原文，逐条对应）
 * 1. **不给覆盖层传 percent** —— 它自己按 clientId 订阅 store；走 props 会让每次百分比
 *    变化都从消息列表顶层重渲一整棵树。这里只递 `clientId` 与两个**模块级**回调。
 * 2. `status === 'done'` 时它自己返回 null，本组件不判断（`done` 到真实消息进列表之间
 *    仍要显示这张本地预览，否则会闪一下空白）。
 * 3. **不在气泡里再写一套滚底** —— 乐观条目的 `client_` 前缀已经让 useStickToBottom
 *    无条件滚底，本文件里没有任何 scrollTop / scrollIntoView。
 */
function SendingMediaMessage({
  entry,
  displayVariant,
}: {
  entry: SendingMediaEntry;
  displayVariant?: 'bubble' | 'album';
}) {
  const { kind, previewUrl, name, size, width, height } = entry.preview;

  const overlay = (
    <SendingMediaOverlay
      clientId={entry.clientId}
      onRetry={retrySendingItem}
      onCancel={cancelSendingItem}
    />
  );

  // 文档：待发区也收文档，它同样要能在自己的卡片上转圈
  if (kind === 'file') {
    return (
      <div className="file-message document-message">
        <div className="document-icon">
          <FileIcon />
        </div>
        <div className="document-info">
          <span className="document-name" title={name}>
            {name.length > 20 ? `${name.slice(0, 17)}...` : name}
          </span>
          {size > 0 && <span className="document-size">{formatFileSize(size)}</span>}
        </div>
        {overlay}
      </div>
    );
  }

  const isVideo = kind === 'video';
  // 容器尺寸与完成态**同源同算法**：ImageMessage / VideoMessage 用的是
  // calculateDisplaySize(image_width, image_height, 各自的 MAX)，而那两个数与这里的
  // width/height 都出自 utils/mediaDimensions.readMediaDimensions（同一个文件、同一次读法）。
  // 读不出尺寸时两边一起退到同一套默认值 —— 缺尺寸的那条路上也不会跳版。
  // 判定与 ImageMessage / VideoMessage 的 hasPresetDimensions 逐字同形
  const hasPresetDimensions = width && height && width > 0 && height > 0;
  const displaySize = hasPresetDimensions
    ? calculateDisplaySize(
      width,
      height,
      isVideo ? VIDEO_MAX_WIDTH : IMAGE_MAX_WIDTH,
      isVideo ? VIDEO_MAX_HEIGHT : IMAGE_MAX_HEIGHT,
    )
    : {
      width: isVideo ? VIDEO_DEFAULT_WIDTH : IMAGE_DEFAULT_WIDTH,
      height: isVideo ? VIDEO_DEFAULT_HEIGHT : IMAGE_DEFAULT_HEIGHT,
    };
  // 相册态照旧交给外层 grid（内联宽高会跟 grid 打架）
  const containerStyle: React.CSSProperties = displayVariant === 'album'
    ? { width: '100%', height: '100%' }
    : mediaContainerStyle(displaySize);

  return (
    <div
      className={`file-message ${isVideo ? 'video-message' : 'image-message'}`}
      style={containerStyle}
    >
      {previewUrl && (isVideo
        ? (
          // 完成态用的就是这个组件（`#t=0.1` 逼引擎 seek 出首帧）。把 blob 直接喂 <img>
          // 是画不出视频画面的 —— 那正是"上传中一个破图问号"的另一半成因。
          // 🔴 不传 fileHash：此刻文件还没上传、根本没有 file_hash，而 video_posters
          // 那张表的键就是它 ⇒ 不传即恒走 <video> 分支，不读也不写封面缓存。
          <VideoThumbnail src={previewUrl} className="message-video-thumbnail" decorative />
        )
        : (
          <img
            className="message-image"
            src={previewUrl}
            alt={name}
            draggable={false}
          />
        ))}
      {/* 播放角标：完成态的 VideoMessage 有，所以在途也必须有。
          验收口径是「上传中与上传完成**唯一**的差别是进度圈在不在」——少画一个角标
          就是第二处差别。它 `pointer-events: none`、只是装饰，不会让"还不能播的东西"变得可点；
          进度圈 z-index 3 盖在它上面，所以上传中看到的是"被遮罩压暗的角标 + 环"。
          （视觉上更干净的做法是上传中不画它，但那属于改验收口径，得 huanwei 拍板，不自造。） */}
      {isVideo && (
        <div className="video-play-overlay">
          <PlayIcon />
        </div>
      )}
      {overlay}
    </div>
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
  clientId,
  imageWidth,
  imageHeight,
  displayVariant = 'bubble',
}: FileMessageContentProps) {
  // 在途发送项（clientId 有值且还在 store 里）⇒ 走本地预览 + 覆盖层。
  // Hook 必须在所有早返回之前无条件调用；clientId 为 undefined 时选择器直接给 undefined。
  const sendingEntry = useSendingMediaState(clientId);

  // 从消息内容中提取文件名
  const filename = messageContent.replace(/^\[(图片|视频|文件)\]\s*/, '');

  if (sendingEntry) {
    return <SendingMediaMessage entry={sendingEntry} displayVariant={displayVariant} />;
  }

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
          displayVariant={displayVariant}
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
          displayVariant={displayVariant}
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

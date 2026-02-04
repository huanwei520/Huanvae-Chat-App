/**
 * 移动端媒体预览组件
 *
 * 由于移动端不支持 WebviewWindow 多窗口，
 * 使用全屏模态框实现图片和视频的预览功能
 *
 * 功能：
 * - 全屏显示图片/视频
 * - 支持双指缩放手势（图片）
 * - 点击背景关闭
 * - 顶部关闭按钮
 * - 底部操作栏：
 *   - 下载中：显示进度条（与视频缓存进度同步）
 *   - 下载完成：显示保存按钮（保存到相册）
 * - 阻止长按触发底层消息气泡的右键菜单
 *
 * @since 2024-01
 * @updated 2026-02-04 添加保存到相册功能，修复长按穿透问题
 * @updated 2026-02-04 添加下载进度条，与视频缓存进度同步显示
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMobileBackHandler } from '../../hooks/useMobileBackHandler';
import { saveToGallery } from '../../utils/saveToGallery';

// 调试日志（Android logcat 不支持 %c 样式，使用 JSON.stringify 显示对象）
function logMedia(action: string, data?: unknown) {
  const dataStr = data ? JSON.stringify(data, null, 0) : '';
  // eslint-disable-next-line no-console
  console.log(`[MobileMedia] ${action}`, dataStr);
}

export interface MobileMediaPreviewProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 媒体类型 */
  type: 'image' | 'video';
  /** 媒体源 URL */
  src: string;
  /** 文件名 */
  filename: string;
  /** 本地文件路径（用于保存到相册） */
  localPath?: string | null;
  /** 下载进度百分比 (0-100)，用于显示进度条 */
  downloadProgress?: number;
  /** 是否正在下载 */
  isDownloading?: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 关闭图标
 */
function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      width={24}
      height={24}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}

/**
 * 保存图标
 */
function SaveIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      width={20}
      height={20}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  );
}

export function MobileMediaPreview({
  isOpen,
  type,
  src,
  filename,
  localPath,
  downloadProgress = 0,
  isDownloading = false,
  onClose,
}: MobileMediaPreviewProps) {
  // 视频/图片加载状态
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorInfo, setErrorInfo] = useState<string | null>(null);
  // 保存状态
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  // 移动端返回手势处理：预览打开时拦截返回操作
  useMobileBackHandler(() => {
    if (isOpen) {
      logMedia('返回手势关闭预览');
      onClose();
      return true; // 已处理，不继续传递
    }
    return false; // 未打开，不处理
  });

  // 调试：打印媒体信息
  useEffect(() => {
    if (isOpen) {
      logMedia('预览打开', {
        type,
        filename,
        src: src.substring(0, 100) + (src.length > 100 ? '...' : ''),
        srcLength: src.length,
        isAssetProtocol: src.startsWith('asset://'),
        isHttps: src.startsWith('https://'),
        isHttp: src.startsWith('http://'),
        isBlob: src.startsWith('blob:'),
        isDataUrl: src.startsWith('data:'),
      });
      setLoadState('loading');
      setErrorInfo(null);
    }
  }, [isOpen, type, src, filename]);

  // 禁止背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isOpen]);

  // 点击背景关闭
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // 视频事件处理
  const handleVideoLoadStart = useCallback(() => {
    logMedia('视频 loadstart - 开始加载');
    setLoadState('loading');
  }, []);

  const handleVideoLoadedMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    logMedia('视频 loadedmetadata - 元数据加载完成', {
      duration: video.duration,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      readyState: video.readyState,
      networkState: video.networkState,
    });
  }, []);

  const handleVideoCanPlay = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    logMedia('视频 canplay - 可以播放', {
      currentTime: video.currentTime,
      readyState: video.readyState,
      paused: video.paused,
    });
    setLoadState('ready');
  }, []);

  const handleVideoPlaying = useCallback(() => {
    logMedia('视频 playing - 正在播放');
  }, []);

  const handleVideoError = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    const error = video.error;

    // MediaError code 含义
    const errorCodeMap: Record<number, string> = {
      1: 'MEDIA_ERR_ABORTED - 用户中止',
      2: 'MEDIA_ERR_NETWORK - 网络错误',
      3: 'MEDIA_ERR_DECODE - 解码错误',
      4: 'MEDIA_ERR_SRC_NOT_SUPPORTED - 格式不支持',
    };

    const errorDetail = {
      code: error?.code,
      codeName: error?.code ? errorCodeMap[error.code] : 'Unknown',
      message: error?.message || 'No message',
      networkState: video.networkState,
      readyState: video.readyState,
      src: src.substring(0, 100),
    };

    logMedia('视频 error - 加载失败', errorDetail);
    setLoadState('error');
    setErrorInfo(`${errorCodeMap[error?.code ?? 0] || '未知错误'}: ${error?.message || ''}`);
  }, [src]);

  const handleVideoStalled = useCallback(() => {
    logMedia('视频 stalled - 数据获取停滞');
  }, []);

  const handleVideoWaiting = useCallback(() => {
    logMedia('视频 waiting - 等待数据');
  }, []);

  // 图片事件处理
  const handleImageLoad = useCallback(() => {
    logMedia('图片 load - 加载完成');
    setLoadState('ready');
  }, []);

  const handleImageError = useCallback(() => {
    logMedia('图片 error - 加载失败', { src: src.substring(0, 100) });
    setLoadState('error');
    setErrorInfo('图片加载失败');
  }, [src]);

  // 保存到相册
  const handleSaveToGallery = useCallback(async () => {
    if (!localPath) {
      logMedia('保存失败 - 无本地路径');
      return;
    }

    setSaveStatus('saving');
    logMedia('开始保存到相册', { localPath, type });

    const result = await saveToGallery(localPath, type);

    if (result.success) {
      logMedia('保存成功', { savedPath: result.savedPath });
      setSaveStatus('success');
      // 2秒后重置状态
      setTimeout(() => setSaveStatus('idle'), 2000);
    } else {
      logMedia('保存失败', { message: result.message });
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }
  }, [localPath, type]);

  // 阻止长按触发上下文菜单（解决穿透问题）
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // 阻止事件冒泡，防止触发底层消息气泡的长按菜单
    e.stopPropagation();
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // 阻止右键菜单
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // 重置保存状态
  useEffect(() => {
    if (!isOpen) {
      setSaveStatus('idle');
    }
  }, [isOpen]);

  const content = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="mobile-media-preview-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={handleBackdropClick}
          onTouchStart={handleTouchStart}
          onContextMenu={handleContextMenu}
        >
          {/* 顶部栏 */}
          <div className="mobile-media-preview-header">
            <button
              className="mobile-media-preview-close"
              onClick={onClose}
              type="button"
            >
              <CloseIcon />
            </button>
            <span className="mobile-media-preview-title">{filename}</span>
          </div>

          {/* 媒体内容 */}
          <div className="mobile-media-preview-content">
            {/* 加载状态指示 */}
            {loadState === 'loading' && (
              <div className="mobile-media-preview-loading">
                <span>加载中...</span>
              </div>
            )}

            {/* 错误状态显示 */}
            {loadState === 'error' && (
              <div className="mobile-media-preview-error">
                <span>加载失败</span>
                {errorInfo && <span className="error-detail">{errorInfo}</span>}
                <span className="error-src">src: {src.substring(0, 50)}...</span>
              </div>
            )}

            {type === 'image' ? (
              <motion.img
                src={src}
                alt={filename}
                className="mobile-media-preview-image"
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.9 }}
                transition={{ duration: 0.2 }}
                onLoad={handleImageLoad}
                onError={handleImageError}
                style={{ display: loadState === 'error' ? 'none' : 'block' }}
              />
            ) : (
              <motion.video
                src={src}
                className="mobile-media-preview-video"
                controls
                autoPlay
                playsInline
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.9 }}
                transition={{ duration: 0.2 }}
                onLoadStart={handleVideoLoadStart}
                onLoadedMetadata={handleVideoLoadedMetadata}
                onCanPlay={handleVideoCanPlay}
                onPlaying={handleVideoPlaying}
                onError={handleVideoError}
                onStalled={handleVideoStalled}
                onWaiting={handleVideoWaiting}
                style={{ display: loadState === 'error' ? 'none' : 'block' }}
              />
            )}
          </div>

          {/* 底部操作栏 - 下载进度条或保存按钮 */}
          <div className="mobile-media-preview-actions">
            {/* eslint-disable-next-line no-nested-ternary */}
            {isDownloading ? (
              /* 下载中：显示进度条 */
              <div className="mobile-media-preview-progress">
                <div className="progress-bar-container">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${Math.min(downloadProgress, 100)}%` }}
                  />
                </div>
                <span className="progress-text">
                  缓存中 {Math.round(downloadProgress)}%
                </span>
              </div>
            ) : localPath ? (
              /* 下载完成：显示保存按钮 */
              <button
                className={`mobile-media-preview-save-btn ${saveStatus}`}
                onClick={handleSaveToGallery}
                disabled={saveStatus === 'saving'}
                type="button"
              >
                <SaveIcon />
                <span>
                  {saveStatus === 'idle' && '保存'}
                  {saveStatus === 'saving' && '保存中...'}
                  {saveStatus === 'success' && '已保存'}
                  {saveStatus === 'error' && '保存失败'}
                </span>
              </button>
            ) : null}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // 使用 Portal 渲染到 body
  return createPortal(content, document.body);
}

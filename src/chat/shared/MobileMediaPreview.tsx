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
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMobileBackHandler } from '../../hooks/useMobileBackHandler';

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

export function MobileMediaPreview({
  isOpen,
  type,
  src,
  filename,
  onClose,
}: MobileMediaPreviewProps) {
  // 视频/图片加载状态
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorInfo, setErrorInfo] = useState<string | null>(null);

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
        </motion.div>
      )}
    </AnimatePresence>
  );

  // 使用 Portal 渲染到 body
  return createPortal(content, document.body);
}

/**
 * 文件缓存 Hook
 *
 * 为 React 组件提供文件缓存功能的便捷接口
 * 自动处理本地优先加载和后台缓存
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useApi } from '../contexts/SessionContext';
import { useFileCacheStore, selectDownloadTask } from '../stores/fileCacheStore';
import {
  getFileSource,
  triggerBackgroundDownload,
  getFileTypeFromMime,
  startProgressListener,
  type FileSourceResult,
} from '../services/fileCache';

// ============================================
// 类型定义
// ============================================

export interface UseFileCacheOptions {
  /** 文件 UUID */
  fileUuid: string;
  /** 文件哈希（用于本地缓存） */
  fileHash?: string | null;
  /** 文件名 */
  fileName: string;
  /** 文件类型 */
  fileType?: 'image' | 'video' | 'document';
  /** 内容类型（MIME） */
  contentType?: string;
  /** 文件大小 */
  fileSize?: number;
  /** URL 类型 */
  urlType?: 'user' | 'friend' | 'group';
  /** 是否自动缓存图片 */
  autoCache?: boolean;
  /** 是否启用（用于条件加载） */
  enabled?: boolean;
}

export interface UseFileCacheResult {
  /** 文件源 URL（可直接用于 img/video src） */
  src: string | null;
  /** 是否来自本地缓存 */
  isLocal: boolean;
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 本地路径（如果有） */
  localPath: string | null;
  /** 手动触发缓存 */
  cacheFile: () => Promise<void>;
  /** 重新加载 */
  reload: () => void;
}

// ============================================
// Hook 实现
// ============================================

/**
 * 文件缓存 Hook
 *
 * @example
 * ```tsx
 * const { src, isLocal, loading } = useFileCache({
 *   fileUuid: message.file_uuid,
 *   fileHash: message.file_hash,
 *   fileName: message.message_content,
 *   urlType: 'friend',
 *   autoCache: true,
 * });
 *
 * return <img src={src} />;
 * ```
 */
export function useFileCache(options: UseFileCacheOptions): UseFileCacheResult {
  const {
    fileUuid,
    fileHash,
    fileName,
    fileType: explicitFileType,
    contentType,
    fileSize,
    urlType = 'user',
    autoCache = true,
    enabled = true,
  } = options;

  const api = useApi();
  const [result, setResult] = useState<FileSourceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 用于避免重复下载
  const downloadTriggeredRef = useRef(false);

  // 监听下载任务状态
  const downloadTask = useFileCacheStore(selectDownloadTask(fileHash ?? ''));

  // 确定文件类型
  const fileType = explicitFileType ?? (contentType ? getFileTypeFromMime(contentType) : 'document');

  // 加载文件源
  const loadSource = useCallback(async () => {
    if (!enabled || !fileUuid) { return; }

    setLoading(true);
    setError(null);

    try {
      // 启动进度监听器（全局只需启动一次）
      startProgressListener();

      const source = await getFileSource(api, fileUuid, fileHash, urlType);
      setResult(source);

      // 如果是远程文件且需要自动缓存，标记需要下载
      if (!source.isLocal && autoCache && fileHash && fileType === 'image') {
        downloadTriggeredRef.current = false; // 重置，等待图片加载完成
      }
    } catch (err) {
      setError(String(err));
      console.error('[useFileCache] 加载失败:', err);
    } finally {
      setLoading(false);
    }
  }, [api, fileUuid, fileHash, urlType, enabled, autoCache, fileType]);

  // 初始加载
  useEffect(() => {
    loadSource();
  }, [loadSource]);

  // 如果下载完成，更新结果
  useEffect(() => {
    if (downloadTask?.status === 'completed' && downloadTask.localPath) {
      setResult({
        src: convertFileSrc(downloadTask.localPath),
        isLocal: true,
        fileHash: fileHash ?? undefined,
        localPath: downloadTask.localPath,
      });
    }
  }, [downloadTask?.status, downloadTask?.localPath, fileHash]);

  // 手动触发缓存
  const cacheFile = useCallback(async () => {
    if (!result || result.isLocal || !fileHash || downloadTriggeredRef.current) {
      return;
    }

    downloadTriggeredRef.current = true;

    await triggerBackgroundDownload(
      result.src,
      fileHash,
      fileName,
      fileType,
      fileSize,
    );
  }, [result, fileHash, fileName, fileType, fileSize]);

  // 重新加载
  const reload = useCallback(() => {
    downloadTriggeredRef.current = false;
    loadSource();
  }, [loadSource]);

  return {
    src: result?.src ?? null,
    isLocal: result?.isLocal ?? false,
    loading,
    error,
    localPath: result?.localPath ?? null,
    cacheFile,
    reload,
  };
}

// ============================================
// 简化版 Hook（图片专用）
// ============================================

/**
 * 图片缓存 Hook（自动缓存）
 *
 * @example
 * ```tsx
 * const { src, isLocal, onLoad } = useImageCache(fileUuid, fileHash, fileName);
 * return <img src={src} onLoad={onLoad} />;
 * ```
 */
export function useImageCache(
  fileUuid: string,
  fileHash: string | null | undefined,
  fileName: string,
  urlType: 'user' | 'friend' | 'group' = 'user',
) {
  const result = useFileCache({
    fileUuid,
    fileHash,
    fileName,
    fileType: 'image',
    urlType,
    autoCache: true,
  });

  // 图片加载完成后触发缓存
  const onLoad = useCallback(() => {
    if (!result.isLocal && fileHash) {
      result.cacheFile();
    }
  }, [result, fileHash]);

  return {
    ...result,
    onLoad,
  };
}

/**
 * 视频缓存 Hook（播放时缓存）
 *
 * @example
 * ```tsx
 * const { src, isLocal, onPlay } = useVideoCache(fileUuid, fileHash, fileName);
 * return <video src={src} onPlay={onPlay} />;
 * ```
 */
export function useVideoCache(
  fileUuid: string,
  fileHash: string | null | undefined,
  fileName: string,
  fileSize?: number,
  urlType: 'user' | 'friend' | 'group' = 'user',
) {
  const result = useFileCache({
    fileUuid,
    fileHash,
    fileName,
    fileType: 'video',
    fileSize,
    urlType,
    autoCache: false, // 视频不自动缓存
  });

  // 播放时触发缓存
  const onPlay = useCallback(() => {
    if (!result.isLocal && fileHash) {
      result.cacheFile();
    }
  }, [result, fileHash]);

  return {
    ...result,
    onPlay,
  };
}

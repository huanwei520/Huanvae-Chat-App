/**
 * 文件缓存 Hook
 *
 * 为 React 组件提供文件缓存功能的便捷接口：
 * - 本地优先加载（检查 file_mappings 表）
 * - 远程文件自动缓存到 data/file/{type}/ 目录
 * - 图片加载完成后自动缓存
 * - 视频播放时后台缓存
 *
 * 缓存流程：
 * 1. getFileSource() 检查本地缓存
 * 2. 无缓存则获取预签名 URL
 * 3. 图片 onLoad / 视频 onPlay 触发 cacheFile()
 * 4. triggerBackgroundDownload() 调用 Rust 下载
 * 5. 保存到 data/file/{type}/ 并更新 file_mappings 表
 * 6. 显示 LocalBadge 标识
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
// 调试日志
// ============================================

const DEBUG = true;

function logCache(action: string, data?: unknown) {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`%c[FileCache] ${action}`, 'color: #9C27B0; font-weight: bold', data ?? '');
  }
}

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

  // 保存最新的 result 和 fileHash，供回调使用
  const resultRef = useRef<FileSourceResult | null>(null);
  const fileHashRef = useRef<string | null | undefined>(fileHash);

  // 同步更新 ref
  resultRef.current = result;
  fileHashRef.current = fileHash;

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

      logCache('加载文件源', { fileUuid, fileHash, urlType });
      const source = await getFileSource(api, fileUuid, fileHash, urlType);
      setResult(source);

      logCache('文件源加载完成', {
        fileUuid,
        isLocal: source.isLocal,
        hasLocalPath: !!source.localPath,
      });

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
      logCache('下载完成，更新为本地路径', {
        fileHash,
        localPath: downloadTask.localPath,
      });
      setResult({
        src: convertFileSrc(downloadTask.localPath),
        isLocal: true,
        fileHash: fileHash ?? undefined,
        localPath: downloadTask.localPath,
      });
    }
  }, [downloadTask?.status, downloadTask?.localPath, fileHash]);

  // 手动触发缓存（使用 ref 获取最新值）
  const cacheFile = useCallback(async () => {
    const currentResult = resultRef.current;
    const currentFileHash = fileHashRef.current;

    if (!currentResult || currentResult.isLocal || !currentFileHash || downloadTriggeredRef.current) {
      logCache('跳过缓存', {
        hasResult: !!currentResult,
        isLocal: currentResult?.isLocal,
        hasFileHash: !!currentFileHash,
        alreadyTriggered: downloadTriggeredRef.current,
      });
      return;
    }

    downloadTriggeredRef.current = true;
    logCache('触发后台下载', { fileHash: currentFileHash, fileName, fileType });

    await triggerBackgroundDownload(
      currentResult.src,
      currentFileHash,
      fileName,
      fileType,
      fileSize,
    );
  }, [fileName, fileType, fileSize]);

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
 * 图片加载完成后自动触发后台缓存到 data/file/pictures/
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

  // 保存最新的 cacheFile 和状态
  const cacheFileRef = useRef(result.cacheFile);
  const isLocalRef = useRef(result.isLocal);
  const fileHashRef = useRef(fileHash);

  // 同步更新 ref
  cacheFileRef.current = result.cacheFile;
  isLocalRef.current = result.isLocal;
  fileHashRef.current = fileHash;

  // 图片加载完成后触发缓存（使用 ref 避免依赖问题）
  const onLoad = useCallback(() => {
    logCache('图片 onLoad 触发', {
      fileHash: fileHashRef.current,
      isLocal: isLocalRef.current,
    });

    if (!isLocalRef.current && fileHashRef.current) {
      cacheFileRef.current();
    }
  }, []);

  return {
    ...result,
    onLoad,
  };
}

/**
 * 视频缓存 Hook（播放时缓存）
 *
 * 视频开始播放时触发后台缓存到 data/file/videos/
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
    autoCache: false, // 视频不自动缓存，等待播放
  });

  // 保存最新的 cacheFile 和状态
  const cacheFileRef = useRef(result.cacheFile);
  const isLocalRef = useRef(result.isLocal);
  const fileHashRef = useRef(fileHash);

  // 同步更新 ref
  cacheFileRef.current = result.cacheFile;
  isLocalRef.current = result.isLocal;
  fileHashRef.current = fileHash;

  // 播放时触发缓存（使用 ref 避免依赖问题）
  const onPlay = useCallback(() => {
    logCache('视频 onPlay 触发', {
      fileHash: fileHashRef.current,
      isLocal: isLocalRef.current,
    });

    if (!isLocalRef.current && fileHashRef.current) {
      cacheFileRef.current();
    }
  }, []);

  return {
    ...result,
    onPlay,
  };
}

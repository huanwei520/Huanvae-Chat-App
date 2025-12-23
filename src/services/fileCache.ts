/**
 * 文件缓存服务
 *
 * 提供文件本地缓存的核心功能：
 * - 检查本地缓存
 * - 获取预签名 URL
 * - 下载并保存文件
 * - 获取文件源（本地优先）
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { ApiClient } from '../api/client';
import { useFileCacheStore } from '../stores/fileCacheStore';

// ============================================
// 类型定义
// ============================================

/** 下载进度事件 */
interface DownloadProgressEvent {
  fileHash: string;
  downloaded: number;
  total: number;
  percent: number;
  status: 'downloading' | 'completed' | 'failed';
}

/** 预签名 URL 响应 */
interface PresignedUrlResponse {
  presigned_url: string;
  expires_at: string;
  file_uuid: string;
  file_size: number;
  content_type: string;
}

/** 文件源结果 */
export interface FileSourceResult {
  /** 可用于加载的 URL（本地或远程） */
  src: string;
  /** 是否来自本地缓存 */
  isLocal: boolean;
  /** 文件哈希 */
  fileHash?: string;
  /** 本地路径（如果有） */
  localPath?: string;
}

// ============================================
// Tauri 命令封装
// ============================================

/**
 * 检查文件是否已缓存
 */
export async function isFileCached(fileHash: string): Promise<boolean> {
  try {
    return await invoke<boolean>('is_file_cached', { fileHash });
  } catch (error) {
    console.error('[FileCache] 检查缓存失败:', error);
    return false;
  }
}

/**
 * 获取已缓存文件的本地路径
 */
export async function getCachedFilePath(fileHash: string): Promise<string | null> {
  try {
    return await invoke<string | null>('get_cached_file_path', { fileHash });
  } catch {
    return null;
  }
}

/**
 * 下载文件并保存到本地
 */
export async function downloadAndSaveFile(
  url: string,
  fileHash: string,
  fileName: string,
  fileType: 'image' | 'video' | 'document',
  fileSize?: number,
): Promise<string> {
  return invoke<string>('download_and_save_file', {
    url,
    fileHash,
    fileName,
    fileType,
    fileSize: fileSize ?? null,
  });
}

// ============================================
// 预签名 URL 获取
// ============================================

/**
 * 获取预签名 URL（带缓存）
 */
export async function getPresignedUrl(
  api: ApiClient,
  fileUuid: string,
  urlType: 'user' | 'friend' | 'group' = 'user',
): Promise<{ url: string; expiresAt: string }> {
  const store = useFileCacheStore.getState();

  // 1. 检查缓存
  const cached = store.getUrlCache(fileUuid);
  if (cached) {
    console.log('[FileCache] 使用缓存的预签名 URL:', fileUuid);
    return { url: cached.url, expiresAt: cached.expiresAt };
  }

  // 2. 请求新的预签名 URL
  let endpoint: string;
  switch (urlType) {
    case 'friend':
      endpoint = `/api/storage/friends_file/${fileUuid}/presigned_url`;
      break;
    case 'group':
      endpoint = `/api/storage/file/${fileUuid}/presigned_url`; // 群文件也用这个
      break;
    default:
      endpoint = `/api/storage/file/${fileUuid}/presigned_url`;
  }

  const response = await api.post<PresignedUrlResponse>(endpoint, {
    operation: 'preview',
  });

  // 3. 缓存 URL
  store.setUrlCache(fileUuid, response.presigned_url, response.expires_at);

  console.log('[FileCache] 获取新的预签名 URL:', fileUuid);
  return { url: response.presigned_url, expiresAt: response.expires_at };
}

// ============================================
// 核心功能：获取文件源
// ============================================

/**
 * 获取文件源（本地优先）
 *
 * 工作流程：
 * 1. 检查本地缓存
 * 2. 无本地缓存则获取预签名 URL
 * 3. 返回可用的 src
 */
export async function getFileSource(
  api: ApiClient,
  fileUuid: string,
  fileHash: string | null | undefined,
  urlType: 'user' | 'friend' | 'group' = 'user',
): Promise<FileSourceResult> {
  const store = useFileCacheStore.getState();

  // 1. 如果有 fileHash，先检查内存缓存
  if (fileHash) {
    const cachedPath = store.getLocalPath(fileHash);
    if (cachedPath) {
      return {
        src: convertFileSrc(cachedPath),
        isLocal: true,
        fileHash,
        localPath: cachedPath,
      };
    }

    // 2. 检查数据库缓存
    const localPath = await getCachedFilePath(fileHash);
    if (localPath) {
      // 更新内存缓存
      store.setLocalPath(fileHash, localPath);
      return {
        src: convertFileSrc(localPath),
        isLocal: true,
        fileHash,
        localPath,
      };
    }
  }

  // 3. 无本地缓存，获取预签名 URL
  const { url } = await getPresignedUrl(api, fileUuid, urlType);
  return {
    src: url,
    isLocal: false,
    fileHash: fileHash ?? undefined,
  };
}

/**
 * 获取文件源并自动缓存（图片专用）
 *
 * 图片加载完成后自动下载保存到本地
 */
export async function getFileSourceWithAutoCache(
  api: ApiClient,
  fileUuid: string,
  fileHash: string | null | undefined,
  fileName: string,
  fileType: 'image' | 'video' | 'document',
  urlType: 'user' | 'friend' | 'group' = 'user',
): Promise<FileSourceResult & { shouldCache: boolean; presignedUrl?: string }> {
  const result = await getFileSource(api, fileUuid, fileHash, urlType);

  if (result.isLocal) {
    // 已有本地缓存，无需下载
    return { ...result, shouldCache: false };
  }

  // 需要下载缓存
  return {
    ...result,
    shouldCache: !!fileHash,
    presignedUrl: result.src,
  };
}

/**
 * 触发后台下载（图片加载完成后调用）
 */
export async function triggerBackgroundDownload(
  presignedUrl: string,
  fileHash: string,
  fileName: string,
  fileType: 'image' | 'video' | 'document',
  fileSize?: number,
): Promise<void> {
  const store = useFileCacheStore.getState();

  // 检查是否已在下载
  const existingTask = store.downloadTasks[fileHash];
  if (existingTask && existingTask.status !== 'failed') {
    return; // 已在下载中或已完成
  }

  // 添加下载任务
  store.addDownloadTask({
    fileHash,
    fileName,
    fileType,
    total: fileSize ?? 0,
  });

  try {
    const localPath = await downloadAndSaveFile(
      presignedUrl,
      fileHash,
      fileName,
      fileType,
      fileSize,
    );
    store.completeDownload(fileHash, localPath);
    console.log('[FileCache] 后台下载完成:', fileName);
  } catch (error) {
    store.failDownload(fileHash, String(error));
    console.error('[FileCache] 后台下载失败:', error);
  }
}

// ============================================
// 事件监听
// ============================================

let unlistenProgress: UnlistenFn | null = null;

/**
 * 开始监听下载进度事件
 */
export async function startProgressListener(): Promise<void> {
  if (unlistenProgress) { return; }

  unlistenProgress = await listen<DownloadProgressEvent>('download-progress', (event) => {
    const { fileHash, downloaded, total, percent, status } = event.payload;
    const store = useFileCacheStore.getState();

    if (status === 'downloading') {
      store.updateDownloadProgress(fileHash, downloaded, total, percent);
    }
    // completed 和 failed 由 triggerBackgroundDownload 处理
  });

  console.log('[FileCache] 下载进度监听已启动');
}

/**
 * 停止监听下载进度事件
 */
export function stopProgressListener(): void {
  if (unlistenProgress) {
    unlistenProgress();
    unlistenProgress = null;
    console.log('[FileCache] 下载进度监听已停止');
  }
}

// ============================================
// 工具函数
// ============================================

/**
 * 根据 MIME 类型判断文件类型
 */
export function getFileTypeFromMime(contentType: string): 'image' | 'video' | 'document' {
  if (contentType.startsWith('image/')) { return 'image'; }
  if (contentType.startsWith('video/')) { return 'video'; }
  return 'document';
}

/**
 * 清理过期的 URL 缓存
 */
export function clearExpiredUrlCache(): void {
  useFileCacheStore.getState().clearExpiredUrls();
}

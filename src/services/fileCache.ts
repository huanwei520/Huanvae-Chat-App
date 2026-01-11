/**
 * 文件缓存服务
 *
 * 统一本地缓存方案的核心服务层，所有文件统一缓存到：
 * data/{用户名}_{服务器}/file/{pictures|videos|documents}/
 *
 * 功能：
 * - 检查本地缓存（file_mappings 表，后端验证文件存在性）
 * - 获取预签名 URL（带内存缓存，有时效性）
 * - 下载并保存文件到统一目录
 * - 获取文件源（本地优先，无缓存则获取远程 URL）
 *
 * 缓存入口：
 * 1. 用户上传文件 → copy_file_to_cache → 复制到缓存目录
 * 2. 图片加载完成 → triggerBackgroundDownload → 下载到缓存目录
 * 3. 视频开始播放 → triggerBackgroundDownload → 下载到缓存目录
 *
 * 文件命名规则：{hash前8位}_{原始文件名}
 *
 * 大文件优化（≥用户设置阈值，默认100MB）：
 * - 上传时不复制到缓存目录，记录 original_path
 * - 读取时优先使用 original_path
 * - 若 original_path 失效（文件被移动/删除），自动从服务器下载到缓存目录
 *
 * 缓存策略：
 * - 本地文件路径：每次从数据库查询（后端验证文件存在性，约 1-5ms）
 * - 预签名 URL：内存缓存，提前 5 分钟失效
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { ApiClient } from '../api/client';
import { useFileCacheStore } from '../stores/fileCacheStore';
import {
  reportFriendPermissionError,
  createPresignedUrlErrorContext,
} from './diagnosticService';

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
export function downloadAndSaveFile(
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
 *
 * 当好友文件访问返回403时，自动上报诊断日志到后端
 */
export async function getPresignedUrl(
  api: ApiClient,
  fileUuid: string,
  urlType: 'user' | 'friend' | 'group' = 'user',
  options?: {
    friendId?: string;
    fileType?: 'image' | 'video' | 'document';
  },
): Promise<{ url: string; expiresAt: string }> {
  const store = useFileCacheStore.getState();

  // 1. 检查缓存
  const cached = store.getUrlCache(fileUuid);
  if (cached) {
    // eslint-disable-next-line no-console
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

  // eslint-disable-next-line no-console
  console.log('[FileCache] 请求预签名 URL:', { fileUuid, urlType, endpoint });

  try {
    const response = await api.post<PresignedUrlResponse>(endpoint, {
      operation: 'preview',
    });

    // 3. 缓存 URL
    store.setUrlCache(fileUuid, response.presigned_url, response.expires_at);

    // eslint-disable-next-line no-console
    console.log('[FileCache] 获取新的预签名 URL:', fileUuid);
    return { url: response.presigned_url, expiresAt: response.expires_at };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // 好友文件403错误：上报诊断日志（图片/视频/文件都上报）
    if (urlType === 'friend' && errorMessage.includes('403')) {
      // 异步上报，不阻塞主流程
      reportFriendPermissionError(
        api.getBaseUrl(),
        api.getAccessToken(),
        createPresignedUrlErrorContext(fileUuid, errorMessage, {
          operation: 'preview',
          urlType,
          friendId: options?.friendId,
          fileType: options?.fileType,
          screen: 'chat_detail',
          action: 'get_presigned_url',
        }),
      ).catch(() => {
        // 上报失败静默处理
      });
    }

    // 重新抛出错误
    throw error;
  }
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
 *
 * @param api - API 客户端
 * @param fileUuid - 文件 UUID
 * @param fileHash - 文件哈希（用于本地缓存查找）
 * @param urlType - URL 类型（用于选择正确的预签名端点）
 * @param options - 额外选项（用于错误上报）
 */
export async function getFileSource(
  api: ApiClient,
  fileUuid: string,
  fileHash: string | null | undefined,
  urlType: 'user' | 'friend' | 'group' = 'user',
  options?: {
    /** 好友 ID（用于错误上报） */
    friendId?: string;
    /** 文件类型（用于错误上报） */
    fileType?: 'image' | 'video' | 'document';
  },
): Promise<FileSourceResult> {
  // 1. 如果有 fileHash，检查数据库缓存
  // 后端 get_cached_file_path 会验证文件存在性，无效则返回 null
  if (fileHash) {
    const localPath = await getCachedFilePath(fileHash);
    if (localPath) {
      return {
        src: convertFileSrc(localPath),
        isLocal: true,
        fileHash,
        localPath,
      };
    }
  }

  // 2. 无本地缓存，获取预签名 URL（传递选项用于错误上报）
  const { url } = await getPresignedUrl(api, fileUuid, urlType, options);
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
  _fileName: string,
  _fileType: 'image' | 'video' | 'document',
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
 * 触发后台下载（图片 onLoad / 视频 onPlay 时调用）
 *
 * 将远程文件下载并保存到本地缓存目录：
 * data/{用户名}_{服务器}/file/{pictures|videos|documents}/
 */
export async function triggerBackgroundDownload(
  presignedUrl: string,
  fileHash: string,
  fileName: string,
  fileType: 'image' | 'video' | 'document',
  fileSize?: number,
): Promise<void> {
  const store = useFileCacheStore.getState();

  // eslint-disable-next-line no-console
  console.log('%c[FileCache] triggerBackgroundDownload 被调用', 'color: #9C27B0; font-weight: bold', {
    fileHash,
    fileName,
    fileType,
    fileSize,
  });

  // 检查是否已在下载
  const existingTask = store.downloadTasks[fileHash];
  if (existingTask && existingTask.status !== 'failed') {
    // eslint-disable-next-line no-console
    console.log('[FileCache] 跳过：任务已存在', { status: existingTask.status });
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
    // eslint-disable-next-line no-console
    console.log('[FileCache] 开始后台下载...', { fileName });

    const localPath = await downloadAndSaveFile(
      presignedUrl,
      fileHash,
      fileName,
      fileType,
      fileSize,
    );
    store.completeDownload(fileHash, localPath);

    // eslint-disable-next-line no-console
    console.log('%c[FileCache] 后台下载完成', 'color: #4CAF50; font-weight: bold', {
      fileName,
      localPath,
    });
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
}

/**
 * 停止监听下载进度事件
 */
export function stopProgressListener(): void {
  if (unlistenProgress) {
    unlistenProgress();
    unlistenProgress = null;
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

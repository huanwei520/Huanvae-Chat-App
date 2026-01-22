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
 * - 跨窗口事件通知（下载完成时通知独立媒体窗口）
 * - 局域网优化（自动替换公网 URL 为局域网地址）
 *
 * 缓存入口：
 * 1. 用户上传文件 → copy_file_to_cache → 复制到缓存目录
 * 2. 图片加载完成 → triggerBackgroundDownload → 下载到缓存目录
 * 3. 视频点击播放 → triggerBackgroundDownload → 下载到缓存目录
 *
 * 跨窗口通信：
 * - 下载完成时发送 'file-download-completed' 事件
 * - 独立媒体窗口监听此事件，自动切换到本地文件
 *
 * 文件命名规则：{hash前8位}_{原始文件名}
 *
 * 大文件优化（≥用户设置阈值，默认100MB）：
 * - 上传时不复制到缓存目录，记录 original_path
 * - 读取时优先使用 original_path
 * - 若 original_path 失效（文件被移动/删除），自动从服务器下载到缓存目录
 *
 * URL 优化：
 * - 将公网预签名 URL 替换为当前登录的服务器地址
 * - 局域网登录时自动使用局域网直连（100MB: ~80秒 → ~1秒）
 * - 公网登录时保持公网访问
 *
 * 缓存策略：
 * - 本地文件路径：每次从数据库查询（后端验证文件存在性，约 1-5ms）
 * - 预签名 URL：内存缓存，提前 5 分钟失效
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { ApiClient } from '../api/client';
import { useFileCacheStore } from '../stores/fileCacheStore';
import {
  reportFriendPermissionError,
  createPresignedUrlErrorContext,
} from './diagnosticService';
import { optimizePresignedUrl } from '../utils/network';
import { isMobile } from '../utils/platform';

// ============================================
// Android asset URL 修复
// ============================================

/**
 * 修复 Android 上 convertFileSrc 返回的 URL
 *
 * 问题：Tauri 的 convertFileSrc 在 Android 上返回的 URL 路径被 URL 编码
 * 例如：http://asset.localhost/%2Fdata%2Fuser%2F0%2F...
 * 应该是：http://asset.localhost/data/user/0/...
 *
 * 这导致 video/audio 元素报告 MEDIA_ERR_SRC_NOT_SUPPORTED 错误
 */
export function fixAssetUrl(url: string): string {
  // 只在移动端处理
  if (!isMobile()) {
    return url;
  }

  // 检查是否是 asset 协议 URL（Android 上是 http://asset.localhost/...）
  if (url.startsWith('http://asset.localhost/')) {
    // 提取路径部分并解码
    const prefix = 'http://asset.localhost/';
    const encodedPath = url.substring(prefix.length);
    const decodedPath = decodeURIComponent(encodedPath);
    return prefix + decodedPath;
  }

  // 桌面端格式 asset://localhost/...
  if (url.startsWith('asset://localhost/')) {
    const prefix = 'asset://localhost/';
    const encodedPath = url.substring(prefix.length);
    const decodedPath = decodeURIComponent(encodedPath);
    return prefix + decodedPath;
  }

  return url;
}

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

/** 下载完成事件（跨窗口通知） */
export interface FileDownloadCompletedEvent {
  fileHash: string;
  localPath: string;
  fileName: string;
  fileType: 'image' | 'video' | 'document';
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

    // 3. 优化 URL（用当前服务器地址替换公网域名）
    const optimizedUrl = optimizePresignedUrl(response.presigned_url, api.getBaseUrl());

    // 4. 缓存优化后的 URL
    store.setUrlCache(fileUuid, optimizedUrl, response.expires_at);

    // eslint-disable-next-line no-console
    console.log('[FileCache] 获取新的预签名 URL:', fileUuid);
    return { url: optimizedUrl, expiresAt: response.expires_at };
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
      // 使用 fixAssetUrl 修复 Android 上的 URL 编码问题
      const rawSrc = convertFileSrc(localPath);
      const src = fixAssetUrl(rawSrc);
      return {
        src,
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
 * 获取移动端本地视频的 HTTP URL
 *
 * 调用 Rust 端命令，如果视频已缓存，返回本地服务器 URL
 */
async function getLocalVideoUrl(fileHash: string): Promise<string | null> {
  if (!isMobile()) {
    return null;
  }
  try {
    const url = await invoke<string | null>('get_local_video_url', { fileHash });
    return url;
  } catch {
    return null;
  }
}

/**
 * 获取视频文件源（移动端优化版本）
 *
 * 移动端问题：Android WebView 无法通过 asset:// 协议播放本地视频
 * 解决方案：使用 Rust 端本地 HTTP 服务器提供视频文件
 *
 * @param api - API 客户端
 * @param fileUuid - 文件 UUID
 * @param fileHash - 文件哈希（用于缓存查找）
 * @param urlType - URL 类型
 * @param options - 额外选项
 */
export async function getVideoSource(
  api: ApiClient,
  fileUuid: string,
  fileHash: string | null | undefined,
  urlType: 'user' | 'friend' | 'group' = 'user',
  options?: {
    friendId?: string;
    fileType?: 'image' | 'video' | 'document';
  },
): Promise<FileSourceResult> {
  // 1. 移动端：优先尝试本地 HTTP 服务器
  if (isMobile() && fileHash) {
    const localVideoUrl = await getLocalVideoUrl(fileHash);
    if (localVideoUrl) {
      // eslint-disable-next-line no-console
      console.log('[FileCache] 使用移动端本地视频服务器:', localVideoUrl);
      return {
        src: localVideoUrl,
        isLocal: true,
        fileHash,
      };
    }
  }

  // 2. 无本地缓存或桌面端，获取预签名 URL
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

  // 检查本地是否已有缓存（避免 HMR 后重复触发）
  try {
    const cachedPath = await getCachedFilePath(fileHash);
    if (cachedPath) {
      // eslint-disable-next-line no-console
      console.log('[FileCache] 跳过：本地已有缓存', { cachedPath });
      // 直接标记为完成
      store.addDownloadTask({ fileHash, fileName, fileType, total: fileSize ?? 0 });
      store.completeDownload(fileHash, cachedPath);
      return;
    }
  } catch {
    // 忽略检查错误，继续下载
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

    // 发送跨窗口事件，通知所有窗口（包括独立媒体窗口）
    emit('file-download-completed', {
      fileHash,
      localPath,
      fileName,
      fileType,
    } as FileDownloadCompletedEvent);
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

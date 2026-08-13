/**
 * 文件上传 Hook
 *
 * 功能：
 * - SHA-256 采样哈希计算（小文件完整哈希，大文件采样哈希）
 * - 预签名分片上传到 MinIO
 * - 上传进度跟踪（使用 XMLHttpRequest 实现真实进度）
 * - 秒传支持（基于 UUID 映射）
 * - 自动重试机制
 *
 * 分片上传用 XMLHttpRequest(支持上传进度事件),经回环安全反代(http://127.0.0.1:<port>)转发到源站——
 * webview 原生 XHR 验不过私有 CA 自签 leaf 且连逻辑域名会触发 ICP/SNI 拦截,故必须经 secure_proxy 中转。
 * API 请求(请求上传 / 取分片预签名 URL / 确认)走 ApiClient(invoke secure_http,直连源站 IP)。
 */

import { useState, useCallback } from 'react';
import { useApi } from '../contexts/SessionContext';
import { formatFileSize } from '../utils/format';
import { optimizePresignedUrl } from '../utils/network';
import { proxyRequestUrl } from '../services/secureProxy';

// ============================================
// 类型定义
// ============================================

/** 文件类型枚举 */
export type FileType =
  | 'user_image'
  | 'user_video'
  | 'user_document'
  | 'friend_image'
  | 'friend_video'
  | 'friend_document'
  | 'group_image'
  | 'group_video'
  | 'group_document';

/** 存储位置枚举 */
export type StorageLocation =
  | 'user_files'
  | 'friend_messages'
  | 'group_files';

/** 上传请求参数 */
/**
 * 媒体组（相册）元数据
 *
 * 后端约束（storage/models/request.rs）：
 * - `count` 取值 2..10；`index` 取值 0..count-1
 * - `caption` **只允许**随 `index = 0` 那一项提交，其余位次带 caption 直接 400
 * - 三件套必须在 `upload/request` **与** `upload/confirm` 两处都带 ——
 *   非秒传路径的消息是在 confirm 那一步才建的，只在 request 带的话对非秒传分支无效
 */
export interface MediaGroupMeta {
  /** 组标识（客户端生成，同组各项共用） */
  id: string;
  /** 组内位次，0-based */
  index: number;
  /** 组内总数 */
  count: number;
}

export interface UploadRequestParams {
  file: File;
  fileType: FileType;
  storageLocation: StorageLocation;
  relatedId?: string; // 好友ID或群ID
  /** 相册元数据；单发时不传 */
  mediaGroup?: MediaGroupMeta;
  /**
   * 配文。两种合法用法（backend-docs/storage/文件存储管理.md `caption` 参数行）：
   * ① **不成组的单条**媒体消息可直接带（单图配文）；
   * ② 成组时**只在 `mediaGroup.index === 0` 那一项**传。挂到组内其它位次 → 后端 400。
   */
  caption?: string;
  /**
   * 逐次上传的进度回调。
   *
   * hook 自带的 `progress` state 是**单例**：串行上传 N 项时它只反映"当前这一项"，
   * 而类 Telegram 的发送态要求「每个媒体在自己的位置转圈」⇒ 调用方需要一条
   * 与自己那一项绑定的进度流。故这里给每次调用一个独立回调，
   * 与全局 `progress` 并行推送同样的值（不是二选一，两者同源）。
   */
  onProgress?: (progress: UploadProgress) => void;
  /**
   * 取消信号。粒度 = **分片边界**：只在开始下一个分片前检查，
   * 不中断已经在飞的那个 XHR（中断它需要把 xhr 实例透传出来，收益不抵复杂度）。
   * ⇒ 用户点取消后最长要等当前分片传完才真正停，UI 应显示"正在取消"而不是立刻消失。
   */
  signal?: AbortSignal;
}

/** 取消时抛出的错误信息 —— 调用方据此把"用户主动取消"与"真失败"分开 */
export const UPLOAD_CANCELLED = '上传已取消';

/** 上传进度信息 */
export interface UploadProgress {
  /** 上传百分比 0-100 */
  percent: number;
  /** 已上传字节数 */
  loaded: number;
  /** 总字节数 */
  total: number;
  /** 当前分片编号 */
  currentChunk: number;
  /** 总分片数 */
  totalChunks: number;
  /** 状态描述 */
  status: 'hashing' | 'requesting' | 'uploading' | 'confirming' | 'done' | 'error';
  /** 状态详情（如哈希采样进度、上传速度等） */
  statusDetail?: string;
}

/** 上传结果 */
export interface UploadResult {
  /** 是否成功 */
  success: boolean;
  /** 是否秒传 */
  instant: boolean;
  /** 文件访问 URL */
  fileUrl?: string;
  /** 文件 UUID */
  fileUuid?: string;
  /** 文件哈希（用于本地识别） */
  fileHash?: string;
  /** 消息 UUID（好友/群聊文件自动发送消息时返回） */
  messageUuid?: string;
  /** 消息发送时间 */
  messageSendTime?: string;
  /** 媒体宽度（图片/视频） */
  imageWidth?: number | null;
  /** 媒体高度（图片/视频） */
  imageHeight?: number | null;
  /** 错误信息 */
  error?: string;
}

/** 上传请求响应 */
interface UploadRequestResponse {
  mode: string;
  preview_support: string;
  multipart_upload_id: string | null;
  expires_in: number | null;
  chunk_size: number | null;
  total_chunks: number | null;
  file_key: string;
  max_file_size: number;
  instant_upload: boolean;
  existing_file_url: string | null;
  message_uuid?: string;
  message_send_time?: string;
}

/** 确认上传响应 */
interface ConfirmUploadResponse {
  file_url: string;
  file_key: string;
  file_size: number;
  content_type: string;
  preview_support: string;
  message_uuid?: string;
  message_send_time?: string;
}

// ============================================
// 常量
// ============================================

const SAMPLE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_CHUNK_SIZE = 30 * 1024 * 1024; // 30MB
const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 4000, 6000]; // 递增延迟

// ============================================
// 工具函数
// ============================================

/**
 * 计算文件 SHA-256 哈希（带进度回调）
 * - 小文件（< 30MB）：计算完整哈希
 * - 大文件（≥ 30MB）：采样哈希（文件大小 + 开头/中间/结尾各 10MB）
 */
async function calculateSHA256(
  file: File,
  onProgress?: (detail: string) => void,
): Promise<string> {
  // 文件大小信息（确保相同内容产生相同哈希）
  const sizeBuffer = new TextEncoder().encode(`|size:${file.size}|`);

  let dataToHash: Uint8Array;

  if (file.size <= SAMPLE_SIZE * 3) {
    // 小文件：计算完整哈希
    onProgress?.('读取文件数据...');
    const fileBuffer = new Uint8Array(await file.arrayBuffer());
    dataToHash = new Uint8Array(sizeBuffer.length + fileBuffer.length);
    dataToHash.set(sizeBuffer, 0);
    dataToHash.set(fileBuffer, sizeBuffer.length);
  } else {
    // 大文件：采样哈希策略
    const chunks: Uint8Array[] = [];

    // 读取开头 10MB
    onProgress?.('采样: 读取开头 10MB...');
    const startBlob = file.slice(0, SAMPLE_SIZE);
    chunks.push(new Uint8Array(await startBlob.arrayBuffer()));

    // 读取中间 10MB
    onProgress?.('采样: 读取中间 10MB...');
    const middleStart = Math.floor((file.size - SAMPLE_SIZE) / 2);
    const middleBlob = file.slice(middleStart, middleStart + SAMPLE_SIZE);
    chunks.push(new Uint8Array(await middleBlob.arrayBuffer()));

    // 读取结尾 10MB
    onProgress?.('采样: 读取结尾 10MB...');
    const endBlob = file.slice(file.size - SAMPLE_SIZE, file.size);
    chunks.push(new Uint8Array(await endBlob.arrayBuffer()));

    // 合并所有数据
    onProgress?.('合并采样数据...');
    const totalLength =
      sizeBuffer.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    dataToHash = new Uint8Array(totalLength);
    let offset = 0;

    dataToHash.set(sizeBuffer, offset);
    offset += sizeBuffer.length;

    for (const chunk of chunks) {
      dataToHash.set(chunk, offset);
      offset += chunk.length;
    }
  }

  // 计算 SHA-256 哈希
  onProgress?.('计算 SHA-256...');
  // 使用 Uint8Array 直接传入，TypeScript 需要断言
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataToHash as unknown as ArrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 读取图片文件的原始尺寸
 * 返回 { width, height } 或 null（加载失败）
 */
function getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    img.src = url;
  });
}

/**
 * 读取视频文件的原始尺寸
 * 返回 { width, height } 或 null（加载失败）
 */
function getVideoDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ width: video.videoWidth, height: video.videoHeight });
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    // 设置预加载元数据
    video.preload = 'metadata';
    video.src = url;
  });
}

/**
 * 读取媒体文件（图片/视频）的原始尺寸
 * 返回 { width, height } 或 null（非媒体文件或加载失败）
 */
function getMediaDimensionsFromFile(file: File): Promise<{ width: number; height: number } | null> {
  if (file.type.startsWith('image/')) {
    return getImageDimensions(file);
  } else if (file.type.startsWith('video/')) {
    return getVideoDimensions(file);
  }
  return Promise.resolve(null);
}

/**
 * 根据 MIME 类型确定文件类型
 */
function getFileType(
  file: File,
  storageLocation: StorageLocation,
): FileType {
  // 确定前缀（避免嵌套三元表达式）
  let prefix = 'user';
  if (storageLocation === 'friend_messages') {
    prefix = 'friend';
  } else if (storageLocation === 'group_files') {
    prefix = 'group';
  }

  if (file.type.startsWith('image/')) {
    return `${prefix}_image` as FileType;
  } else if (file.type.startsWith('video/')) {
    return `${prefix}_video` as FileType;
  } else {
    return `${prefix}_document` as FileType;
  }
}

/**
 * 上传单个分片（使用 XMLHttpRequest 实现真实进度）
 */
function uploadChunk(
  url: string,
  chunk: Blob,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // 上传进度事件
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded, event.total);
      }
    };

    // 完成事件
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`分片上传失败: HTTP ${xhr.status}`));
      }
    };

    // 错误事件
    xhr.onerror = () => {
      reject(new Error('网络错误'));
    };

    // 超时事件
    xhr.ontimeout = () => {
      reject(new Error('上传超时'));
    };

    // 设置超时时间（90秒，兼容 Cloudflare 100秒限制）
    xhr.timeout = 90000;

    // 预签名分片 URL 经回环安全反代转发(Host=逻辑域名,兼容 presigned 签名);webview 直传验不过自签 leaf。
    xhr.open('PUT', proxyRequestUrl(url));
    xhr.send(chunk);
  });
}

/**
 * 上传单个分片（带重试和进度回调）
 */
async function uploadChunkWithRetry(
  url: string,
  chunk: Blob,
  onProgress?: (loaded: number, total: number) => void,
  retryCount = 0,
): Promise<void> {
  try {
    await uploadChunk(url, chunk, onProgress);
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      console.warn(`[Upload] 分片上传失败，${RETRY_DELAYS[retryCount] / 1000}秒后重试...`, error);
      // 等待后重试
      await new Promise<void>((resolve) => {
        setTimeout(resolve, RETRY_DELAYS[retryCount]);
      });
      return uploadChunkWithRetry(url, chunk, onProgress, retryCount + 1);
    }
    throw error;
  }
}

// ============================================
// Hook 实现
// ============================================

export function useFileUpload() {
  const api = useApi();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  /**
   * 上传文件
   */
  const uploadFile = useCallback(
    async (params: UploadRequestParams): Promise<UploadResult> => {
      const { file, storageLocation, relatedId, mediaGroup, caption, onProgress, signal } = params;
      const fileType = params.fileType || getFileType(file, storageLocation);

      // 进度的**唯一**真值持有在这个局部变量里，再同时推给 hook state 与本次调用的回调。
      // 原先各处用 `setProgress(prev => ...)` 更新器，无法在同一处把值也交给 onProgress
      // （在更新器里调回调 = 在 React 的状态计算里做副作用，StrictMode 下会跑两次）。
      let current: UploadProgress = {
        percent: 0,
        loaded: 0,
        total: file.size,
        currentChunk: 0,
        totalChunks: 0,
        status: 'hashing',
        statusDetail: '准备计算文件指纹...',
      };
      const pushProgress = (patch: Partial<UploadProgress>) => {
        current = { ...current, ...patch };
        setProgress(current);
        onProgress?.(current);
      };

      setUploading(true);
      setProgress(current);
      onProgress?.(current);

      try {
        // 1. 计算文件哈希（带进度回调）
        const fileHash = await calculateSHA256(file, (detail) => {
          pushProgress({ statusDetail: detail });
        });

        if (signal?.aborted) { throw new Error(UPLOAD_CANCELLED); }

        // 1.5 读取媒体尺寸（图片/视频文件）
        const imageDimensions = await getMediaDimensionsFromFile(file);

        // 调试：确认是否获取到了媒体尺寸
        // eslint-disable-next-line no-console
        console.log('%c[Upload] 媒体尺寸获取结果', 'color: #9C27B0; font-weight: bold', {
          fileName: file.name,
          fileType: file.type,
          dimensions: imageDimensions,
          willSend: {
            image_width: imageDimensions?.width ?? null,
            image_height: imageDimensions?.height ?? null,
          },
        });

        pushProgress({ status: 'requesting', percent: 5, statusDetail: '正在请求上传...' });

        // 2. 请求上传（包含图片尺寸，后端文档要求）
        const uploadInfo = await api.post<UploadRequestResponse>('/api/storage/upload/request', {
          file_type: fileType,
          storage_location: storageLocation,
          related_id: relatedId || null,
          filename: file.name,
          file_size: file.size,
          content_type: file.type,
          file_hash: fileHash,
          force_upload: false,
          // 图片尺寸（后端文档：image_width/image_height 仅图片类型需要）
          image_width: imageDimensions?.width ?? null,
          image_height: imageDimensions?.height ?? null,
          // 相册三件套 + 配文：秒传分支的消息就在这一步建，故必须在这里带
          media_group_id: mediaGroup?.id ?? null,
          media_group_index: mediaGroup?.index ?? null,
          media_group_count: mediaGroup?.count ?? null,
          caption: caption ?? null,
        });

        // 3. 检查是否秒传
        if (uploadInfo.instant_upload) {
          pushProgress({
            percent: 100,
            loaded: file.size,
            total: file.size,
            currentChunk: 1,
            totalChunks: 1,
            status: 'done',
            statusDetail: '秒传成功！',
          });
          setUploading(false);

          // 从 URL 中提取 UUID
          const fileUuid = uploadInfo.existing_file_url?.split('/').pop();

          return {
            success: true,
            instant: true,
            fileUrl: uploadInfo.existing_file_url || undefined,
            fileUuid,
            fileHash,
            messageUuid: uploadInfo.message_uuid,
            messageSendTime: uploadInfo.message_send_time,
            imageWidth: imageDimensions?.width ?? null,
            imageHeight: imageDimensions?.height ?? null,
          };
        }

        // 4. 分片上传
        const chunkSize = uploadInfo.chunk_size || DEFAULT_CHUNK_SIZE;
        const totalChunks =
          uploadInfo.total_chunks || Math.ceil(file.size / chunkSize);

        pushProgress({
          status: 'uploading',
          totalChunks,
          percent: 10,
          statusDetail: `0 / ${formatFileSize(file.size)}`,
        });

        let completedChunksSize = 0; // 已完成分片的总大小

        // 确保 multipart_upload_id 存在
        const uploadId = uploadInfo.multipart_upload_id || '';

        for (let i = 0; i < totalChunks; i++) {
          // 取消检查放在分片边界（见 UploadRequestParams.signal 的粒度说明）
          if (signal?.aborted) { throw new Error(UPLOAD_CANCELLED); }
          // 获取分片预签名 URL
          // eslint-disable-next-line no-await-in-loop
          const partUrlData = await api.get<{ part_url: string }>(
            `/api/storage/multipart/part_url?file_key=${encodeURIComponent(
              uploadInfo.file_key,
            )}&upload_id=${encodeURIComponent(uploadId)}&part_number=${i + 1}`,
          );

          // 切割分片
          const start = i * chunkSize;
          const end = Math.min(start + chunkSize, file.size);
          const chunk = file.slice(start, end);

          // 解析分片 URL（后端可能返回相对路径）
          const resolvedPartUrl = optimizePresignedUrl(partUrlData.part_url, api.getBaseUrl());

          // 上传分片（带实时进度回调）
          // eslint-disable-next-line no-await-in-loop
          await uploadChunkWithRetry(
            resolvedPartUrl,
            chunk,
            (chunkLoaded, _chunkTotal) => {
              // 计算总进度：已完成分片 + 当前分片已上传
              const totalUploaded = completedChunksSize + chunkLoaded;
              const uploadPercent = 10 + (totalUploaded / file.size) * 80; // 10%-90%
              pushProgress({
                percent: uploadPercent,
                loaded: totalUploaded,
                total: file.size,
                currentChunk: i + 1,
                totalChunks,
                status: 'uploading',
                statusDetail: `${formatFileSize(totalUploaded)} / ${formatFileSize(file.size)}`,
              });
            },
          );

          // 分片完成，累加到已完成大小
          completedChunksSize += chunk.size;
        }

        // 5. 确认上传
        pushProgress({ status: 'confirming', percent: 95, statusDetail: '正在确认上传...' });

        const confirmResult = await api.post<ConfirmUploadResponse>('/api/storage/upload/confirm', {
          file_key: uploadInfo.file_key,
          // 非秒传路径的消息是在**确认**这一步才建的，所以三件套与配文要在这里再带一次；
          // 只在 request 带对这条分支无效（后端 ConfirmUploadRequest 注释明写此事）
          media_group_id: mediaGroup?.id ?? null,
          media_group_index: mediaGroup?.index ?? null,
          media_group_count: mediaGroup?.count ?? null,
          caption: caption ?? null,
        });

        // 从 URL 中提取 UUID
        const fileUuid = confirmResult.file_url.split('/').pop();

        pushProgress({
          percent: 100,
          loaded: file.size,
          total: file.size,
          currentChunk: totalChunks,
          totalChunks,
          status: 'done',
          statusDetail: '上传完成！',
        });
        setUploading(false);

        return {
          success: true,
          instant: false,
          fileUrl: confirmResult.file_url,
          fileUuid,
          fileHash,
          messageUuid: confirmResult.message_uuid,
          messageSendTime: confirmResult.message_send_time,
          imageWidth: imageDimensions?.width ?? null,
          imageHeight: imageDimensions?.height ?? null,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : '上传失败';
        pushProgress({ status: 'error', statusDetail: errorMessage });
        setUploading(false);

        return {
          success: false,
          instant: false,
          error: errorMessage,
        };
      }
    },
    [api],
  );

  /**
   * 上传好友文件
   */
  const uploadFriendFile = useCallback(
    (
      file: File,
      friendId: string,
      /** 相册元数据；单发时不传（传了才成组） */
      mediaGroup?: MediaGroupMeta,
      /** 配文；不成组的单条可直接带，成组时只在 index === 0 那一项传（后端约束） */
      caption?: string,
      /** 逐项进度 / 取消（类 Telegram 发送态用；旧路径不传，行为逐字节不变） */
      opts?: Pick<UploadRequestParams, 'onProgress' | 'signal'>,
    ): Promise<UploadResult> => {
      return uploadFile({
        file,
        fileType: getFileType(file, 'friend_messages'),
        storageLocation: 'friend_messages',
        relatedId: friendId,
        mediaGroup,
        caption,
        onProgress: opts?.onProgress,
        signal: opts?.signal,
      });
    },
    [uploadFile],
  );

  /**
   * 上传群聊文件
   */
  const uploadGroupFile = useCallback(
    (
      file: File,
      groupId: string,
      /** 相册元数据；单发时不传（传了才成组） */
      mediaGroup?: MediaGroupMeta,
      /** 配文；不成组的单条可直接带，成组时只在 index === 0 那一项传（后端约束） */
      caption?: string,
      /** 逐项进度 / 取消（类 Telegram 发送态用；旧路径不传，行为逐字节不变） */
      opts?: Pick<UploadRequestParams, 'onProgress' | 'signal'>,
    ): Promise<UploadResult> => {
      return uploadFile({
        file,
        fileType: getFileType(file, 'group_files'),
        storageLocation: 'group_files',
        relatedId: groupId,
        mediaGroup,
        caption,
        onProgress: opts?.onProgress,
        signal: opts?.signal,
      });
    },
    [uploadFile],
  );

  /**
   * 重置上传状态
   */
  const resetUpload = useCallback(() => {
    setUploading(false);
    setProgress(null);
  }, []);

  return {
    uploading,
    progress,
    uploadFile,
    uploadFriendFile,
    uploadGroupFile,
    resetUpload,
  };
}

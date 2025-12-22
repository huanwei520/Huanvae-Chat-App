/**
 * 文件上传 Hook
 *
 * 功能：
 * - SHA-256 采样哈希计算（小文件完整哈希，大文件采样哈希）
 * - 预签名分片上传到 MinIO
 * - 上传进度跟踪
 * - 秒传支持（基于 UUID 映射）
 * - 自动重试机制
 */

import { useState, useCallback } from 'react';
import { useApi } from '../contexts/SessionContext';

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
export interface UploadRequestParams {
  file: File;
  fileType: FileType;
  storageLocation: StorageLocation;
  relatedId?: string; // 好友ID或群ID
}

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
 * 上传单个分片（带重试）
 */
async function uploadChunkWithRetry(
  url: string,
  chunk: Blob,
  retryCount = 0,
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: 'PUT',
      body: chunk,
    });

    if (!response.ok) {
      throw new Error(`分片上传失败: HTTP ${response.status}`);
    }
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      // 等待后重试
      await new Promise<void>((resolve) => {
        setTimeout(resolve, RETRY_DELAYS[retryCount]);
      });
      return uploadChunkWithRetry(url, chunk, retryCount + 1);
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
      const { file, storageLocation, relatedId } = params;
      const fileType = params.fileType || getFileType(file, storageLocation);

      setUploading(true);
      setProgress({
        percent: 0,
        loaded: 0,
        total: file.size,
        currentChunk: 0,
        totalChunks: 0,
        status: 'hashing',
        statusDetail: '准备计算文件指纹...',
      });

      try {
        // 1. 计算文件哈希（带进度回调）
        const fileHash = await calculateSHA256(file, (detail) => {
          setProgress((prev) => {
            if (!prev) { return prev; }
            return { ...prev, statusDetail: detail };
          });
        });

        setProgress((prev) => {
          if (!prev) { return prev; }
          return { ...prev, status: 'requesting', percent: 5, statusDetail: '正在请求上传...' };
        });

        // 2. 请求上传
        const uploadInfo = await api.post<UploadRequestResponse>('/api/storage/upload/request', {
          file_type: fileType,
          storage_location: storageLocation,
          related_id: relatedId || null,
          filename: file.name,
          file_size: file.size,
          content_type: file.type,
          file_hash: fileHash,
          force_upload: false,
        });

        // 3. 检查是否秒传
        if (uploadInfo.instant_upload) {
          setProgress({
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

          console.log('%c[Upload] 秒传成功', 'color: #4CAF50; font-weight: bold', {
            fileName: file.name,
            fileHash,
            fileUuid,
            instant: true,
          });

          return {
            success: true,
            instant: true,
            fileUrl: uploadInfo.existing_file_url || undefined,
            fileUuid,
            fileHash,
            messageUuid: uploadInfo.message_uuid,
            messageSendTime: uploadInfo.message_send_time,
          };
        }

        // 4. 分片上传
        const chunkSize = uploadInfo.chunk_size || DEFAULT_CHUNK_SIZE;
        const totalChunks =
          uploadInfo.total_chunks || Math.ceil(file.size / chunkSize);

        setProgress((prev) => {
          if (!prev) { return prev; }
          return {
            ...prev,
            status: 'uploading',
            totalChunks,
            percent: 10,
            statusDetail: `0 / ${formatFileSize(file.size)}`,
          };
        });

        let totalUploaded = 0;

        // 确保 multipart_upload_id 存在
        const uploadId = uploadInfo.multipart_upload_id || '';

        for (let i = 0; i < totalChunks; i++) {
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

          // 上传分片
          // eslint-disable-next-line no-await-in-loop
          await uploadChunkWithRetry(partUrlData.part_url, chunk);

          // 更新进度
          totalUploaded += chunk.size;
          const uploadPercent = 10 + (totalUploaded / file.size) * 80; // 10%-90%
          setProgress({
            percent: uploadPercent,
            loaded: totalUploaded,
            total: file.size,
            currentChunk: i + 1,
            totalChunks,
            status: 'uploading',
            statusDetail: `${formatFileSize(totalUploaded)} / ${formatFileSize(file.size)}`,
          });
        }

        // 5. 确认上传
        setProgress((prev) => {
          if (!prev) { return prev; }
          return { ...prev, status: 'confirming', percent: 95, statusDetail: '正在确认上传...' };
        });

        const confirmResult = await api.post<ConfirmUploadResponse>('/api/storage/upload/confirm', {
          file_key: uploadInfo.file_key,
        });

        // 从 URL 中提取 UUID
        const fileUuid = confirmResult.file_url.split('/').pop();

        setProgress({
          percent: 100,
          loaded: file.size,
          total: file.size,
          currentChunk: totalChunks,
          totalChunks,
          status: 'done',
          statusDetail: '上传完成！',
        });
        setUploading(false);

        console.log('%c[Upload] 上传完成', 'color: #4CAF50; font-weight: bold', {
          fileName: file.name,
          fileHash,
          fileUuid,
          fileSize: file.size,
        });

        return {
          success: true,
          instant: false,
          fileUrl: confirmResult.file_url,
          fileUuid,
          fileHash,
          messageUuid: confirmResult.message_uuid,
          messageSendTime: confirmResult.message_send_time,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : '上传失败';
        setProgress((prev) => {
          if (!prev) { return prev; }
          return { ...prev, status: 'error' };
        });
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
    (file: File, friendId: string): Promise<UploadResult> => {
      return uploadFile({
        file,
        fileType: getFileType(file, 'friend_messages'),
        storageLocation: 'friend_messages',
        relatedId: friendId,
      });
    },
    [uploadFile],
  );

  /**
   * 上传群聊文件
   */
  const uploadGroupFile = useCallback(
    (file: File, groupId: string): Promise<UploadResult> => {
      return uploadFile({
        file,
        fileType: getFileType(file, 'group_files'),
        storageLocation: 'group_files',
        relatedId: groupId,
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

// ============================================
// 预签名 URL 获取
// ============================================

/** 预签名 URL 缓存 */
const presignedUrlCache: Map<
  string,
  { url: string; expiresAt: Date }
> = new Map();

/** 预签名 URL 响应类型 */
interface PresignedUrlResponse {
  presigned_url: string;
  expires_at: string;
}

/**
 * 获取文件预签名 URL（带缓存）
 *
 * 统一使用 /api/storage/file/{uuid}/presigned_url 接口
 * 该接口会自动检查用户权限（包括好友文件和群文件）
 */
export async function getPresignedUrl(
  api: ReturnType<typeof useApi>,
  fileUuid: string,
): Promise<string> {
  // 检查缓存
  const cached = presignedUrlCache.get(fileUuid);
  if (cached && cached.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
    return cached.url;
  }

  // 统一使用通用的文件预签名 URL 接口
  const endpoint = `/api/storage/file/${fileUuid}/presigned_url`;

  const data = await api.post<PresignedUrlResponse>(endpoint, { operation: 'preview' });

  // 缓存 URL
  presignedUrlCache.set(fileUuid, {
    url: data.presigned_url,
    expiresAt: new Date(data.expires_at),
  });

  return data.presigned_url;
}

/**
 * 清除预签名 URL 缓存
 */
export function clearPresignedUrlCache(fileUuid?: string) {
  if (fileUuid) {
    presignedUrlCache.delete(fileUuid);
  } else {
    presignedUrlCache.clear();
  }
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) { return `${bytes  } B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)  } KB`; }
  if (bytes < 1024 * 1024 * 1024) { return `${(bytes / 1024 / 1024).toFixed(1)  } MB`; }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)  } GB`;
}

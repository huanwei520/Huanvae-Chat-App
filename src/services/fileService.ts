/**
 * 文件本地链接服务
 *
 * 基于文件哈希实现跨位置本地文件识别
 * 当消息中包含 file_hash 且本地有该文件时，直接读取本地文件
 */

import { exists, stat } from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';
import * as db from '../db';
import type { LocalFileMapping } from '../db';

// ============================================================================
// 文件源类型
// ============================================================================

export type FileSource = 'local' | 'remote' | 'checking';

export interface FileSourceResult {
  source: FileSource;
  url: string;
  localPath?: string;
}

// ============================================================================
// 文件本地链接服务
// ============================================================================

/**
 * 检查文件是否有本地副本
 * @param fileHash 文件哈希
 * @param expectedSize 预期文件大小（用于验证）
 * @returns 本地文件 URL 或 null
 */
export async function getLocalFileUrl(
  fileHash: string,
  expectedSize?: number,
): Promise<string | null> {
  if (!fileHash) { return null; }

  try {
    // 查询本地映射
    const mapping = await db.getFileMapping(fileHash);
    if (!mapping) { return null; }

    // 验证文件是否存在
    const fileExists = await exists(mapping.local_path);
    if (!fileExists) {
      // 文件不存在，删除映射
      await db.deleteFileMapping(fileHash);
      console.log('[FileService] 本地文件不存在，删除映射', { fileHash });
      return null;
    }

    // 验证文件大小（如果提供了预期大小）
    if (expectedSize !== undefined) {
      try {
        const fileStat = await stat(mapping.local_path);
        if (fileStat.size !== expectedSize) {
          // 文件大小不匹配，可能被修改，删除映射
          await db.deleteFileMapping(fileHash);
          console.log('[FileService] 文件大小不匹配，删除映射', {
            fileHash,
            expected: expectedSize,
            actual: fileStat.size,
          });
          return null;
        }
      } catch {
        // stat 失败，删除映射
        await db.deleteFileMapping(fileHash);
        return null;
      }
    }

    // 更新最后验证时间
    await db.updateFileMappingVerified(fileHash);

    // 转换为可用 URL
    const url = convertFileSrc(mapping.local_path);
    console.log('[FileService] 使用本地文件', { fileHash, localPath: mapping.local_path });
    return url;
  } catch (error) {
    console.error('[FileService] 检查本地文件失败', error);
    return null;
  }
}

/**
 * 获取文件的最佳来源
 * @param fileHash 文件哈希
 * @param remoteUrl 远程 URL（备用）
 * @param expectedSize 预期文件大小
 * @returns 文件来源信息
 */
export async function getFileSource(
  fileHash: string | null | undefined,
  remoteUrl: string,
  expectedSize?: number,
): Promise<FileSourceResult> {
  if (!fileHash) {
    return { source: 'remote', url: remoteUrl };
  }

  const localUrl = await getLocalFileUrl(fileHash, expectedSize);
  if (localUrl) {
    const mapping = await db.getFileMapping(fileHash);
    return {
      source: 'local',
      url: localUrl,
      localPath: mapping?.local_path,
    };
  }

  return { source: 'remote', url: remoteUrl };
}

/**
 * 记录上传的文件映射
 * @param fileHash 文件哈希
 * @param localPath 本地文件路径
 * @param fileSize 文件大小
 * @param fileName 文件名
 * @param contentType MIME 类型
 */
export async function recordUploadedFile(
  fileHash: string,
  localPath: string,
  fileSize: number,
  fileName: string,
  contentType: string,
): Promise<void> {
  await db.saveFileMapping({
    file_hash: fileHash,
    local_path: localPath,
    file_size: fileSize,
    file_name: fileName,
    content_type: contentType,
    source: 'uploaded',
    last_verified: new Date().toISOString(),
  });
  console.log('[FileService] 记录上传文件映射', { fileHash, localPath });
}

/**
 * 记录下载的文件映射
 * @param fileHash 文件哈希
 * @param localPath 本地保存路径
 * @param fileSize 文件大小
 * @param fileName 文件名
 * @param contentType MIME 类型
 */
export async function recordDownloadedFile(
  fileHash: string,
  localPath: string,
  fileSize: number,
  fileName: string,
  contentType: string,
): Promise<void> {
  await db.saveFileMapping({
    file_hash: fileHash,
    local_path: localPath,
    file_size: fileSize,
    file_name: fileName,
    content_type: contentType,
    source: 'downloaded',
    last_verified: new Date().toISOString(),
  });
  console.log('[FileService] 记录下载文件映射', { fileHash, localPath });
}

/**
 * 查找所有引用了相同哈希的本地文件
 * 用于实现：一个文件下载后，其他位置的相同文件也可以直接使用本地
 */
export function findLocalFileByHash(fileHash: string): Promise<LocalFileMapping | null> {
  return db.getFileMapping(fileHash);
}

/**
 * 清理无效的文件映射
 * 检查本地文件是否存在，不存在则删除映射
 */
export async function cleanupInvalidMappings(): Promise<{ removed: number; total: number }> {
  // 这个功能需要遍历所有映射并检查文件
  // 暂时返回统计信息，实际清理在后续实现
  return db.cleanupInvalidFileMappings();
}

/**
 * 文件本地链接服务
 *
 * 上传文件时记录 file_hash → 本地路径映射，使本端发出的文件在本地被识别。
 * （文件源解析/本地缓存命中现统一走 services/fileCache.ts + hooks/useFileCache.ts；
 * 本文件只负责"上传后落映射"这一件事。）
 */

import * as db from '../db';

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
}

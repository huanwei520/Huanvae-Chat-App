/**
 * 图片尺寸缓存服务
 *
 * 将图片尺寸信息存储到本地 SQLite 数据库中，
 * 用于在图片加载前预设容器尺寸，避免布局偏移。
 *
 * 工作流程：
 * 1. 显示图片前先查询缓存的尺寸
 * 2. 如果有缓存，使用预设尺寸渲染容器
 * 3. 图片加载完成后，将尺寸保存到缓存
 */

import { invoke } from '@tauri-apps/api/core';

// ============================================
// 类型定义
// ============================================

export interface ImageDimensions {
  width: number;
  height: number;
}

// ============================================
// 内存缓存（减少 IPC 调用）
// ============================================

const memoryCache = new Map<string, ImageDimensions>();

// ============================================
// 公开 API
// ============================================

/**
 * 同步获取内存缓存中的图片尺寸（用于渲染时立即获取预加载的尺寸）
 *
 * @param fileKey - 文件标识（file_hash 或 file_uuid）
 * @returns 图片尺寸，如果内存缓存中没有则返回 null
 */
export function getImageDimensionsSync(fileKey: string): ImageDimensions | null {
  return memoryCache.get(fileKey) ?? null;
}

/**
 * 获取图片尺寸（优先内存缓存，其次 SQLite）
 *
 * @param fileKey - 文件标识（file_hash 或 file_uuid）
 * @returns 图片尺寸，如果没有缓存则返回 null
 */
export async function getImageDimensions(
  fileKey: string,
): Promise<ImageDimensions | null> {
  // 优先检查内存缓存
  const cached = memoryCache.get(fileKey);
  if (cached) {
    return cached;
  }

  try {
    const result = await invoke<ImageDimensions | null>('db_get_image_dimensions', {
      fileKey,
    });

    if (result) {
      // 更新内存缓存
      memoryCache.set(fileKey, result);
    }

    return result;
  } catch (error) {
    console.error('[ImageDimensions] 获取尺寸失败:', error);
    return null;
  }
}

/**
 * 保存图片尺寸（同时更新内存缓存和 SQLite）
 *
 * @param fileKey - 文件标识（file_hash 或 file_uuid）
 * @param width - 图片宽度
 * @param height - 图片高度
 */
export async function saveImageDimensions(
  fileKey: string,
  width: number,
  height: number,
): Promise<void> {
  // 验证尺寸有效性
  if (width <= 0 || height <= 0) {
    return;
  }

  const dimensions: ImageDimensions = { width, height };

  // 更新内存缓存
  memoryCache.set(fileKey, dimensions);

  try {
    await invoke('db_save_image_dimensions', {
      fileKey,
      width,
      height,
    });
  } catch (error) {
    console.error('[ImageDimensions] 保存尺寸失败:', error);
  }
}

/**
 * 计算显示尺寸（保持比例，限制最大尺寸）
 *
 * @param originalWidth - 原始宽度
 * @param originalHeight - 原始高度
 * @param maxWidth - 最大宽度（默认 280）
 * @param maxHeight - 最大高度（默认 300）
 * @returns 计算后的显示尺寸
 */
export function calculateDisplaySize(
  originalWidth: number,
  originalHeight: number,
  maxWidth = 280,
  maxHeight = 300,
): { width: number; height: number } {
  if (originalWidth <= 0 || originalHeight <= 0) {
    return { width: maxWidth, height: maxHeight };
  }

  const aspectRatio = originalWidth / originalHeight;

  let displayWidth = originalWidth;
  let displayHeight = originalHeight;

  // 限制最大宽度
  if (displayWidth > maxWidth) {
    displayWidth = maxWidth;
    displayHeight = displayWidth / aspectRatio;
  }

  // 限制最大高度
  if (displayHeight > maxHeight) {
    displayHeight = maxHeight;
    displayWidth = displayHeight * aspectRatio;
  }

  return {
    width: Math.round(displayWidth),
    height: Math.round(displayHeight),
  };
}

/**
 * 清除内存缓存（切换用户时调用）
 */
export function clearMemoryCache(): void {
  memoryCache.clear();
}

/**
 * ============================================================================
 * 头像加载工具函数
 * ============================================================================
 *
 * 处理本地头像路径和服务器头像 URL 的转换。
 * 优先使用本地缓存头像，回退到服务器 URL。
 */

import { convertFileSrc } from '@tauri-apps/api/core';

// ============================================================================
// 文件路径转换
// ============================================================================

/**
 * 将本地文件路径转换为可在 webview 中使用的 URL
 *
 * @param filePath - 本地文件路径（绝对路径）
 * @returns asset:// URL
 */
export function getLocalFileUrl(filePath: string): string {
  if (!filePath.startsWith('/')) {
    console.warn('getLocalFileUrl: 路径应该是绝对路径', filePath);
  }

  return convertFileSrc(filePath);
}

// ============================================================================
// 头像 URL 获取
// ============================================================================

/**
 * 获取头像 URL（优先本地，回退服务器）
 *
 * @param localPath - 本地头像路径
 * @param serverUrl - 服务器头像 URL
 * @returns 可用的头像 URL 或 null
 */
export function getAvatarUrl(
  localPath: string | null | undefined,
  serverUrl: string | null | undefined,
): string | null {
  // 优先使用本地缓存
  if (localPath) {
    try {
      return getLocalFileUrl(localPath);
    } catch {
      // 本地文件加载失败，回退到服务器 URL
    }
  }

  // 回退到服务器 URL
  if (serverUrl) {
    return serverUrl;
  }

  return null;
}

// ============================================================================
// URL 类型检测
// ============================================================================

/**
 * 检查是否是本地文件 URL（asset:// 协议）
 */
export function isLocalFileUrl(url: string): boolean {
  return url.startsWith('asset://');
}

/**
 * 检查是否是服务器 URL（http:// 或 https://）
 */
export function isServerUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * ============================================================================
 * 头像加载工具函数
 * ============================================================================
 *
 * 处理本地头像路径和服务器头像 URL 的转换。
 * 优先使用本地缓存头像，回退到服务器 URL。
 *
 * 后端返回的头像 URL 为相对路径（如 "avatars/user.jpg?t=123"），
 * 前端需要拼接 STORAGE_BASE_URL（与 API 基础地址相同）获取完整 URL。
 */

import { convertFileSrc } from '@tauri-apps/api/core';

// ============================================================================
// 服务器基础 URL 管理（单例，登录时设置）
// ============================================================================

let _currentServerBaseUrl = '';

/**
 * 设置当前服务器基础 URL（登录时调用一次）
 *
 * 后续所有 resolveServerAvatarUrl 调用会使用此值拼接相对路径。
 */
export function setCurrentServerBaseUrl(url: string): void {
  _currentServerBaseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * 将后端返回的头像相对路径解析为完整 URL
 *
 * - null/undefined → null
 * - 已经是完整 URL（http/https 开头）→ 原样返回（兼容旧数据）
 * - 相对路径 → 拼接 serverBaseUrl 返回完整 URL
 */
export function resolveServerAvatarUrl(path: string | null | undefined): string | null {
  if (!path) { return null; }
  if (path.startsWith('http://') || path.startsWith('https://')) { return path; }
  if (!_currentServerBaseUrl) { return path; }
  const rel = path.startsWith('/') ? path.slice(1) : path;
  return `${_currentServerBaseUrl}/${rel}`;
}

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
 * @param serverUrl - 服务器头像 URL（可以是相对路径，会自动解析）
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

  // 回退到服务器 URL（解析相对路径）
  return resolveServerAvatarUrl(serverUrl);
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

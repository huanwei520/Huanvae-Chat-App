/**
 * ============================================================================
 * 头像加载工具函数
 * ============================================================================
 *
 * 处理本地头像路径和服务器头像 URL 的转换。
 * 优先使用本地缓存头像，回退到服务器 URL。
 *
 * 后端返回的头像 URL 为相对路径（如 "avatars/user.jpg?t=123"），
 * 前端经回环安全反代(proxyResourceUrl)改写为 http://127.0.0.1:<port>/<path+query> 显示
 * （webview 的 <img> 用系统信任验不过私有 CA 自签 leaf，故必须经 secure_proxy 中转）。
 */

import { convertFileSrc } from '@tauri-apps/api/core';
import { proxyResourceUrl } from '../services/secureProxy';

/**
 * 将后端返回的头像 URL 解析为可显示 URL（委托回环安全反代 proxyResourceUrl）
 *
 * - null/undefined/空 → null
 * - 完整 URL / 相对路径 → 改写为 http://127.0.0.1:<port>/<path+query>（反代未就绪时:完整URL原样、相对路径null）
 */
export function resolveServerAvatarUrl(path: string | null | undefined): string | null {
  // 经回环安全反代取头像(走自签源站:钉内置 CA、连源站 IP、不发 SNI)——
  // webview 的 <img> 用系统信任,无法直接验私有 CA 自签证书,故必须经 secure_proxy 中转。
  // proxyResourceUrl 会把相对路径 / 完整域名 URL 都改写成 http://127.0.0.1:<port>/<path+query>。
  return proxyResourceUrl(path);
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

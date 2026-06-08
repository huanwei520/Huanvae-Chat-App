/**
 * ============================================================================
 * 头像加载工具函数
 * ============================================================================
 *
 * 处理本地头像路径和服务器头像 URL 的转换。
 * 优先使用本地缓存头像，回退到服务器 URL。
 *
 * 后端返回的头像 URL 为相对路径（如 "avatars/user.jpg?t=123"）或逻辑域名 URL，
 * 前端经唯一显示收口点 resolveDisplayUrl 改写为 http://127.0.0.1:<port>/<path+query> 反代显示
 * （webview 的 <img> 用系统信任验不过私有 CA 自签 leaf，故后端资源必须经 secure_proxy 中转；
 * 外部 host 的真 CA URL 由 resolveDisplayUrl 原样放行）。
 */

import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveDisplayUrl } from '../services/secureProxy';

/**
 * 将后端返回的头像 URL 解析为可显示 URL（委托唯一收口点 resolveDisplayUrl）
 *
 * - null/undefined/空 → null
 * - 后端资源(相对路径 / 逻辑域名 URL)→ 回环反代 http://127.0.0.1:<port>/<path+query>
 * - 外部资源(其它 host 的完整 URL)→ 原样（真 CA，webview 直连可加载）
 */
export function resolveServerAvatarUrl(path: string | null | undefined): string | null {
  // webview 的 <img> 用系统信任,无法直接验私有 CA 自签证书,故后端资源必须经 secure_proxy 中转。
  // 收口到 resolveDisplayUrl(与聊天图片/小程序图标/OAuth logo 同一出口,由契约测试强制)。
  return resolveDisplayUrl(path);
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

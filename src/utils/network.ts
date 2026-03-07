/**
 * 网络优化工具
 *
 * 将后端返回的 URL（相对路径或绝对路径）解析为可直接访问的完整 URL。
 *
 * ## 工作原理
 * - 后端返回的 presigned_url / file_url / existing_file_url 均为相对路径
 * - 前端拼接用户实际登录的服务器地址（serverUrl）生成完整 URL
 * - 兼容旧版本的绝对路径格式（替换公网域名为当前服务器地址）
 *
 * ## 性能优化效果
 * - 局域网下载 100MB 视频：~80秒（公网绕行）→ ~1秒（局域网直连）
 * - 视频播放：卡顿频繁 → 流畅播放
 */

// ============================================
// 常量定义
// ============================================

/** 公网 API 域名（旧版本后端可能使用绝对路径，需兼容） */
const PUBLIC_DOMAIN = 'api.huanvae.cn';

// ============================================
// URL 解析与优化
// ============================================

/**
 * 解析存储相对路径为完整 URL
 *
 * 后端返回的 file_url / existing_file_url / presigned_url 均为相对路径，
 * 需要拼接 serverUrl 获取完整可访问 URL。
 *
 * @param relativePath - 后端返回的相对路径（如 "api/storage/file/{uuid}"）
 * @param serverUrl - 当前登录的服务器地址（从 api.getBaseUrl() 获取）
 * @returns 完整 URL 或 null
 */
export function resolveStorageUrl(relativePath: string | null | undefined, serverUrl: string): string | null {
  if (!relativePath) { return null; }
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return optimizePresignedUrl(relativePath, serverUrl);
  }
  if (!serverUrl) { return relativePath; }

  const base = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
  const path = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
  return `${base}/${path}`;
}

/**
 * 优化预签名 URL
 *
 * 处理两种格式：
 * 1. 相对路径（新版本）：拼接 serverUrl
 * 2. 绝对路径（旧版本兼容）：替换公网域名为当前服务器地址
 *
 * @param url - 后端返回的预签名 URL（相对或绝对路径）
 * @param serverUrl - 当前登录的服务器地址（从 api.getBaseUrl() 获取）
 * @returns 优化后的完整 URL
 */
export function optimizePresignedUrl(url: string, serverUrl: string): string {
  if (!url) { return url; }
  if (!serverUrl) { return url; }

  // 相对路径：拼接服务器地址
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    const base = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
    const path = url.startsWith('/') ? url.slice(1) : url;
    return `${base}/${path}`;
  }

  // 绝对路径（旧版兼容）：替换公网域名
  try {
    const parsedServerUrl = new URL(serverUrl);
    const serverOrigin = parsedServerUrl.origin;

    const optimizedUrl = url.replace(`https://${PUBLIC_DOMAIN}`, serverOrigin);

    if (optimizedUrl !== url) {
      // eslint-disable-next-line no-console
      console.log('[Network] URL 优化:', {
        from: `https://${PUBLIC_DOMAIN}`,
        to: serverOrigin,
      });
    }

    return optimizedUrl;
  } catch {
    return url;
  }
}

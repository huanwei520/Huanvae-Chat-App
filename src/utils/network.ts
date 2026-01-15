/**
 * 网络优化工具
 *
 * 将预签名 URL 的域名替换为当前登录的服务器地址，实现直连加速。
 *
 * ## 工作原理
 * - 后端返回的预签名 URL 固定使用公网域名 (api.huanvae.cn)
 * - 前端将其替换为用户实际登录的服务器地址
 * - 如果用户通过局域网 IP 登录，则使用局域网直连
 * - 如果用户通过公网域名登录，则保持公网访问
 *
 * ## 性能优化效果
 * - 局域网下载 100MB 视频：~80秒（公网绕行）→ ~1秒（局域网直连）
 * - 视频播放：卡顿频繁 → 流畅播放
 */

// ============================================
// 常量定义
// ============================================

/** 公网 API 域名（后端预签名 URL 固定使用此域名） */
const PUBLIC_DOMAIN = 'api.huanvae.cn';

// ============================================
// URL 优化
// ============================================

/**
 * 优化预签名 URL
 *
 * 将预签名 URL 中的公网域名替换为当前登录的服务器地址。
 *
 * @param url - 后端返回的预签名 URL
 * @param serverUrl - 当前登录的服务器地址（从 api.getBaseUrl() 获取）
 * @returns 优化后的 URL
 *
 * @example
 * // 用户通过局域网 IP 登录
 * optimizePresignedUrl('https://api.huanvae.cn/minio/...', 'http://192.168.5.153')
 * // 返回: 'http://192.168.5.153/minio/...'
 *
 * @example
 * // 用户通过公网域名登录
 * optimizePresignedUrl('https://api.huanvae.cn/minio/...', 'https://api.huanvae.cn')
 * // 返回: 'https://api.huanvae.cn/minio/...' (无变化)
 */
export function optimizePresignedUrl(url: string, serverUrl: string): string {
  if (!serverUrl) {
    return url;
  }

  try {
    // 解析服务器地址，获取 origin（协议+主机+端口）
    const parsedServerUrl = new URL(serverUrl);
    const serverOrigin = parsedServerUrl.origin; // 如 "http://192.168.5.153"

    // 替换公网域名为当前服务器地址
    const optimizedUrl = url.replace(`https://${PUBLIC_DOMAIN}`, serverOrigin);

    // 仅在实际替换时输出日志
    if (optimizedUrl !== url) {
      // eslint-disable-next-line no-console
      console.log('[Network] URL 优化:', {
        from: `https://${PUBLIC_DOMAIN}`,
        to: serverOrigin,
      });
    }

    return optimizedUrl;
  } catch {
    // URL 解析失败，返回原 URL
    return url;
  }
}

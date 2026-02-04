/**
 * URL 工具函数
 *
 * @since 2026-02-04
 */

/**
 * 从 URL 提取主机名（用于显示）
 *
 * @param url - 完整 URL 或代理地址
 * @returns 主机名，如果 URL 为空或无效则返回 "直连"
 *
 * @example
 * extractProxyHost("https://mirror.ghproxy.com/") // "mirror.ghproxy.com"
 * extractProxyHost("") // "直连"
 * extractProxyHost("invalid") // "invalid"
 */
export function extractProxyHost(url: string): string {
  if (!url) {
    return '直连';
  }
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

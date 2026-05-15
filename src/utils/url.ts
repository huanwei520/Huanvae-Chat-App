/**
 * URL 工具函数
 *
 * @since 2026-02-04
 */

/**
 * 从 URL 提取主机名（用于显示当前更新源等场景）
 *
 * @param url - 完整 URL
 * @returns 主机名，URL 为空时返回 "直连"，无效 URL 原样返回
 *
 * @example
 * extractHostname("https://store.huanvae.cn/update/...") // "store.huanvae.cn"
 * extractHostname("") // "直连"
 * extractHostname("invalid") // "invalid"
 */
export function extractHostname(url: string): string {
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

/**
 * 通用格式化工具函数
 *
 * 提供文件大小、传输速度、剩余时间等格式化功能
 * 用于局域网传输、更新下载等场景
 *
 * ## 使用方式
 * ```typescript
 * import { formatSize, formatSpeed, formatEta } from '../utils/format';
 *
 * formatSize(1536);     // "1.5 KB"
 * formatSpeed(1048576); // "1.0 MB/s"
 * formatEta(125);       // "2分5秒"
 * ```
 *
 * ## 注意事项
 * - 直接导入所需函数，不要通过 index.ts barrel 导入（避免 tree-shaking 问题）
 * - 所有函数为纯函数，无副作用
 *
 * @module utils/format
 * @created 2026-01-24
 */

/**
 * 格式化文件大小
 *
 * @param bytes 字节数
 * @returns 格式化字符串，如 "1.5 MB"
 *
 * @example
 * formatSize(500);        // "500 B"
 * formatSize(1024);       // "1.0 KB"
 * formatSize(1536);       // "1.5 KB"
 * formatSize(1048576);    // "1.0 MB"
 * formatSize(1073741824); // "1.00 GB"
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * 格式化传输速度
 *
 * @param bytesPerSec 每秒字节数
 * @returns 格式化字符串，如 "1.5 MB/s"
 *
 * @example
 * formatSpeed(1024);    // "1.0 KB/s"
 * formatSpeed(1048576); // "1.0 MB/s"
 */
export function formatSpeed(bytesPerSec: number): string {
  return `${formatSize(bytesPerSec)}/s`;
}

/**
 * 格式化剩余时间
 *
 * @param seconds 剩余秒数
 * @returns 格式化字符串，如 "5分30秒"
 *
 * @example
 * formatEta(30);    // "30秒"
 * formatEta(90);    // "1分30秒"
 * formatEta(3600);  // "1小时"
 * formatEta(3725);  // "1小时2分"
 */
export function formatEta(seconds?: number): string {
  if (!seconds || seconds <= 0) {
    return '';
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}秒`;
  }
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return secs > 0 ? `${mins}分${secs}秒` : `${mins}分钟`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}小时${mins}分` : `${hours}小时`;
}

/**
 * 格式化时长（毫秒）
 *
 * @param ms 毫秒数
 * @returns 格式化字符串，如 "1.5 秒"
 *
 * @example
 * formatDuration(500);  // "500 毫秒"
 * formatDuration(1500); // "1.5 秒"
 * formatDuration(65000); // "1 分 5 秒"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms} 毫秒`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)} 秒`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
}

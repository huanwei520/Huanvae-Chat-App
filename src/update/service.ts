/**
 * 应用更新服务
 *
 * 使用 Tauri updater 插件实现自动更新功能：
 * - 检查更新
 * - 下载更新（带进度）
 * - 安装更新并重启
 *
 * 更新源支持多个代理，按顺序尝试：
 * 1. edgeone.gh-proxy.org
 * 2. cdn.gh-proxy.org
 * 3. hk.gh-proxy.org
 * 4. gh-proxy.org
 * 5. github.com（直连备选）
 */

import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

// ============================================
// 类型定义
// ============================================

export interface UpdateInfo {
  /** 是否有可用更新 */
  available: boolean;
  /** 新版本号 */
  version?: string;
  /** 更新说明 */
  notes?: string;
  /** 发布日期 */
  date?: string;
  /** 更新对象（用于下载安装） */
  update?: Update;
}

export interface DownloadProgress {
  /** 进度事件类型 */
  event: 'Started' | 'Progress' | 'Finished';
  /** 总大小（字节） */
  contentLength?: number;
  /** 当前块大小（字节） */
  chunkLength?: number;
  /** 百分比（0-100） */
  percent?: number;
  /** 已下载大小（字节） */
  downloaded?: number;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

// ============================================
// 更新检查
// ============================================

/**
 * 检查是否有可用更新
 *
 * @returns 更新信息
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  try {
    const update = await check();

    if (update) {
      return {
        available: true,
        version: update.version,
        notes: update.body || undefined,
        date: update.date || undefined,
        update,
      };
    }

    return { available: false };
  } catch (error) {
    // 常见的非致命错误，静默处理
    const errorMsg = error instanceof Error ? error.message : String(error);

    // 这些错误通常是网络问题或代理问题，不需要显示给用户
    if (
      errorMsg.includes('decoding response body') ||
      errorMsg.includes('network') ||
      errorMsg.includes('timeout') ||
      errorMsg.includes('fetch')
    ) {
      console.warn('[Update] 更新检查暂时不可用（网络/代理问题）');
      return { available: false };
    }

    // 其他错误正常抛出
    console.error('[Update] 检查更新失败:', error);
    throw error;
  }
}

// ============================================
// 下载并安装更新
// ============================================

/**
 * 下载并安装更新
 *
 * @param update - 更新对象（从 checkForUpdates 获取）
 * @param onProgress - 进度回调
 */
export async function downloadAndInstall(
  update: Update,
  onProgress?: ProgressCallback,
): Promise<void> {
  let downloaded = 0;
  let contentLength = 0;

  try {
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength || 0;
          downloaded = 0;
          onProgress?.({
            event: 'Started',
            contentLength,
            percent: 0,
            downloaded: 0,
          });
          break;

        case 'Progress': {
          downloaded += event.data.chunkLength;
          const percent = contentLength > 0
            ? Math.round((downloaded / contentLength) * 100)
            : 0;
          onProgress?.({
            event: 'Progress',
            chunkLength: event.data.chunkLength,
            percent,
            downloaded,
            contentLength,
          });
          break;
        }

        case 'Finished':
          onProgress?.({
            event: 'Finished',
            percent: 100,
            downloaded: contentLength,
            contentLength,
          });
          break;
      }
    });
  } catch (error) {
    console.error('[Update] 下载安装失败:', error);
    throw error;
  }
}

/**
 * 重启应用以完成更新
 */
export async function restartApp(): Promise<void> {
  try {
    await relaunch();
  } catch (error) {
    console.error('[Update] 重启失败:', error);
    throw error;
  }
}

// ============================================
// 一键更新
// ============================================

/**
 * 检查并执行更新（一键操作）
 *
 * @param onProgress - 进度回调
 * @param autoRestart - 是否自动重启（默认 true）
 * @returns 是否执行了更新
 */
export async function checkAndUpdate(
  onProgress?: ProgressCallback,
  autoRestart: boolean = true,
): Promise<boolean> {
  const info = await checkForUpdates();

  if (!info.available || !info.update) {
    return false;
  }

  await downloadAndInstall(info.update, onProgress);

  if (autoRestart) {
    await restartApp();
  }

  return true;
}

// ============================================
// 格式化工具
// ============================================

/**
 * 格式化文件大小
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
  if (bytes < 1024 * 1024 * 1024) { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

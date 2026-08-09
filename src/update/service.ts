/**
 * 应用更新服务
 *
 * 使用 Tauri updater 插件实现自动更新功能：
 * - 检查更新
 * - 下载更新（带进度）
 * - 安装更新并重启
 *
 * 更新源（tauri.conf.json updater.endpoints，按顺序尝试）：
 * 1. store.huanvae.cn（自建 Cloudflare R2，优先）
 * 2. github.com（直连备用）
 *
 * ## Windows 更新
 * Windows 使用 NSIS EXE 安装包，通过自定义 hooks.nsi 处理旧版本卸载
 *
 * 参考文档：
 * - Tauri 2 Updater: https://v2.tauri.app/plugin/updater/
 *
 * @module update/service
 * @updated 2026-01-27 使用 NSIS EXE 更新
 */

import { check, type Update } from '@tauri-apps/plugin-updater';
import { Channel, invoke } from '@tauri-apps/api/core';
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
  /** 总大小（字节）；服务端没给 Content-Length 时为 undefined */
  contentLength?: number;
  /** 当前块大小（字节） */
  chunkLength?: number;
  /** 百分比（0-100）；总长未知时为 undefined —— 此时看 indeterminate，别当成 0% */
  percent?: number;
  /** 已下载大小（字节） */
  downloaded?: number;
  /**
   * 不定态：总长度未知，无法算百分比。
   * UI 应显示不定态进度条 / 已下载字节数，**不要**显示一个钉死不动的 0%。
   */
  indeterminate?: boolean;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

// ============================================
// 更新检查
// ============================================

// Windows 使用默认的 NSIS EXE 更新，无需指定特殊 target
// latest.json 中的平台键为 "windows-x86_64"（Tauri 默认值）

/**
 * 检查是否有可用更新
 *
 * 所有平台使用默认 target，Tauri 会自动匹配：
 * - Windows: windows-x86_64 (NSIS EXE)
 * - Linux: linux-x86_64 (AppImage)
 * - macOS: darwin-aarch64 (.app.tar.gz —— Tauri v2 updater 不消费 DMG)
 *
 * @returns 更新信息
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  try {
    // 使用默认 target，Tauri 自动根据平台匹配
    const update = await check();

    if (update) {
      // eslint-disable-next-line no-console
      console.log('[Update] 发现新版本:', update.version);
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

/** Rust 侧 `ShardedEvent` 的线格式（serde tag="event" / content="data"，camelCase） */
type ShardedEvent =
  | { event: 'Started'; data: { contentLength: number | null } }
  | { event: 'Progress'; data: { downloaded: number; contentLength: number | null } }
  | { event: 'Finished' };

/**
 * 下载并安装更新
 *
 * 走 Rust 侧自建下载器 `updater_sharded_install`（Range 分片 + 多连接并发 + 断点续传 +
 * 重试 + 超时），**不再**用插件默认的单连接顺序下载 `update.downloadAndInstall()`。
 * 受控链路损伤实测：5% 丢包 / 250ms RTT 下 8 段分片比单连接快 4.39x。
 *
 * 🔴 签名校验没有丢：插件的验签在它自己的 `download()` 内部，`install(bytes)` 不验签；
 *    Rust 侧已原样复刻同一套 minisign 校验（见 `src-tauri/src/updater_download.rs`），
 *    校验不过直接报错、绝不安装。
 *
 * 🔴 没有任何兜底：分片失败 / 源不支持 Range / 验签失败 一律直接抛错，
 *    **不会**退回插件默认下载（产品决定：失败要让用户看见，不静默降级）。
 *
 * @param update - 更新对象（从 checkForUpdates 获取）
 * @param onProgress - 进度回调
 */
export async function downloadAndInstall(
  update: Update,
  onProgress?: ProgressCallback,
): Promise<void> {
  const channel = new Channel<ShardedEvent>();
  let total: number | undefined;

  channel.onmessage = (msg) => {
    switch (msg.event) {
      case 'Started': {
        total = msg.data.contentLength ?? undefined;
        onProgress?.({
          event: 'Started',
          contentLength: total,
          // 总长未知 ⇒ 不定态；不再把百分比钉死成 0%
          percent: total === undefined ? undefined : 0,
          indeterminate: total === undefined,
          downloaded: 0,
        });
        break;
      }
      case 'Progress': {
        const downloaded = msg.data.downloaded;
        const len = msg.data.contentLength ?? total;
        onProgress?.({
          event: 'Progress',
          downloaded,
          contentLength: len,
          percent: len && len > 0 ? Math.round((downloaded / len) * 100) : undefined,
          indeterminate: !len || len <= 0,
        });
        break;
      }
      case 'Finished': {
        onProgress?.({
          event: 'Finished',
          percent: 100,
          downloaded: total,
          contentLength: total,
          indeterminate: false,
        });
        break;
      }
    }
  };

  try {
    await invoke('updater_sharded_install', { rid: update.rid, onEvent: channel });
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
// 格式化工具（重新导出，保持向后兼容）
// ============================================

// 使用统一的格式化函数，重新导出以保持 API 兼容
export { formatSize } from '../utils/format';

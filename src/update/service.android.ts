/**
 * Android 更新服务
 *
 * 与桌面端 service.ts 完全隔离，专门处理 Android 平台的更新逻辑：
 * - 从 android-latest.json 检查更新（尝试多个代理）
 * - 使用 Rust 后端下载 APK 到本地存储
 * - 使用 tauri-plugin-android-package-install 安装 APK
 *
 * 注意：
 * - 桌面端使用 @tauri-apps/plugin-updater，支持自动安装和重启
 * - Android 需要调用系统安装器，用户手动确认安装
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  checkPermissions,
  requestPermissions,
  install,
} from '@kingsword/tauri-plugin-android-package-install';
import {
  PROXY_URLS,
  GITHUB_RELEASE_BASE,
  ANDROID_LATEST_JSON_PATH,
  PROXY_TIMEOUT_SECONDS,
} from './config';

// ============================================
// 类型定义
// ============================================

/** Android 更新信息 */
export interface AndroidUpdateInfo {
  /** 是否有可用更新 */
  available: boolean;
  /** 新版本号 */
  version?: string;
  /** 更新说明 */
  notes?: string;
  /** APK 下载地址 */
  apkUrl?: string;
  /** APK 文件大小（字节） */
  apkSize?: number;
}

/** android-latest.json 文件格式 */
interface AndroidLatestJson {
  version: string;
  notes?: string;
  url: string;
  size?: number;
}

/** 下载进度回调参数 */
export interface AndroidDownloadProgress {
  /** 百分比（0-100） */
  percent: number;
  /** 已下载大小（字节） */
  downloaded: number;
  /** 总大小（字节） */
  total: number;
  /** 当前使用的代理 */
  proxyHost?: string;
}

export type AndroidProgressCallback = (progress: AndroidDownloadProgress) => void;

// ============================================
// 版本比较
// ============================================

/**
 * 比较版本号
 * @returns 正数表示 v1 > v2，负数表示 v1 < v2，0 表示相等
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.replace(/^v/, '').split('.').map(Number);
  const parts2 = v2.replace(/^v/, '').split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 !== p2) {
      return p1 - p2;
    }
  }
  return 0;
}

/**
 * 获取当前应用版本号
 */
async function getCurrentVersion(): Promise<string> {
  try {
    return await invoke<string>('get_app_version');
  } catch {
    // 备用：从 package.json 获取（开发环境）
    return '0.0.0';
  }
}

// ============================================
// 更新检查
// ============================================

/**
 * 检查是否有可用更新
 * 依次尝试多个代理源，直到成功获取版本信息
 */
export async function checkForUpdates(): Promise<AndroidUpdateInfo> {
  const currentVersion = await getCurrentVersion();
  console.log('[Android Update] 当前版本:', currentVersion);

  for (let i = 0; i < PROXY_URLS.length; i++) {
    const proxy = PROXY_URLS[i];
    const proxyName = proxy || '直连';

    try {
      const url = `${proxy}${GITHUB_RELEASE_BASE}${ANDROID_LATEST_JSON_PATH}`;
      console.log(`[Android Update] 尝试代理 ${i + 1}/${PROXY_URLS.length}: ${proxyName}`);

      // 使用 Rust 后端发起请求（更好的超时控制）
      const response = await invoke<string>('fetch_update_json', {
        url,
        timeoutSecs: PROXY_TIMEOUT_SECONDS,
      });

      const data: AndroidLatestJson = JSON.parse(response);
      console.log('[Android Update] 获取到远程版本:', data.version);

      // 比较版本号
      if (compareVersions(data.version, currentVersion) > 0) {
        return {
          available: true,
          version: data.version,
          notes: data.notes,
          apkUrl: data.url,
          apkSize: data.size,
        };
      }

      return { available: false };
    } catch (err) {
      console.warn(`[Android Update] 代理 ${proxyName} 失败:`, err);
      continue; // 尝试下一个代理
    }
  }

  console.warn('[Android Update] 所有代理均失败');
  return { available: false };
}

// ============================================
// 下载 APK
// ============================================

/**
 * 下载 APK 到本地存储
 *
 * @param url - APK 下载地址
 * @param onProgress - 进度回调
 * @returns 本地文件路径
 */
export async function downloadApk(
  url: string,
  onProgress?: AndroidProgressCallback,
): Promise<string> {
  // 监听下载进度事件
  let unlisten: UnlistenFn | null = null;

  if (onProgress) {
    unlisten = await listen<[number, number, number]>(
      'apk-download-progress',
      (event) => {
        const [percent, downloaded, total] = event.payload;
        onProgress({ percent, downloaded, total });
      },
    );
  }

  try {
    // 调用 Rust 后端下载
    const localPath = await invoke<string>('download_apk', { url });
    return localPath;
  } finally {
    // 清理监听器
    if (unlisten) {
      unlisten();
    }
  }
}

// ============================================
// 安装 APK
// ============================================

/**
 * 安装 APK
 * 会检查并请求安装权限，然后调用系统安装器
 *
 * @param apkPath - APK 本地路径
 */
export async function installApk(apkPath: string): Promise<void> {
  console.log('[Android Update] 准备安装 APK:', apkPath);

  // 检查权限
  const permission = await checkPermissions();
  console.log('[Android Update] 安装权限状态:', permission);

  if (permission !== 'granted') {
    console.log('[Android Update] 请求安装权限...');
    const result = await requestPermissions();
    if (result !== 'granted') {
      throw new Error('用户拒绝了安装权限');
    }
  }

  // 调用系统安装器
  console.log('[Android Update] 调用系统安装器...');
  await install(apkPath);
}

// ============================================
// 工具函数
// ============================================

/**
 * 从代理 URL 提取主机名（用于显示）
 */
export function extractProxyHost(proxyUrl: string): string {
  if (!proxyUrl) {
    return '直连';
  }
  try {
    const urlObj = new URL(proxyUrl);
    return urlObj.hostname;
  } catch {
    return proxyUrl;
  }
}

/**
 * 格式化文件大小
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

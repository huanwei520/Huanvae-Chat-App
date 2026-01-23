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
  console.warn('[Android Update] ========== 开始检查更新 ==========');
  console.warn('[Android Update] 当前版本:', currentVersion);
  console.warn('[Android Update] 代理源数量:', PROXY_URLS.length);
  console.warn('[Android Update] 超时设置:', PROXY_TIMEOUT_SECONDS, '秒');

  for (let i = 0; i < PROXY_URLS.length; i++) {
    const proxy = PROXY_URLS[i];
    const proxyName = proxy || '直连';

    try {
      const url = `${proxy}${GITHUB_RELEASE_BASE}${ANDROID_LATEST_JSON_PATH}`;
      console.warn(`[Android Update] 尝试代理 ${i + 1}/${PROXY_URLS.length}: ${proxyName}`);
      console.warn('[Android Update] 请求 URL:', url);

      // 使用 Rust 后端发起请求（更好的超时控制）
      const response = await invoke<string>('fetch_update_json', {
        url,
        timeoutSecs: PROXY_TIMEOUT_SECONDS,
      });

      console.warn('[Android Update] 响应长度:', response.length);
      const data: AndroidLatestJson = JSON.parse(response);
      console.warn('[Android Update] 远程版本:', data.version);
      console.warn('[Android Update] APK URL:', data.url);
      console.warn('[Android Update] APK 大小:', data.size);

      // 比较版本号
      const comparison = compareVersions(data.version, currentVersion);
      console.warn('[Android Update] 版本比较结果:', comparison, '(>0 表示有更新)');

      if (comparison > 0) {
        console.warn('[Android Update] ✓ 发现新版本:', data.version);
        return {
          available: true,
          version: data.version,
          notes: data.notes,
          apkUrl: data.url,
          apkSize: data.size,
        };
      }

      console.warn('[Android Update] ✓ 已是最新版本');
      return { available: false };
    } catch (err) {
      console.warn(`[Android Update] ✗ 代理 ${proxyName} 失败:`, err);
      continue; // 尝试下一个代理
    }
  }

  console.warn('[Android Update] ✗ 所有代理均失败');
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
  console.warn('[Android Update] ========== downloadApk 开始 ==========');
  console.warn('[Android Update] 下载 URL:', url);

  // 监听下载进度事件
  let unlisten: UnlistenFn | null = null;

  if (onProgress) {
    console.warn('[Android Update] 注册进度事件监听器...');
    unlisten = await listen<[number, number, number]>(
      'apk-download-progress',
      (event) => {
        const [percent, downloaded, total] = event.payload;
        onProgress({ percent, downloaded, total });
      },
    );
    console.warn('[Android Update] ✓ 进度事件监听器已注册');
  }

  try {
    console.warn('[Android Update] 调用 Rust download_apk...');
    // 调用 Rust 后端下载
    const localPath = await invoke<string>('download_apk', { url });
    console.warn('[Android Update] ✓ Rust 返回本地路径:', localPath);
    return localPath;
  } catch (err) {
    console.error('[Android Update] ✗ download_apk 失败:', err);
    throw err;
  } finally {
    // 清理监听器
    if (unlisten) {
      console.warn('[Android Update] 清理进度事件监听器');
      unlisten();
    }
  }
}

// ============================================
// 安装权限
// ============================================

/**
 * 确保拥有安装权限
 * 在下载前调用，提前获取权限，避免下载完成后权限请求和安装调用时机冲突
 *
 * @returns true 如果已有权限或权限请求成功
 * @throws Error 如果用户拒绝权限
 */
export async function ensureInstallPermission(): Promise<boolean> {
  console.warn('[Android Update] ========== 检查安装权限 ==========');

  const permission = await checkPermissions();
  console.warn('[Android Update] 当前权限状态:', permission);

  if (permission === 'granted') {
    console.warn('[Android Update] ✓ 已有安装权限');
    return true;
  }

  console.warn('[Android Update] 权限未授予，请求权限...');
  const result = await requestPermissions();
  console.warn('[Android Update] 权限请求结果:', result);

  if (result !== 'granted') {
    console.error('[Android Update] ✗ 用户拒绝了安装权限');
    throw new Error('用户拒绝了安装权限');
  }

  console.warn('[Android Update] ✓ 权限已授予');
  return true;
}

// ============================================
// 安装 APK
// ============================================

/**
 * 安装 APK
 * 注意：调用前应先调用 ensureInstallPermission() 确保有权限
 *
 * @param apkPath - APK 本地路径
 */
export async function installApk(apkPath: string): Promise<void> {
  console.warn('[Android Update] ========== installApk 开始 ==========');
  console.warn('[Android Update] APK 路径:', apkPath);

  // 调用系统安装器
  console.warn('[Android Update] 调用系统安装器...');
  try {
    await install(apkPath);
    console.warn('[Android Update] ✓ 系统安装器已启动');
  } catch (err) {
    console.error('[Android Update] ✗ 调用安装器失败:', err);
    throw err;
  }
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

/**
 * Android 更新服务
 *
 * 与桌面端 service.ts 完全隔离，专门处理 Android 平台的更新逻辑：
 * - 从 android-latest.json 检查更新（自建 Cloudflare 优先，GitHub 直连备用）
 * - 使用 Rust 后端下载 APK 到本地存储
 * - 使用 tauri-plugin-android-package-install 安装 APK
 *
 * 注意：
 * - 桌面端使用 @tauri-apps/plugin-updater，支持自动安装和重启
 * - Android 需要调用系统安装器，用户手动确认安装
 *
 * ## 前台/后台分工（别再把安装挂在下载 Promise 后面）
 *
 * 拉起系统安装器本质是 `startActivity`，而 Android 10 (API 29) 起**后台应用不许启动
 * Activity**，且系统是**静默**拦截（调用方既没有返回值也没有异常，只有 logcat 里一行
 * `Background activity launch blocked!`）——
 * <https://developer.android.com/guide/components/activities/background-starts>
 *
 * 所以本模块的分工是：
 * - **前台**：`installApk()` 直接拉安装器（合法的前台启动）
 * - **后台**：完全不碰安装器；由 Rust 侧写「待安装」标记 + 发通知
 *   （通知点击走系统 PendingIntent，正是官方豁免清单里唯一适用的那条），
 *   用户回到前台后再由 `getPendingApkInstall()` 恢复出「可安装」状态
 */

import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  checkPermissions,
  requestPermissions,
  install,
} from '@kingsword/tauri-plugin-android-package-install';
import {
  SELF_HOSTED_ANDROID_JSON,
  GITHUB_ANDROID_JSON,
  SOURCE_TIMEOUT_SECONDS,
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
  /**
   * APK 的 sha256（小写十六进制，64 位）—— 由发布流水线对**即将分发的那份字节**算出
   * 并写进清单（`.github/workflows/release.yml` 的 `APK_SHA256`）。
   *
   * 🔴 下载完成后**必须**在 Rust 侧逐字节校验（`download_apk` 的 `sha256` 参数）：
   * 这条链的终点是把 APK 交给系统安装器，任何能污染对象存储或劫持 GitHub 回退源的路径，
   * 没有它就等于「静默下载并拉起任意 APK 的安装」。
   */
  apkSha256?: string;
}

/** android-latest.json 文件格式 */
interface AndroidLatestJson {
  version: string;
  notes?: string;
  url: string;
  /** APK 的 sha256（小写十六进制 64 位），由发布流水线写入 */
  sha256?: string;
}

/** 下载进度回调参数 */
export interface AndroidDownloadProgress {
  /** 百分比（0-100） */
  percent: number;
  /** 已下载大小（字节） */
  downloaded: number;
  /** 总大小（字节） */
  total: number;
  /** 当前使用的源（用于 UI 显示） */
  sourceHost?: string;
}

export type AndroidProgressCallback = (progress: AndroidDownloadProgress) => void;

/** 已下完、等待用户确认安装的 APK（真值在 Rust 侧的标记文件，见 android_update.rs） */
export interface PendingApkInstall {
  /** 待安装包版本号 */
  version: string;
  /** APK 本地绝对路径 */
  path: string;
  /** 下载完成时的字节数 */
  size: number;
}

// ============================================
// webview 可见性上报
// ============================================

/** 上报可见性用的事件名（与 Rust 侧 `UI_VISIBILITY_EVENT` 必须一致） */
const UI_VISIBILITY_EVENT = 'apk-ui-visibility';

/**
 * 把当前 webview 是否可见上报给 Rust
 *
 * 为什么必须由 JS 主动推、而不是 Rust 去问：
 * JS → Rust 是**同步**的（`Ipc.postMessage` 是 `@JavascriptInterface`，由 JS 线程直接调进
 * Rust，见 gen/android 生成的 `Ipc.kt`），应用切后台那一刻的 `visibilitychange` 能可靠送达；
 * 反方向 Rust → JS 要经 Android 主线程 `post{} + evaluateJavascript`（`RustWebView.kt`），
 * webview 被 pause / 进程进 cached 态后不可靠。
 *
 * 失败不抛：这只是给 Rust 的一个提示，拿不到时 Rust 按「可见」兜底（多发一条通知
 * 远好过该发不发）。
 */
export async function reportUiVisibility(visible: boolean): Promise<void> {
  try {
    await emit(UI_VISIBILITY_EVENT, { visible });
  } catch (e) {
    console.warn('[Android Update] 上报可见性失败:', e);
  }
}

// ============================================
// 待安装包查询
// ============================================

/**
 * 查询是否有「已下完、待安装」的 APK
 *
 * 冷启动 + 每次重回前台各查一次。它是这两个症状的解药：
 * - 切回来只看到一个卡死的满进度条（内存里的 store 状态已经没意义了，以磁盘标记为准）
 * - 必须清掉后台重新下一遍（APK 其实还在缓存目录里，不必重下）
 *
 * 查不到（非 Android / 无标记 / 文件已被系统清缓存）一律返回 null，不抛。
 */
export async function getPendingApkInstall(): Promise<PendingApkInstall | null> {
  try {
    return await invoke<PendingApkInstall | null>('pending_apk_install');
  } catch (e) {
    console.warn('[Android Update] 查询待安装包失败:', e);
    return null;
  }
}

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
// 单源拉取
// ============================================

async function fetchAndroidLatest(
  url: string,
  currentVersion: string,
  sourceLabel: string,
): Promise<AndroidUpdateInfo> {
  console.warn(`[Android Update] 尝试 ${sourceLabel}: ${url}`);
  const response = await invoke<string>('fetch_update_json', {
    url,
    timeoutSecs: SOURCE_TIMEOUT_SECONDS,
  });
  const data: AndroidLatestJson = JSON.parse(response);
  console.warn(`[Android Update] ${sourceLabel} 返回版本:`, data.version);

  const comparison = compareVersions(data.version, currentVersion);
  if (comparison > 0) {
    console.warn(`[Android Update] ✓ ${sourceLabel} 发现新版本:`, data.version);
    return {
      available: true,
      version: data.version,
      notes: data.notes,
      apkUrl: data.url,
      apkSha256: data.sha256,
    };
  }
  console.warn(`[Android Update] ✓ 已是最新版本 (${sourceLabel})`);
  return { available: false };
}

// ============================================
// 更新检查
// ============================================

/**
 * 检查是否有可用更新
 *
 * 顺序：
 * 1. 自建 Cloudflare R2（store.huanvae.cn） — 优先
 * 2. GitHub Release 直连 — 备用
 */
export async function checkForUpdates(): Promise<AndroidUpdateInfo> {
  const currentVersion = await getCurrentVersion();
  console.warn('[Android Update] ========== 开始检查更新 ==========');
  console.warn('[Android Update] 当前版本:', currentVersion);

  try {
    return await fetchAndroidLatest(SELF_HOSTED_ANDROID_JSON, currentVersion, '自建源 Cloudflare');
  } catch (e) {
    console.warn('[Android Update] 自建源失败，回退到 GitHub 直连:', e);
  }

  try {
    return await fetchAndroidLatest(GITHUB_ANDROID_JSON, currentVersion, 'GitHub 直连');
  } catch (e) {
    console.warn('[Android Update] ✗ GitHub 直连也失败:', e);
  }

  console.warn('[Android Update] ✗ 所有更新源均不可达');
  return { available: false };
}

// ============================================
// 下载 APK
// ============================================

/**
 * 下载 APK 到本地存储
 *
 * ⚠️ 这个 Promise **不能**被当成「安装的触发器」来用：应用切后台时 webview 被 pause、
 * 进程还可能进 cached 态，Rust → JS 的响应投递不可靠，于是它可能迟迟不 resolve
 * （用户看到的就是「切回来只有一个满进度条」）。真正跨进程可靠的完成收尾在 Rust 侧
 * （写待安装标记 + 不可见时发通知），见 `src-tauri/src/android_update.rs` 模块头注释。
 *
 * @param url - APK 下载地址
 * @param version - 目标版本号（写进待安装标记与通知文案）
 * @param sha256 - 清单给出的 APK sha256（小写十六进制 64 位）；
 *                 Rust 侧下完后逐字节校验，**不合法或对不上一律失败**，绝不放行安装
 * @param onProgress - 进度回调
 * @returns 本地文件路径
 */
export async function downloadApk(
  url: string,
  version: string,
  sha256: string,
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
    const localPath = await invoke<string>('download_apk', { url, version, sha256 });
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
 * 拉起系统安装器（发射后不管）
 *
 * ## ⚠️ 返回 `void` 而不是 `Promise` 是故意的 —— 千万别改回 async
 *
 * `tauri-plugin-android-package-install` 2.0.2 的 Kotlin 侧 `install` 命令
 * （`android/src/main/java/PackageInstallPlugin.kt`）**在所有路径上都不调
 * `invoke.resolve()` / `invoke.reject()`**：
 *
 * ```kotlin
 * @Command
 * fun install(invoke: Invoke) {
 *   …
 *   try { activity.startActivity(installIntent) }
 *   catch (e: ActivityNotFoundException) { Toast… }
 *   catch (e: SecurityException) { Toast… }
 * }   // ← 没有 resolve，也没有 reject
 * ```
 *
 * 于是成功路径上底层 invoke 的 Promise **永远不会 settle**。谁 `await` 它谁就永久挂起，
 * 它后面的代码一行都跑不到 —— 这正是旧实现「卡在满进度条」的直接机制：
 * `await install()` 永不返回 ⇒ 既到不了 `dismiss()`、也进不了 `catch`，
 * store 永远停在 `downloading` + progress=100。（Android 14 真机 logcat 实测：
 * 整场 `调用系统安装器` 2 次、`✓ 已启动` 0 次、`✗ 失败` 0 次。）
 *
 * 前台之所以看不出问题，只是因为安装器盖住了界面、应用随后被替换，
 * 那个悬挂的 Promise 没人看见——它一直都在。
 *
 * ## 另外：后台调用会被系统静默丢弃
 *
 * 拉安装器就是 `startActivity`，Android 10 起后台应用不许启动 Activity，
 * 且**不抛异常**（真机实测 `ActivityTaskManager: Background activity launch blocked …
 * (BAL_BLOCK) result code=102`，插件的两个 catch 一个都没触发）。
 * 所以调用方必须自己先确认应用可见，别指望这里报错。
 *
 * @param apkPath - APK 本地路径（调用前应先 ensureInstallPermission()）
 * @param onLaunchError - 拉起失败回调。`startActivity` 之前发生的失败（参数错误、
 *   FileProvider 抛 IllegalArgumentException 等）仍会被 Tauri 插件框架 reject 出来，
 *   由它收口；成功时**不会**有任何回调（见上）。
 */
export function installApk(
  apkPath: string,
  onLaunchError?: (message: string) => void,
): void {
  console.warn('[Android Update] ========== installApk 开始 ==========');
  console.warn('[Android Update] APK 路径:', apkPath);
  console.warn('[Android Update] 调用系统安装器（不 await，插件成功路径不 settle）...');

  void install(apkPath).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Android Update] ✗ 调用安装器失败:', message);
    onLaunchError?.(message);
  });
}

// ============================================
// 工具函数 - 从 utils/url.ts 导入
// ============================================

export { extractHostname } from '../utils/url';

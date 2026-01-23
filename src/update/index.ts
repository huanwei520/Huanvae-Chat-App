/**
 * 更新模块导出
 *
 * 提供应用自动更新功能：
 * - UpdateToast: 灵动岛风格更新提示组件（所有平台共用）
 * - useSilentUpdate: 桌面端静默更新 Hook
 * - useSilentUpdateAndroid: Android 静默更新 Hook
 * - usePlatformUpdate: 跨平台更新 Hook（自动选择平台实现）
 *
 * 平台隔离：
 * - 桌面端 (Windows/macOS/Linux): 使用 @tauri-apps/plugin-updater
 * - Android: 使用自定义服务 + tauri-plugin-android-package-install
 */

// ============================================
// UI 组件（所有平台共用）
// ============================================
export {
  UpdateToast,
  useUpdateToast,
  type UpdateToastProps,
  type UpdateToastStatus,
  type UseUpdateToastReturn,
} from './components';

// ============================================
// 桌面端 Hook 和服务
// ============================================
export { useSilentUpdate } from './useSilentUpdate';

export {
  checkForUpdates,
  downloadAndInstall,
  restartApp,
  checkAndUpdate,
  formatSize,
  type UpdateInfo,
  type DownloadProgress,
  type ProgressCallback,
} from './service';

// ============================================
// Android Hook 和服务
// ============================================
export { useSilentUpdateAndroid } from './useSilentUpdate.android';

export {
  checkForUpdates as checkForUpdatesAndroid,
  downloadApk,
  installApk,
  extractProxyHost,
  formatSize as formatSizeAndroid,
  type AndroidUpdateInfo,
  type AndroidDownloadProgress,
  type AndroidProgressCallback,
} from './service.android';

// ============================================
// 跨平台 Hook
// ============================================
export { usePlatformUpdate } from './usePlatformUpdate';

// ============================================
// 配置
// ============================================
export {
  PROXY_URLS,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_RELEASE_BASE,
  ANDROID_LATEST_JSON_PATH,
  DESKTOP_LATEST_JSON_PATH,
  UPDATE_CHECK_DELAY,
  PROXY_TIMEOUT_SECONDS,
  DEBUG_UPDATE,
} from './config';

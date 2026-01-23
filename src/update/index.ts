/**
 * 更新模块导出
 *
 * 提供应用自动更新功能：
 * - UpdateToast: 灵动岛风格更新提示组件（所有平台共用）
 * - useUpdateStore: 全局更新状态管理（Zustand Store）
 * - useAutoUpdateCheck: 桌面端自动更新检查 Hook
 * - useAutoUpdateCheckAndroid: Android 自动更新检查 Hook
 *
 * 架构说明：
 * - UpdateToast 在 App.tsx 统一渲染（全局唯一实例）
 * - 各页面使用 useAutoUpdateCheck/useAutoUpdateCheckAndroid 触发检查
 * - 所有状态通过 useUpdateStore 全局管理，防止多实例弹窗
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
// 全局状态管理（推荐使用）
// ============================================
export {
  useUpdateStore,
  useUpdateToastProps,
  useCheckUpdate,
  useIsChecking,
} from './store';

// ============================================
// 桌面端 Hook 和服务
// ============================================
export { useSilentUpdate, useAutoUpdateCheck } from './useSilentUpdate';

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
export { useSilentUpdateAndroid, useAutoUpdateCheckAndroid } from './useSilentUpdate.android';

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
// 跨平台 Hook（已废弃，推荐使用 useUpdateStore）
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

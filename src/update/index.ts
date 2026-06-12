/**
 * 更新模块导出
 *
 * 提供应用自动更新功能：
 * - UpdateToast: 灵动岛风格更新提示组件（所有平台共用）
 * - useUpdateStore: 全局更新状态管理（Zustand Store）
 * - useStartupUpdateCheck: 启动时自动更新检查 Hook（App.tsx 顶层，登录前 5s 后触发）
 * - useAutoUpdateCheck: 桌面端登录后自动更新检查 Hook（Main mount 3s 后触发）
 * - useAutoUpdateCheckAndroid: Android 登录后自动更新检查 Hook（MobileMain mount 3s 后触发）
 *
 * 架构说明：
 * - UpdateToast 在 App.tsx 的所有分支独立渲染（分支互斥 → 同时刻只有一个实例 mount）
 * - App.tsx 顶层调 useStartupUpdateCheck 在登录页就触发检测
 * - 登录后 Main/MobileMain 各自再触发一次，store 双锁（isChecking + status !== 'idle'）保证只一次有效检测
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
// 启动时 Hook（App.tsx 顶层使用，登录前就触发一次检测）
// ============================================
export { useStartupUpdateCheck } from './useStartupUpdateCheck';

// ============================================
// 桌面端 Hook 和服务
// ============================================
export { useAutoUpdateCheck } from './useSilentUpdate';

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
export { useAutoUpdateCheckAndroid } from './useSilentUpdate.android';

export {
  checkForUpdates as checkForUpdatesAndroid,
  downloadApk,
  installApk,
  extractHostname,
  type AndroidUpdateInfo,
  type AndroidDownloadProgress,
  type AndroidProgressCallback,
} from './service.android';

// ============================================
// 配置
// ============================================
export {
  SELF_HOSTED_BASE,
  SELF_HOSTED_DESKTOP_JSON,
  SELF_HOSTED_ANDROID_JSON,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_RELEASE_BASE,
  GITHUB_ANDROID_JSON,
  ANDROID_LATEST_JSON_PATH,
  DESKTOP_LATEST_JSON_PATH,
  UPDATE_CHECK_DELAY,
  UPDATE_CHECK_DELAY_STARTUP,
  SOURCE_TIMEOUT_SECONDS,
  DEBUG_UPDATE,
} from './config';

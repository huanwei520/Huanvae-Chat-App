/**
 * 更新模块导出
 *
 * 提供应用自动更新功能：
 * - UpdateToast: 灵动岛风格更新提示组件
 * - useSilentUpdate: 静默更新 Hook
 * - 更新服务函数
 */

// 组件
export {
  UpdateToast,
  useUpdateToast,
  type UpdateToastProps,
  type UpdateToastStatus,
  type UseUpdateToastReturn,
} from './components';

// Hook
export { useSilentUpdate } from './useSilentUpdate';

// 服务
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

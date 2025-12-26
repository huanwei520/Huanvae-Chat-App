/**
 * 应用更新模块
 *
 * 提供自动更新功能：
 * - 静默更新 Hook（推荐使用）
 * - 底层更新服务（高级用法）
 *
 * 基本用法：
 * ```tsx
 * import { useSilentUpdate } from './update';
 *
 * function App() {
 *   useSilentUpdate();
 *   return <div>...</div>;
 * }
 * ```
 *
 * 高级用法（手动控制更新流程）：
 * ```tsx
 * import { checkForUpdates, downloadAndInstall, restartApp } from './update';
 *
 * async function manualUpdate() {
 *   const info = await checkForUpdates();
 *   if (info.available && info.update) {
 *     await downloadAndInstall(info.update, (progress) => {
 *       console.log(`下载进度: ${progress.percent}%`);
 *     });
 *     await restartApp();
 *   }
 * }
 * ```
 */

// 静默更新 Hook
export { useSilentUpdate } from './useSilentUpdate';

// 底层服务
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


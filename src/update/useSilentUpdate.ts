/**
 * 静默更新 Hook
 *
 * 在应用启动时自动检查更新，后台静默下载：
 * - 检测到更新时发送系统通知提醒用户
 * - 后台静默下载，不显示进度 UI
 * - 下载完成后自动重启安装
 * - 只有发生错误时才通知用户
 *
 * 使用方式：
 * ```tsx
 * function App() {
 *   useSilentUpdate();
 *   return <div>...</div>;
 * }
 * ```
 */

import { useEffect } from 'react';
import { checkForUpdates, downloadAndInstall, restartApp } from './service';
import { notify } from '../services/notificationService';

/** GitHub 仓库地址 */
const GITHUB_REPO = 'https://github.com/huanwei520/Huanvae-Chat-App';

/**
 * 静默更新 Hook
 *
 * @param delay - 延迟检查时间（毫秒），默认 2000ms
 */
export function useSilentUpdate(delay: number = 2000): void {
  useEffect(() => {
    const checkAndSilentUpdate = async () => {
      try {
        // 检查更新
        const info = await checkForUpdates();
        if (!info.available || !info.update) {
          return;
        }

        // 发送系统通知提醒用户
        const releaseUrl = `${GITHUB_REPO}/releases/tag/v${info.version}`;
        await notify({
          title: '发现新版本',
          body: `v${info.version} 可用\n${info.notes || 'Huanvae Chat 更新'}\n查看完整更新日志: ${releaseUrl}`,
        });

        // 后台静默下载
        await downloadAndInstall(info.update);

        // 下载完成，重启应用
        await restartApp();
      } catch (err) {
        // 只有报错时才通知用户
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error('[Update] 更新失败:', errorMsg);
        await notify({
          title: '更新失败',
          body: errorMsg,
        });
      }
    };

    // 延迟检查更新，避免影响启动体验
    const timer = setTimeout(checkAndSilentUpdate, delay);
    return () => clearTimeout(timer);
  }, [delay]);
}

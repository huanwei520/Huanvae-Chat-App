/**
 * 静默更新 Hook
 *
 * 在应用启动时自动检查更新，使用灵动岛风格弹窗提示：
 * - 检测到更新时显示顶部弹窗，用户可选择更新或稍后
 * - 点击更新后显示下载进度和当前代理链接
 * - 下载完成后提示重启
 * - 发生错误时显示错误信息，可重试
 *
 * 使用方式：
 * ```tsx
 * function App() {
 *   const { toastProps } = useSilentUpdate();
 *   return (
 *     <>
 *       <UpdateToast {...toastProps} />
 *       <div>...</div>
 *     </>
 *   );
 * }
 * ```
 */

import { useEffect, useCallback, useRef } from 'react';
import { checkForUpdates, downloadAndInstall, restartApp, type UpdateInfo } from './service';
import { useUpdateToast, type UpdateToastProps } from './components';

/** 更新检查延迟时间（毫秒） */
const CHECK_DELAY = 3000;

/** 开发环境模拟更新（设为 true 可在本地测试弹窗） */
const DEBUG_UPDATE = false;

/**
 * 静默更新 Hook
 *
 * @returns 更新弹窗的 props
 */
export function useSilentUpdate(): { toastProps: UpdateToastProps } {
  const toast = useUpdateToast();
  const updateInfoRef = useRef<UpdateInfo | null>(null);
  const currentProxyRef = useRef<string>('');

  // 检查更新
  const checkUpdate = useCallback(async () => {
    // 开发环境模拟更新弹窗
    if (DEBUG_UPDATE) {
      toast.showAvailable('1.0.8', '这是一个测试更新说明');
      return;
    }

    try {
      const info = await checkForUpdates();
      if (info.available && info.update && info.version) {
        updateInfoRef.current = info;
        toast.showAvailable(info.version, info.notes);
      }
    } catch (err) {
      // 静默失败，不显示错误
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn('[Update] 检查更新失败:', errorMsg);
    }
  }, [toast]);

  // 开始下载
  const handleUpdate = useCallback(async () => {
    const info = updateInfoRef.current;
    if (!info?.update) {
      return;
    }

    toast.startDownload();

    try {
      await downloadAndInstall(info.update, (progress) => {
        toast.updateProgress(
          progress.percent || 0,
          progress.downloaded || 0,
          progress.contentLength || 0,
          currentProxyRef.current,
        );
      });

      toast.downloadComplete();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      toast.showError(errorMsg);
    }
  }, [toast]);

  // 重启应用
  const handleRestart = useCallback(async () => {
    try {
      await restartApp();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      toast.showError(`重启失败: ${errorMsg}`);
    }
  }, [toast]);

  // 重试更新
  const handleRetry = useCallback(() => {
    handleUpdate();
  }, [handleUpdate]);

  // 关闭弹窗
  const handleDismiss = useCallback(() => {
    toast.dismiss();
  }, [toast]);

  // 启动时检查更新
  useEffect(() => {
    const timer = setTimeout(checkUpdate, CHECK_DELAY);
    return () => clearTimeout(timer);
  }, [checkUpdate]);

  // 构建 props
  const toastProps: UpdateToastProps = {
    status: toast.status,
    version: toast.version,
    notes: toast.notes,
    progress: toast.progress,
    downloaded: toast.downloaded,
    total: toast.total,
    proxyUrl: toast.proxyUrl,
    errorMessage: toast.errorMessage,
    onUpdate: handleUpdate,
    onDismiss: handleDismiss,
    onRestart: handleRestart,
    onRetry: handleRetry,
  };

  return { toastProps };
}

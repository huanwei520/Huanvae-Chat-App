/**
 * Android 静默更新 Hook
 *
 * 与桌面端 useSilentUpdate.ts 完全隔离，专门处理 Android 平台的更新逻辑。
 *
 * 与桌面端的区别：
 * - 使用 android-latest.json 检查更新
 * - 下载 APK 到本地存储
 * - 调用系统安装器安装（用户手动确认）
 * - 无需重启（安装器会处理应用替换）
 *
 * 使用方式：
 * ```tsx
 * function App() {
 *   const { toastProps } = useSilentUpdateAndroid();
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
import {
  checkForUpdates,
  downloadApk,
  installApk,
  extractProxyHost,
  type AndroidUpdateInfo,
} from './service.android';
import { useUpdateToast, type UpdateToastProps } from './components';
import { UPDATE_CHECK_DELAY, DEBUG_UPDATE, PROXY_URLS } from './config';

/**
 * Android 静默更新 Hook
 *
 * @returns 更新弹窗的 props
 */
export function useSilentUpdateAndroid(): { toastProps: UpdateToastProps } {
  const toast = useUpdateToast();
  const updateInfoRef = useRef<AndroidUpdateInfo | null>(null);
  const currentProxyIndexRef = useRef(0);

  // 检查更新
  const checkUpdate = useCallback(async () => {
    // 开发环境模拟更新弹窗
    if (DEBUG_UPDATE) {
      toast.showAvailable('1.0.99', '这是 Android 测试更新说明');
      updateInfoRef.current = {
        available: true,
        version: '1.0.99',
        notes: '测试更新',
        apkUrl: 'https://example.com/test.apk',
      };
      return;
    }

    try {
      console.log('[Android Update] 开始检查更新...');
      const info = await checkForUpdates();

      if (info.available && info.version) {
        console.log('[Android Update] 发现新版本:', info.version);
        updateInfoRef.current = info;
        toast.showAvailable(info.version, info.notes);
      } else {
        console.log('[Android Update] 已是最新版本');
      }
    } catch (err) {
      // 静默失败，不显示错误
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn('[Android Update] 检查更新失败:', errorMsg);
    }
  }, [toast]);

  // 开始下载并安装
  const handleUpdate = useCallback(async () => {
    const info = updateInfoRef.current;
    if (!info?.apkUrl) {
      console.error('[Android Update] 没有可用的下载地址');
      return;
    }

    toast.startDownload();
    currentProxyIndexRef.current = 0;

    try {
      console.log('[Android Update] 开始下载 APK:', info.apkUrl);

      // 下载 APK
      const localPath = await downloadApk(info.apkUrl, (progress) => {
        // 从 URL 中提取当前代理
        const proxyHost = extractProxyHost(
          PROXY_URLS[currentProxyIndexRef.current] || '',
        );
        toast.updateProgress(
          progress.percent,
          progress.downloaded,
          progress.total,
          proxyHost,
        );
      });

      console.log('[Android Update] 下载完成:', localPath);
      toast.downloadComplete();

      // 安装 APK（会跳转到系统安装器）
      await installApk(localPath);

      // 安装器启动后关闭弹窗
      // 注意：用户可能取消安装，此时应用仍在运行
      toast.dismiss();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[Android Update] 更新失败:', errorMsg);
      toast.showError(errorMsg);
    }
  }, [toast]);

  // Android 不需要重启按钮（系统安装器会处理）
  // 但为了保持接口一致，提供一个空操作
  const handleRestart = useCallback(() => {
    // Android 安装完成后系统会自动重启应用
    console.log('[Android Update] Android 不需要手动重启');
    toast.dismiss();
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
    const timer = setTimeout(checkUpdate, UPDATE_CHECK_DELAY);
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

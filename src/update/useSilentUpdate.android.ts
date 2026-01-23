/**
 * Android 静默更新 Hook
 *
 * 在应用启动时自动检查更新，使用全局 store 管理状态。
 *
 * 注意：此 Hook 仅负责触发检查，弹窗渲染由 App.tsx 统一处理。
 *
 * 与桌面端的区别：
 * - 使用 android-latest.json 检查更新
 * - 下载 APK 到本地存储
 * - 调用系统安装器安装（用户手动确认）
 * - 无需重启（安装器会处理应用替换）
 *
 * 使用方式：
 * ```tsx
 * function MobileMain() {
 *   // 启动时自动检查更新
 *   useAutoUpdateCheckAndroid();
 *   return <div>...</div>;
 * }
 * ```
 */

import { useEffect } from 'react';
import { useUpdateStore } from './store';
import { UPDATE_CHECK_DELAY, DEBUG_UPDATE } from './config';

/**
 * 自动更新检查 Hook（Android）
 *
 * 在组件挂载后延迟检查更新，使用全局 store 管理状态
 */
export function useAutoUpdateCheckAndroid(): void {
  const checkUpdate = useUpdateStore((s) => s.checkUpdate);
  const showAvailable = useUpdateStore((s) => s.showAvailable);

  useEffect(() => {
    console.warn('[Android Update Hook] useAutoUpdateCheckAndroid 挂载');

    // 开发环境模拟更新弹窗
    if (DEBUG_UPDATE) {
      console.warn('[Android Update Hook] 使用模拟更新数据');
      const timer = setTimeout(() => {
        showAvailable('1.0.99', '这是 Android 测试更新说明');
      }, UPDATE_CHECK_DELAY);
      return () => clearTimeout(timer);
    }

    // 延迟检查更新
    console.warn('[Android Update Hook] 将在', UPDATE_CHECK_DELAY, 'ms 后检查更新');
    const timer = setTimeout(checkUpdate, UPDATE_CHECK_DELAY);
    return () => clearTimeout(timer);
  }, [checkUpdate, showAvailable]);
}

/**
 * @deprecated 请使用 useAutoUpdateCheckAndroid() 替代
 * 保留此导出以兼容旧代码，内部使用全局 store
 */
export function useSilentUpdateAndroid() {
  // 触发自动检查
  useAutoUpdateCheckAndroid();

  // 返回全局 store 的 toast props
  const toastProps = useUpdateStore((s) => s.getToastProps());
  return { toastProps };
}

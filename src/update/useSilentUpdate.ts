/**
 * 桌面端静默更新 Hook
 *
 * 在应用启动时自动检查更新，使用全局 store 管理状态。
 *
 * 注意：此 Hook 仅负责触发检查，弹窗渲染由 App.tsx 统一处理。
 *
 * 使用方式：
 * ```tsx
 * function Main() {
 *   // 启动时自动检查更新
 *   useAutoUpdateCheck();
 *   return <div>...</div>;
 * }
 * ```
 */

import { useEffect } from 'react';
import { useUpdateStore } from './store';
import { UPDATE_CHECK_DELAY, DEBUG_UPDATE } from './config';

/**
 * 自动更新检查 Hook（桌面端）
 *
 * 在组件挂载后延迟检查更新，使用全局 store 管理状态
 */
export function useAutoUpdateCheck(): void {
  const checkUpdate = useUpdateStore((s) => s.checkUpdate);
  const showAvailable = useUpdateStore((s) => s.showAvailable);

  useEffect(() => {
    // 开发环境模拟更新弹窗
    if (DEBUG_UPDATE) {
      const timer = setTimeout(() => {
        showAvailable('1.0.99', '这是桌面端测试更新说明');
      }, UPDATE_CHECK_DELAY);
      return () => clearTimeout(timer);
    }

    // 延迟检查更新
    const timer = setTimeout(checkUpdate, UPDATE_CHECK_DELAY);
    return () => clearTimeout(timer);
  }, [checkUpdate, showAvailable]);
}

/**
 * @deprecated 请使用 useAutoUpdateCheck() 替代
 * 保留此导出以兼容旧代码，内部使用全局 store
 */
export function useSilentUpdate() {
  // 触发自动检查
  useAutoUpdateCheck();

  // 返回全局 store 的 toast props
  const toastProps = useUpdateStore((s) => s.getToastProps());
  return { toastProps };
}

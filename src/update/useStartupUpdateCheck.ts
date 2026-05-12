/**
 * 启动时更新检查 Hook（应用首次 mount 时使用）
 *
 * 与 useAutoUpdateCheck / useAutoUpdateCheckAndroid 的区别：
 * - 在 App.tsx 顶层调用，应用启动阶段（登录前）就触发一次检测
 * - 延迟 UPDATE_CHECK_DELAY_STARTUP（5s）vs 主页 hook 的 UPDATE_CHECK_DELAY（3s），
 *   错峰避免视觉重叠（store 的 isChecking + status !== 'idle' 双锁也会兜底保证只一次有效检测）
 * - 不区分平台：store.checkUpdate 内部已按 isMobile() 分流到桌面/移动版服务
 *
 * 使用方式：
 * ```tsx
 * function App() {
 *   useStartupUpdateCheck();
 *   return <UpdateToast {...updateToastProps} /> ...;
 * }
 * ```
 */

import { useEffect } from 'react';
import { useUpdateStore } from './store';
import { UPDATE_CHECK_DELAY_STARTUP, DEBUG_UPDATE } from './config';

/**
 * 启动时更新检查 Hook
 *
 * 在 App mount 后延迟 UPDATE_CHECK_DELAY_STARTUP 毫秒触发一次更新检查，
 * 让登录页 UI 先稳定渲染再弹更新提示，避免与登录后 Main 的检测视觉重叠。
 */
export function useStartupUpdateCheck(): void {
  const checkUpdate = useUpdateStore((s) => s.checkUpdate);
  const showAvailable = useUpdateStore((s) => s.showAvailable);

  useEffect(() => {
    if (DEBUG_UPDATE) {
      const timer = setTimeout(() => {
        showAvailable('1.0.99', '启动时模拟更新提示');
      }, UPDATE_CHECK_DELAY_STARTUP);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(checkUpdate, UPDATE_CHECK_DELAY_STARTUP);
    return () => clearTimeout(timer);
  }, [checkUpdate, showAvailable]);
}

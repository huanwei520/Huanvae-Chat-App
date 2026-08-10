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
import { isMobile } from '../utils/platform';

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

  useAndroidPendingInstallBridge();
}

/**
 * Android：可见性上报 + 待安装包恢复
 *
 * 挂在 App 顶层（跟着 useStartupUpdateCheck 一起，全生命周期常驻），做两件事：
 *
 * 1. **上报可见性给 Rust** —— Rust 靠它决定「下载完成时该不该发通知」。
 *    必须由 JS 推：JS → Rust 是同步 JNI 调用（`Ipc.kt` 的 `@JavascriptInterface`），
 *    切后台那一刻的 `visibilitychange` 送得到；反方向要经主线程 `evaluateJavascript`，
 *    webview 被 pause 后不可靠。
 * 2. **每次回到前台查一次待安装包** —— 这一条直接对应用户报的两个现象：
 *    「切回来只剩一个满进度条」和「必须清后台重下一遍」。内存里的下载状态在
 *    进程被回收后就没了，磁盘标记才是真值。
 */
function useAndroidPendingInstallBridge(): void {
  const restorePendingInstall = useUpdateStore((s) => s.restorePendingInstall);

  useEffect(() => {
    if (!isMobile()) {
      return;
    }

    let cancelled = false;

    const syncVisibility = () => {
      const visible = document.visibilityState !== 'hidden';
      void import('./service.android').then(({ reportUiVisibility }) => {
        if (!cancelled) {
          void reportUiVisibility(visible);
        }
      });
      // 回到前台：磁盘上可能已经躺着一个下好的包（后台下完的，或上个进程留下的）
      if (visible) {
        void restorePendingInstall();
      }
    };

    // 首次挂载即上报一次当前状态 + 查一次待安装包（覆盖冷启动路径）
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, [restorePendingInstall]);
}

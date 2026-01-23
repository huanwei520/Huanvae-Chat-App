/**
 * 更新模块全局状态管理
 *
 * 使用 Zustand 实现全局单例状态，解决多个组件创建多个弹窗的问题。
 *
 * 设计目标：
 * - 全局唯一的更新弹窗状态
 * - 防止并发检查更新（全局锁）
 * - 支持桌面端和移动端
 * - 自动平台检测
 *
 * 使用方式：
 * ```tsx
 * // 在 App.tsx 中渲染唯一的 UpdateToast
 * function App() {
 *   const toastProps = useUpdateStore((s) => s.toastProps);
 *   return <UpdateToast {...toastProps} />;
 * }
 *
 * // 在任何组件中触发检查更新
 * const checkUpdate = useUpdateStore((s) => s.checkUpdate);
 * checkUpdate();
 * ```
 */

import { create } from 'zustand';
import { isMobile } from '../utils/platform';
import type { UpdateToastStatus, UpdateToastProps } from './components/UpdateToast';

// 动态导入，避免循环依赖
import type { UpdateInfo } from './service';
import type { AndroidUpdateInfo } from './service.android';

// ============================================
// 类型定义
// ============================================

interface UpdateStoreState {
  // 弹窗状态
  status: UpdateToastStatus;
  version: string;
  notes: string;
  progress: number;
  downloaded: number;
  total: number;
  proxyUrl: string;
  errorMessage: string;

  // 锁状态
  isChecking: boolean;

  // 缓存的更新信息
  desktopUpdateInfo: UpdateInfo | null;
  androidUpdateInfo: AndroidUpdateInfo | null;
}

interface UpdateStoreActions {
  // 弹窗操作
  showAvailable: (version: string, notes?: string) => void;
  startDownload: () => void;
  updateProgress: (progress: number, downloaded: number, total: number, proxyUrl?: string) => void;
  downloadComplete: () => void;
  showError: (message: string) => void;
  dismiss: () => void;

  // 更新检查（带锁）
  checkUpdate: () => Promise<void>;

  // 更新下载安装
  handleUpdate: () => Promise<void>;

  // 重启（桌面端）
  handleRestart: () => Promise<void>;

  // 重试
  handleRetry: () => void;

  // 获取 Toast props（便捷方法）
  getToastProps: () => UpdateToastProps;
}

type UpdateStore = UpdateStoreState & UpdateStoreActions;

// ============================================
// 初始状态
// ============================================

const initialState: UpdateStoreState = {
  status: 'idle',
  version: '',
  notes: '',
  progress: 0,
  downloaded: 0,
  total: 0,
  proxyUrl: '',
  errorMessage: '',
  isChecking: false,
  desktopUpdateInfo: null,
  androidUpdateInfo: null,
};

// ============================================
// Store 实现
// ============================================

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  ...initialState,

  // ========== 弹窗操作 ==========

  showAvailable: (version, notes) => {
    const state = get();
    // 防重：如果已经显示了相同版本，不重复显示
    if (state.status === 'available' && state.version === version) {
      console.warn('[UpdateStore] 跳过重复显示:', version);
      return;
    }
    console.warn('[UpdateStore] showAvailable:', version);
    set({ status: 'available', version, notes: notes || '' });
  },

  startDownload: () => {
    set({ status: 'downloading', progress: 0, downloaded: 0, total: 0 });
  },

  updateProgress: (progress, downloaded, total, proxyUrl) => {
    set({
      progress,
      downloaded,
      total,
      ...(proxyUrl ? { proxyUrl } : {}),
    });
  },

  downloadComplete: () => {
    set({ status: 'ready', progress: 100 });
  },

  showError: (message) => {
    set({ status: 'error', errorMessage: message });
  },

  dismiss: () => {
    set({ status: 'idle' });
  },

  // ========== 更新检查（带锁） ==========

  checkUpdate: async () => {
    const state = get();

    // 全局锁：防止并发检查
    if (state.isChecking) {
      console.warn('[UpdateStore] 跳过：正在检查中');
      return;
    }

    // 如果已经显示了弹窗，不重复检查
    if (state.status !== 'idle') {
      console.warn('[UpdateStore] 跳过：弹窗已显示，状态:', state.status);
      return;
    }

    set({ isChecking: true });
    console.warn('[UpdateStore] 开始检查更新...');

    try {
      if (isMobile()) {
        // 移动端
        const { checkForUpdates } = await import('./service.android');
        const info = await checkForUpdates();

        if (info.available && info.version) {
          set({ androidUpdateInfo: info });
          get().showAvailable(info.version, info.notes);
        } else {
          console.warn('[UpdateStore] 已是最新版本');
        }
      } else {
        // 桌面端
        const { checkForUpdates } = await import('./service');
        const info = await checkForUpdates();

        if (info.available && info.version && info.update) {
          set({ desktopUpdateInfo: info });
          get().showAvailable(info.version, info.notes);
        } else {
          console.warn('[UpdateStore] 已是最新版本');
        }
      }
    } catch (err) {
      console.error('[UpdateStore] 检查更新失败:', err);
      // 静默失败，不显示错误弹窗
    } finally {
      set({ isChecking: false });
    }
  },

  // ========== 更新下载安装 ==========

  handleUpdate: async () => {
    const state = get();
    const store = get();

    try {
      if (isMobile()) {
        // 移动端：先检查安装权限，再开始下载
        const info = state.androidUpdateInfo;
        if (!info?.apkUrl) {
          throw new Error('没有可用的下载地址');
        }

        const { downloadApk, installApk, ensureInstallPermission, extractProxyHost } = await import('./service.android');
        const { PROXY_URLS } = await import('./config');

        // 1. 先确保有安装权限（在下载前请求，避免时机冲突）
        console.warn('[UpdateStore] 检查安装权限...');
        await ensureInstallPermission();
        console.warn('[UpdateStore] ✓ 安装权限已就绪');

        // 2. 权限通过后开始下载
        store.startDownload();
        console.warn('[UpdateStore] 开始下载 APK:', info.apkUrl);
        const localPath = await downloadApk(info.apkUrl, (progress) => {
          const proxyHost = extractProxyHost(PROXY_URLS[0] || '');
          store.updateProgress(progress.percent, progress.downloaded, progress.total, proxyHost);
        });

        console.warn('[UpdateStore] 下载完成:', localPath);

        // 3. 直接调用安装器（权限已在步骤1获取）
        console.warn('[UpdateStore] 调用安装器...');
        await installApk(localPath);
        // 安装器启动后，系统会接管，应用可能被替换，直接关闭弹窗
        store.dismiss();
      } else {
        // 桌面端
        const info = state.desktopUpdateInfo;
        if (!info?.update) {
          throw new Error('没有可用的更新');
        }

        const { downloadAndInstall } = await import('./service');

        await downloadAndInstall(info.update, (progress) => {
          store.updateProgress(
            progress.percent || 0,
            progress.downloaded || 0,
            progress.contentLength || 0,
          );
        });

        store.downloadComplete();
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[UpdateStore] 更新失败:', errorMsg);
      store.showError(errorMsg);
    }
  },

  // ========== 重启（桌面端） ==========

  handleRestart: async () => {
    if (isMobile()) {
      // 移动端不需要手动重启
      console.warn('[UpdateStore] 移动端不需要手动重启');
      get().dismiss();
      return;
    }

    try {
      const { restartApp } = await import('./service');
      await restartApp();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      get().showError(`重启失败: ${errorMsg}`);
    }
  },

  // ========== 重试 ==========

  handleRetry: () => {
    get().handleUpdate();
  },

  // ========== 获取 Toast props ==========

  getToastProps: (): UpdateToastProps => {
    const state = get();
    return {
      status: state.status,
      version: state.version,
      notes: state.notes,
      progress: state.progress,
      downloaded: state.downloaded,
      total: state.total,
      proxyUrl: state.proxyUrl,
      errorMessage: state.errorMessage,
      onUpdate: state.handleUpdate,
      onDismiss: state.dismiss,
      onRestart: state.handleRestart,
      onRetry: state.handleRetry,
    };
  },
}));

// ============================================
// 便捷 Hooks
// ============================================

/**
 * 获取更新弹窗 props（用于渲染 UpdateToast）
 *
 * 注意：直接选择状态字段，避免调用 getToastProps() 产生新对象导致无限重渲染
 */
export function useUpdateToastProps(): UpdateToastProps {
  // 分别选择各个状态字段，避免每次返回新对象
  const status = useUpdateStore((s) => s.status);
  const version = useUpdateStore((s) => s.version);
  const notes = useUpdateStore((s) => s.notes);
  const progress = useUpdateStore((s) => s.progress);
  const downloaded = useUpdateStore((s) => s.downloaded);
  const total = useUpdateStore((s) => s.total);
  const proxyUrl = useUpdateStore((s) => s.proxyUrl);
  const errorMessage = useUpdateStore((s) => s.errorMessage);

  // 获取稳定的 action 引用（不会随状态变化而变化）
  const handleUpdate = useUpdateStore((s) => s.handleUpdate);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const handleRestart = useUpdateStore((s) => s.handleRestart);
  const handleRetry = useUpdateStore((s) => s.handleRetry);

  return {
    status,
    version,
    notes,
    progress,
    downloaded,
    total,
    proxyUrl,
    errorMessage,
    onUpdate: handleUpdate,
    onDismiss: dismiss,
    onRestart: handleRestart,
    onRetry: handleRetry,
  };
}

/**
 * 获取检查更新函数
 */
export function useCheckUpdate(): () => Promise<void> {
  return useUpdateStore((state) => state.checkUpdate);
}

/**
 * 获取检查状态
 */
export function useIsChecking(): boolean {
  return useUpdateStore((state) => state.isChecking);
}

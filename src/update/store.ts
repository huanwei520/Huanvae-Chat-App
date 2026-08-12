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
import { createDownloadSpeedTracker } from './downloadSpeed';
import type {
  UpdateToastStatus,
  UpdateToastProps,
  UpdateProgressInput,
} from './components/UpdateToast';

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
  /** 百分比（0-100）；**仅当 indeterminate=false 时有意义** */
  progress: number;
  downloaded: number;
  /** 总字节数；0 表示未知（此时 indeterminate 必为 true） */
  total: number;
  /**
   * 实时下载速率（bytes/s）；**0 = 没有可显示的读数**（还没起量 / 不在下载中）。
   *
   * 由 `downloadSpeed` 的 EMA 估算，复用两端已有的 200ms 进度上报，不新增定时器。
   * 0 的语义是「不显示」而不是「速率为零」—— UI 不许渲染 `0 B/s` 这种零信息量文案。
   * 每次离开 downloading 的转换都会把它清回 0，不留过期读数。
   */
  speed: number;
  /** 不定态：总长未知 ⇒ UI 显示滚动动画而不是一个不动的 0% */
  indeterminate: boolean;
  sourceUrl: string;
  errorMessage: string;

  // 锁状态
  isChecking: boolean;

  // 缓存的更新信息
  desktopUpdateInfo: UpdateInfo | null;
  androidUpdateInfo: AndroidUpdateInfo | null;

  /**
   * Android：已下完、待安装的 APK 本地路径（''=没有）
   *
   * 有它才谈得上「下完之后还能再点一次安装」——旧实现下完就 dismiss，
   * 安装器一旦没弹出来（后台被系统拦掉 / 用户点了取消），这个包就再也点不到了。
   */
  androidApkPath: string;

  /**
   * Android：本次会话里用户已经把「可安装」提示关掉过
   *
   * 只作用于**从磁盘标记恢复**的那条路径：不加这个标志，用户每次切回前台
   * 都会被同一条提示重新怼一次。仅进程内有效，重启后会再提示一次（合理：包确实还等着装）。
   */
  pendingInstallDismissed: boolean;

  /**
   * 下一次 `startDownload` 是「接着下」而不是「重来」
   *
   * 只由 `handleRetry` 置位、被 `startDownload` 消费后立刻清掉（一次性）。
   *
   * 🔴 它**只影响进度条的起点显示**：真正的字节续传发生在 Rust 侧，依据是磁盘上的
   * 断点清单（`src-tauri/src/resume_meta.rs`），与这个标志无关。之所以还需要它，
   * 是因为重试时会先做一次 HEAD 探测才拿得到断点位置 —— 那段时间里若把进度清零，
   * 用户看到的就是「又从 0 开始了」，而事实并非如此。弱网上这段探测正好最久。
   */
  resumeHint: boolean;
}

interface UpdateStoreActions {
  // 弹窗操作
  showAvailable: (version: string, notes?: string) => void;
  startDownload: () => void;
  updateProgress: (input: UpdateProgressInput) => void;
  downloadComplete: () => void;
  showError: (message: string) => void;
  dismiss: () => void;

  // 更新检查（带锁）
  checkUpdate: () => Promise<void>;

  // 更新下载安装
  handleUpdate: () => Promise<void>;

  /** Android：对已下完的 APK 再次拉起系统安装器（「立即安装」按钮） */
  installReadyApk: () => Promise<void>;

  /**
   * Android：从 Rust 侧的磁盘标记恢复「已下完，待安装」状态
   *
   * 冷启动 + 每次重回前台各调一次。
   */
  restorePendingInstall: () => Promise<void>;

  // 重启（桌面端）
  handleRestart: () => Promise<void>;

  // 重试
  handleRetry: () => void;

  // 获取 Toast props（便捷方法）
  getToastProps: () => UpdateToastProps;
}

type UpdateStore = UpdateStoreState & UpdateStoreActions;

// ============================================
// 工具
// ============================================

/**
 * 当前 webview 是否可见
 *
 * 用途只有一个：决定「能不能拉系统安装器」。Android 10 起后台不许启动 Activity，
 * 且系统是**静默**拦截 —— 拉了不会报错、也不会有任何反应，所以必须在调用前自己判断，
 * 不能靠 catch 兜。<https://developer.android.com/guide/components/activities/background-starts>
 *
 * 判错的代价是不对称的，因此**默认按可见处理**：
 * - 误判成可见 ⇒ 白拉一次安装器（被系统拦掉，无副作用），状态仍停在可安装
 * - 误判成不可见 ⇒ 明明在前台却不弹安装器，用户得多点一次
 */
function isUiVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * 速率估算器（进程内单例）
 *
 * 同一时刻只可能有一轮下载：`checkUpdate` 有全局锁、`handleUpdate` 由唯一的
 * 全局弹窗触发，所以单例是够的。每轮 `startDownload` 会 `reset()`。
 */
const speedTracker = createDownloadSpeedTracker();

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
  speed: 0,
  indeterminate: false,
  sourceUrl: '',
  errorMessage: '',
  isChecking: false,
  desktopUpdateInfo: null,
  androidUpdateInfo: null,
  androidApkPath: '',
  pendingInstallDismissed: false,
  resumeHint: false,
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
    // 上一轮的样本（基线时间戳 / 已下字节 / EMA）对这一轮毫无意义，必须清干净，
    // 否则新一轮的第一个样本会拿上一轮的基线去减，算出一个荒唐的巨值。
    speedTracker.reset();
    const prev = get();
    // 「重试」= 接着下（Rust 侧按磁盘断点清单续），此时**保留上次的读数**，
    // 别把进度清零 —— 清零传达的是「之前下的全白费了」，而那是假的。
    // 只有在真拿得到上次读数（total > 0）时才保留；否则仍走不定态。
    const resuming = prev.resumeHint && prev.total > 0 && prev.downloaded > 0;
    set({
      status: 'downloading',
      // 起手总长未知时（首次下载，第一个 Started 事件还没到）先进不定态，
      // 免得先闪一个「0%」再变成真实百分比。
      progress: resuming ? Math.round((prev.downloaded / prev.total) * 100) : 0,
      downloaded: resuming ? prev.downloaded : 0,
      total: resuming ? prev.total : 0,
      speed: 0,
      indeterminate: !resuming,
      // Android：下载中的 APK 是半截的 ⇒ 旧路径此刻不可安装，必须一起作废，
      // 免得残留一个指向坏包的「立即安装」。
      androidApkPath: '',
      // 用户重新点了更新 = 重新有兴趣了，之前那次「稍后」不该继续压制提示
      pendingInstallDismissed: false,
      // 一次性标志，用完即清：下一次若是"全新开始"就不该再吃到它
      resumeHint: false,
    });
  },

  updateProgress: ({ percent, downloaded, total, indeterminate, sourceUrl }) => {
    // 数据源显式给了就听它的；没给才按「有没有总长」推断。
    // 🔴 全程不用 `||`：percent=0 / downloaded=0 都是合法值，`||` 会把它们和 undefined 混掉。
    const isIndeterminate = indeterminate ?? (total === undefined || total <= 0);
    const state = get();
    const nextDownloaded = downloaded ?? state.downloaded;
    const nextTotal = total ?? state.total;

    // 速率就在这一次上报里顺带算掉 —— 桌面（updater_download.rs 的 200ms sleep）与
    // 安卓（android_update.rs 的 APK_PROGRESS_TICK）本来就各有一个 200ms tick，
    // 不新增定时器、不提高上报频率。
    // 🔴 必须放在 `set` 之外：push 是有状态的（推进基线），而 zustand 的函数式 updater
    //    语义上不该有副作用。
    const nextSpeed = speedTracker.push({
      downloaded: nextDownloaded,
      total: nextTotal,
      now: performance.now(),
    });

    set({
      // 不定态下没有可信百分比，保持 0（UI 按 indeterminate 渲染滚动条，不读这个值）
      progress: isIndeterminate ? 0 : (percent ?? state.progress),
      downloaded: nextDownloaded,
      total: nextTotal,
      // null（还没有可显示的读数）在 store 里落成 0 = 「不显示」，见 speed 字段注释
      speed: nextSpeed ?? 0,
      indeterminate: isIndeterminate,
      ...(sourceUrl ? { sourceUrl } : {}),
    });
  },

  // ⬇️ 下面三个都是「离开 downloading」的出口，一律把 speed 清回 0：
  //    下载已经结束，留一个过期读数在 state 里就是误导性残留。
  downloadComplete: () => {
    set({ status: 'ready', progress: 100, speed: 0, indeterminate: false });
  },

  showError: (message) => {
    set({ status: 'error', speed: 0, errorMessage: message });
  },

  dismiss: () => {
    // 移动端把「已下完待安装」关掉时记一笔，免得每次切回前台都被同一条提示怼一次
    // （仅本次进程内有效，见 pendingInstallDismissed 注释）
    const shouldMutePending = isMobile() && get().status === 'ready';
    set(
      shouldMutePending
        ? { status: 'idle', speed: 0, pendingInstallDismissed: true }
        : { status: 'idle', speed: 0 },
    );
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

        const { downloadApk, installApk, ensureInstallPermission } = await import('./service.android');

        // 1. 先确保有安装权限（在下载前请求，避免时机冲突）
        console.warn('[UpdateStore] 检查安装权限...');
        await ensureInstallPermission();
        console.warn('[UpdateStore] ✓ 安装权限已就绪');

        // 2. 权限通过后开始下载
        store.startDownload();
        console.warn('[UpdateStore] 开始下载 APK:', info.apkUrl);
        const localPath = await downloadApk(info.apkUrl, info.version ?? '', (progress) => {
          // Android 侧总长来自 Content-Length；拿不到时是 0 ⇒ 由 updateProgress 推断成不定态
          store.updateProgress({
            percent: progress.percent,
            downloaded: progress.downloaded,
            total: progress.total,
            sourceUrl: info.apkUrl,
          });
        });

        console.warn('[UpdateStore] 下载完成:', localPath);

        // 3. 先落成「已下完，可安装」这个**可交互**状态，再谈拉安装器。
        //    顺序不能反：旧实现是「拉安装器 → dismiss」，一旦安装器没真弹出来
        //    （后台被系统静默拦掉 / 用户点了取消），UI 要么停在一个永远满着的进度条上，
        //    要么直接消失，用户既看不到也点不到那个已经下好的包。
        set({
          androidApkPath: localPath,
          status: 'ready',
          progress: 100,
          speed: 0,
          indeterminate: false,
          pendingInstallDismissed: false,
        });

        // 4. 只有在**可见**时才拉安装器。后台拉会被 Android 静默拦掉
        //    （既无返回值也无异常），此时改由 Rust 侧发通知把用户拉回来。
        //    ⚠️ installApk 是 void 且不可 await（插件成功路径永不 settle，见其注释），
        //    所以状态必须在**它之前**就落好 —— 这也是上一步顺序不能反的原因。
        if (isUiVisible()) {
          console.warn('[UpdateStore] 前台，直接调用安装器...');
          installApk(localPath, (message) => {
            // 拉安装器失败**不能**把整次更新判成失败：包已经下好了，
            // 状态停在「可安装」，用户还能再点一次「立即安装」（那条显式路径会报错）。
            console.error('[UpdateStore] 自动拉起安装器失败，保留可安装状态:', message);
          });
        } else {
          console.warn('[UpdateStore] 后台，不拉安装器（会被系统拦截），等用户回到前台');
        }
      } else {
        // 桌面端
        const info = state.desktopUpdateInfo;
        if (!info?.update) {
          throw new Error('没有可用的更新');
        }

        const { downloadAndInstall } = await import('./service');

        store.startDownload();

        await downloadAndInstall(info.update, (progress) => {
          // 🔴 原样透传，不做 `|| 0` 兜底：service.ts 已经把「总长未知」表达成
          // percent=undefined + indeterminate=true，兜底会把它压成一个假的 0%。
          store.updateProgress({
            percent: progress.percent,
            downloaded: progress.downloaded,
            total: progress.contentLength,
            indeterminate: progress.indeterminate,
          });
        });

        store.downloadComplete();
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[UpdateStore] 更新失败:', errorMsg);
      store.showError(errorMsg);
    }
  },

  // ========== Android：对已下完的包再次拉起安装器 ==========

  installReadyApk: async () => {
    const apkPath = get().androidApkPath;
    if (!apkPath) {
      console.warn('[UpdateStore] 没有待安装的 APK');
      return;
    }

    try {
      const { installApk, ensureInstallPermission } = await import('./service.android');
      // 冷启动恢复出来的待安装包，权限可能是上一个进程里授的（也可能被用户撤了），
      // 所以这条显式路径每次都自己确认一遍，不复用下载前那次。
      await ensureInstallPermission();
      // ⚠️ 不能 await：插件成功路径永不 settle（见 installApk 注释），
      //    await 会让这里永久挂起、catch 也永远等不到。失败经回调回来。
      installApk(apkPath, (message) => get().showError(message));
    } catch (err) {
      // 这里只兜得到「拉安装器之前」的失败：权限被拒等
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[UpdateStore] 安装失败:', errorMsg);
      get().showError(errorMsg);
    }
  },

  // ========== Android：从磁盘标记恢复「待安装」 ==========

  restorePendingInstall: async () => {
    if (!isMobile()) {
      return;
    }

    const state = get();
    // 用户这次会话里已经把提示关掉了，别再怼他
    if (state.pendingInstallDismissed) {
      return;
    }
    // 只有这两个状态该被磁盘上的「已下完」接管：
    // - idle：冷启动 / 平时
    // - downloading：**关键** —— 这正是故障现场。下载其实早就完成了（标记文件是完成时才写的，
    //   且每轮下载开始会先删掉旧标记，所以标记存在 ⇒ 这一份确已下完），只是那条
    //   「Rust → JS」的回执没能把前端从 downloading 推出去。不放行这个状态，
    //   用户切回来看到的就还是那根卡死的满进度条。
    // 其余状态（available / ready / error）都是用户正在看的、有明确语义的提示，不覆盖。
    if (state.status !== 'idle' && state.status !== 'downloading') {
      return;
    }

    const { getPendingApkInstall } = await import('./service.android');
    const pending = await getPendingApkInstall();
    if (!pending) {
      return;
    }

    console.warn('[UpdateStore] 恢复待安装包:', pending.version, pending.path);
    set({
      status: 'ready',
      version: pending.version,
      androidApkPath: pending.path,
      progress: 100,
      // 这条路径可能从 downloading 直接接管（见上面的状态白名单注释）⇒ 同样要清读数
      speed: 0,
      indeterminate: false,
      downloaded: pending.size,
      total: pending.size,
    });
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
    // 重试 = 接着下。两端 Rust 侧都会按磁盘上的断点清单只补没下完的部分
    // （见 src-tauri/src/resume_meta.rs），这里只是让 UI 别先把进度清零，
    // 免得在 HEAD 探测那几百毫秒里骗用户「又从头开始了」。
    set({ resumeHint: true });
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
      speed: state.speed,
      indeterminate: state.indeterminate,
      sourceUrl: state.sourceUrl,
      errorMessage: state.errorMessage,
      onUpdate: state.handleUpdate,
      onDismiss: state.dismiss,
      onRestart: state.handleRestart,
      onRetry: state.handleRetry,
      onInstall: state.installReadyApk,
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
  const speed = useUpdateStore((s) => s.speed);
  const indeterminate = useUpdateStore((s) => s.indeterminate);
  const sourceUrl = useUpdateStore((s) => s.sourceUrl);
  const errorMessage = useUpdateStore((s) => s.errorMessage);

  // 获取稳定的 action 引用（不会随状态变化而变化）
  const handleUpdate = useUpdateStore((s) => s.handleUpdate);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const handleRestart = useUpdateStore((s) => s.handleRestart);
  const handleRetry = useUpdateStore((s) => s.handleRetry);
  const installReadyApk = useUpdateStore((s) => s.installReadyApk);

  return {
    status,
    version,
    notes,
    progress,
    downloaded,
    total,
    speed,
    indeterminate,
    sourceUrl,
    errorMessage,
    onUpdate: handleUpdate,
    onDismiss: dismiss,
    onRestart: handleRestart,
    onRetry: handleRetry,
    onInstall: installReadyApk,
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

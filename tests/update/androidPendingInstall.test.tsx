/**
 * Android 更新：后台下完 → 能装上（回归测试）
 *
 * 背景（真实故障，用户原话）：
 * 「手机端的更新下载在后台下载的时候下载完成了不会自动弹出切换到安装，需要消除后台重新下载，
 *   切回只会显示满下载进度，只有在前台下载盯着到满才会弹出系统的安装」
 *
 * 根因（Android 14 真机模拟器 logcat 实测确认，两个互相独立的缺陷）：
 * 1. Android 10 (API 29) 起**后台应用不许启动 Activity**，且系统**静默**拦截——
 *    实测 `ActivityTaskManager: Background activity launch blocked … (BAL_BLOCK) result code=102`，
 *    `startActivity` 正常返回、不抛异常。拉系统安装器就是 startActivity ⇒ 后台必然静默失败。
 *    <https://developer.android.com/guide/components/activities/background-starts>
 * 2. `tauri-plugin-android-package-install` 2.0.2 的 Kotlin `install` 命令
 *    **在所有路径上都不 resolve / reject**，于是 `await install()` 永不返回 ⇒
 *    旧 store 既到不了 `dismiss()`、也进不了 `catch`，永远停在 `downloading` + progress=100。
 *    实测：`调用系统安装器` 2 次、`✓ 已启动` 0 次、`✗ 失败` 0 次。
 * 3. 叠加症状：旧 store 的**移动端分支从不进入 'ready' 状态**（`downloadComplete()` 只有
 *    桌面分支调）。于是「下载中且 progress=100」成了一个可达且**无出口**的状态 ——
 *    正是用户看到的那个卡死的满进度条；已经下好的 APK 再也点不到，只能清后台重下。
 *
 * 本文件把修复后的契约钉死：
 * - 后台下完：**不**拉安装器（拉了也会被静默拦掉），状态落到可交互的 'ready'
 * - 前台下完：拉安装器，但状态**仍**停在 'ready'（安装器被取消还能再点一次）
 * - 拉安装器失败不把整次更新判成 error（包已经下好了）
 * - 冷启动/回前台能从 Rust 侧磁盘标记恢复出 'ready' —— 这条消灭「必须重下一遍」
 * - 移动端 'ready' 的 UI 是「立即安装」，不是桌面的「立即重启」
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

// isMobile 是 UA 关键词判断，jsdom 下恒 false ⇒ 必须整体替换才能走移动端分支。
// 🔴 工厂是整体替换：platform.ts 的 4 个导出必须都列上，漏一个就是
//    `No "xxx" export is defined on the mock`。
const platformMock = vi.hoisted(() => ({ mobile: true }));
vi.mock('../../src/utils/platform', () => ({
  isMobile: () => platformMock.mobile,
  isDesktop: () => !platformMock.mobile,
  getPlatformType: () => (platformMock.mobile ? 'mobile' : 'desktop'),
  _resetPlatformCache: () => {},
}));

// store 用 `await import('./service.android')` 动态导入，这里整体替换掉。
const serviceMock = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  downloadApk: vi.fn(),
  installApk: vi.fn(),
  ensureInstallPermission: vi.fn(),
  getPendingApkInstall: vi.fn(),
  reportUiVisibility: vi.fn(),
}));
vi.mock('../../src/update/service.android', () => serviceMock);

import { useUpdateStore } from '../../src/update/store';
import { UpdateToast } from '../../src/update/components/UpdateToast';

/** 把 store 拍回初始态（zustand 是跨用例共享的全局单例） */
function resetStore() {
  useUpdateStore.setState({
    status: 'idle',
    version: '',
    notes: '',
    progress: 0,
    downloaded: 0,
    total: 0,
    indeterminate: false,
    sourceUrl: '',
    errorMessage: '',
    isChecking: false,
    desktopUpdateInfo: null,
    androidUpdateInfo: null,
    androidApkPath: '',
    pendingInstallDismissed: false,
  });
}

/** 覆写 document.visibilityState（jsdom 默认 'visible'，且该属性只有 getter） */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    value: state,
    configurable: true,
  });
}

/**
 * 一个形状合法的 APK 摘要（64 位十六进制）。
 *
 * 🔴 自 2026-08-21 起 `handleUpdate` 对缺 `apkSha256` 的更新信息是 **fail-closed** 的
 *（清单没给摘要就中止本次更新，见 store.ts）。所以这里必须给一个 ——
 * 不给的话下面每一条用例都会在下载之前就被拦掉，测的就不再是它们各自想测的东西了。
 * 「缺摘要要中止」本身另有专门用例覆盖（见文件末尾）。
 */
const VALID_APK_SHA256 = '2ab91325fd1d93eebf78d7edb43c2387e81116c17397ff217028b14255e26376';

/** 摆好「有可用更新」的前置状态并跑一次 handleUpdate */
async function runMobileUpdate(apkUrl = 'https://example.invalid/app.apk', version = '9.9.9') {
  useUpdateStore.setState({
    androidUpdateInfo: { available: true, version, apkUrl, apkSha256: VALID_APK_SHA256 },
  });
  await act(async () => {
    await useUpdateStore.getState().handleUpdate();
  });
}

describe('Android 后台下完：不拉安装器，但必须留下可交互的「可安装」状态', () => {
  beforeEach(() => {
    platformMock.mobile = true;
    resetStore();
    serviceMock.downloadApk.mockReset().mockResolvedValue('/cache/huanvae-chat-update.apk');
    // installApk 是同步 void（插件成功路径永不 settle，故意不可 await）
    serviceMock.installApk.mockReset().mockReturnValue(undefined);
    serviceMock.ensureInstallPermission.mockReset().mockResolvedValue(true);
    serviceMock.getPendingApkInstall.mockReset().mockResolvedValue(null);
    setVisibility('visible');
  });

  afterEach(() => {
    setVisibility('visible');
  });

  it('后台（hidden）下完：不调用安装器，状态落到 ready 且记住 APK 路径', async () => {
    setVisibility('hidden');

    await runMobileUpdate();

    // 后台拉安装器会被 Android 静默拦掉（既无返回值也无异常）⇒ 干脆别拉
    expect(serviceMock.installApk).not.toHaveBeenCalled();

    const s = useUpdateStore.getState();
    // 🔴 旧实现这里会停在 downloading（那个卡死的满进度条）或被 dismiss 成 idle
    expect(s.status).toBe('ready');
    expect(s.androidApkPath).toBe('/cache/huanvae-chat-update.apk');
    expect(s.progress).toBe(100);
    expect(s.indeterminate).toBe(false);
  });

  it('前台（visible）下完：拉安装器，但状态仍停在 ready（安装器被取消还能再点）', async () => {
    await runMobileUpdate();

    expect(serviceMock.installApk).toHaveBeenCalledWith(
      '/cache/huanvae-chat-update.apk',
      expect.any(Function),
    );

    const s = useUpdateStore.getState();
    // 🔴 旧实现在这里 dismiss()，包一旦没装上就再也点不到了
    expect(s.status).toBe('ready');
    expect(s.androidApkPath).toBe('/cache/huanvae-chat-update.apk');
  });

  it('「可安装」状态必须在拉安装器【之前】就落好（插件不 settle，之后的代码跑不到）', async () => {
    let statusAtInstallTime = '';
    serviceMock.installApk.mockImplementation(() => {
      statusAtInstallTime = useUpdateStore.getState().status;
    });

    await runMobileUpdate();

    // 🔴 顺序反了就等于没修：await install() 永不返回 ⇒ 它后面的 set 一行都不会执行
    expect(statusAtInstallTime).toBe('ready');
  });

  it('自动拉安装器失败：不把整次更新判成 error，仍停在 ready', async () => {
    serviceMock.installApk.mockImplementation(
      (_path: string, onLaunchError?: (m: string) => void) => {
        onLaunchError?.('installer boom');
      },
    );

    await runMobileUpdate();

    const s = useUpdateStore.getState();
    expect(s.status).toBe('ready');
    expect(s.errorMessage).toBe('');
  });

  it('下载本身失败：照旧进 error 状态（不能被上面那条容错吞掉）', async () => {
    serviceMock.downloadApk.mockRejectedValue(new Error('network down'));

    await runMobileUpdate();

    const s = useUpdateStore.getState();
    expect(s.status).toBe('error');
    expect(s.errorMessage).toBe('network down');
  });

  it('版本号与 sha256 必须传给 Rust（前者写标记与通知文案，后者做完整性校验）', async () => {
    await runMobileUpdate('https://example.invalid/app.apk', '1.2.3');

    expect(serviceMock.downloadApk).toHaveBeenCalledWith(
      'https://example.invalid/app.apk',
      '1.2.3',
      VALID_APK_SHA256,
      expect.any(Function),
    );
  });
});

describe('从磁盘标记恢复待安装包（消灭「必须清后台重下一遍」）', () => {
  beforeEach(() => {
    platformMock.mobile = true;
    resetStore();
    serviceMock.getPendingApkInstall.mockReset();
    serviceMock.installApk.mockReset().mockResolvedValue(undefined);
    serviceMock.ensureInstallPermission.mockReset().mockResolvedValue(true);
  });

  it('磁盘上有下好的包：恢复成 ready + 版本 + 路径，不用重下', async () => {
    serviceMock.getPendingApkInstall.mockResolvedValue({
      version: '9.9.9',
      path: '/cache/huanvae-chat-update.apk',
      size: 12345,
    });

    await act(async () => {
      await useUpdateStore.getState().restorePendingInstall();
    });

    const s = useUpdateStore.getState();
    expect(s.status).toBe('ready');
    expect(s.version).toBe('9.9.9');
    expect(s.androidApkPath).toBe('/cache/huanvae-chat-update.apk');
    expect(s.total).toBe(12345);
  });

  it('磁盘上没有：保持 idle，不弹任何东西', async () => {
    serviceMock.getPendingApkInstall.mockResolvedValue(null);

    await act(async () => {
      await useUpdateStore.getState().restorePendingInstall();
    });

    expect(useUpdateStore.getState().status).toBe('idle');
  });

  it('卡在 downloading 但磁盘已有成品：接管成 ready —— 这就是那根卡死满进度条的解药', async () => {
    // 故障现场：下载其实早完成了（Rust 写了标记），只是「Rust → JS」的回执没能把前端
    // 推出 downloading。标记只在完成时写、且每轮下载开始会先删旧标记 ⇒ 有标记就等于确已下完。
    useUpdateStore.setState({ status: 'downloading', progress: 100 });
    serviceMock.getPendingApkInstall.mockResolvedValue({
      version: '9.9.9',
      path: '/cache/huanvae-chat-update.apk',
      size: 12345,
    });

    await act(async () => {
      await useUpdateStore.getState().restorePendingInstall();
    });

    expect(useUpdateStore.getState().status).toBe('ready');
    expect(useUpdateStore.getState().androidApkPath).toBe('/cache/huanvae-chat-update.apk');
  });

  it('重新开始下载：作废旧 APK 路径 + 解除「稍后」压制', async () => {
    // 新一轮下载会把同名 APK 截断重写、并删掉旧标记 ⇒ 旧路径此刻指向半截文件
    useUpdateStore.setState({
      androidApkPath: '/cache/huanvae-chat-update.apk',
      pendingInstallDismissed: true,
    });

    act(() => {
      useUpdateStore.getState().startDownload();
    });

    const s = useUpdateStore.getState();
    expect(s.androidApkPath).toBe('');
    expect(s.pendingInstallDismissed).toBe(false);
  });

  it('真的还在下载（磁盘上没有成品）：保持 downloading，不瞎接管', async () => {
    useUpdateStore.setState({ status: 'downloading', progress: 42 });
    serviceMock.getPendingApkInstall.mockResolvedValue(null);

    await act(async () => {
      await useUpdateStore.getState().restorePendingInstall();
    });

    expect(useUpdateStore.getState().status).toBe('downloading');
    expect(useUpdateStore.getState().progress).toBe(42);
  });

  it('用户正在看的提示不被磁盘状态覆盖（available / error）', async () => {
    serviceMock.getPendingApkInstall.mockResolvedValue({
      version: '9.9.9',
      path: '/cache/huanvae-chat-update.apk',
      size: 12345,
    });

    for (const status of ['available', 'error'] as const) {
      useUpdateStore.setState({ status, androidApkPath: '' });
      serviceMock.getPendingApkInstall.mockClear();

      await act(async () => {
        await useUpdateStore.getState().restorePendingInstall();
      });

      expect(serviceMock.getPendingApkInstall).not.toHaveBeenCalled();
      expect(useUpdateStore.getState().status).toBe(status);
    }
  });

  it('用户关掉过提示：本次会话内不再恢复（否则每次切回前台都被怼一次）', async () => {
    serviceMock.getPendingApkInstall.mockResolvedValue({
      version: '9.9.9',
      path: '/cache/huanvae-chat-update.apk',
      size: 12345,
    });

    // 先恢复出 ready，再让用户点「稍后」
    await act(async () => {
      await useUpdateStore.getState().restorePendingInstall();
    });
    act(() => {
      useUpdateStore.getState().dismiss();
    });
    expect(useUpdateStore.getState().pendingInstallDismissed).toBe(true);

    serviceMock.getPendingApkInstall.mockClear();
    await act(async () => {
      await useUpdateStore.getState().restorePendingInstall();
    });

    expect(serviceMock.getPendingApkInstall).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().status).toBe('idle');
  });

  it('桌面端不查（这条路径是 Android 专属）', async () => {
    platformMock.mobile = false;

    await act(async () => {
      await useUpdateStore.getState().restorePendingInstall();
    });

    expect(serviceMock.getPendingApkInstall).not.toHaveBeenCalled();
  });
});

describe('installReadyApk：「立即安装」按钮背后的动作', () => {
  beforeEach(() => {
    platformMock.mobile = true;
    resetStore();
    serviceMock.installApk.mockReset().mockReturnValue(undefined);
    serviceMock.ensureInstallPermission.mockReset().mockResolvedValue(true);
  });

  it('每次都重新确认安装权限再拉安装器（恢复出来的包可能跨了进程）', async () => {
    useUpdateStore.setState({ status: 'ready', androidApkPath: '/cache/x.apk' });

    await act(async () => {
      await useUpdateStore.getState().installReadyApk();
    });

    expect(serviceMock.ensureInstallPermission).toHaveBeenCalledTimes(1);
    expect(serviceMock.installApk).toHaveBeenCalledWith('/cache/x.apk', expect.any(Function));
  });

  it('没有待安装包时什么都不做（不去拉一个空路径）', async () => {
    useUpdateStore.setState({ status: 'ready', androidApkPath: '' });

    await act(async () => {
      await useUpdateStore.getState().installReadyApk();
    });

    expect(serviceMock.installApk).not.toHaveBeenCalled();
  });

  it('用户显式点安装却失败：这条路径要把错误报出来', async () => {
    useUpdateStore.setState({ status: 'ready', androidApkPath: '/cache/x.apk' });
    serviceMock.installApk.mockImplementation(
      (_path: string, onLaunchError?: (m: string) => void) => {
        onLaunchError?.('FileProvider 拒绝该路径');
      },
    );

    await act(async () => {
      await useUpdateStore.getState().installReadyApk();
    });

    const s = useUpdateStore.getState();
    expect(s.status).toBe('error');
    expect(s.errorMessage).toBe('FileProvider 拒绝该路径');
  });

  it('权限被拒（拉安装器之前就失败）：同样要报错', async () => {
    useUpdateStore.setState({ status: 'ready', androidApkPath: '/cache/x.apk' });
    serviceMock.ensureInstallPermission.mockRejectedValue(new Error('用户拒绝了安装权限'));

    await act(async () => {
      await useUpdateStore.getState().installReadyApk();
    });

    expect(serviceMock.installApk).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().status).toBe('error');
    expect(useUpdateStore.getState().errorMessage).toBe('用户拒绝了安装权限');
  });
});

describe('UpdateToast：ready 状态的两端语义不同', () => {
  it('移动端：渲染「立即安装」并触发 onInstall（不是重启）', () => {
    platformMock.mobile = true;
    const onInstall = vi.fn();
    const onRestart = vi.fn();

    render(
      <UpdateToast status="ready" version="1.2.3" onInstall={onInstall} onRestart={onRestart} />,
    );

    expect(screen.getByText('v1.2.3 已下载完成')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: '立即安装' });
    fireEvent.click(btn);

    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '立即重启' })).toBeNull();
  });

  it('移动端：有「稍后」出口，点了走 onDismiss', () => {
    platformMock.mobile = true;
    const onDismiss = vi.fn();

    render(<UpdateToast status="ready" version="1.2.3" onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: '稍后' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('桌面端：仍是「立即重启」，不受移动端改动影响', () => {
    platformMock.mobile = false;
    const onInstall = vi.fn();
    const onRestart = vi.fn();

    render(
      <UpdateToast status="ready" version="1.2.3" onInstall={onInstall} onRestart={onRestart} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '立即重启' }));
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onInstall).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '立即安装' })).toBeNull();
  });
});

// ============================================
// APK 完整性校验：摘要缺失必须 fail-closed
// ============================================

describe('缺少 apkSha256 时必须中止本次更新（fail-closed）', () => {
  beforeEach(() => {
    platformMock.mobile = true;
    resetStore();
    serviceMock.downloadApk.mockReset().mockResolvedValue('/cache/huanvae-chat-update.apk');
    serviceMock.installApk.mockReset().mockReturnValue(undefined);
    serviceMock.ensureInstallPermission.mockReset().mockResolvedValue(true);
    serviceMock.getPendingApkInstall.mockReset().mockResolvedValue(null);
  });

  it('清单没给摘要 ⇒ 一个字节都不下载，状态落到 error', async () => {
    useUpdateStore.setState({
      androidUpdateInfo: {
        available: true,
        version: '9.9.9',
        apkUrl: 'https://example.invalid/app.apk',
        // 故意不给 apkSha256
      },
    });

    await act(async () => {
      await useUpdateStore.getState().handleUpdate();
    });

    // 🔴 核心断言：**没有**进下载。
    // 「下完再校验」不等价 —— 那样磁盘上会先落一个来源不明的 APK。
    expect(serviceMock.downloadApk).not.toHaveBeenCalled();
    expect(serviceMock.installApk).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().status).toBe('error');
  });

  it('正对照：给了摘要就正常下载，并把它原样交给 downloadApk', async () => {
    await runMobileUpdate();

    expect(serviceMock.downloadApk).toHaveBeenCalledTimes(1);
    const args = serviceMock.downloadApk.mock.calls[0];
    expect(args[0]).toBe('https://example.invalid/app.apk');
    expect(args[1]).toBe('9.9.9');
    expect(args[2]).toBe(VALID_APK_SHA256);
  });
});

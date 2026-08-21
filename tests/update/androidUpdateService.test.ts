/**
 * Android 更新服务层：可见性上报 / 待安装包查询 / 下载参数
 *
 * 这三件事是「后台下完也能装上」的地基：
 * - `reportUiVisibility` 让 **Rust** 知道该不该发通知（后台完成时唯一能把用户拉回来的手段；
 *   通知点击走系统 PendingIntent，是官方后台启动 Activity 豁免清单里唯一适用的一条）
 * - `getPendingApkInstall` 让冷启动/回前台能从磁盘标记恢复出「已下完，可安装」，
 *   而不是逼用户清后台重下一遍
 * - `downloadApk` 必须把版本号传给 Rust —— 标记文件和通知文案都要用
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

// @tauri-apps/api/event 未在 tests/setup.ts 全局 mock，这里补
const eventMock = vi.hoisted(() => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock('@tauri-apps/api/event', () => eventMock);

// 安装插件同样未全局 mock；它内部会 import setup.ts 没提供的 core 导出，
// 不替换掉整个模块会直接 `No "checkPermissions" export is defined on the mock`。
const installPluginMock = vi.hoisted(() => ({
  install: vi.fn().mockReturnValue(new Promise<void>(() => {})),
  checkPermissions: vi.fn().mockResolvedValue('granted'),
  requestPermissions: vi.fn().mockResolvedValue('granted'),
}));
vi.mock('@kingsword/tauri-plugin-android-package-install', () => installPluginMock);

import {
  reportUiVisibility,
  getPendingApkInstall,
  downloadApk,
  installApk,
  checkForUpdates,
} from '../../src/update/service.android';

const mockInvoke = vi.mocked(invoke);

describe('reportUiVisibility：把可见性推给 Rust', () => {
  beforeEach(() => {
    eventMock.emit.mockReset().mockResolvedValue(undefined);
  });

  it('事件名与载荷必须与 Rust 侧 UI_VISIBILITY_EVENT 约定一致', async () => {
    await reportUiVisibility(false);
    expect(eventMock.emit).toHaveBeenCalledWith('apk-ui-visibility', { visible: false });

    await reportUiVisibility(true);
    expect(eventMock.emit).toHaveBeenLastCalledWith('apk-ui-visibility', { visible: true });
  });

  it('上报失败不抛（它只是给 Rust 的提示，不该拖垮调用方）', async () => {
    eventMock.emit.mockRejectedValue(new Error('ipc down'));
    await expect(reportUiVisibility(true)).resolves.toBeUndefined();
  });
});

describe('getPendingApkInstall：查磁盘上的待安装包', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('有待安装包时原样返回 Rust 给的三元组', async () => {
    mockInvoke.mockResolvedValue({
      version: '1.2.3',
      path: '/cache/huanvae-chat-update.apk',
      size: 127843746,
    });

    await expect(getPendingApkInstall()).resolves.toEqual({
      version: '1.2.3',
      path: '/cache/huanvae-chat-update.apk',
      size: 127843746,
    });
    expect(mockInvoke).toHaveBeenCalledWith('pending_apk_install');
  });

  it('命令不存在/非 Android 平台：返回 null 而不是抛', async () => {
    mockInvoke.mockRejectedValue(new Error('command not found'));
    await expect(getPendingApkInstall()).resolves.toBeNull();
  });
});

describe('downloadApk：版本号与 sha256 必须一起传给 Rust', () => {
  const SHA = '2ab91325fd1d93eebf78d7edb43c2387e81116c17397ff217028b14255e26376';

  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue('/cache/huanvae-chat-update.apk');
  });

  /**
   * 🔴 钉的是**请求体字面量**，不是 TS 类型 —— 本仓踩过「改了类型 ≠ 传了字段」：
   * 参数加进签名但没写进 invoke 载荷时，TS 一个字都不报，
   * Rust 侧却收不到 sha256 ⇒ 整道完整性校验静默失效。
   */
  it('invoke 载荷同时带 url / version / sha256', async () => {
    const path = await downloadApk('https://example.invalid/a.apk', '1.2.3', SHA);

    expect(mockInvoke).toHaveBeenCalledWith('download_apk', {
      url: 'https://example.invalid/a.apk',
      version: '1.2.3',
      sha256: SHA,
    });
    expect(path).toBe('/cache/huanvae-chat-update.apk');
  });

  it('sha256 原样透传，不在 TS 侧做任何"修正"（真值校验只在 Rust 那一处）', async () => {
    await downloadApk('https://example.invalid/a.apk', '1.2.3', '  NOT-A-HASH  ');
    const payload = mockInvoke.mock.calls[0][1] as { sha256: string };
    expect(payload.sha256).toBe('  NOT-A-HASH  ');
  });
});

describe('checkForUpdates：清单里的 sha256 必须一路带到 UpdateInfo', () => {
  const SHA = '2ab91325fd1d93eebf78d7edb43c2387e81116c17397ff217028b14255e26376';

  /** 复刻发布流水线真实写出的 android-latest.json 形状（字段名逐字一致） */
  function manifest(extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
      version: '9.9.9',
      notes: 'Huanvae Chat v9.9.9 Android 更新',
      url: 'https://example.invalid/app.apk',
      directUrl: 'https://example.invalid/gh/app.apk',
      sha256: SHA,
      pub_date: '2026-08-21T00:00:00Z',
      ...extra,
    });
  }

  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('有新版本时 apkSha256 = 清单的 sha256（少了它 Rust 侧无从校验）', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_app_version') { return '1.0.0'; }
      if (cmd === 'fetch_update_json') { return manifest(); }
      throw new Error(`未预期的命令: ${cmd}`);
    });

    const info = await checkForUpdates();
    expect(info.available).toBe(true);
    expect(info.apkUrl).toBe('https://example.invalid/app.apk');
    expect(info.apkSha256).toBe(SHA);
  });

  it('清单里没有 sha256 时 apkSha256 为 undefined（由调用方 fail-closed，不在这里编一个）', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_app_version') { return '1.0.0'; }
      if (cmd === 'fetch_update_json') {
        const parsed = JSON.parse(manifest()) as Record<string, unknown>;
        delete parsed.sha256;
        return JSON.stringify(parsed);
      }
      throw new Error(`未预期的命令: ${cmd}`);
    });

    const info = await checkForUpdates();
    expect(info.available).toBe(true);
    expect(info.apkSha256).toBeUndefined();
  });
});

describe('installApk：发射后不管', () => {
  beforeEach(() => {
    installPluginMock.install.mockReset();
  });

  it('底层 install 永不 settle 时也立即返回（否则调用方会被永久挂住）', () => {
    // 复刻插件真实行为：成功路径既不 resolve 也不 reject
    installPluginMock.install.mockReturnValue(new Promise<void>(() => {}));

    expect(installApk('/cache/x.apk')).toBeUndefined();
    expect(installPluginMock.install).toHaveBeenCalledWith('/cache/x.apk');
  });

  it('拉起前失败（参数/FileProvider）经回调报出来，不静默吞掉', async () => {
    installPluginMock.install.mockRejectedValue(new Error('bad provider path'));
    const onLaunchError = vi.fn();

    installApk('/cache/x.apk', onLaunchError);
    // .catch 是微任务，让它跑完
    await Promise.resolve();
    await Promise.resolve();

    expect(onLaunchError).toHaveBeenCalledWith('bad provider path');
  });
});

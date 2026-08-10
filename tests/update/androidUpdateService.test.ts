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

describe('downloadApk：版本号必须一起传给 Rust', () => {
  beforeEach(() => {
    mockInvoke.mockReset().mockResolvedValue('/cache/huanvae-chat-update.apk');
  });

  it('invoke 载荷同时带 url 和 version（Rust 用它写标记 + 通知文案）', async () => {
    const path = await downloadApk('https://example.invalid/a.apk', '1.2.3');

    expect(mockInvoke).toHaveBeenCalledWith('download_apk', {
      url: 'https://example.invalid/a.apk',
      version: '1.2.3',
    });
    expect(path).toBe('/cache/huanvae-chat-update.apk');
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

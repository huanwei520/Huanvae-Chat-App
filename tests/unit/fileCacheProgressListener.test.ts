/**
 * 进度监听器状态机测试
 *
 * 覆盖 services/fileCache.ts 的 startProgressListener 在收到 Rust 'download-progress'
 * 事件时是否能正确驱动 fileCacheStore 状态机：
 *
 * - 'downloading' → updateDownloadProgress（设置/更新 percent）
 * - 'completed'  → completeDownload（设置 status='completed' + localPath，解决卡 100% 问题）
 * - 'failed'     → failDownload（设置 status='failed' + error）
 * - hash 未注册任务时静默忽略，避免污染 store
 *
 * 这个测试是修复「下载进度环卡 100%」的关键回归屏障。Bug 现象：
 * 因 HMR / fire-and-forget / 跨窗口下载，triggerBackgroundDownload 的 await 回调可能
 * 失效，store 永远停在 status='downloading' / percent=100。
 * 修复：让 listener 直接根据 Rust 事件 status='completed' 驱动 completeDownload。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1) Mock @tauri-apps/api/event 的 listen，捕获注册的 handler 供下面手动触发
const mockListen = vi.hoisted(() => {
  let captured: ((event: { payload: unknown }) => void) | null = null;
  return {
    listen: vi.fn((_eventName: string, handler: (event: { payload: unknown }) => void) => {
      captured = handler;
      return Promise.resolve(() => {});
    }),
    fire: (payload: unknown) => {
      if (!captured) { throw new Error('listener 未注册'); }
      captured({ payload });
    },
    reset: () => { captured = null; },
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen.listen,
  emit: vi.fn().mockResolvedValue(undefined),
}));

// 2) Mock @tauri-apps/api/core 防 invoke 命中真实 Tauri
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (s: string) => s,
}));

// 3) Mock plugin-http 防请求出去
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

import { startProgressListener, stopProgressListener } from '../../src/services/fileCache';
import { useFileCacheStore } from '../../src/stores/fileCacheStore';

describe('progress listener 状态机', () => {
  beforeEach(() => {
    stopProgressListener();
    mockListen.reset();
    mockListen.listen.mockClear();
    // 重置 store 到干净状态
    useFileCacheStore.setState({ downloadTasks: {}, urlCache: {} });
  });

  it('downloading 事件 → 更新 percent，但 hash 必须先注册任务', async () => {
    await startProgressListener();
    expect(mockListen.listen).toHaveBeenCalledWith('download-progress', expect.any(Function));

    // 未注册 hash → 事件静默忽略
    mockListen.fire({
      fileHash: 'unknown-hash',
      downloaded: 50,
      total: 100,
      percent: 50,
      status: 'downloading',
    });
    expect(useFileCacheStore.getState().downloadTasks).toEqual({});

    // 先添加任务，再发事件 → store 应更新 percent
    useFileCacheStore.getState().addDownloadTask({
      fileHash: 'hash-A',
      fileName: 'a.mp4',
      fileType: 'video',
      total: 100,
    });
    mockListen.fire({
      fileHash: 'hash-A',
      downloaded: 60,
      total: 100,
      percent: 60,
      status: 'downloading',
    });

    const task = useFileCacheStore.getState().downloadTasks['hash-A'];
    expect(task.status).toBe('downloading');
    expect(task.percent).toBe(60);
  });

  it('completed 事件携带 localPath → 直接 completeDownload，不依赖 await（修复进度环卡 100%）', async () => {
    await startProgressListener();

    useFileCacheStore.getState().addDownloadTask({
      fileHash: 'hash-B',
      fileName: 'b.mp4',
      fileType: 'video',
      total: 200,
    });

    mockListen.fire({
      fileHash: 'hash-B',
      downloaded: 200,
      total: 200,
      percent: 100,
      status: 'completed',
      localPath: '/data/cache/b.mp4',
    });

    const task = useFileCacheStore.getState().downloadTasks['hash-B'];
    expect(task.status).toBe('completed');
    expect(task.percent).toBe(100);
    expect(task.localPath).toBe('/data/cache/b.mp4');
  });

  it('completed 事件无 localPath（旧版 Rust 兼容）→ 不调 completeDownload', async () => {
    await startProgressListener();

    useFileCacheStore.getState().addDownloadTask({
      fileHash: 'hash-C',
      fileName: 'c.mp4',
      fileType: 'video',
      total: 100,
    });

    mockListen.fire({
      fileHash: 'hash-C',
      downloaded: 100,
      total: 100,
      percent: 100,
      status: 'completed',
      // 故意不传 localPath
    });

    // 任务保留但不被强行标 completed（避免无 localPath 写入空字符串）
    const task = useFileCacheStore.getState().downloadTasks['hash-C'];
    expect(task.status).toBe('pending'); // addDownloadTask 设置的初始值
  });

  it('failed 事件 → failDownload 设置 error', async () => {
    await startProgressListener();

    useFileCacheStore.getState().addDownloadTask({
      fileHash: 'hash-D',
      fileName: 'd.pdf',
      fileType: 'document',
      total: 50,
    });

    mockListen.fire({
      fileHash: 'hash-D',
      downloaded: 0,
      total: 50,
      percent: 0,
      status: 'failed',
      error: 'HTTP 500',
    });

    const task = useFileCacheStore.getState().downloadTasks['hash-D'];
    expect(task.status).toBe('failed');
    expect(task.error).toBe('HTTP 500');
  });

  it('failed 事件无 error 字段 → 使用默认错误信息', async () => {
    await startProgressListener();

    useFileCacheStore.getState().addDownloadTask({
      fileHash: 'hash-E',
      fileName: 'e.png',
      fileType: 'image',
      total: 10,
    });

    mockListen.fire({
      fileHash: 'hash-E',
      downloaded: 0,
      total: 10,
      percent: 0,
      status: 'failed',
    });

    const task = useFileCacheStore.getState().downloadTasks['hash-E'];
    expect(task.status).toBe('failed');
    expect(task.error).toBe('下载失败');
  });

  it('未注册的 hash 收到 completed/failed 事件 → 忽略（不创建空任务）', async () => {
    await startProgressListener();

    mockListen.fire({
      fileHash: 'never-registered',
      downloaded: 100,
      total: 100,
      percent: 100,
      status: 'completed',
      localPath: '/somewhere',
    });
    mockListen.fire({
      fileHash: 'never-registered-2',
      downloaded: 0,
      total: 0,
      percent: 0,
      status: 'failed',
      error: 'X',
    });

    expect(useFileCacheStore.getState().downloadTasks).toEqual({});
  });
});

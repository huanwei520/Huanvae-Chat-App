/**
 * 视频封面会话缓存 —— 「切换视频封面反复重读」探针转**持久**计数契约（勿删）
 *
 * 缺陷回顾（huanwei 反馈）：切换视频封面时反复重新读取 —— 修复前每次挂载都重付一轮
 * `get_video_poster_path`（IPC + SQLite + stat）；会话内刚截好落盘的封面，切回时还要
 * 整张解码回像素做黑帧自愈（自愈解码恰好落在「切回」那次挂载上）。
 *
 * 本文件三段：
 *  1. 现链路（真 `<VideoThumbnail>` → `useVideoPoster` → `services/videoPoster`）计数契约：
 *     初始切换 = 解码 1 次；切走再切回 = 0 次（缓存命中、首帧同步出封面）；换源 = 重新 1 次。
 *  2. 修复前对比：`git show HEAD:src/services/videoPoster.ts` 的**逐字节源码副本**以常驻
 *     fixture（tests/unit/fixtures/videoPoster.head.ts，仅 import 路径改写）直接调用旧逻辑，
 *     实跑取「修复前」计数 —— 探针证据由此永久可复跑（禁止临时文件删除式取证）。
 *  3. 修复前/后对照表所引用的全部数字都来自本文件实跑输出，禁止手写。
 *
 * mock 边界（仅外部边界，业务链路全真，符合 test-quality-check）：
 *  - `@tauri-apps/api/core` invoke / convertFileSrc（IPC 与 asset 显示通道）
 *  - `services/videoPosterCapture` 的 captureVideoFrame / readImagePixels（jsdom 无解码器盲区）
 *  新旧两份 videoPoster 模块经同一解析路径命中同一批 mock ⇒ 共用同一组计数器。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const core = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => `asset://localhost/${p}`),
  Channel: class {},
}));
vi.mock('@tauri-apps/api/core', () => core);

const capture = vi.hoisted(() => ({
  captureVideoFrame: vi.fn(),
  readImagePixels: vi.fn(),
}));
vi.mock('../../src/services/videoPosterCapture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/videoPosterCapture')>()),
  ...capture,
}));

const { VideoThumbnail } = await import('../../src/chat/shared/VideoThumbnail');
const newApi = await import('../../src/services/videoPoster');
// 修复前逻辑 = HEAD 源码副本（常驻 fixture，逐字节同 HEAD，仅 import 路径改写）
const headApi = await import('./fixtures/videoPoster.head');

/** 内存版 video_posters 表：get/save/invalidate 三步语义与 Rust 侧一一对应 */
function posterDb(initialKeys: string[] = []) {
  const rows = new Set(initialKeys);
  return (cmd: string, args?: { fileKey?: string }) => {
    const key = args?.fileKey ?? '';
    if (cmd === 'get_video_poster_path') {
      return Promise.resolve(rows.has(key) ? `/data/u_s/file/posters/${key}.jpg` : null);
    }
    if (cmd === 'save_video_poster') {
      rows.add(key);
      return Promise.resolve(`/data/u_s/file/posters/${key}.jpg`);
    }
    if (cmd === 'invalidate_video_poster') {
      rows.delete(key);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(undefined);
  };
}

/** 某条命令的真实调用次数（不看 invoke 总数 —— 那会被无关 IPC 蒙混） */
const countInvokes = (cmd: string) => core.invoke.mock.calls.filter((c) => c[0] === cmd).length;

/** 有内容的截帧结果：真黑帧判据一定放行 */
const litFrame = () => ({
  bytes: new Uint8Array([1, 2, 3]),
  pixels: new Uint8ClampedArray([255, 255, 255, 255]),
});

const SRC = 'http://127.0.0.1:5321/bucket/clip.mp4';
const mountThumb = (key: string) =>
  render(<VideoThumbnail src={SRC} fileUuid={key} className="message-video-thumbnail" />);
const imgSrcOf = (c: HTMLElement) => c.querySelector('img')?.getAttribute('src') ?? null;

beforeEach(() => {
  // 现链路模块级缓存：用例间走生产导出的失效口清空（登出走的同一条路）。
  // posterInspected / captureFailed 无清空导出，以「每用例唯一 key」隔离（键含用例名）。
  newApi.clearVideoPosterSessionCache();
  core.invoke.mockReset();
  core.convertFileSrc.mockClear();
  capture.captureVideoFrame.mockReset();
  capture.readImagePixels.mockReset();
  // 默认读不出像素 ⇒ 自愈保持现状不删缓存（与既有 videoPoster 系列测试同款语义）
  capture.readImagePixels.mockResolvedValue(null);
});

describe('现链路：切换必须命中会话缓存（计数契约）', () => {
  it('初始切换 = 索引读取 1 次 + 解码 1 次，封面直接上屏', async () => {
    core.invoke.mockImplementation(posterDb(['vc-init']));
    capture.captureVideoFrame.mockResolvedValue(litFrame());

    const view = mountThumb('vc-init');
    await waitFor(() => expect(imgSrcOf(view.container)).not.toBeNull());

    expect(countInvokes('get_video_poster_path')).toBe(1);
    expect(capture.readImagePixels).toHaveBeenCalledTimes(1);
    expect(imgSrcOf(view.container)).toBe(
      'asset://localhost//data/u_s/file/posters/vc-init.jpg',
    );
    view.unmount();
  });

  it('切走再切回（A→B→A）= 切回那一次 0 索引读取 0 解码（缓存命中，首帧同步出封面）', async () => {
    core.invoke.mockImplementation(posterDb(['vc-a', 'vc-b']));
    capture.captureVideoFrame.mockResolvedValue(litFrame());

    // A 首次：读 1 + 解码 1
    const a = mountThumb('vc-a');
    await waitFor(() => expect(imgSrcOf(a.container)).not.toBeNull());
    a.unmount();

    // 切走到 B（换源，B 第一次：读 1 + 解码 1，各付各的）
    const b = mountThumb('vc-b');
    await waitFor(() => expect(imgSrcOf(b.container)).not.toBeNull());
    expect(imgSrcOf(b.container)).toBe('asset://localhost//data/u_s/file/posters/vc-b.jpg');
    b.unmount();

    // 切回 A：🔴 修复前这里 get 会涨到 3（每次挂载都读）；修复后必须命中缓存
    const a2 = mountThumb('vc-a');
    expect(a2.container.querySelector('img')).not.toBeNull();
    expect(a2.container.querySelector('[data-video-poster-placeholder]')).toBeNull();
    expect(imgSrcOf(a2.container)).toBe('asset://localhost//data/u_s/file/posters/vc-a.jpg');

    expect(countInvokes('get_video_poster_path')).toBe(2);
    expect(capture.readImagePixels).toHaveBeenCalledTimes(2);
    a2.unmount();
  });

  it('换源 = 重新解码 1 次（不同视频不同键，不互替命中、各显各的封面）', async () => {
    core.invoke.mockImplementation(posterDb(['vc-a1', 'vc-c1']));
    capture.captureVideoFrame.mockResolvedValue(litFrame());

    const a = mountThumb('vc-a1');
    await waitFor(() => expect(imgSrcOf(a.container)).not.toBeNull());
    a.unmount();

    // 换源到另一条视频：它自己的第一次 —— 恰好 1 次新读取 + 1 次新解码，且拿到的是自己的封面
    const c = mountThumb('vc-c1');
    await waitFor(() => expect(imgSrcOf(c.container)).not.toBeNull());
    expect(imgSrcOf(c.container)).toBe('asset://localhost//data/u_s/file/posters/vc-c1.jpg');

    expect(countInvokes('get_video_poster_path')).toBe(2);
    expect(capture.readImagePixels).toHaveBeenCalledTimes(2);
    c.unmount();
  });

  it('会话内新截好的封面切回：0 重截、0 重读、0 解码', async () => {
    core.invoke.mockImplementation(posterDb()); // 盘上原本没有
    capture.captureVideoFrame.mockResolvedValue(litFrame());

    const first = mountThumb('vc-fresh');
    await waitFor(() => expect(imgSrcOf(first.container)).not.toBeNull()); // 截完当场切 <img>
    expect(countInvokes('save_video_poster')).toBe(1);
    first.unmount();

    // 切回：🔴 修复前：重截 captureVideoFrame=2、get=2、且整张自愈解码 1 次；修复后全 0 新增
    const second = mountThumb('vc-fresh');
    await waitFor(() => expect(imgSrcOf(second.container)).not.toBeNull());
    expect(imgSrcOf(second.container)).toBe(
      'asset://localhost//data/u_s/file/posters/vc-fresh.jpg',
    );

    expect(countInvokes('get_video_poster_path')).toBe(1);
    expect(capture.captureVideoFrame).toHaveBeenCalledTimes(1);
    expect(countInvokes('save_video_poster')).toBe(1);
    expect(capture.readImagePixels).toHaveBeenCalledTimes(0);
    second.unmount();
  });
});

describe('修复前对比（HEAD 源码副本直接调用，常驻 fixture 实跑）', () => {
  it('HEAD：已落盘封面同键重复读取 —— 每次挂载都重付索引 IPC（2 次读取），解码仅首次（1 次）', async () => {
    core.invoke.mockImplementation(posterDb(['head-onDisk']));
    capture.readImagePixels.mockResolvedValue(null);

    // 挂载#1（首次）：读 1 + 解码 1
    await headApi.loadVideoPosterSrc('head-onDisk');
    // 挂载#2（切走再切回）：🔴 修复前再付一轮 IPC；解码被 posterInspected 摊销
    await headApi.loadVideoPosterSrc('head-onDisk');

    expect(countInvokes('get_video_poster_path')).toBe(2);
    expect(capture.readImagePixels).toHaveBeenCalledTimes(1);
  });

  it('HEAD：会话内新截好的封面切回 —— 切回首读就整张解码（解码=1），再次挂载又付 IPC（get=2）', async () => {
    core.invoke.mockImplementation(posterDb()); // 盘上原本没有
    capture.captureVideoFrame.mockResolvedValue(litFrame());
    capture.readImagePixels.mockResolvedValue(null);

    // 挂载#1：截帧 + 落盘（旧写侧不喂任何读侧缓存）
    await headApi.captureAndSaveVideoPoster('head-fresh', SRC);
    expect(countInvokes('save_video_poster')).toBe(1);
    expect(countInvokes('get_video_poster_path')).toBe(0);

    // 挂载#2（切回）：🔴 修复前切回首读重付一轮 IPC + 整张解码；修复后 0/0（见上方 vc-fresh 用例）
    await headApi.loadVideoPosterSrc('head-fresh');
    expect(countInvokes('get_video_poster_path')).toBe(1);
    expect(capture.readImagePixels).toHaveBeenCalledTimes(1);

    // 挂载#3：解码不再重复（posterInspected），但 IPC 每次照付
    await headApi.loadVideoPosterSrc('head-fresh');
    expect(countInvokes('get_video_poster_path')).toBe(2);
    expect(capture.readImagePixels).toHaveBeenCalledTimes(1);
  });
});

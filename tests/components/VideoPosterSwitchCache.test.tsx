/**
 * 「切换视频封面」的缓存命中契约 —— huanwei 反馈「切换视频封面时反复重新读取」的计数实证与回归守卫
 *
 * 缺陷（修复前，本文件计数可见）：同一个视频的封面在**每次挂载**都重新走一遍读链路 ——
 * 切会话再切回 / 列表滚动让缩略图销毁重建，每次都打一轮 `get_video_poster_path`
 * （IPC + SQLite + stat）；本会话第一次命中还要整张解码回像素做黑帧自愈；
 * 更糟的是**会话内刚截好落盘**的封面，切回时居然整段重截（离屏 `<video>` 拉元数据 +
 * seek + 解码 + `INSERT OR REPLACE` 重写盘）—— 因为读侧结果没有进程内缓存，
 * 写侧截完也不会告诉读侧。
 *
 * 本文件在**组件级**计数：mock 的只有两条外部边界 ——
 *  - `@tauri-apps/api/core` 的 invoke / convertFileSrc（IPC 与 asset 显示通道）
 *  - `services/videoPosterCapture` 里碰 DOM 的两个函数（jsdom 盲区，见该模块头）
 * 中间整条链（`<VideoThumbnail>` → `useVideoPoster` → `services/videoPoster`）跑**真实现**，
 * 计数对象是业务行为（同源切换后的真实 IPC/解码/截帧次数），不是 mock 自证。
 *
 * 末组是进程内缓存的**两个失效点**接线守卫：登出（SessionContext.clearSession）与
 * 「重置所有数据」（SettingsPanel → db_clear_all_data）。缓存活着，失效点就必须也在。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
const { clearVideoPosterSessionCache } = await import('../../src/services/videoPoster');

/**
 * 内存版 `video_posters` 表：get / save / invalidate 三步语义与 Rust 侧一一对应
 * （get = 查表；save = INSERT OR REPLACE；invalidate = 删行）。
 */
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

/** 有内容的截帧结果：真黑帧判据一定放行（与 videoPosterService.test.ts 同款构造） */
const litFrame = () => ({
  bytes: new Uint8Array([1, 2, 3]),
  pixels: new Uint8ClampedArray([255, 255, 255, 255]),
});

const SRC = 'http://127.0.0.1:5321/bucket/clip.mp4';
const mountThumb = (key: string) =>
  render(<VideoThumbnail src={SRC} fileUuid={key} className="message-video-thumbnail" />);
const imgSrcOf = (c: HTMLElement) => c.querySelector('img')?.getAttribute('src') ?? null;

beforeEach(() => {
  // 进程内缓存是模块级状态，用例间用生产导出的失效口清空（登出走的同一条路）
  clearVideoPosterSessionCache();
  core.invoke.mockReset();
  core.convertFileSrc.mockClear();
  capture.captureVideoFrame.mockReset();
  capture.readImagePixels.mockReset();
  // 默认读不出像素 ⇒ 自愈保持现状不删缓存（与 videoPosterService.test.ts 同款语义）
  capture.readImagePixels.mockResolvedValue(null);
});

describe('同源封面切换必须命中缓存（不再反复重读）', () => {
  it('切走再切回：第二次挂载零索引读取，封面同步出现（修复前每次挂载都读）', async () => {
    core.invoke.mockImplementation(posterDb(['uuid-switch']));
    capture.captureVideoFrame.mockResolvedValue(litFrame()); // uuid-other 不在索引里 ⇒ 走真截帧链路

    // 第一次看到这个视频：读一次索引 + 自愈解码一次
    const first = mountThumb('uuid-switch');
    await waitFor(() => expect(imgSrcOf(first.container)).not.toBeNull());
    expect(countInvokes('get_video_poster_path')).toBe(1);
    first.unmount();

    // 切到另一个视频（不同键，各读各的）
    const other = mountThumb('uuid-other');
    await waitFor(() => expect(imgSrcOf(other.container)).not.toBeNull());
    other.unmount();

    // 切回来：同一个视频、同一把键 —— 不许再读
    const second = mountThumb('uuid-switch');

    // 🔴 修复前这里是 3（每次挂载都打一轮）；修复后切换必须命中缓存
    expect(countInvokes('get_video_poster_path')).toBe(2);
    // 自愈解码同样只发生在落盘路径第一次被读到时
    expect(capture.readImagePixels).toHaveBeenCalledTimes(1);
    // 命中是**同步**的：第一帧就有封面，没有 pending 占位（「切回先黑一下」的消除）
    expect(second.container.querySelector('img')).not.toBeNull();
    expect(second.container.querySelector('[data-video-poster-placeholder]')).toBeNull();
    expect(imgSrcOf(second.container)).toBe(
      'asset://localhost//data/u_s/file/posters/uuid-switch.jpg',
    );
  });

  it('会话内刚截好落盘的封面，切回时零重截、零重读、零重写', async () => {
    core.invoke.mockImplementation(posterDb()); // 磁盘上原本没有这张封面
    capture.captureVideoFrame.mockResolvedValue(litFrame());

    const first = mountThumb('uuid-fresh');
    await waitFor(() => expect(imgSrcOf(first.container)).not.toBeNull()); // 截完当场切 <img>
    first.unmount();

    const second = mountThumb('uuid-fresh');
    await waitFor(() => expect(imgSrcOf(second.container)).not.toBeNull());

    // 🔴 修复前：get=2、captureVideoFrame=2、save=2 —— 切回等于整段重截重写一遍
    expect(countInvokes('get_video_poster_path')).toBe(1);
    expect(capture.captureVideoFrame).toHaveBeenCalledTimes(1);
    expect(countInvokes('save_video_poster')).toBe(1);
    expect(imgSrcOf(second.container)).toBe(
      'asset://localhost//data/u_s/file/posters/uuid-fresh.jpg',
    );
  });

  it('键隔离：不同视频不互替命中，各读各的、各显各的', async () => {
    core.invoke.mockImplementation(posterDb(['uuid-a']));
    capture.captureVideoFrame.mockResolvedValue(litFrame());

    const a = mountThumb('uuid-a');
    await waitFor(() => expect(imgSrcOf(a.container)).not.toBeNull());
    a.unmount();

    // uuid-b 不在索引里 ⇒ 走截帧落盘（真链路），出来的是 b 自己的封面
    const b = mountThumb('uuid-b');
    await waitFor(() => expect(imgSrcOf(b.container)).not.toBeNull());
    expect(imgSrcOf(b.container)).toBe('asset://localhost//data/u_s/file/posters/uuid-b.jpg');
    b.unmount();

    const a2 = mountThumb('uuid-a');
    await waitFor(() => expect(imgSrcOf(a2.container)).not.toBeNull());
    // a、b 各读一次 = 2；a 的第二次挂载不再读
    expect(countInvokes('get_video_poster_path')).toBe(2);
    expect(imgSrcOf(a2.container)).toBe('asset://localhost//data/u_s/file/posters/uuid-a.jpg');
  });
});

/**
 * 进程内缓存的**两个失效点**接线守卫（静态扫描，同
 * videoPosterPersistenceWiring.test.ts 的做法 —— 跨组件的接线 jsdom 测不到）。
 */
describe('失效点接线：缓存活着，失效点就必须也在', () => {
  const ROOT = resolve(__dirname, '../..');
  const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf-8');

  it('登出 / 切换账号（SessionContext.clearSession）清封面进程内缓存', () => {
    const code = read('src/contexts/SessionContext.tsx');
    // 它必须落在 clearSession 里（与其它会话级缓存的清空同一条收敛点）
    const at = code.indexOf('clearSession = useCallback');
    expect(at).toBeGreaterThan(-1);
    expect(code.indexOf('clearVideoPosterSessionCache()', at)).toBeGreaterThan(at);
  });

  it('重置所有数据（SettingsPanel → db_clear_all_data）成功后清封面进程内缓存', () => {
    const code = read('src/components/settings/SettingsPanel.tsx');
    const at = code.indexOf("invoke('db_clear_all_data')");
    expect(at).toBeGreaterThan(-1);
    // 必须在清库**之后**调用（先清就把旧地址放回了）
    expect(code.indexOf('clearVideoPosterSessionCache()', at)).toBeGreaterThan(at);
  });
});

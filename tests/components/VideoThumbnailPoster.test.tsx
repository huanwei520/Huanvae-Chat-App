/**
 * `<VideoThumbnail>` 的封面本地持久化行为
 *
 * 三条验收口径全在这里：
 *  1. **缓存命中 ⇒ 不发起截帧**，且**根本不建 `<video>`**（这才是「杀掉 App 重开立刻有画面」）
 *  2. **未命中 ⇒ 截一次**（恰 1 次，参数是 fileHash + 裸 src），截好当场切成 `<img>`
 *  3. **不传 fileHash 的调用点行为不变**（`<video>` 分支，且一次 IPC 都不发）——
 *     第 3 条守的是「我的文件」那两个还没接线的消费点不被牵连。
 *
 * 编排层（services/videoPoster）在此被 mock：本文件只验组件把它接对了没有，
 * 编排本身的去重 / 并发 / 失败不重试在 tests/unit/videoPosterService.test.ts。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const posterService = vi.hoisted(() => ({
  loadVideoPosterSrc: vi.fn(),
  captureAndSaveVideoPoster: vi.fn(),
}));
vi.mock('../../src/services/videoPoster', () => posterService);

const { VideoThumbnail } = await import('../../src/chat/shared/VideoThumbnail');

const SRC = 'http://127.0.0.1:5321/bucket/clip.mp4';
const POSTER = 'asset://localhost//data/u_s/file/posters/h1.jpg';

beforeEach(() => {
  posterService.loadVideoPosterSrc.mockReset();
  posterService.captureAndSaveVideoPoster.mockReset();
  posterService.captureAndSaveVideoPoster.mockResolvedValue(null);
});

describe('本地已有封面：走 <img>，不建 <video>、不再截帧', () => {
  it('渲染 <img src=封面>，DOM 里没有任何 <video>', async () => {
    posterService.loadVideoPosterSrc.mockResolvedValue(POSTER);

    const { container } = render(
      <VideoThumbnail src={SRC} fileHash="h1" className="message-video-thumbnail" />,
    );

    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img).toHaveAttribute('src', POSTER);
      // 🔴 这一条是本功能的要害：命中就不该再有媒体元素去拉元数据 / seek
      expect(container.querySelector('video')).toBeNull();
    });

    expect(posterService.loadVideoPosterSrc).toHaveBeenCalledWith('h1');
    expect(posterService.captureAndSaveVideoPoster).not.toHaveBeenCalled();
  });

  it('className 照旧落到显示元素上（九宫格/气泡的尺寸与裁切样式靠它）', async () => {
    posterService.loadVideoPosterSrc.mockResolvedValue(POSTER);
    const { container } = render(
      <VideoThumbnail src={SRC} fileHash="h1" className="conv-msg-search-cover" decorative />,
    );
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).toHaveClass('conv-msg-search-cover');
      // decorative 的语义不变（外层格子已带 aria-label）
      expect(img).toHaveAttribute('aria-hidden', 'true');
    });
  });
});

describe('本地没有封面：照旧渲染 <video>，同时截一次存下来', () => {
  it('渲染 <video src=…#t=0.1>，并对 (fileHash, 裸 src) 恰发起一次截帧', async () => {
    posterService.loadVideoPosterSrc.mockResolvedValue(null);

    const { container } = render(<VideoThumbnail src={SRC} fileHash="h2" />);

    await waitFor(() => {
      const video = container.querySelector('video');
      expect(video).not.toBeNull();
      expect(video).toHaveAttribute('src', `${SRC}#t=0.1`);
    });

    await waitFor(() => {
      expect(posterService.captureAndSaveVideoPoster).toHaveBeenCalledTimes(1);
    });
    // 递给截帧的必须是**裸** src（带 #t=0.1 的那份只给可见元素当封面用）
    expect(posterService.captureAndSaveVideoPoster).toHaveBeenCalledWith('h2', SRC);
  });

  it('截帧成功 ⇒ 当场切成 <img>，不必等下次挂载', async () => {
    posterService.loadVideoPosterSrc.mockResolvedValue(null);
    posterService.captureAndSaveVideoPoster.mockResolvedValue(POSTER);

    const { container } = render(<VideoThumbnail src={SRC} fileHash="h3" />);

    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).toHaveAttribute('src', POSTER);
      expect(container.querySelector('video')).toBeNull();
    });
  });

  it('截帧失败 ⇒ 停在 <video>，不清屏也不报错', async () => {
    posterService.loadVideoPosterSrc.mockResolvedValue(null);
    posterService.captureAndSaveVideoPoster.mockResolvedValue(null);

    const { container } = render(<VideoThumbnail src={SRC} fileHash="h4" />);

    await waitFor(() => {
      expect(container.querySelector('video')).not.toBeNull();
    });
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('成因判定的运行时观测：不带封面缓存时，每次挂载都是一个全新的 <video>', () => {
  // 这一组是「每次都重新加载 / 先黑再显示」成因判定（① 每次挂载重新 load+seek）的**可复跑观测**，
  // 顺带当回归守卫。它证明的是：不接封面缓存时，跨挂载**没有任何产物被留下** ——
  // 每次挂载产出的都是一个新的 <video> 元素，首帧只能靠引擎按 preload="metadata" + #t=0.1
  // 现拉现 seek；元素一销毁那帧就没了。
  // （另外两种成因由 /private/tmp 的静态探针排除：② 修复前全仓根本没有封面产物可命中 ——
  //  没有 poster 属性、没有索引表、没有截帧设施；③ 标签上没有 key，元素不会被无谓重建，
  //  而「杀掉 App 重开」时元素必然是新的，与是否多余重建无关。）
  it('挂载 → 卸载 → 再挂载：两次拿到的是不同的 <video> 实例，且全程没有任何持久化产物', () => {
    const first = render(<VideoThumbnail src={SRC} />);
    const v1 = first.container.querySelector('video');
    expect(v1).not.toBeNull();
    // 没有 poster 属性 = 没有任何"已经算好的封面"可用，只能靠元素自己 seek
    expect(v1?.hasAttribute('poster')).toBe(false);
    first.unmount();

    const second = render(<VideoThumbnail src={SRC} />);
    const v2 = second.container.querySelector('video');
    expect(v2).not.toBeNull();
    // 新元素、新的 load+seek —— 上一次那帧没有被留下来
    expect(v2).not.toBe(v1);
    expect(v2).toHaveAttribute('src', `${SRC}#t=0.1`);
    expect(second.container.querySelector('img')).toBeNull();
  });
});

describe('不传 fileHash：与本功能落地前逐字节相同', () => {
  it('同步渲染 <video>，且一次封面 IPC 都不发（还没接线的消费点不受牵连）', () => {
    const { container } = render(<VideoThumbnail src={SRC} />);

    // 同步 —— 不经 pending 空窗（没有键可查，没什么可等的）
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('src', `${SRC}#t=0.1`);

    expect(posterService.loadVideoPosterSrc).not.toHaveBeenCalled();
    expect(posterService.captureAndSaveVideoPoster).not.toHaveBeenCalled();
  });

  it('onPlay 仍接在 <video> 上（气泡靠它收占位 / 触发后台缓存）', async () => {
    const onPlay = vi.fn();
    const { container } = render(<VideoThumbnail src={SRC} onPlay={onPlay} />);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    video?.dispatchEvent(new Event('play', { bubbles: true }));
    await waitFor(() => expect(onPlay).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('img')).toBeNull();
  });
});

/**
 * 待发区组件：渲染 + 逐个删除 + 超限提示 + 空态不占位
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComposerTray } from '../../src/chat/shared/ComposerTray';
import type { TrayItem } from '../../src/stores/composerTrayStore';

function item(id: string, name: string, kind: TrayItem['kind'], previewUrl: string | null): TrayItem {
  return {
    id,
    file: new File(['x'], name, { type: kind === 'file' ? 'application/pdf' : `${kind}/png` }),
    localPath: `/tmp/${name}`,
    kind,
    previewUrl,
  };
}

describe('ComposerTray', () => {
  it('没有附件也没有提示时什么都不渲染（不给输入框上方留空条）', () => {
    const { container } = render(
      <ComposerTray items={[]} onRemove={vi.fn()} notice={null} onDismissNotice={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('图片项渲染缩略图，文件项渲染文件名（没有缩略图可用）', () => {
    render(
      <ComposerTray
        items={[item('1', 'a.png', 'image', 'blob:a'), item('2', 'b.pdf', 'file', null)]}
        onRemove={vi.fn()}
        notice={null}
        onDismissNotice={vi.fn()}
      />,
    );
    const img = screen.getByAltText('a.png') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('blob:a');
    expect(screen.getByTitle('b.pdf')).toHaveTextContent('b.pdf');
    // 文件项没有 <img>
    expect(screen.queryByAltText('b.pdf')).toBeNull();
  });

  /**
   * 🔴 视频那一格必须是**封面预览**，不是破图。
   *
   * `previewUrl` 是 `URL.createObjectURL(file)` 造的 blob 地址：喂给 `<img>` 时，
   * 图片解得出、视频解不出 —— 于是同一个待发区里"图片有预览、视频是破图图标"。
   * 修法是复用全仓唯一那处视频封面组件 `<VideoThumbnail>`（内部追 `#t=0.1` 逼引擎 seek 首帧）。
   *
   * jsdom 不解码也不 seek，所以这里能钉的是**接线**：出来的是 `<video>` 而不是 `<img>`、
   * src 带了媒体片段、三个播放属性齐全。真实首帧画不画得出来是真机的事
   * （见 .claude/rules/frontend-test.md「所有 X 必经 Y」的结构性盲区）。
   */
  it('视频项渲染 <video> 封面预览（带 #t=0.1 与三个播放属性），而不是喂给 <img> 的破图', () => {
    const { container } = render(
      <ComposerTray items={[item('1', 'v.mp4', 'video', 'blob:v')]} onRemove={vi.fn()} notice={null} onDismissNotice={vi.fn()} />,
    );

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('blob:v#t=0.1');
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect(video?.muted).toBe(true);
    expect(video?.hasAttribute('playsinline')).toBe(true);
    // 反向：这一格里不许再有 <img>（那正是破图的来源）
    expect(container.querySelector('.composer-tray-thumb img')).toBeNull();
  });

  it('图片项仍然走 <img>（上一条的反向对照：不是把所有格子都改成了 <video>）', () => {
    const { container } = render(
      <ComposerTray items={[item('1', 'a.png', 'image', 'blob:a')]} onRemove={vi.fn()} notice={null} onDismissNotice={vi.fn()} />,
    );
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('.composer-tray-thumb img')?.getAttribute('src')).toBe('blob:a');
  });

  it('视频项带「视频」角标（图片项没有）', () => {
    const { rerender } = render(
      <ComposerTray items={[item('1', 'v.mp4', 'video', 'blob:v')]} onRemove={vi.fn()} notice={null} onDismissNotice={vi.fn()} />,
    );
    expect(screen.getByText('视频')).toBeInTheDocument();
    rerender(
      <ComposerTray items={[item('1', 'a.png', 'image', 'blob:a')]} onRemove={vi.fn()} notice={null} onDismissNotice={vi.fn()} />,
    );
    expect(screen.queryByText('视频')).toBeNull();
  });

  it('点某一项的移除按钮，只回传那一项的 id', () => {
    const onRemove = vi.fn();
    render(
      <ComposerTray
        items={[item('1', 'a.png', 'image', 'blob:a'), item('2', 'b.png', 'image', 'blob:b')]}
        onRemove={onRemove}
        notice={null}
        onDismissNotice={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('移除 b.png'));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenLastCalledWith('2');
  });

  it('超限提示原文可见，且可关闭', () => {
    const onDismiss = vi.fn();
    render(
      <ComposerTray
        items={[]}
        onRemove={vi.fn()}
        notice="huge.mp4 超过单个 15 GB 上限，未加入"
        onDismissNotice={onDismiss}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('huge.mp4 超过单个 15 GB 上限，未加入');
    fireEvent.click(screen.getByLabelText('关闭提示'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

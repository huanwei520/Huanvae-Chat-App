/**
 * VideoThumbnail —— 全仓唯一那处「把 `<video>` 当封面」的共享组件
 *
 * 本文件只覆盖**渲染契约与交互**（jsdom 能验的那一半）：
 *  - src 必经 videoPosterSrc（追 `#t=0.1`），且已带 fragment 时不重复追
 *  - preload / muted / playsInline 三个属性一个不缺（漏任一都只有真机看得见）
 *  - className 透传（各调用点的尺寸 / 裁切样式仍归各自 CSS）
 *  - decorative 决定 aria-hidden（格子自带 aria-label 时不让读屏念两遍）
 *  - onPlay 回调接线（气泡里的视频靠它收起「加载中」占位）
 *
 * ⚠️ **这里验不到的那一半**：jsdom 的 `<video>` 不解码、不 seek、不画帧，
 * 「首帧到底有没有画出来」只有真 webview 才知道（见 .claude/rules/frontend-test.md
 * 「所有 X 必经 Y」的结构性盲区）。「全仓只剩这一处 `<video>`」这条结构不变量
 * 由 tests/unit/videoPosterWiring.test.ts 静态扫描守着，不在本文件。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { VideoThumbnail } from '../../src/chat/shared/VideoThumbnail';

/** jsdom 里 `<video>` 没有 role，用 container 直接取元素 */
function renderThumb(props: Parameters<typeof VideoThumbnail>[0]) {
  const { container } = render(<VideoThumbnail {...props} />);
  const el = container.querySelector('video');
  if (!el) {
    throw new Error('VideoThumbnail 没有渲染出 <video>');
  }
  return el;
}

describe('VideoThumbnail 渲染契约', () => {
  it('src 经 videoPosterSrc 追 #t=0.1，并带齐 preload / muted / playsInline', () => {
    const el = renderThumb({ src: 'http://127.0.0.1:41234/proxied/clip.mp4' });

    expect(el.getAttribute('src')).toBe('http://127.0.0.1:41234/proxied/clip.mp4#t=0.1');
    expect(el.getAttribute('preload')).toBe('metadata');
    // React 把 muted 设成 DOM **属性**而非 HTML attribute，只能读 property
    expect(el.muted).toBe(true);
    expect(el.hasAttribute('playsinline')).toBe(true);
  });

  it('src 已带 fragment 时原样透传，不拼出第二个 #（URL 只能有一个 fragment）', () => {
    const el = renderThumb({ src: 'http://127.0.0.1:41234/proxied/clip.mp4#t=5' });

    expect(el.getAttribute('src')).toBe('http://127.0.0.1:41234/proxied/clip.mp4#t=5');
  });

  it('className 透传；未传 decorative 时不写 aria-hidden', () => {
    const el = renderThumb({ src: 'http://x/y.mp4', className: 'conv-msg-search-cover' });

    expect(el).toHaveClass('conv-msg-search-cover');
    expect(el.hasAttribute('aria-hidden')).toBe(false);
  });

  it('decorative 时置 aria-hidden（外层格子已带 aria-label，不让读屏念两遍）', () => {
    const el = renderThumb({ src: 'http://x/y.mp4', decorative: true });

    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('VideoThumbnail 交互', () => {
  it('播放事件回调接线：onPlay 被调用（气泡靠它收起「加载中」占位）', () => {
    const onPlay = vi.fn();
    const el = renderThumb({ src: 'http://x/y.mp4', onPlay });

    expect(onPlay).not.toHaveBeenCalled();
    fireEvent.play(el);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('未传 onPlay 时播放事件不报错（四个调用点里三处都不需要它）', () => {
    const el = renderThumb({ src: 'http://x/y.mp4' });

    expect(() => fireEvent.play(el)).not.toThrow();
  });
});

describe('VideoThumbnail 无障碍', () => {
  it('非装饰态下 <video> 留在无障碍树里（可被 querySelector 之外的手段取到）', () => {
    render(
      <div aria-label="外层容器">
        <VideoThumbnail src="http://x/y.mp4" className="message-video-thumbnail" />
      </div>,
    );

    // 外层容器仍可被读屏定位；<video> 本身没有被 aria-hidden 摘除
    const wrapper = screen.getByLabelText('外层容器');
    expect(wrapper.querySelector('video')?.hasAttribute('aria-hidden')).toBe(false);
  });
});

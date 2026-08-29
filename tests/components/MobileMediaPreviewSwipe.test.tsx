/**
 * MobileMediaPreview 横向滑动切图（组件层接线）
 *
 * 纯判定逻辑已由 tests/unit/mediaSwipe.test.ts 覆盖；这份测的是**接线**：
 * 真的把 touch 事件喂进去了、真的按裁决调了对应回调、放大态真的让位。
 *
 * ⚠️ 覆盖边界（对齐 .claude/rules/frontend-test.md「滚动 / 布局相关行为 vitest 结构性测不出」）：
 * jsdom 无布局 ⇒ `clientWidth` 恒 0 ⇒ 阈值退到 SWIPE_MIN_DISTANCE_PX（56px），
 * 而「跟手位移看起来对不对 / 回弹动画好不好看」这半属于**真机**，这里测不了。
 * 这里能钉住的是「该调的调了、不该调的没调」。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

vi.mock('../../src/hooks/useMobileBackHandler', () => ({
  useMobileBackHandler: vi.fn(),
  useMobileBackOverlay: vi.fn(),
}));

vi.mock('../../src/utils/saveToGallery', () => ({
  saveToGallery: vi.fn().mockResolvedValue({ success: true }),
}));

import { MobileMediaPreview } from '../../src/chat/shared/MobileMediaPreview';
import { setMediaZoomed } from '../../src/chat/shared/mediaZoomState';

/**
 * jsdom 没有 TouchEvent 构造器，手搓一个带 touches / changedTouches 的事件。
 * 只用到 clientX / clientY 两个字段（手势层就只读这两个）。
 */
function touchEvent(type: string, points: Array<{ x: number; y: number }>): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const list = points.map((p) => ({ clientX: p.x, clientY: p.y }));
  Object.defineProperty(ev, 'touches', { value: list });
  Object.defineProperty(ev, 'changedTouches', { value: list });
  return ev;
}

function baseProps() {
  return {
    isOpen: true as const,
    type: 'image' as const,
    src: 'http://example.com/img.jpg',
    filename: 'photo.jpg',
    onClose: vi.fn(),
  };
}

function area(container: HTMLElement): HTMLElement {
  const el = container.ownerDocument.querySelector('.mobile-media-preview-content');
  if (!el) { throw new Error('找不到手势采集区 .mobile-media-preview-content'); }
  return el as HTMLElement;
}

/** 一次完整的横向拖动手势（单指） */
function swipe(el: HTMLElement, dx: number, dy = 0) {
  act(() => {
    el.dispatchEvent(touchEvent('touchstart', [{ x: 200, y: 300 }]));
    // 先走一步把方向判出来，再走到终点（与真机上连续 touchmove 同形）
    el.dispatchEvent(touchEvent('touchmove', [{ x: 200 + dx / 2, y: 300 + dy / 2 }]));
    el.dispatchEvent(touchEvent('touchmove', [{ x: 200 + dx, y: 300 + dy }]));
    el.dispatchEvent(touchEvent('touchend', [{ x: 200 + dx, y: 300 + dy }]));
  });
}

describe('MobileMediaPreview 横向滑动切图', () => {
  beforeEach(() => {
    cleanup();
    setMediaZoomed(false);
  });

  afterEach(() => {
    setMediaZoomed(false);
  });

  it('向左滑过阈值 → 调 onSwipeNext（下一张）', () => {
    const onSwipeNext = vi.fn();
    const onSwipePrev = vi.fn();
    const { container } = render(
      <MobileMediaPreview
        {...baseProps()}
        onSwipePrev={onSwipePrev}
        onSwipeNext={onSwipeNext}
        hasPrev
        hasNext
      />,
    );

    swipe(area(container), -120);
    expect(onSwipeNext).toHaveBeenCalledTimes(1);
    expect(onSwipePrev).not.toHaveBeenCalled();
  });

  it('向右滑过阈值 → 调 onSwipePrev（上一张）', () => {
    const onSwipeNext = vi.fn();
    const onSwipePrev = vi.fn();
    const { container } = render(
      <MobileMediaPreview
        {...baseProps()}
        onSwipePrev={onSwipePrev}
        onSwipeNext={onSwipeNext}
        hasPrev
        hasNext
      />,
    );

    swipe(area(container), 120);
    expect(onSwipePrev).toHaveBeenCalledTimes(1);
    expect(onSwipeNext).not.toHaveBeenCalled();
  });

  it('没滑够 → 两个回调都不调（回弹）', () => {
    const onSwipeNext = vi.fn();
    const { container } = render(
      <MobileMediaPreview {...baseProps()} onSwipeNext={onSwipeNext} hasNext />,
    );

    swipe(area(container), -30);
    expect(onSwipeNext).not.toHaveBeenCalled();
  });

  it('竖向为主的拖动 → 不切图（不抢竖向手势）', () => {
    const onSwipeNext = vi.fn();
    const { container } = render(
      <MobileMediaPreview {...baseProps()} onSwipeNext={onSwipeNext} hasNext />,
    );

    swipe(area(container), -120, -300);
    expect(onSwipeNext).not.toHaveBeenCalled();
  });

  it('🔴 边界：最后一张继续往后滑 → 不调 onSwipeNext（回弹，不循环）', () => {
    const onSwipeNext = vi.fn();
    const { container } = render(
      <MobileMediaPreview {...baseProps()} onSwipeNext={onSwipeNext} hasNext={false} />,
    );

    swipe(area(container), -200);
    expect(onSwipeNext).not.toHaveBeenCalled();
  });

  it('🔴 边界：第一张继续往前滑 → 不调 onSwipePrev（回弹，不循环）', () => {
    const onSwipePrev = vi.fn();
    const { container } = render(
      <MobileMediaPreview {...baseProps()} onSwipePrev={onSwipePrev} hasPrev={false} />,
    );

    swipe(area(container), 200);
    expect(onSwipePrev).not.toHaveBeenCalled();
  });

  it('🔴 放大态：同一条手势不再切图（横向拖动整个让给缩放层）', () => {
    const onSwipeNext = vi.fn();
    const { container } = render(
      <MobileMediaPreview {...baseProps()} onSwipeNext={onSwipeNext} hasNext />,
    );
    const el = area(container);

    // 正对照：未放大时这条手势是会切图的（证明下面那个"没调"不是手势本身没生效）
    swipe(el, -200);
    expect(onSwipeNext).toHaveBeenCalledTimes(1);

    act(() => { setMediaZoomed(true); });
    swipe(el, -200);
    expect(onSwipeNext).toHaveBeenCalledTimes(1); // 没有再增加
  });

  it('🔴 手势中途落下第二指（捏合）→ 不切图', () => {
    const onSwipeNext = vi.fn();
    const { container } = render(
      <MobileMediaPreview {...baseProps()} onSwipeNext={onSwipeNext} hasNext />,
    );
    const el = area(container);

    act(() => {
      el.dispatchEvent(touchEvent('touchstart', [{ x: 200, y: 300 }]));
      el.dispatchEvent(touchEvent('touchmove', [{ x: 140, y: 300 }]));
      // 第二根手指落下 → 这是捏合，不是切图
      el.dispatchEvent(touchEvent('touchmove', [{ x: 80, y: 300 }, { x: 300, y: 320 }]));
      el.dispatchEvent(touchEvent('touchend', [{ x: 80, y: 300 }]));
    });

    expect(onSwipeNext).not.toHaveBeenCalled();
  });

  it('不传 onSwipePrev / onSwipeNext 的调用方（「我的文件」页等）完全不启用手势', () => {
    const { container } = render(<MobileMediaPreview {...baseProps()} />);
    // 没有监听器可挂 ⇒ 派发触摸事件不应抛错，也不该有任何切图行为可言
    expect(() => swipe(area(container), -200)).not.toThrow();
  });

  it('位置指示：传了就渲染，不传就一个节点都不产生', () => {
    const { container, rerender } = render(
      <MobileMediaPreview {...baseProps()} positionLabel="3 / 12" onSwipeNext={vi.fn()} hasNext />,
    );
    expect(
      container.ownerDocument.querySelector('.mobile-media-preview-position')?.textContent,
    ).toBe('3 / 12');

    rerender(<MobileMediaPreview {...baseProps()} onSwipeNext={vi.fn()} hasNext />);
    expect(container.ownerDocument.querySelector('.mobile-media-preview-position')).toBeNull();
  });

  it('src 为空串（新一项还没取到源）→ 不渲染媒体元素，也不再出「加载中」文字覆盖层', () => {
    const { container } = render(
      <MobileMediaPreview {...baseProps()} src="" onSwipeNext={vi.fn()} hasNext />,
    );
    const doc = container.ownerDocument;
    expect(doc.querySelector('.mobile-media-preview-image')).toBeNull();
    // 2026-08-26 需求：加载态的用户可见文字/覆盖层整体移除（.mobile-media-preview-loading 不再存在），
    // loadState 状态机本身保留 —— 它仍门控错误态与媒体元素的 display 切换。
    expect(doc.querySelector('.mobile-media-preview-loading')).toBeNull();
    expect(doc.body.textContent ?? '').not.toContain('加载中');
  });

  it('loadState 状态机保留：图片加载失败仍出「加载失败」错误态（只删了加载中文字）', () => {
    const { container } = render(<MobileMediaPreview {...baseProps()} />);
    const img = container.ownerDocument.querySelector('.mobile-media-preview-image');
    if (!img) { throw new Error('找不到 .mobile-media-preview-image'); }
    act(() => {
      img.dispatchEvent(new Event('error', { bubbles: true }));
    });
    const doc = container.ownerDocument;
    expect(doc.querySelector('.mobile-media-preview-error')?.textContent).toContain('加载失败');
    expect(doc.querySelector('.mobile-media-preview-loading')).toBeNull();
  });
});

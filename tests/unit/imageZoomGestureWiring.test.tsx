/**
 * 图片缩放手势的**行为**测试：真的挂上监听、真的按策略 preventDefault、真的写真值源
 *
 * 与 tests/unit/imageZoomGesture.test.ts（纯几何）互补：那边测"算得对不对"，
 * 这边测"事件进来之后这一层做了什么"。
 *
 * 🔴 jsdom 能测到什么、测不到什么（别把全绿读成"真机行为验过了"）：
 * - ✅ 能测：监听有没有挂上、preventDefault 的**策略**（未放大时单指必须放行给切图层）、
 *   缩放倍数的计算、放大态有没有写进 mediaZoomState、未激活实例有没有越权写。
 * - ❌ 测不到：任何**布局**结果。jsdom 里 offsetWidth / getBoundingClientRect() 恒 0
 *   （见 .claude/rules/frontend-test.md），所以平移边界恒为 0、屏幕上图片长什么样
 *   一律测不出来 —— 那一半只能真机看。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useImageZoom } from '../../src/chat/shared/useImageZoom';

const zoomStateMock = vi.hoisted(() => ({ setMediaZoomed: vi.fn() }));
vi.mock('../../src/chat/shared/mediaZoomState', () => zoomStateMock);

/**
 * 造一个带 touches 的触摸事件
 *
 * jsdom 的 TouchEvent 构造不稳定，而被测代码只读 `touches.length` / `clientX` /
 * `clientY` / `timeStamp`，所以直接在普通 Event 上挂 touches 即可 —— 读到的字段
 * 与真实事件逐字相同，不是"造一个假接口再测它"。
 */
function touchEvent(
  type: string,
  points: { x: number; y: number }[],
  timeStamp?: number,
): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const touches = points.map((p) => ({ clientX: p.x, clientY: p.y }));
  Object.defineProperty(ev, 'touches', { value: touches });
  if (timeStamp !== undefined) {
    Object.defineProperty(ev, 'timeStamp', { value: timeStamp });
  }
  return ev;
}

function Harness({ enabled }: { enabled: boolean }) {
  const { stageRef, mediaRef } = useImageZoom(enabled);
  return (
    <div data-testid="stage" ref={stageRef}>
      <img data-testid="img" ref={mediaRef} alt="" />
    </div>
  );
}

function mountStage(enabled = true) {
  const utils = render(<Harness enabled={enabled} />);
  return { stage: utils.getByTestId('stage'), ...utils };
}

/** 从 inline transform 里抠出 scale 数值（拿不到返回 null） */
function readScale(el: HTMLElement): number | null {
  const m = /scale\(([\d.]+)\)/.exec(el.style.transform);
  return m ? Number(m[1]) : null;
}

/** 走一遍「双指从 distance0 捏到 distance1」 */
function pinch(stage: HTMLElement, distance0: number, distance1: number) {
  stage.dispatchEvent(touchEvent('touchstart', [{ x: 0, y: 0 }, { x: distance0, y: 0 }]));
  stage.dispatchEvent(touchEvent('touchmove', [{ x: 0, y: 0 }, { x: distance1, y: 0 }]));
  stage.dispatchEvent(touchEvent('touchend', []));
}

beforeEach(() => {
  zoomStateMock.setMediaZoomed.mockClear();
});

describe('双指捏合 → 图片自己缩放', () => {
  it('张开手指后 stage 的 transform 出现 scale > 1', () => {
    const { stage } = mountStage();
    expect(readScale(stage)).toBe(1);

    stage.dispatchEvent(touchEvent('touchstart', [{ x: 0, y: 0 }, { x: 100, y: 0 }]));
    stage.dispatchEvent(touchEvent('touchmove', [{ x: 0, y: 0 }, { x: 250, y: 0 }]));

    // 100px → 250px ⇒ 2.5 倍
    expect(readScale(stage)).toBeCloseTo(2.5, 5);
  });

  it('放大倍数被夹在上限内（狂张手指也不会无限放大）', () => {
    const { stage } = mountStage();
    stage.dispatchEvent(touchEvent('touchstart', [{ x: 0, y: 0 }, { x: 10, y: 0 }]));
    stage.dispatchEvent(touchEvent('touchmove', [{ x: 0, y: 0 }, { x: 9000, y: 0 }]));
    expect(readScale(stage)).toBe(5);
  });

  it('捏合事件被 preventDefault（不留给浏览器 / 也不留给切图层）', () => {
    const { stage } = mountStage();
    const start = touchEvent('touchstart', [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    stage.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(true);

    const move = touchEvent('touchmove', [{ x: 0, y: 0 }, { x: 200, y: 0 }]);
    stage.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(true);
  });
});

describe('与横向切图层的分工（这条错了两单会互相打架）', () => {
  it('未放大时单指 touchstart 不被截走 —— 留给切图层', () => {
    const { stage } = mountStage();
    const start = touchEvent('touchstart', [{ x: 50, y: 50 }]);
    stage.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(false);

    const move = touchEvent('touchmove', [{ x: 120, y: 55 }]);
    stage.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(false);
  });

  it('已放大后单指改归本层平移（同一个动作，状态不同归属不同）', () => {
    const { stage } = mountStage();
    // 先捏大
    stage.dispatchEvent(touchEvent('touchstart', [{ x: 0, y: 0 }, { x: 100, y: 0 }]));
    stage.dispatchEvent(touchEvent('touchmove', [{ x: 0, y: 0 }, { x: 300, y: 0 }]));
    stage.dispatchEvent(touchEvent('touchend', [])); // 双指全部抬起，保持放大态
    expect(readScale(stage)).toBeGreaterThan(1);

    const start = touchEvent('touchstart', [{ x: 50, y: 50 }]);
    stage.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(true);
  });
});

describe('放大态写进 mediaZoomState（切图层的唯一读口）', () => {
  it('捏大 → setMediaZoomed(true)', () => {
    const { stage } = mountStage();
    pinch(stage, 100, 300);
    expect(zoomStateMock.setMediaZoomed).toHaveBeenCalledWith(true);
  });

  it('捏回 1x → setMediaZoomed(false)，且 transform 归位', () => {
    const { stage } = mountStage();
    pinch(stage, 100, 300);
    zoomStateMock.setMediaZoomed.mockClear();

    // 再捏回去（从 300 捏到 100 = 缩小回 1/3，夹到下限 1）
    pinch(stage, 300, 100);
    expect(zoomStateMock.setMediaZoomed).toHaveBeenLastCalledWith(false);
    expect(readScale(stage)).toBe(1);
  });

  it('未激活的预览实例既不挂监听、也不写真值源', () => {
    // 聊天列表里每条图片消息都挂着一个 MobileMediaPreview（isOpen=false）。
    // 它们若也响应手势 / 写真值源，就会把真正打开的那个实例的放大态覆盖掉。
    const { stage } = mountStage(false);
    zoomStateMock.setMediaZoomed.mockClear();

    const start = touchEvent('touchstart', [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    stage.dispatchEvent(start);
    stage.dispatchEvent(touchEvent('touchmove', [{ x: 0, y: 0 }, { x: 300, y: 0 }]));

    expect(start.defaultPrevented).toBe(false); // 监听根本没挂
    expect(readScale(stage)).toBe(1); // 没有被缩放
    expect(zoomStateMock.setMediaZoomed).not.toHaveBeenCalled();
  });
});

describe('双击放大 / 复位', () => {
  it('两次快速点按在放大与复位之间切换', () => {
    const { stage } = mountStage();

    const tap = (t: number) => {
      stage.dispatchEvent(touchEvent('touchstart', [{ x: 40, y: 40 }], t));
      stage.dispatchEvent(touchEvent('touchend', [], t + 10));
    };

    tap(1000);
    expect(readScale(stage)).toBe(1); // 单击不放大
    tap(1100);
    expect(readScale(stage)).toBeGreaterThan(1);

    tap(2000);
    tap(2100);
    expect(readScale(stage)).toBe(1); // 再双击复位
  });

  it('间隔太久的两次点按不算双击', () => {
    const { stage } = mountStage();
    stage.dispatchEvent(touchEvent('touchstart', [{ x: 40, y: 40 }], 1000));
    stage.dispatchEvent(touchEvent('touchend', [], 1010));
    stage.dispatchEvent(touchEvent('touchstart', [{ x: 40, y: 40 }], 5000));
    stage.dispatchEvent(touchEvent('touchend', [], 5010));
    expect(readScale(stage)).toBe(1);
  });
});

describe('换图把承载层卸载重挂之后（gen-47 真机缺陷的回归测试）', () => {
  /**
   * 与 MobileMediaPreview 同形：上层切上一张 / 下一张时会先把 src 置成空串
   * （MediaGalleryProvider 的 `src={source?.src ?? ''}`），
   * 于是 `{src && ...}` 把承载层整个卸载再重挂 —— 节点换了一个。
   */
  function SwitchHarness({ src }: { src: string }) {
    const { stageRef, mediaRef } = useImageZoom(true);
    // 逐字照搬 MobileMediaPreview 的形状：`{src && ...}` 而不是三元 —— 三元的两个分支
    // 都是 <div> 时 React 会复用同一个 DOM 节点，那就复现不出「节点被换掉」这件事
    return (
      <div>
        {src && (
          <div data-testid="stage" ref={stageRef}>
            <img data-testid="img" ref={mediaRef} alt="" />
          </div>
        )}
      </div>
    );
  }

  it('重挂出来的新节点仍然响应捏合', () => {
    const utils = render(<SwitchHarness src="a" />);
    const first = utils.getByTestId('stage');

    utils.rerender(<SwitchHarness src="" />);
    utils.rerender(<SwitchHarness src="b" />);
    const second = utils.getByTestId('stage');
    // 这一条不成立的话，下面两条断言测的是同一个节点，等于什么都没测
    expect(second).not.toBe(first);

    const start = touchEvent('touchstart', [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    second.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(true);

    second.dispatchEvent(touchEvent('touchmove', [{ x: 0, y: 0 }, { x: 250, y: 0 }]));
    expect(readScale(second)).toBeCloseTo(2.5, 5);
  });

  it('监听是搬家不是复制 —— 被摘掉的旧节点不再响应', () => {
    const utils = render(<SwitchHarness src="a" />);
    const first = utils.getByTestId('stage');
    utils.rerender(<SwitchHarness src="" />);
    utils.rerender(<SwitchHarness src="b" />);

    const start = touchEvent('touchstart', [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    first.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(false);
  });
});

/**
 * 「点别人头像打开的个人主页」B+C 两个症状的回归测试
 *
 * huanwei 原话（一句话里连着说的两件事，同一个页面）：
 *   「手机端点击头像后显示的个人主页没有办法用返回手势返回到上一层，这点我早就说过，
 *     **而且**个人信息页面还会被左右滑动移动偏离」
 *
 * ## B 接不到返回手势 —— 根因：入口走错组件
 * `useEdgeSwipeBack` 此前**只挂在 MobileProfilePage（我自己的资料页）**；
 * 点别人头像走的是 useProfileViewStore → OtherProfileView，那里一个手势都没有。
 * ⇒ v1.1.25 报的「移动端资料页支持侧滑返回」根本没覆盖他说的入口。不是回归，是从没做到。
 *
 * ## C 被左右拖偏 —— 根因：overflow-y 隐式带出 overflow-x
 * CSS 规定 overflow-y 为 auto/scroll/hidden 且 overflow-x 为默认 visible 时，
 * overflow-x **被隐式计算成 auto**（MDN）。原 `.other-profile-shell { overflow-y: auto }`
 * 因此可横向滚动 —— 是**真的能滚并停在偏移位**，不是回弹没夹住。
 *
 * 两条都在这一个页面上，故合成一个文件测。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mockPlatform = vi.hoisted(() => ({ mobile: true }));
vi.mock('../../src/utils/platform', () => ({ isMobile: () => mockPlatform.mobile }));

const storeMock = vi.hoisted(() => ({
  userId: 'peer-1' as string | null,
  botUsername: null as string | null,
  close: vi.fn(),
}));
vi.mock('../../src/stores', () => ({
  useProfileViewStore: (selector: (s: typeof storeMock) => unknown) => selector(storeMock),
}));

vi.mock('../../src/chat/shared/OtherProfilePanel', () => ({
  OtherProfilePanel: () => <div data-testid="panel">panel</div>,
}));

import { OtherProfileView } from '../../src/chat/shared/OtherProfileView';

/** 从左边缘起手、向右拖到达标距离再松手 */
function edgeSwipeRight(el: Element, endX = 400) {
  fireEvent.touchStart(el, { touches: [{ clientX: 5, clientY: 300 }] });
  fireEvent.touchMove(el, { touches: [{ clientX: 120, clientY: 302 }] });
  fireEvent.touchMove(el, { touches: [{ clientX: endX, clientY: 305 }] });
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: endX, clientY: 305 }] });
}

describe('B —— 点别人头像的资料页必须能侧滑返回', () => {
  beforeEach(() => {
    storeMock.close.mockReset();
    storeMock.userId = 'peer-1';
    mockPlatform.mobile = true;
  });

  it('移动端：从左边缘右滑到达标 ⇒ 触发返回（与右上角关闭键同一个动作）', () => {
    render(<OtherProfileView />);
    // 组件 createPortal 到 document.body ⇒ 查询根是 document，不是 render 的 container
    const layer = document.querySelector('.other-profile-swipe-layer');
    expect(layer, '侧滑层必须存在——它是承载跟手位移的那一层').not.toBeNull();

    edgeSwipeRight(layer!);
    expect(storeMock.close).toHaveBeenCalledTimes(1);
  });

  it('不是从边缘起手（屏幕中间开始拖）⇒ 不返回，避免误触', () => {
    render(<OtherProfileView />);
    const layer = document.querySelector('.other-profile-swipe-layer')!;

    fireEvent.touchStart(layer, { touches: [{ clientX: 300, clientY: 300 }] });
    fireEvent.touchMove(layer, { touches: [{ clientX: 600, clientY: 305 }] });
    fireEvent.touchEnd(layer, { changedTouches: [{ clientX: 600, clientY: 305 }] });

    expect(storeMock.close).not.toHaveBeenCalled();
  });

  it('慢速短拖（够不上距离阈值、也够不上快甩速度）⇒ 不返回，回弹', () => {
    // 必须显式控制时间：判定有「距离」与「快甩速度」两条通道，
    // jsdom 里起手到松手常常只差 0~1ms ⇒ 速度被算成极大值而误判成快甩。
    // 这里把耗时钉成 1000ms，让 35px 的速度只有 0.035（远低于 0.45 阈值），
    // 两条通道都不命中，才真正测到「位移不够就该回弹」这个语义。
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1_000_000);   // touchStart
    nowSpy.mockReturnValue(1_001_000);       // touchEnd：+1000ms

    render(<OtherProfileView />);
    const layer = document.querySelector('.other-profile-swipe-layer')!;

    fireEvent.touchStart(layer, { touches: [{ clientX: 5, clientY: 300 }] });
    fireEvent.touchMove(layer, { touches: [{ clientX: 40, clientY: 302 }] });
    fireEvent.touchEnd(layer, { changedTouches: [{ clientX: 40, clientY: 302 }] });

    expect(storeMock.close).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it('桌面端不挂手势（右侧抽屉，鼠标没有边缘侧滑这一说）', () => {
    mockPlatform.mobile = false;
    render(<OtherProfileView />);
    const layer = document.querySelector('.other-profile-swipe-layer')!;

    edgeSwipeRight(layer);
    expect(storeMock.close).not.toHaveBeenCalled();
  });

  it('未打开（userId 为空）时不渲染', () => {
    storeMock.userId = null;
    render(<OtherProfileView />);
    expect(document.querySelector('.other-profile-swipe-layer')).toBeNull();
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
  });
});

describe('C —— 该页不得可横向滚动（overflow-y 会隐式带出 overflow-x）', () => {
  const CSS = readFileSync(
    resolve(__dirname, '../..', 'src/styles/pages/main.css'),
    'utf-8',
  );

  /**
   * 取某个 selector 的规则块正文，**并剥掉注释**。
   *
   * 🔴 剥注释不是洁癖：本规则块的注释里逐字写着 `overflow-x: hidden`（在解释为什么必须显式写），
   * 不剥的话 `toMatch(/overflow-x:\s*hidden/)` 会命中注释而不是声明 ——
   * 把真声明删掉测试照样绿，就是一条假测试。（本文件初版正是这样，靠变异验证才发现。）
   */
  function ruleBody(selector: string): string {
    const i = CSS.indexOf(`${selector} {`);
    expect(i, `CSS 里找不到 ${selector}`).toBeGreaterThan(-1);
    const raw = CSS.slice(i, CSS.indexOf('}', i));
    return raw.replace(/\/\*[\s\S]*?\*\//g, '');
  }

  it('滚动层显式声明 overflow-x: hidden —— 只写 overflow-y 的话它会被隐式算成 auto', () => {
    const body = ruleBody('.other-profile-swipe-layer');
    expect(body).toMatch(/overflow-y:\s*auto/);
    // 这条是本用例的全部意义：缺了它，页面就能被横向拖走
    expect(body).toMatch(/overflow-x:\s*hidden/);
  });

  it('外层 shell 只负责裁剪（overflow: hidden），不承担滚动', () => {
    const body = ruleBody('.other-profile-shell');
    expect(body).toMatch(/overflow:\s*hidden/);
    // 滚动已下移到侧滑层：若滚动留在 shell 上，跟手位移时滚动条会跟着一起平移
    expect(body).not.toMatch(/overflow-y:\s*auto/);
  });
});

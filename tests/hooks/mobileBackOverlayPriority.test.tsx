/**
 * 移动端返回：浮层优先级测试
 *
 * 被测的是**分发顺序**这一条不变量：浮层（他人资料页 / 群详情 / 群设置面板）
 * 必须**先于**页面级处理器被询问。
 *
 * ## 为什么这条会坏，且只有真机能暴露
 *
 * `useMobileBackHandler` 原本只有一个「后注册者优先」的栈。而浮层都是被父级页面
 * 渲染出来的**子组件**，React 的 effect 是**自下而上**执行的（子先于父）⇒
 * 浮层恒**早于** MobileMain 注册 ⇒ 在「后注册者优先」的栈里恒排在下面 ⇒
 * **父级页面反而先处理掉返回事件**。文件里写着的「模态框 > 页面 > 主容器」在实现上是反的。
 *
 * 真机后果不是"手势没反应"，而是**直接退出 App**：他人资料页打开时按系统返回键，
 * MobileMain 的优先级链里没有这个页面，一路走到 `return false` ⇒ 默认行为 = 退出。
 * 手势导航（安卓默认）下最左边缘归系统，系统会把边缘右滑转成同一个 Android back，
 * 所以这条通路是那种形态下**唯一**的返回路径。
 *
 * 本用例用「后注册页面处理器」精确复刻那个顺序，因此**不是恒真**：
 * 去掉分发里的浮层那一轮，第一条断言立刻翻红（已做变异验证）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const platformMock = vi.hoisted(() => ({ isMobile: () => true }));
vi.mock('../../src/utils/platform', () => platformMock);

/** 捕获插件注册进来的那个「系统返回事件」回调，用于在测试里主动触发一次返回 */
const pluginMock = vi.hoisted(() => ({
  fire: null as null | (() => void),
  registerBackEvent: vi.fn(async (cb: () => void) => {
    pluginMock.fire = cb;
    return { unregister: vi.fn() };
  }),
}));
vi.mock('@kingsword/tauri-plugin-mobile-onbackpressed-listener', () => ({
  registerBackEvent: pluginMock.registerBackEvent,
}));

import {
  useMobileBackHandler,
  useMobileBackOverlay,
} from '../../src/hooks/useMobileBackHandler';

/**
 * 等插件的异步初始化跑完（initBackListener 内是**动态 import**）。
 * 只 flush 微任务不够 —— 动态 import 的解析要跨宏任务，故这里等 setTimeout。
 */
async function flushInit() {
  for (let i = 0; i < 50 && !pluginMock.fire; i++) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

describe('移动端返回：浮层先于页面', () => {
  beforeEach(() => {
    pluginMock.registerBackEvent.mockClear();
  });

  it('页面处理器【后】注册，返回事件仍由浮层先接管（复刻 effect 自下而上的真实顺序）', async () => {
    const order: string[] = [];

    // 浮层先挂载（子组件 effect 先跑）
    const overlay = renderHook(() =>
      useMobileBackOverlay(() => {
        order.push('overlay');
        return true;
      }),
    );
    // 页面后挂载（父组件 effect 后跑）——旧实现里这一个会抢先
    const page = renderHook(() =>
      useMobileBackHandler(() => {
        order.push('page');
        return true;
      }),
    );

    await flushInit();
    expect(pluginMock.fire).toBeTruthy();
    pluginMock.fire!();

    // 关键断言：浮层接管，页面根本没被问到
    expect(order).toEqual(['overlay']);

    overlay.unmount();
    page.unmount();
  });

  it('浮层没开着（返回 false）时，事件继续往页面传', async () => {
    const order: string[] = [];

    const overlay = renderHook(() =>
      useMobileBackOverlay(() => {
        order.push('overlay-declined');
        return false;
      }),
    );
    const page = renderHook(() =>
      useMobileBackHandler(() => {
        order.push('page');
        return true;
      }),
    );

    await flushInit();
    pluginMock.fire!();

    expect(order).toEqual(['overlay-declined', 'page']);

    overlay.unmount();
    page.unmount();
  });

  it('多个浮层：后注册的先被问到（栈语义，用于浮层叠浮层）', async () => {
    const order: string[] = [];

    const first = renderHook(() =>
      useMobileBackOverlay(() => {
        order.push('first');
        return true;
      }),
    );
    const second = renderHook(() =>
      useMobileBackOverlay(() => {
        order.push('second');
        return true;
      }),
    );

    await flushInit();
    pluginMock.fire!();

    expect(order).toEqual(['second']);

    first.unmount();
    second.unmount();
  });

  it('卸载后不再被询问（不留悬挂处理器）', async () => {
    const order: string[] = [];

    const overlay = renderHook(() =>
      useMobileBackOverlay(() => {
        order.push('overlay');
        return true;
      }),
    );
    const page = renderHook(() =>
      useMobileBackHandler(() => {
        order.push('page');
        return true;
      }),
    );
    await flushInit();

    overlay.unmount();
    pluginMock.fire!();

    // 浮层已卸载 ⇒ 该轮只应命中页面
    expect(order).toEqual(['page']);
    page.unmount();
  });
});

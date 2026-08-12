/**
 * 全屏媒体预览必须挂在**浮层车道**上（系统返回键的归属）
 *
 * ## 被修的真机现象
 *
 * 手机端从侧边栏「查找聊天记录」打开图片预览后按系统返回：不是关预览，
 * 而是被 ChatMenu 抢走（退回面板主菜单），预览留在屏幕上。
 *
 * ## 成因
 *
 * `useMobileBackHandler` 的分发是两条车道：**①浮层车道恒先问 → ②页面级栈**
 *（见 src/hooks/useMobileBackHandler.ts 的 overlayHandlers 注释）。
 * ChatMenu 挂在浮层车道，而 MobileMediaPreview 原先挂在**页面栈** ⇒
 * 只要 ChatMenu 开着，它恒在预览之前被问到，预览自己的 handler 永远轮不上。
 *
 * ## 这些用例不是恒真的
 *
 * 用例 1 精确复刻真机的注册顺序（面板先挂载、预览后挂载）：把 MobileMediaPreview 改回
 * `useMobileBackHandler`，它立刻翻红（已做变异验证，见交付）。
 * 用例 2 是反向断言 —— 预览没开着时**不许**吞掉返回事件，挡住"无脑 return true"的修法。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { renderHook } from '@testing-library/react';

vi.mock('../../src/utils/platform', () => ({
  isMobile: () => true,
  isDesktop: () => false,
  isMacOS: () => false,
  getPlatformType: () => 'mobile',
  _resetPlatformCache: () => undefined,
}));

vi.mock('../../src/utils/saveToGallery', () => ({
  saveToGallery: vi.fn().mockResolvedValue({ success: true }),
}));

/** 捕获插件注册进来的「系统返回事件」回调，用于主动触发一次返回 */
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

import { useMobileBackOverlay } from '../../src/hooks/useMobileBackHandler';
import { MobileMediaPreview } from '../../src/chat/shared/MobileMediaPreview';

/** 等插件的异步初始化跑完（内部是**动态 import**，只 flush 微任务不够） */
async function flushInit() {
  for (let i = 0; i < 50 && !pluginMock.fire; i++) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

const baseProps = {
  type: 'image' as const,
  src: 'http://127.0.0.1:41234/proxied/photo.png',
  filename: 'photo.png',
};

describe('MobileMediaPreview 的系统返回归属', () => {
  beforeEach(() => {
    pluginMock.registerBackEvent.mockClear();
    document.body.style.overflow = '';
  });

  it('面板先挂载、预览后挂载：返回键先关预览，面板不被问到', async () => {
    const order: string[] = [];
    const onClose = vi.fn(() => order.push('preview'));

    // 侧边设置面板（ChatMenu）先在浮层车道上
    const panel = renderHook(() =>
      useMobileBackOverlay(() => {
        order.push('chat-menu');
        return true;
      }),
    );
    // 预览随后按需挂载（真机上正是这个顺序）
    const view = render(<MobileMediaPreview {...baseProps} isOpen onClose={onClose} />);

    await flushInit();
    expect(pluginMock.fire).toBeTruthy();
    pluginMock.fire!();

    expect(order).toEqual(['preview']);
    expect(onClose).toHaveBeenCalledTimes(1);

    view.unmount();
    panel.unmount();
  });

  it('预览没打开时不吞返回事件，继续交给下一个处理器', async () => {
    const order: string[] = [];
    const onClose = vi.fn(() => order.push('preview'));

    const panel = renderHook(() =>
      useMobileBackOverlay(() => {
        order.push('chat-menu');
        return true;
      }),
    );
    const view = render(<MobileMediaPreview {...baseProps} isOpen={false} onClose={onClose} />);

    await flushInit();
    pluginMock.fire!();

    expect(order).toEqual(['chat-menu']);
    expect(onClose).not.toHaveBeenCalled();

    view.unmount();
    panel.unmount();
  });
});

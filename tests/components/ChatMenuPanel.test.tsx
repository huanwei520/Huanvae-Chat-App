/**
 * ChatMenuPanel（聊天设置侧边滑出面板）测试
 *
 * 覆盖真实组件的开合与可达性契约：
 * - open 开合（关闭时不留 dialog 在 DOM）
 * - **非模态**：不铺遮罩层、不带 aria-modal（背景照常可点，这是产品口径，见组件文件头）
 * - **不盖聊天标题栏**：顶边贴齐 .chat-header / .mobile-chat-header 的下沿
 * - 关闭通道：Esc / 关闭键（「点面板外」由 useChatMenu 的 document 监听承担，不在本组件内）
 * - sheetRef 契约：ref 指向面板本体且包含面板内容
 *   （useChatMenu 的「点击外部关闭」靠它做 contains 判定，指错即误关）
 * - 焦点：打开移入面板、关闭还给触发元素；Tab 在面板内循环不外逃
 *
 * 注：拖拽关闭只在 isMobile() 为真时启用，jsdom 的 UA 非移动 → 本文件不覆盖拖拽，
 * 它属于真机手感验收范畴。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { ChatMenuPanel } from '../../src/chat/shared/ChatMenuPanel';

type PanelOverrides = Omit<Partial<React.ComponentProps<typeof ChatMenuPanel>>, 'onClose'>;

function renderPanel(overrides: PanelOverrides = {}) {
  const onClose = vi.fn();
  const props: React.ComponentProps<typeof ChatMenuPanel> = {
    open: true,
    title: '前端小分队',
    subtitle: '群聊设置',
    onClose,
    children: <button type="button">查看成员</button>,
    ...overrides,
  };
  const view = render(<ChatMenuPanel {...props} />);
  return { ...view, onClose, props };
}

/** 本文件挂到 body 上的临时聊天顶栏，afterEach 统一摘掉 */
let mountedHeaders: HTMLElement[] = [];

/**
 * 造一个「聊天标题栏 + 里面的触发按钮容器」，并把标题栏的 bottom 钉成 bottomPx。
 * jsdom 不做布局，getBoundingClientRect 恒为 0，必须显式打桩才能验位置契约。
 */
function mountInChatHeader(headerClass: string, bottomPx: number) {
  const header = document.createElement('div');
  header.className = headerClass;
  header.getBoundingClientRect = () => ({ bottom: bottomPx } as DOMRect);
  const trigger = document.createElement('div');
  header.appendChild(trigger);
  document.body.appendChild(header);
  mountedHeaders.push(header);
  return { header, trigger };
}

describe('ChatMenuPanel — 侧边滑出面板', () => {
  beforeEach(() => cleanup());

  afterEach(() => {
    mountedHeaders.forEach((h) => h.remove());
    mountedHeaders = [];
  });

  it('open=false 时不渲染面板', () => {
    renderPanel({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('open=true 渲染 dialog：标题 / 副标题 / 内容俱在，带 aria-labelledby 但**不**带 aria-modal', () => {
    renderPanel();
    const dialog = screen.getByRole('dialog');
    // 非模态：背景仍可感知可操作，不能宣称 aria-modal（否则读屏会把整页其余内容藏掉）
    expect(dialog).not.toHaveAttribute('aria-modal');

    const heading = screen.getByRole('heading', { name: '前端小分队' });
    // aria-labelledby 必须真的指向标题节点，否则读屏念不出面板名字
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.getAttribute('id'));

    expect(screen.getByText('群聊设置')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看成员' })).toBeInTheDocument();
  });

  it('Esc 关闭', () => {
    const { onClose } = renderPanel();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('open=false 时 Esc 不触发 onClose（监听已摘除）', () => {
    const { onClose } = renderPanel({ open: false });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('【一】不铺遮罩层：DOM 里没有任何变暗蒙层，面板是唯一被渲染的层', () => {
    renderPanel();

    // 回归守卫：一旦把遮罩加回来，这条即 FAIL
    expect(document.querySelector('.chat-menu-scrim')).toBeNull();

    const dialog = screen.getByRole('dialog');
    // 面板自己就是 portal 的顶层节点，不再被任何全屏容器包着
    expect(dialog.parentElement).toBe(document.body);
  });

  it('面板内点击不触发 onClose（关闭只由 Esc / 关闭键 / 外部监听发起）', () => {
    const { onClose } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '查看成员' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('关闭键触发 onClose，并带无障碍名', () => {
    const { onClose } = renderPanel();
    const closeBtn = screen.getByRole('button', { name: '关闭设置面板' });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('footer 为空时不渲染底部区，有内容时渲染', () => {
    const { unmount } = renderPanel();
    expect(document.querySelector('.chat-menu-sheet-footer')).toBeNull();
    unmount();

    renderPanel({ footer: <span>操作失败</span> });
    expect(document.querySelector('.chat-menu-sheet-footer')).not.toBeNull();
    expect(screen.getByText('操作失败')).toBeInTheDocument();
  });

  it('sheetRef 指向面板本体，且包含面板内容', () => {
    const sheetRef = createRef<HTMLDivElement>();
    renderPanel({ sheetRef });

    const dialog = screen.getByRole('dialog');
    expect(sheetRef.current).toBe(dialog);
    // useChatMenu 用 contains 判定「点在菜单外」：面板内容必须算在内
    expect(sheetRef.current?.contains(screen.getByRole('button', { name: '查看成员' }))).toBe(true);
  });

  it('sheetRef 在面板退场卸载后被置空', async () => {
    const sheetRef = createRef<HTMLDivElement>();
    const { rerender, props } = renderPanel({ sheetRef });
    expect(sheetRef.current).not.toBeNull();

    rerender(<ChatMenuPanel {...props} sheetRef={sheetRef} open={false} />);
    // AnimatePresence 的退场卸载是异步的（哪怕 skipAnimations），消失断言必须进 waitFor
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(sheetRef.current).toBeNull();
    });
  });

  it('【二】顶边贴齐聊天标题栏下沿：不遮住标题栏（桌面 .chat-header）', () => {
    const { trigger } = mountInChatHeader('chat-header', 81);
    const triggerRef = { current: trigger };

    render(
      <ChatMenuPanel open title="小明" onClose={vi.fn()} triggerRef={triggerRef}>
        <button type="button">设置备注</button>
      </ChatMenuPanel>,
    );

    // 顶边 = 标题栏下沿 → 标题栏那 81px 不会被面板盖住
    expect(screen.getByRole('dialog').style.top).toBe('81px');
  });

  it('【二】移动端标题栏更矮（含安全区）时同样贴其下沿，不是写死的常量', () => {
    const { trigger } = mountInChatHeader('mobile-chat-header', 56);
    const triggerRef = { current: trigger };

    render(
      <ChatMenuPanel open title="小明" onClose={vi.fn()} triggerRef={triggerRef}>
        <button type="button">设置备注</button>
      </ChatMenuPanel>,
    );

    expect(screen.getByRole('dialog').style.top).toBe('56px');
  });

  it('量不到标题栏（未挂在聊天顶栏里）时退化为贴视口顶，不乱猜', () => {
    renderPanel();
    expect(screen.getByRole('dialog').style.top).toBe('0px');
  });

  it('打开时焦点移入面板，关闭后还给触发它的元素', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const onClose = vi.fn();
    const { rerender } = render(
      <ChatMenuPanel open={false} title="小明" onClose={onClose}>
        <button type="button">设置备注</button>
      </ChatMenuPanel>,
    );

    rerender(
      <ChatMenuPanel open title="小明" onClose={onClose}>
        <button type="button">设置备注</button>
      </ChatMenuPanel>,
    );
    expect(document.activeElement).toBe(screen.getByRole('dialog'));

    rerender(
      <ChatMenuPanel open={false} title="小明" onClose={onClose}>
        <button type="button">设置备注</button>
      </ChatMenuPanel>,
    );
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it('Tab 在面板内循环：最后一个可聚焦元素上 Tab 回到第一个', () => {
    renderPanel({
      children: (
        <>
          <button type="button">设置备注</button>
          <button type="button">删除好友</button>
        </>
      ),
    });

    const dialog = screen.getByRole('dialog');
    const closeBtn = screen.getByRole('button', { name: '关闭设置面板' });
    const last = screen.getByRole('button', { name: '删除好友' });

    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    // 关闭键是面板内 DOM 顺序上的第一个可聚焦元素
    expect(document.activeElement).toBe(closeBtn);

    // Shift+Tab 从第一个回到最后一个
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('禁用的菜单项不进入 Tab 循环（隐藏项不能被聚焦/误触发）', () => {
    renderPanel({
      children: (
        <>
          <button type="button">设置备注</button>
          <button type="button" disabled>解散群聊</button>
        </>
      ),
    });

    const dialog = screen.getByRole('dialog');
    const closeBtn = screen.getByRole('button', { name: '关闭设置面板' });
    const remarkBtn = screen.getByRole('button', { name: '设置备注' });

    // 「设置备注」是最后一个**可用**元素，Tab 应回卷到关闭键，而不是停在 disabled 项上
    remarkBtn.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(closeBtn);
  });
});

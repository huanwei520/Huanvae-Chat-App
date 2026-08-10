/**
 * ChatMenuPanel（聊天设置侧边滑出面板）测试
 *
 * 覆盖真实组件的开合与可达性契约：
 * - open 开合（关闭时不留 dialog 在 DOM）
 * - 三条关闭通道：Esc / 点遮罩 / 关闭键；点面板内**不**关闭
 * - sheetRef 契约：ref 指向面板本体且包含面板内容
 *   （useChatMenu 的「点击外部关闭」靠它做 contains 判定，指错即误关）
 * - 焦点：打开移入面板、关闭还给触发元素；Tab 在面板内循环不外逃
 *
 * 注：拖拽关闭只在 isMobile() 为真时启用，jsdom 的 UA 非移动 → 本文件不覆盖拖拽，
 * 它属于真机手感验收范畴。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('ChatMenuPanel — 侧边滑出面板', () => {
  beforeEach(() => cleanup());

  it('open=false 时不渲染面板', () => {
    renderPanel({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('open=true 渲染 dialog：标题 / 副标题 / 内容俱在，且带 aria-modal 与 aria-labelledby', () => {
    renderPanel();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

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

  it('点遮罩关闭，点面板内不关闭', () => {
    const { container, onClose } = renderPanel();
    const scrim = document.querySelector('.chat-menu-scrim');
    expect(scrim).not.toBeNull();

    fireEvent.click(scrim as Element);
    expect(onClose).toHaveBeenCalledTimes(1);

    // 面板内部点击必须被 stopPropagation 拦住，不能冒泡到遮罩再关一次
    onClose.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '查看成员' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(container).toBeTruthy();
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

  it('sheetRef 指向面板本体，且包含面板内容 / 不包含遮罩', () => {
    const sheetRef = createRef<HTMLDivElement>();
    renderPanel({ sheetRef });

    const dialog = screen.getByRole('dialog');
    expect(sheetRef.current).toBe(dialog);
    // useChatMenu 用 contains 判定「点在菜单外」：内容必须算在内，遮罩必须算在外
    expect(sheetRef.current?.contains(screen.getByRole('button', { name: '查看成员' }))).toBe(true);
    expect(sheetRef.current?.contains(document.querySelector('.chat-menu-scrim'))).toBe(false);
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

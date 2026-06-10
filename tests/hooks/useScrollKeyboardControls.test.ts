/**
 * useScrollKeyboardControls 单元测试
 *
 * 覆盖消息容器的键盘滚动控制 + 「仅键盘聚焦」判定：
 * - End → 滚到底（最新）  Home → 滚到顶
 * - PageDown / PageUp → 按视口高度 90% 翻页
 * - 处理的键调用 preventDefault；未处理的键不调用
 * - kbdFocused：键盘聚焦点亮、鼠标按下聚焦不点亮、失焦清除
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { useScrollKeyboardControls } from '../../src/chat/shared/useScrollKeyboardControls';

/** 造一个可控 scrollTop/scrollHeight/clientHeight 的容器，规避 jsdom 无布局 */
function makeContainer(scrollHeight = 1000, clientHeight = 400) {
  const el = document.createElement('div');
  let scrollTop = 0;
  Object.defineProperty(el, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => { scrollTop = v; },
    configurable: true,
  });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  return el;
}

function keyEvent(key: string) {
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent<HTMLDivElement>;
}

describe('useScrollKeyboardControls', () => {
  it('containerProps 暴露 tabIndex / role / aria-label', () => {
    const ref = { current: makeContainer() };
    const { result } = renderHook(() => useScrollKeyboardControls(ref));
    expect(result.current.containerProps.tabIndex).toBe(0);
    expect(result.current.containerProps.role).toBe('group');
    expect(result.current.containerProps['aria-label']).toContain('End');
  });

  it('End 滚到最新（底部 = scrollHeight）', () => {
    const el = makeContainer(1000, 400);
    const ref = { current: el };
    const { result } = renderHook(() => useScrollKeyboardControls(ref));
    const ev = keyEvent('End');
    result.current.containerProps.onKeyDown(ev);
    expect(el.scrollTop).toBe(1000);
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('Home 滚到顶部（0）', () => {
    const el = makeContainer(1000, 400);
    el.scrollTop = 500;
    const ref = { current: el };
    const { result } = renderHook(() => useScrollKeyboardControls(ref));
    result.current.containerProps.onKeyDown(keyEvent('Home'));
    expect(el.scrollTop).toBe(0);
  });

  it('PageDown / PageUp 按 clientHeight*0.9 翻页', () => {
    const el = makeContainer(1000, 400);
    const ref = { current: el };
    const { result } = renderHook(() => useScrollKeyboardControls(ref));
    result.current.containerProps.onKeyDown(keyEvent('PageDown'));
    expect(el.scrollTop).toBe(360); // 0 + 400*0.9
    result.current.containerProps.onKeyDown(keyEvent('PageUp'));
    expect(el.scrollTop).toBe(0); // 360 - 360
  });

  it('未处理的键不调用 preventDefault、不改 scrollTop', () => {
    const el = makeContainer(1000, 400);
    el.scrollTop = 120;
    const ref = { current: el };
    const { result } = renderHook(() => useScrollKeyboardControls(ref));
    const ev = keyEvent('a');
    result.current.containerProps.onKeyDown(ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(el.scrollTop).toBe(120);
  });

  it('容器为空时安全无操作', () => {
    const ref = { current: null };
    const { result } = renderHook(() => useScrollKeyboardControls(ref));
    expect(() => result.current.containerProps.onKeyDown(keyEvent('End'))).not.toThrow();
  });

  it('键盘聚焦点亮 kbdFocused，失焦清除', () => {
    const ref = { current: makeContainer() };
    const { result } = renderHook(() => useScrollKeyboardControls(ref));
    expect(result.current.kbdFocused).toBe(false);
    act(() => { result.current.containerProps.onFocus(); });
    expect(result.current.kbdFocused).toBe(true);
    act(() => { result.current.containerProps.onBlur(); });
    expect(result.current.kbdFocused).toBe(false);
  });

  it('鼠标按下后聚焦不点亮 kbdFocused（仅键盘）', () => {
    const ref = { current: makeContainer() };
    const { result } = renderHook(() => useScrollKeyboardControls(ref));
    act(() => {
      result.current.containerProps.onPointerDown();
      result.current.containerProps.onFocus();
    });
    expect(result.current.kbdFocused).toBe(false);
  });

  it('鼠标聚焦后再次键盘聚焦能正常点亮（pointer 标志被消费）', () => {
    const ref = { current: makeContainer() };
    const { result } = renderHook(() => useScrollKeyboardControls(ref));
    // 第一次：鼠标按下 + 聚焦 → 不点亮
    act(() => {
      result.current.containerProps.onPointerDown();
      result.current.containerProps.onFocus();
      result.current.containerProps.onBlur();
    });
    // 第二次：纯键盘聚焦 → 点亮（pointerDown 标志已在上次 focus 中复位）
    act(() => { result.current.containerProps.onFocus(); });
    expect(result.current.kbdFocused).toBe(true);
  });
});

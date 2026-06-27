/**
 * useScrollKeyboardControls 单元测试
 *
 * 覆盖消息容器的键盘滚动控制：
 * 容器是 flex-direction: column-reverse，滚动原点在底部：scrollTop=0 即最新（底部），
 * 向上（更旧）为负，顶部为 -(scrollHeight - clientHeight)。
 * - End → 滚到底（最新，scrollTop=0）  Home → 滚到顶（最负）
 * - PageDown → 向底（趋向 0，+）  PageUp → 向顶（趋向负，−）
 * - 处理的键调用 preventDefault；未处理的键不调用
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
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

  it('End 滚到最新（column-reverse 底部 = scrollTop 0）', () => {
    const el = makeContainer(1000, 400);
    el.scrollTop = -300; // 先上滑离底
    const ref = { current: el };
    const { result } = renderHook(() => useScrollKeyboardControls(ref));
    const ev = keyEvent('End');
    result.current.containerProps.onKeyDown(ev);
    expect(el.scrollTop).toBe(0);
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('Home 滚到顶部（column-reverse = -(scrollHeight - clientHeight)）', () => {
    const el = makeContainer(1000, 400);
    el.scrollTop = -100;
    const ref = { current: el };
    const { result } = renderHook(() => useScrollKeyboardControls(ref));
    result.current.containerProps.onKeyDown(keyEvent('Home'));
    expect(el.scrollTop).toBe(-600); // -(1000 - 400)
  });

  it('PageDown / PageUp 按 clientHeight*0.9 翻页（column-reverse：向底趋 0、向顶趋负）', () => {
    const el = makeContainer(1000, 400);
    el.scrollTop = -360; // 先上滑一页
    const ref = { current: el };
    const { result } = renderHook(() => useScrollKeyboardControls(ref));
    result.current.containerProps.onKeyDown(keyEvent('PageDown')); // 向底（趋向 0）
    expect(el.scrollTop).toBe(0); // -360 + 400*0.9
    result.current.containerProps.onKeyDown(keyEvent('PageUp')); // 向顶（趋向负）
    expect(el.scrollTop).toBe(-360); // 0 - 360
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
});

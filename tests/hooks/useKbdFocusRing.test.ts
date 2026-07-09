/**
 * useKbdFocusRing 键盘可见焦点环 Hook 单元测试
 *
 * 锁定契约（见 src/hooks/useKbdFocusRing.ts）：
 * - 键盘聚焦（无 pointerdown 前置）→ isKbdFocused(key)=true
 * - 指针按下后再聚焦（鼠标点击）→ isKbdFocused(key)=false（不显示焦点环）
 * - 失焦（blur）清除当前焦点态
 * - A→B 切换：B focus 后 A 的 blur 不误清 B（onBlur 用函数式更新守卫 prev===key）
 * - pointerdown 后无 focus 跟随（拖走/取消）→ setTimeout(0) 兜底清零 pointerDownRef，
 *   下一次纯键盘聚焦仍能显示焦点环
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKbdFocusRing } from '../../src/hooks/useKbdFocusRing';

describe('useKbdFocusRing', () => {
  it('键盘聚焦（无 pointerdown）→ isKbdFocused(key)=true', () => {
    const { result } = renderHook(() => useKbdFocusRing());
    expect(result.current.isKbdFocused('a')).toBe(false);
    act(() => {
      result.current.handlersFor('a').onFocus();
    });
    expect(result.current.isKbdFocused('a')).toBe(true);
  });

  it('pointerdown 后再聚焦（鼠标点击）→ 不显示焦点环', () => {
    const { result } = renderHook(() => useKbdFocusRing());
    act(() => {
      const h = result.current.handlersFor('a');
      h.onPointerDown();
      h.onFocus();
    });
    expect(result.current.isKbdFocused('a')).toBe(false);
  });

  it('blur 清除当前键盘焦点态', () => {
    const { result } = renderHook(() => useKbdFocusRing());
    act(() => {
      result.current.handlersFor('a').onFocus();
    });
    expect(result.current.isKbdFocused('a')).toBe(true);
    act(() => {
      result.current.handlersFor('a').onBlur();
    });
    expect(result.current.isKbdFocused('a')).toBe(false);
  });

  it('A→B 切换：B focus 后 A 的 blur 不误清 B（函数式更新守卫）', () => {
    const { result } = renderHook(() => useKbdFocusRing());
    act(() => {
      result.current.handlersFor('a').onFocus();
    });
    expect(result.current.isKbdFocused('a')).toBe(true);
    // 焦点移到 B
    act(() => {
      result.current.handlersFor('b').onFocus();
    });
    expect(result.current.isKbdFocused('b')).toBe(true);
    expect(result.current.isKbdFocused('a')).toBe(false);
    // A 的 blur 晚于 B 的 focus 到达：prev 已是 'b'，守卫应保留 B
    act(() => {
      result.current.handlersFor('a').onBlur();
    });
    expect(result.current.isKbdFocused('b')).toBe(true);
    expect(result.current.isKbdFocused('a')).toBe(false);
  });

  it('鼠标点击（pointerdown+focus 抑制）后，纯键盘再聚焦仍显示焦点环（onFocus 重置 pointerDownRef）', () => {
    const { result } = renderHook(() => useKbdFocusRing());
    // 第一次：鼠标点击，抑制焦点环
    act(() => {
      const h = result.current.handlersFor('a');
      h.onPointerDown();
      h.onFocus();
    });
    expect(result.current.isKbdFocused('a')).toBe(false);
    // 第二次：纯键盘聚焦，pointerDownRef 已在上次 onFocus 末尾重置为 false → 应显示
    act(() => {
      result.current.handlersFor('a').onFocus();
    });
    expect(result.current.isKbdFocused('a')).toBe(true);
  });

  it('pointerdown 后无 focus 跟随（拖走/取消），setTimeout(0) 兜底清零后下一次键盘聚焦仍显示焦点环', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useKbdFocusRing());
      // 按下但没有 focus 跟随（例如按下后手指拖走 / 触摸滚动取消）
      act(() => {
        result.current.handlersFor('a').onPointerDown();
      });
      // 兜底 setTimeout(0) 执行 → pointerDownRef 清零
      act(() => {
        vi.runOnlyPendingTimers();
      });
      // 之后的纯键盘 Tab 聚焦不再被误判为指针聚焦
      act(() => {
        result.current.handlersFor('a').onFocus();
      });
      expect(result.current.isKbdFocused('a')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

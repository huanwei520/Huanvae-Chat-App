/**
 * useEscapeKey 单测
 *
 * 覆盖：Escape 触发回调、非 Escape 不触发、enabled=false 不挂监听、unmount 移除监听。
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEscapeKey } from '../../src/stocks/hooks/useEscapeKey';

function pressKey(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }));
}

describe('useEscapeKey', () => {
  it('按 Escape 触发回调', () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape));
    pressKey('Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('按其他键不触发', () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape));
    pressKey('Enter');
    pressKey('a');
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('enabled=false 时不挂监听', () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(onEscape, false));
    pressKey('Escape');
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('unmount 后移除监听，不再触发', () => {
    const onEscape = vi.fn();
    const { unmount } = renderHook(() => useEscapeKey(onEscape));
    unmount();
    pressKey('Escape');
    expect(onEscape).not.toHaveBeenCalled();
  });
});

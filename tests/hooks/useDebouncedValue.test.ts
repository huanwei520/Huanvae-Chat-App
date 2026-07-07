/**
 * useDebouncedValue 单元测试（src/stocks/hooks/useDebouncedValue.ts）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from '../../src/stocks/hooks/useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('初始返回源值', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 220));
    expect(result.current).toBe('a');
  });

  it('值变化后 delay 前不更新，delay 后更新', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedValue(v, 220),
      { initialProps: { v: 'a' } },
    );
    rerender({ v: 'b' });
    // 未到 delay
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe('a');
    // 越过 delay
    act(() => { vi.advanceTimersByTime(30); });
    expect(result.current).toBe('b');
  });

  it('快速连续变化只采纳最后一个（防抖）', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useDebouncedValue(v, 220),
      { initialProps: { v: 'a' } },
    );
    rerender({ v: 'b' });
    act(() => { vi.advanceTimersByTime(100); });
    rerender({ v: 'c' });
    act(() => { vi.advanceTimersByTime(100); });
    // 仍未稳定 220ms
    expect(result.current).toBe('a');
    act(() => { vi.advanceTimersByTime(220); });
    expect(result.current).toBe('c');
  });
});

/**
 * useAsyncData 单元测试（src/stocks/hooks/useAsyncData.ts）
 *
 * 阶段二联调新增 retry：需求驱动端点（K线/情报/财报）首开时后端快照可能未就绪（返回错误），
 * retry 让首屏 loading 吸收填充延迟而非一次失败即永久锁 error（PLAN D1「loading 吸收」）。
 *
 * fake timer 用 async 版（vi.advanceTimersByTimeAsync）以 flush setTimeout 回调内的真实 Promise
 * （见 .claude/rules/frontend-test.md「fake timer 与真实 Promise 协调」）。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAsyncData } from '../../src/stocks/hooks/useAsyncData';

afterEach(() => {
  vi.useRealTimers();
});

describe('useAsyncData', () => {
  it('无 retry：首拉成功 → data 就绪、无 error', async () => {
    const loader = vi.fn().mockResolvedValue({ v: 1 });
    const { result } = renderHook(() => useAsyncData(loader, ['k']));
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }));
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('无 retry：首拉失败 → 立即落 error（不重试）', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useAsyncData(loader, ['k']));
    await waitFor(() => expect(result.current.error).toBe('nope'));
    expect(result.current.loading).toBe(false);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('retry：失败→延迟后重试成功，重试期 loading 保持、成功后 error 清空', async () => {
    vi.useFakeTimers();
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('快照不存在'))
      .mockResolvedValue({ v: 2 });
    const { result } = renderHook(() => useAsyncData(loader, ['k'], { attempts: 3, delayMs: 1000 }));

    // 首拉失败：仍 loading（重试待发），尚未落 error
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    // 1s 后重试成功
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual({ v: 2 });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('retry：耗尽尝试次数后落 error', async () => {
    vi.useFakeTimers();
    const loader = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAsyncData(loader, ['k'], { attempts: 2, delayMs: 500 }));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });   // 第 1 次失败 → 排重试
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(500); }); // 第 2 次失败 → 耗尽
    expect(loader).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe('boom');
    expect(result.current.loading).toBe(false);
  });

  it('retry：卸载后清定时器，不再重试', async () => {
    vi.useFakeTimers();
    const loader = vi.fn().mockRejectedValue(new Error('x'));
    const { unmount } = renderHook(() => useAsyncData(loader, ['k'], { attempts: 5, delayMs: 1000 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // 首次失败 → 排重试
    expect(loader).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(loader).toHaveBeenCalledTimes(1); // 卸载后不再拉
  });
});

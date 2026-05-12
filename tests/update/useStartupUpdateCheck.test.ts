/**
 * useStartupUpdateCheck Hook 测试
 *
 * 覆盖：
 * 1. mount 后 5000ms 调用 store.checkUpdate（默认 DEBUG_UPDATE=false）
 * 2. mount 后 4999ms 未触发，5000ms 时触发
 * 3. unmount 在 5000ms 前 → 不触发 checkUpdate（clearTimeout 生效）
 * 4. DEBUG_UPDATE=true 时调用 showAvailable，不调用 checkUpdate
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock 全局 store：useUpdateStore 是 zustand store，调用 selector 时返回 checkUpdate / showAvailable
const mockCheckUpdate = vi.hoisted(() => vi.fn());
const mockShowAvailable = vi.hoisted(() => vi.fn());

vi.mock('../../src/update/store', () => ({
  useUpdateStore: (selector: (s: { checkUpdate: typeof mockCheckUpdate; showAvailable: typeof mockShowAvailable }) => unknown) => {
    return selector({
      checkUpdate: mockCheckUpdate,
      showAvailable: mockShowAvailable,
    });
  },
}));

describe('useStartupUpdateCheck (DEBUG_UPDATE=false)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCheckUpdate.mockReset();
    mockShowAvailable.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../../src/update/config');
  });

  it('mount 后 5000ms 调用 store.checkUpdate', async () => {
    vi.doMock('../../src/update/config', () => ({
      DEBUG_UPDATE: false,
      UPDATE_CHECK_DELAY_STARTUP: 5000,
    }));
    const { useStartupUpdateCheck } = await import('../../src/update/useStartupUpdateCheck');

    renderHook(() => useStartupUpdateCheck());

    expect(mockCheckUpdate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);

    expect(mockCheckUpdate).toHaveBeenCalledTimes(1);
    expect(mockShowAvailable).not.toHaveBeenCalled();
  });

  it('mount 后 4999ms 未触发，5000ms 时触发', async () => {
    vi.doMock('../../src/update/config', () => ({
      DEBUG_UPDATE: false,
      UPDATE_CHECK_DELAY_STARTUP: 5000,
    }));
    const { useStartupUpdateCheck } = await import('../../src/update/useStartupUpdateCheck');

    renderHook(() => useStartupUpdateCheck());

    await vi.advanceTimersByTimeAsync(4999);
    expect(mockCheckUpdate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockCheckUpdate).toHaveBeenCalledTimes(1);
  });

  it('unmount 在 5000ms 前 → 不触发 checkUpdate（clearTimeout 生效）', async () => {
    vi.doMock('../../src/update/config', () => ({
      DEBUG_UPDATE: false,
      UPDATE_CHECK_DELAY_STARTUP: 5000,
    }));
    const { useStartupUpdateCheck } = await import('../../src/update/useStartupUpdateCheck');

    const { unmount } = renderHook(() => useStartupUpdateCheck());

    await vi.advanceTimersByTimeAsync(2000);
    unmount();
    await vi.advanceTimersByTimeAsync(10000);

    expect(mockCheckUpdate).not.toHaveBeenCalled();
    expect(mockShowAvailable).not.toHaveBeenCalled();
  });
});

describe('useStartupUpdateCheck (DEBUG_UPDATE=true)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCheckUpdate.mockReset();
    mockShowAvailable.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../../src/update/config');
  });

  it('DEBUG_UPDATE=true 时调用 showAvailable，不调用 checkUpdate', async () => {
    vi.doMock('../../src/update/config', () => ({
      DEBUG_UPDATE: true,
      UPDATE_CHECK_DELAY_STARTUP: 5000,
    }));
    const { useStartupUpdateCheck } = await import('../../src/update/useStartupUpdateCheck');

    renderHook(() => useStartupUpdateCheck());

    await vi.advanceTimersByTimeAsync(5000);

    expect(mockShowAvailable).toHaveBeenCalledTimes(1);
    expect(mockShowAvailable).toHaveBeenCalledWith('1.0.99', '启动时模拟更新提示');
    expect(mockCheckUpdate).not.toHaveBeenCalled();
  });
});

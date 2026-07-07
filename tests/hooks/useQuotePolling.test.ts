/**
 * useQuotePolling 单元测试（src/stocks/hooks/useQuotePolling.ts）
 *
 * 回归重点（code-review Finding 1）：一轮失败置 error 后，下一轮成功必须清掉 error
 * （否则 PanelBody 会把面板永久锁在 error 态）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQuotePolling } from '../../src/stocks/hooks/useQuotePolling';
import type { StockQuoteData } from '../../src/api/stocks';

const quoteFx: StockQuoteData = {
  symbol: 's', market: 'cn', name: 'n', price: 10, change: 0.1, change_pct: 1,
  open: 10, high: 11, low: 9, prev_close: 9.9, volume: 1, amount: 1, currency: 'CNY',
  bid_ask: { available: true, bids: [], asks: [] }, timestamp: null, as_of: null, fetched_at: null,
};

describe('useQuotePolling', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('首轮成功：填充 quote，无 error', async () => {
    const loader = vi.fn().mockResolvedValue(quoteFx);
    const { result } = renderHook(() => useQuotePolling(loader, 'k', 6000));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.quote).toEqual(quoteFx);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('首轮失败置 error → 下一轮成功清 error（Finding 1 回归）', async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue(quoteFx);
    const { result } = renderHook(() => useQuotePolling(loader, 'k', 6000));

    // 首轮（立即）失败
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.error).toBe('blip');

    // 6s 后下一轮成功 → error 必须被清空
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(result.current.error).toBeNull();
    expect(result.current.quote).toEqual(quoteFx);
  });

  it('卸载后停止轮询（清 interval）', async () => {
    const loader = vi.fn().mockResolvedValue(quoteFx);
    const { unmount } = renderHook(() => useQuotePolling(loader, 'k', 6000));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const callsAtUnmount = loader.mock.calls.length;
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(18000); });
    expect(loader.mock.calls.length).toBe(callsAtUnmount);
  });
});

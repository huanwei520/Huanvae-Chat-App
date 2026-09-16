/**
 * 故障日志环形缓冲单测（10MB 上限、滚动丢弃最旧、时间窗导出）
 */

import { describe, it, expect } from 'vitest';
import { FaultRingBuffer } from '../../src/services/faultReport/ringBuffer';

function entry(at: number, text: string, source: 'console' | 'exception' | 'network' | 'rust' = 'console') {
  return { at, source, level: 'info', text };
}

describe('faultReport ringBuffer', () => {
  it('容量内正常写入与导出', () => {
    const rb = new FaultRingBuffer(1024 * 1024);
    rb.push(entry(1000, 'first'));
    rb.push(entry(2000, 'second'));
    const snap = rb.snapshot(0);
    expect(snap).toContain('first');
    expect(snap).toContain('second');
    expect(rb.stats().count).toBe(2);
  });

  it('10MB 上限滚动丢弃最旧（构造约 12MB 灌入）', () => {
    const mb = 1024 * 1024;
    const rb = new FaultRingBuffer(10 * mb);
    const chunk = 'x'.repeat(1024); // ~1KB/条
    const n = 12 * 1024; // ~12MB
    for (let i = 0; i < n; i++) {
      rb.push(entry(i, chunk));
    }
    const stats = rb.stats();
    expect(stats.bytes).toBeLessThanOrEqual(10 * mb);
    expect(stats.bytes).toBeGreaterThan(9 * mb);
    expect(stats.dropped).toBeGreaterThan(0);
    expect(stats.count).toBeLessThan(n);
  });

  it('snapshot(sinceMs) 只导出时间窗内记录（5 分钟窗口语义）', () => {
    const rb = new FaultRingBuffer(1024 * 1024);
    const t0 = 1_700_000_000_000;
    rb.push(entry(t0, 'old-log'));
    rb.push(entry(t0 + 6 * 60 * 1000, 'recent-log'));
    const snap = rb.snapshot(t0 + 5 * 60 * 1000);
    expect(snap).toContain('recent-log');
    expect(snap).not.toContain('old-log');
  });

  it('发生过滚动丢弃时导出文本携带丢弃标记', () => {
    const rb = new FaultRingBuffer(4096);
    const big = 'y'.repeat(2048);
    for (let i = 0; i < 10; i++) {
      rb.push(entry(i, big));
    }
    expect(rb.stats().dropped).toBeGreaterThan(0);
    expect(rb.snapshot(0)).toContain('滚动丢弃');
  });

  it('单条超过上限整条丢弃且不影响容量约束', () => {
    const rb = new FaultRingBuffer(1024);
    const ok = rb.push(entry(1, 'ok'));
    const tooBig = rb.push(entry(2, 'z'.repeat(4096)));
    expect(ok).toBe(true);
    expect(tooBig).toBe(false);
    expect(rb.stats().count).toBe(1);
  });

  it('clear() 清空全部状态', () => {
    const rb = new FaultRingBuffer(1024 * 1024);
    rb.push(entry(1, 'a'));
    rb.clear();
    expect(rb.stats()).toEqual({ count: 0, bytes: 0, dropped: 0 });
  });
});

/**
 * 断线重连辅助函数单元测试（src/meeting/webrtcCore.ts）
 *
 * 覆盖：
 * - nextBackoffDelay：指数退避（1s,2s,4s…）+ 上限 30s
 * - isPongExpired：心跳存活判定的边界
 */

import { describe, it, expect } from 'vitest';
import {
  nextBackoffDelay,
  isPongExpired,
  shouldReconnectOnClose,
  MAX_BACKOFF_DELAY,
} from '../../src/meeting/webrtcCore';

describe('nextBackoffDelay', () => {
  it('指数递增：1s / 2s / 4s / 8s / 16s', () => {
    expect(nextBackoffDelay(0)).toBe(1000);
    expect(nextBackoffDelay(1)).toBe(2000);
    expect(nextBackoffDelay(2)).toBe(4000);
    expect(nextBackoffDelay(3)).toBe(8000);
    expect(nextBackoffDelay(4)).toBe(16000);
  });

  it('超过上限后封顶在 30s（MAX_BACKOFF_DELAY）', () => {
    // attempt=5 → 32000，封顶 30000
    expect(nextBackoffDelay(5)).toBe(MAX_BACKOFF_DELAY);
    expect(nextBackoffDelay(6)).toBe(MAX_BACKOFF_DELAY);
    expect(nextBackoffDelay(10)).toBe(MAX_BACKOFF_DELAY);
    expect(MAX_BACKOFF_DELAY).toBe(30000);
  });
});

describe('isPongExpired', () => {
  const TIMEOUT = 60_000;

  it('超过阈值：判定为过期', () => {
    expect(isPongExpired(0, 60_001, TIMEOUT)).toBe(true);
  });

  it('恰好等于阈值：未过期（严格大于才过期）', () => {
    expect(isPongExpired(0, 60_000, TIMEOUT)).toBe(false);
  });

  it('远未到阈值：未过期', () => {
    expect(isPongExpired(10_000, 40_000, TIMEOUT)).toBe(false);
  });
});

describe('shouldReconnectOnClose', () => {
  it('用户主动断开（suppressed）时永不重连——即便 code 是异常 1006', () => {
    expect(shouldReconnectOnClose(1006, true, false)).toBe(false);
    expect(shouldReconnectOnClose(1000, true, false)).toBe(false);
  });

  it('本端 pong 超时主动关闭时强制重连——即便关闭帧是干净的 1000', () => {
    // 回归：pong 超时 ws.close() 会发 1000，不能被当作服务器正常关闭而跳过重连
    expect(shouldReconnectOnClose(1000, false, true)).toBe(true);
  });

  it('服务器正常关闭（1000 / 1001）不重连', () => {
    expect(shouldReconnectOnClose(1000, false, false)).toBe(false);
    expect(shouldReconnectOnClose(1001, false, false)).toBe(false);
  });

  it('异常关闭（如 1006 传输断开）重连', () => {
    expect(shouldReconnectOnClose(1006, false, false)).toBe(true);
    expect(shouldReconnectOnClose(1011, false, false)).toBe(true);
  });

  it('suppressed 优先于 pongTimedOut', () => {
    expect(shouldReconnectOnClose(1000, true, true)).toBe(false);
  });
});

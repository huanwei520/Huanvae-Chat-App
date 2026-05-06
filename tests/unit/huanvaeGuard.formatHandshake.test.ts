/**
 * formatHandshake 纯函数测试
 *
 * 输入：svc API 返回的"距上次握手的秒数"
 * 输出：中文相对时间字符串（"从未" / "N 秒前" / "N 分钟前" / "N 小时前"）
 */

import { describe, it, expect } from 'vitest';
import { formatHandshake } from '../../src/huanvaeGuard/format';

describe('formatHandshake', () => {
  it('returns "从未" for 0 seconds', () => {
    expect(formatHandshake(0)).toBe('从未');
  });

  it('returns "N 秒前" for under 60 seconds', () => {
    expect(formatHandshake(1)).toBe('1 秒前');
    expect(formatHandshake(30)).toBe('30 秒前');
    expect(formatHandshake(59)).toBe('59 秒前');
  });

  it('returns "N 分钟前" for 60s..3599s', () => {
    expect(formatHandshake(60)).toBe('1 分钟前');
    expect(formatHandshake(120)).toBe('2 分钟前');
    expect(formatHandshake(3599)).toBe('59 分钟前');
  });

  it('returns "N 小时前" for >= 3600 seconds', () => {
    expect(formatHandshake(3600)).toBe('1 小时前');
    expect(formatHandshake(7200)).toBe('2 小时前');
    expect(formatHandshake(86400)).toBe('24 小时前');
  });

  it('floors fractional minutes / hours', () => {
    expect(formatHandshake(89)).toBe('1 分钟前'); // floor(89/60) = 1
    expect(formatHandshake(5400)).toBe('1 小时前'); // floor(5400/3600) = 1
  });
});

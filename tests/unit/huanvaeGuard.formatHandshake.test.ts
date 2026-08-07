/**
 * formatHandshake 纯函数测试
 *
 * 输入：守护进程 `/api/tunnel/status` peer 段的 `last_handshake` ——
 *       语义是**距今秒数（age）**，不是绝对 Unix 时间戳
 *       （真值源：HuanvaeGuard `client/windows/src/uapi.rs` 的 `handshake_age_secs()`，
 *        macOS `hg-macos` 同名同逻辑）
 * 输出：中文相对时间字符串（"尚未握手" / "N 秒前" / "N 分钟前" / "N 小时前" / "时间异常"）
 */

import { describe, it, expect } from 'vitest';
import { formatHandshake } from '../../src/huanvaeGuard/format';

describe('formatHandshake', () => {
  it('returns "尚未握手" for 0 seconds', () => {
    // 0 有歧义：daemon 对「从未握手」与「刚握手不到 1 秒」都返回 0，
    // 所以文案只能陈述"当前没有可报告的握手时间"，不能断言"从未"
    expect(formatHandshake(0)).toBe('尚未握手');
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

  it('returns "时间异常" for an absolute Unix timestamp passed as age', () => {
    // 这条用例锁的是：daemon 若回归成下发绝对时间戳（本项目已栽过两次，
    // 曾算出 17.8 亿秒导致设备状态恒 offline），必须响亮报错，
    // 而不是渲染成看似合理的「N 小时前」（49 万小时前那种"像真话的假话"）。
    expect(formatHandshake(1786000000)).toBe('时间异常');
  });

  it('guards exactly at the 10-year boundary', () => {
    // 315_360_000 = 10 年秒数；等于阈值仍按正常 age 渲染，严格大于才判异常
    expect(formatHandshake(315360000)).toBe('87600 小时前');
    expect(formatHandshake(315360001)).toBe('时间异常');
  });
});

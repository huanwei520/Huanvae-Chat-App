/**
 * 日期格式化测试（注册时间 / 成为好友时间等）
 */

import { describe, it, expect } from 'vitest';
import { formatDate } from '../../src/utils/time';

describe('formatDate', () => {
  it('格式化为 YYYY年M月D日（年份不受时区跨日影响，用中午 UTC）', () => {
    // 中午 UTC，年份在任何常见时区都稳定为 2025
    expect(formatDate('2025-11-25T12:00:00Z')).toMatch(/^2025年\d{1,2}月\d{1,2}日$/);
  });

  it('无效/空时间返回空串', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('not-a-date')).toBe('');
  });
});

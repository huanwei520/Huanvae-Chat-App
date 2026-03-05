/**
 * 时间格式化工具函数单元测试
 *
 * 测试 src/utils/time.ts 中的 formatMessageTime
 *
 * 包含测试：
 * - 今天：仅显示时间
 * - 昨天：显示 "昨天 HH:MM"
 * - 一周内：显示星期几
 * - 更早：显示月/日
 * - 午夜边界
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatMessageTime } from '../../src/utils/time';

describe('时间格式化工具函数 (utils/time)', () => {
  beforeEach(() => {
    // 固定当前时间为 2026-03-06 12:00:00（周五）
    vi.useFakeTimers({ now: new Date('2026-03-06T12:00:00') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatMessageTime - 格式化消息时间', () => {
    it('今天应仅返回时间', () => {
      const result = formatMessageTime('2026-03-06T10:30:00');
      expect(result).toMatch(/\d{1,2}:\d{2}/);
      expect(result).not.toContain('昨天');
      expect(result).not.toContain('周');
      expect(result).not.toMatch(/\d{1,2}\/\d{1,2}/);
    });

    it('昨天应返回 "昨天 HH:MM"', () => {
      const result = formatMessageTime('2026-03-05T14:30:00');
      expect(result).toMatch(/^昨天\s/);
      expect(result).toMatch(/\d{1,2}:\d{2}$/);
    });

    it('一周内应返回星期几', () => {
      // 2026-03-04 是周三
      const result = formatMessageTime('2026-03-04T09:00:00');
      expect(result).toMatch(/^周[一二三四五六日]\s/);
      expect(result).toMatch(/\d{1,2}:\d{2}$/);
    });

    it('更早日期应返回月/日格式', () => {
      // 2026-02-27 距 2026-03-06 超过 7 天
      const result = formatMessageTime('2026-02-27T08:15:00');
      expect(result).toMatch(/\d{1,2}\/\d{1,2}\s/);
      expect(result).toMatch(/\d{1,2}:\d{2}$/);
    });

    it('午夜边界：同一天 00:00 与 23:59 均应视为今天', () => {
      const early = formatMessageTime('2026-03-06T00:01:00');
      const late = formatMessageTime('2026-03-06T23:59:00');
      expect(early).not.toContain('昨天');
      expect(late).not.toContain('昨天');
    });

    it('午夜边界：昨日 23:59 应视为昨天', () => {
      const result = formatMessageTime('2026-03-05T23:59:00');
      expect(result).toMatch(/^昨天\s/);
    });
  });
});

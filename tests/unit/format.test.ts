/**
 * 格式化工具函数单元测试
 *
 * 测试 src/utils/format.ts 中的格式化函数
 *
 * @created 2026-01-24
 */

import { describe, it, expect } from 'vitest';
import { formatSize, formatSpeed, formatEta, formatDuration } from '../../src/utils/format';

describe('格式化工具函数 (utils/format)', () => {
  describe('formatSize - 格式化文件大小', () => {
    it('应正确格式化字节 (B)', () => {
      expect(formatSize(0)).toBe('0 B');
      expect(formatSize(500)).toBe('500 B');
      expect(formatSize(1023)).toBe('1023 B');
    });

    it('应正确格式化千字节 (KB)', () => {
      expect(formatSize(1024)).toBe('1.0 KB');
      expect(formatSize(1536)).toBe('1.5 KB');
      expect(formatSize(10240)).toBe('10.0 KB');
      expect(formatSize(1024 * 1024 - 1)).toBe('1024.0 KB');
    });

    it('应正确格式化兆字节 (MB)', () => {
      expect(formatSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
      expect(formatSize(100 * 1024 * 1024)).toBe('100.0 MB');
    });

    it('应正确格式化吉字节 (GB)', () => {
      expect(formatSize(1024 * 1024 * 1024)).toBe('1.00 GB');
      expect(formatSize(1.5 * 1024 * 1024 * 1024)).toBe('1.50 GB');
      expect(formatSize(10 * 1024 * 1024 * 1024)).toBe('10.00 GB');
    });
  });

  describe('formatSpeed - 格式化传输速度', () => {
    it('应在大小后添加 /s 后缀', () => {
      expect(formatSpeed(1024)).toBe('1.0 KB/s');
      expect(formatSpeed(1024 * 1024)).toBe('1.0 MB/s');
      expect(formatSpeed(500)).toBe('500 B/s');
    });
  });

  describe('formatEta - 格式化剩余时间', () => {
    it('空值或非正数应返回空字符串', () => {
      expect(formatEta(undefined)).toBe('');
      expect(formatEta(0)).toBe('');
      expect(formatEta(-1)).toBe('');
    });

    it('应正确格式化秒', () => {
      expect(formatEta(1)).toBe('1秒');
      expect(formatEta(30)).toBe('30秒');
      expect(formatEta(59)).toBe('59秒');
    });

    it('应正确格式化分钟', () => {
      expect(formatEta(60)).toBe('1分钟');
      expect(formatEta(90)).toBe('1分30秒');
      expect(formatEta(125)).toBe('2分5秒');
      expect(formatEta(3599)).toBe('59分59秒');
    });

    it('应正确格式化小时', () => {
      expect(formatEta(3600)).toBe('1小时');
      expect(formatEta(3660)).toBe('1小时1分');
      expect(formatEta(7200)).toBe('2小时');
      expect(formatEta(7325)).toBe('2小时2分');
    });
  });

  describe('formatDuration - 格式化时长（毫秒）', () => {
    it('应正确格式化毫秒', () => {
      expect(formatDuration(100)).toBe('100 毫秒');
      expect(formatDuration(500)).toBe('500 毫秒');
      expect(formatDuration(999)).toBe('999 毫秒');
    });

    it('应正确格式化秒', () => {
      expect(formatDuration(1000)).toBe('1.0 秒');
      expect(formatDuration(1500)).toBe('1.5 秒');
      expect(formatDuration(30000)).toBe('30.0 秒');
    });

    it('应正确格式化分钟', () => {
      expect(formatDuration(60000)).toBe('1 分钟');
      expect(formatDuration(65000)).toBe('1 分 5 秒');
      expect(formatDuration(120000)).toBe('2 分钟');
    });
  });
});

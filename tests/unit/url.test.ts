/**
 * URL 工具函数单元测试
 *
 * 测试 src/utils/url.ts 中的 extractProxyHost
 *
 * 包含测试：
 * - 有效 URL → 返回 hostname
 * - 空字符串 → '直连'
 * - 无效 URL → 原样返回
 * - 各种 URL 格式（https、http、带端口、带路径）
 */

import { describe, it, expect } from 'vitest';
import { extractProxyHost } from '../../src/utils/url';

describe('URL 工具函数 (utils/url)', () => {
  describe('extractProxyHost - 提取代理主机名', () => {
    it('有效 URL 应返回 hostname', () => {
      expect(extractProxyHost('https://mirror.ghproxy.com/')).toBe('mirror.ghproxy.com');
      expect(extractProxyHost('https://example.com')).toBe('example.com');
    });

    it('空字符串应返回 "直连"', () => {
      expect(extractProxyHost('')).toBe('直连');
    });

    it('无效 URL 应原样返回', () => {
      expect(extractProxyHost('invalid')).toBe('invalid');
      expect(extractProxyHost('not-a-url')).toBe('not-a-url');
    });

    it('https URL 应正确提取 hostname', () => {
      expect(extractProxyHost('https://api.example.com/path')).toBe('api.example.com');
    });

    it('http URL 应正确提取 hostname', () => {
      expect(extractProxyHost('http://localhost')).toBe('localhost');
    });

    it('带端口的 URL 应仅返回 hostname（不含端口）', () => {
      expect(extractProxyHost('https://example.com:8080/path')).toBe('example.com');
    });

    it('带路径的 URL 应仅返回 hostname', () => {
      expect(extractProxyHost('https://cdn.example.com/assets/file.js')).toBe('cdn.example.com');
    });
  });
});

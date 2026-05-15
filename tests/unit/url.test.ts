/**
 * URL 工具函数单元测试
 *
 * 测试 src/utils/url.ts 中的 extractHostname
 */

import { describe, it, expect } from 'vitest';
import { extractHostname } from '../../src/utils/url';

describe('URL 工具函数 (utils/url)', () => {
  describe('extractHostname - 提取主机名', () => {
    it('有效 URL 应返回 hostname', () => {
      expect(extractHostname('https://store.huanvae.cn/update/')).toBe('store.huanvae.cn');
      expect(extractHostname('https://example.com')).toBe('example.com');
    });

    it('空字符串应返回 "直连"', () => {
      expect(extractHostname('')).toBe('直连');
    });

    it('无效 URL 应原样返回', () => {
      expect(extractHostname('invalid')).toBe('invalid');
      expect(extractHostname('not-a-url')).toBe('not-a-url');
    });

    it('https URL 应正确提取 hostname', () => {
      expect(extractHostname('https://api.example.com/path')).toBe('api.example.com');
    });

    it('http URL 应正确提取 hostname', () => {
      expect(extractHostname('http://localhost')).toBe('localhost');
    });

    it('带端口的 URL 应仅返回 hostname（不含端口）', () => {
      expect(extractHostname('https://example.com:8080/path')).toBe('example.com');
    });

    it('带路径的 URL 应仅返回 hostname', () => {
      expect(extractHostname('https://cdn.example.com/assets/file.js')).toBe('cdn.example.com');
    });
  });
});

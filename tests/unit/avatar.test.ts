/**
 * 头像工具函数单元测试
 *
 * 测试 src/utils/avatar.ts 中的 getLocalFileUrl、getAvatarUrl、isLocalFileUrl、isServerUrl
 *
 * 包含测试：
 * - getLocalFileUrl: 调用 convertFileSrc，非绝对路径时警告
 * - getAvatarUrl: 优先本地，回退服务器，两者都无时返回 null
 * - isLocalFileUrl: asset:// 为 true，http:// 为 false
 * - isServerUrl: http/https 为 true，asset:// 和 ftp:// 为 false
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  getLocalFileUrl,
  getAvatarUrl,
  isLocalFileUrl,
  isServerUrl,
} from '../../src/utils/avatar';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

describe('头像工具函数 (utils/avatar)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('getLocalFileUrl', () => {
    it('应调用 convertFileSrc 并返回转换后的 URL', () => {
      const result = getLocalFileUrl('/path/to/avatar.png');
      expect(convertFileSrc).toHaveBeenCalledWith('/path/to/avatar.png');
      expect(result).toBe('asset://localhost//path/to/avatar.png');
    });

    it('非绝对路径时应输出警告', () => {
      getLocalFileUrl('relative/path.png');
      expect(warnSpy).toHaveBeenCalledWith('getLocalFileUrl: 路径应该是绝对路径', 'relative/path.png');
    });

    it('绝对路径时不应输出警告', () => {
      getLocalFileUrl('/absolute/path.png');
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('getAvatarUrl', () => {
    it('有本地路径时应优先返回本地 URL', () => {
      const result = getAvatarUrl('/local/avatar.png', 'https://server.com/avatar.png');
      expect(result).toBe('asset://localhost//local/avatar.png');
    });

    it('无本地路径有服务器 URL 时应返回服务器 URL', () => {
      const result = getAvatarUrl(null, 'https://server.com/avatar.png');
      expect(result).toBe('https://server.com/avatar.png');
    });

    it('两者都无时应返回 null', () => {
      expect(getAvatarUrl(null, null)).toBeNull();
      expect(getAvatarUrl(undefined, undefined)).toBeNull();
      expect(getAvatarUrl('', '')).toBeNull();
    });

    it('本地路径为空时回退到服务器 URL', () => {
      const result = getAvatarUrl('', 'https://server.com/avatar.png');
      expect(result).toBe('https://server.com/avatar.png');
    });
  });

  describe('isLocalFileUrl', () => {
    it('asset:// 开头应返回 true', () => {
      expect(isLocalFileUrl('asset://localhost/path')).toBe(true);
      expect(isLocalFileUrl('asset://custom/path')).toBe(true);
    });

    it('http:// 开头应返回 false', () => {
      expect(isLocalFileUrl('http://example.com/avatar.png')).toBe(false);
    });
  });

  describe('isServerUrl', () => {
    it('http:// 开头应返回 true', () => {
      expect(isServerUrl('http://example.com/avatar.png')).toBe(true);
    });

    it('https:// 开头应返回 true', () => {
      expect(isServerUrl('https://example.com/avatar.png')).toBe(true);
    });

    it('asset:// 开头应返回 false', () => {
      expect(isServerUrl('asset://localhost/path')).toBe(false);
    });

    it('ftp:// 开头应返回 false', () => {
      expect(isServerUrl('ftp://example.com/file')).toBe(false);
    });
  });
});

/**
 * 头像工具函数单元测试
 *
 * 测试 src/utils/avatar.ts 中的所有导出函数
 *
 * 包含测试：
 * - resolveServerAvatarUrl: 委托回环安全反代(secureProxy.proxyResourceUrl)解析头像 URL
 * - getLocalFileUrl: 调用 convertFileSrc，非绝对路径时警告
 * - getAvatarUrl: 优先本地，回退服务器（经反代解析），两者都无时返回 null
 * - isLocalFileUrl: asset:// 为 true，http:// 为 false
 * - isServerUrl: http/https 为 true，asset:// 和 ftp:// 为 false
 *
 * 注：头像不再直连源站，改为经回环安全反代(http://127.0.0.1:<port>)中转——webview 的 <img>
 * 用系统信任验不过私有 CA 自签 leaf。avatar.ts 仅薄委托,真正的 URL 改写逻辑测试见 secureProxy.test.ts。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  resolveServerAvatarUrl,
  getLocalFileUrl,
  getAvatarUrl,
  isLocalFileUrl,
  isServerUrl,
} from '../../src/utils/avatar';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

// 把 secureProxy 的 proxyResourceUrl 替换为可控 stub,验证 avatar.ts 的委托契约
const proxyMock = vi.hoisted(() => ({ proxyResourceUrl: vi.fn() }));
vi.mock('../../src/services/secureProxy', () => proxyMock);

describe('头像工具函数 (utils/avatar)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    proxyMock.proxyResourceUrl.mockReset();
    // 默认: 把相对路径/URL 映射成可预期的反代 URL
    proxyMock.proxyResourceUrl.mockImplementation((p: string | null | undefined) =>
      p ? `http://127.0.0.1:47823/${String(p).replace(/^\/+/, '')}` : null,
    );
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('resolveServerAvatarUrl (委托 secureProxy.proxyResourceUrl)', () => {
    it('把入参原样转交 proxyResourceUrl 并返回其结果', () => {
      const out = resolveServerAvatarUrl('avatars/user123.jpg?t=1706000000');
      expect(proxyMock.proxyResourceUrl).toHaveBeenCalledWith('avatars/user123.jpg?t=1706000000');
      expect(out).toBe('http://127.0.0.1:47823/avatars/user123.jpg?t=1706000000');
    });

    it('proxyResourceUrl 返回 null 时原样返回 null（null/undefined/空串入参）', () => {
      proxyMock.proxyResourceUrl.mockReturnValue(null);
      expect(resolveServerAvatarUrl(null)).toBeNull();
      expect(resolveServerAvatarUrl(undefined)).toBeNull();
      expect(resolveServerAvatarUrl('')).toBeNull();
      expect(proxyMock.proxyResourceUrl).toHaveBeenCalledTimes(3);
    });

    it('完整 URL 入参也透传给 proxyResourceUrl（由其决定是否改写）', () => {
      proxyMock.proxyResourceUrl.mockReturnValue('http://127.0.0.1:47823/avatars/user.jpg');
      const out = resolveServerAvatarUrl('https://api.huanvae.cn/avatars/user.jpg');
      expect(proxyMock.proxyResourceUrl).toHaveBeenCalledWith('https://api.huanvae.cn/avatars/user.jpg');
      expect(out).toBe('http://127.0.0.1:47823/avatars/user.jpg');
    });
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
    it('有本地路径时应优先返回本地 URL（不走反代）', () => {
      const result = getAvatarUrl('/local/avatar.png', 'avatars/server.png');
      expect(result).toBe('asset://localhost//local/avatar.png');
      expect(proxyMock.proxyResourceUrl).not.toHaveBeenCalled();
    });

    it('无本地路径时经反代解析服务器 URL', () => {
      const result = getAvatarUrl(null, 'avatars/user.jpg?t=123');
      expect(proxyMock.proxyResourceUrl).toHaveBeenCalledWith('avatars/user.jpg?t=123');
      expect(result).toBe('http://127.0.0.1:47823/avatars/user.jpg?t=123');
    });

    it('两者都无时应返回 null', () => {
      proxyMock.proxyResourceUrl.mockReturnValue(null);
      expect(getAvatarUrl(null, null)).toBeNull();
      expect(getAvatarUrl(undefined, undefined)).toBeNull();
      expect(getAvatarUrl('', '')).toBeNull();
    });

    it('本地路径为空时回退到服务器 URL（经反代）', () => {
      const result = getAvatarUrl('', 'avatars/server.png');
      expect(proxyMock.proxyResourceUrl).toHaveBeenCalledWith('avatars/server.png');
      expect(result).toBe('http://127.0.0.1:47823/avatars/server.png');
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

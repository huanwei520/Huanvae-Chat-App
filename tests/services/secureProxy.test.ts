/**
 * 回环安全反代 JS 适配单元测试 (services/secureProxy)
 *
 * 覆盖:
 * - proxyResourceUrl: webview 原生加载(<img>/<video>)的资源 URL 改写(端口未就绪/就绪、完整URL/相对路径)
 * - proxyRequestUrl: XHR/fetch 请求 URL 改写(上传分片、头像上传、multipart、诊断上报、lowcode 算子)
 * - initSecureProxy / proxyPort / setProxyTarget: 端口获取 + 目标源站设置(invoke 契约)
 *
 * 注:proxyPortValue 是模块级状态,测试按"未就绪 → init 取端口 → 就绪后"顺序编排,不可乱序。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

import {
  initSecureProxy,
  setProxyTarget,
  proxyPort,
  proxyResourceUrl,
  proxyRequestUrl,
} from '../../src/services/secureProxy';

const PORT = 47823;

describe('secureProxy', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  describe('反代未就绪(端口=0,启动前)', () => {
    it('proxyPort() 初始为 0', () => {
      expect(proxyPort()).toBe(0);
    });
    it('proxyResourceUrl: 完整 URL 原样返回、相对路径返回 null、空返回 null', () => {
      expect(proxyResourceUrl('https://api.huanvae.cn/avatars/x.jpg')).toBe(
        'https://api.huanvae.cn/avatars/x.jpg',
      );
      expect(proxyResourceUrl('avatars/x.jpg')).toBeNull();
      expect(proxyResourceUrl(null)).toBeNull();
      expect(proxyResourceUrl('')).toBeNull();
    });
    it('proxyRequestUrl: 未就绪时原样返回(失败诚实暴露)', () => {
      expect(proxyRequestUrl('https://api.huanvae.cn/api/storage/x')).toBe(
        'https://api.huanvae.cn/api/storage/x',
      );
    });
  });

  describe('initSecureProxy', () => {
    it('invoke ensure_secure_proxy 取端口并缓存', async () => {
      mocks.invoke.mockResolvedValue(PORT);
      const p = await initSecureProxy();
      expect(p).toBe(PORT);
      expect(proxyPort()).toBe(PORT);
      expect(mocks.invoke).toHaveBeenCalledWith('ensure_secure_proxy');
    });
    it('invoke 失败时不抛、保留上次端口', async () => {
      mocks.invoke.mockRejectedValue(new Error('bind fail'));
      const p = await initSecureProxy();
      // 上一个 it 已设为 PORT, 失败不应清零
      expect(p).toBe(PORT);
      expect(proxyPort()).toBe(PORT);
    });
  });

  describe('setProxyTarget', () => {
    it('invoke set_proxy_target 透传 ip/port/host(host=逻辑域名,反代转发时显式设 Host 头)', async () => {
      mocks.invoke.mockResolvedValue(undefined);
      await setProxyTarget('47.105.101.42', 443, 'api.huanvae.cn');
      expect(mocks.invoke).toHaveBeenCalledWith('set_proxy_target', {
        ip: '47.105.101.42',
        port: 443,
        host: 'api.huanvae.cn',
      });
    });
    it('invoke 失败时静默吞掉(不影响发现流程)', async () => {
      mocks.invoke.mockRejectedValue(new Error('x'));
      await expect(setProxyTarget('1.2.3.4', 443, 'h')).resolves.toBeUndefined();
    });
  });

  describe('反代就绪后(端口已取=47823) 改写 URL', () => {
    it('proxyResourceUrl: 完整 URL → 取 path+query 拼回环', () => {
      expect(proxyResourceUrl('https://api.huanvae.cn/avatars/x.jpg?t=1')).toBe(
        `http://127.0.0.1:${PORT}/avatars/x.jpg?t=1`,
      );
    });
    it('proxyResourceUrl: 相对路径补前导斜杠', () => {
      expect(proxyResourceUrl('avatars/x.jpg')).toBe(`http://127.0.0.1:${PORT}/avatars/x.jpg`);
      expect(proxyResourceUrl('/avatars/x.jpg')).toBe(`http://127.0.0.1:${PORT}/avatars/x.jpg`);
    });
    it('proxyResourceUrl: 非法完整 URL → 原样返回', () => {
      expect(proxyResourceUrl('http://[invalid')).toBe('http://[invalid');
    });
    it('proxyRequestUrl: 完整请求 URL → 仅保留 path+query 经回环', () => {
      expect(proxyRequestUrl('https://api.huanvae.cn/api/storage/multipart/part_url?n=1')).toBe(
        `http://127.0.0.1:${PORT}/api/storage/multipart/part_url?n=1`,
      );
    });
    it('proxyRequestUrl: 预签名长 query 完整保留(签名不丢)', () => {
      const signed =
        'https://api.huanvae.cn/bucket/key?X-Amz-Signature=abc&X-Amz-Expires=900&partNumber=2';
      expect(proxyRequestUrl(signed)).toBe(
        `http://127.0.0.1:${PORT}/bucket/key?X-Amz-Signature=abc&X-Amz-Expires=900&partNumber=2`,
      );
    });
  });
});

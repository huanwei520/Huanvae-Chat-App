/**
 * 回环安全反代 JS 适配单元测试 (services/secureProxy)
 *
 * 覆盖:
 * - proxyResourceUrl: webview 原生加载(<img>/<video>)的资源 URL 改写(端口未就绪/就绪、完整URL/相对路径)
 * - proxyRequestUrl: XHR/fetch 请求 URL 改写(上传分片、头像上传、multipart、诊断上报);未就绪短等待
 *   (窗口内就绪→正常代理,超时→抛 secure proxy not ready),URL 非法→抛 invalid url for proxy(F5,不退化直连)
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
  resolveDisplayUrl,
  PROXY_READY_POLL_INTERVAL_MS,
  PROXY_READY_TIMEOUT_MS,
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
    it('proxyRequestUrl: 未就绪→等待超时→抛明确错误(含 secure proxy not ready 语义,非笼统网络错误)', async () => {
      vi.useFakeTimers();
      try {
        const p = proxyRequestUrl('https://api.huanvae.cn/api/storage/x');
        const assertion = expect(p).rejects.toThrow(/secure proxy not ready/);
        // 快进整个等待预算:轮询耗尽仍端口 0 → 拒绝(纯轮询 proxyPortValue,不重复 invoke)
        await vi.advanceTimersByTimeAsync(PROXY_READY_TIMEOUT_MS);
        await assertion;
        expect(proxyPort()).toBe(0);
        expect(mocks.invoke).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
    it('proxyRequestUrl: URL 非法→抛明确错误(invalid url for proxy,不等等待窗口)', async () => {
      await expect(proxyRequestUrl('http://[invalid')).rejects.toThrow(/invalid url for proxy/);
    });
    it('proxyRequestUrl: 未就绪→等待窗口内就绪(initSecureProxy 回填端口)→正常走代理', async () => {
      vi.useFakeTimers();
      try {
        mocks.invoke.mockResolvedValue(PORT);
        const p = proxyRequestUrl('https://api.huanvae.cn/api/storage/x');
        await vi.advanceTimersByTimeAsync(PROXY_READY_POLL_INTERVAL_MS); // 首轮轮询:仍未就绪
        await initSecureProxy(); // 等待窗口内反代就绪(端口回填)
        await vi.advanceTimersByTimeAsync(PROXY_READY_POLL_INTERVAL_MS); // 下一轮轮询观察到就绪
        await expect(p).resolves.toBe(`http://127.0.0.1:${PORT}/api/storage/x`);
      } finally {
        vi.useRealTimers();
      }
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
    it('proxyRequestUrl: 完整请求 URL → 仅保留 path+query 经回环(行为不变)', async () => {
      await expect(proxyRequestUrl('https://api.huanvae.cn/api/storage/multipart/part_url?n=1')).resolves.toBe(
        `http://127.0.0.1:${PORT}/api/storage/multipart/part_url?n=1`,
      );
    });
    it('proxyRequestUrl: 预签名长 query 完整保留(签名不丢)', async () => {
      const signed =
        'https://api.huanvae.cn/bucket/key?X-Amz-Signature=abc&X-Amz-Expires=900&partNumber=2';
      await expect(proxyRequestUrl(signed)).resolves.toBe(
        `http://127.0.0.1:${PORT}/bucket/key?X-Amz-Signature=abc&X-Amz-Expires=900&partNumber=2`,
      );
    });
  });

  describe('resolveDisplayUrl(唯一显示收口点:后端反代/外部放行)', () => {
    beforeEach(async () => {
      // 端口已就绪(前序 init 设为 PORT);显式设逻辑域名供"后端 vs 外部"判定
      mocks.invoke.mockResolvedValue(undefined);
      await setProxyTarget('47.105.101.42', 443, 'api.huanvae.cn');
    });

    it('后端逻辑域名完整 URL(presigned)→ 反代回环, 签名 query 完整', () => {
      expect(
        resolveDisplayUrl('https://api.huanvae.cn/friends-file/x.jpg?X-Amz-Signature=abc&X-Amz-Expires=900'),
      ).toBe(`http://127.0.0.1:${PORT}/friends-file/x.jpg?X-Amz-Signature=abc&X-Amz-Expires=900`);
    });
    it('外部域名(≠逻辑域名)完整 URL → 原样放行(真 CA 直连, 不能反代到后端)', () => {
      expect(resolveDisplayUrl('https://cdn.example.com/icon.png')).toBe(
        'https://cdn.example.com/icon.png',
      );
    });
    it('后端相对路径(storage 图标)→ 反代回环', () => {
      expect(resolveDisplayUrl('/storage/icons/inventory.png')).toBe(
        `http://127.0.0.1:${PORT}/storage/icons/inventory.png`,
      );
    });
    it('null/undefined/空 → null', () => {
      expect(resolveDisplayUrl(null)).toBeNull();
      expect(resolveDisplayUrl(undefined)).toBeNull();
      expect(resolveDisplayUrl('')).toBeNull();
    });
    it('非法完整 URL → 原样(不抛)', () => {
      expect(resolveDisplayUrl('http://[invalid')).toBe('http://[invalid');
    });
  });

  // 定层位证据（win-restart-filechain ① 回环反代/端口烘焙）：Windows 重启后 secure_proxy.rs
  // 优先绑 PREFERRED_PORT=47823、被占则 ephemeral（端口可变）。穷举（本块搜索 3c/5c）证实桌面端
  // session/账号库不落回环 URL（accounts.json 存 avatar_path 本地路径）；持久化回环 URL 的通道是
  // 移动端 sessionPersist（session.profile.user_avatar_url）与任何历史缓存/DB 残留行。本块钉死该收口点的
  // 「旧端口剥离」分支：旧端口回环 URL 一律剥掉、按当前端口重新反代 —— 端口烘焙在显示面被结构性拆解，
  // 不可能成为跨重启病灶。删掉 secureProxy.resolveDisplayUrl 的 127.0.0.1/localhost 分支即回归。
  describe('resolveDisplayUrl 跨重启旧端口剥离(回环 URL 重写为当前反代端口)', () => {
    beforeEach(async () => {
      mocks.invoke.mockResolvedValue(undefined);
      // 端口沿用前序 init 的 47823;重新显式设 host,保证本块不依赖前序 describe 的 host 状态
      await setProxyTarget('47.105.101.42', 443, 'api.huanvae.cn');
    });

    it('持久层残留旧端口回环 URL(跨重启)→ 剥端口按当前端口重反代,签名 query 完整保留', () => {
      expect(
        resolveDisplayUrl('http://127.0.0.1:53117/friends-file/x.jpg?X-Amz-Signature=abc&X-Amz-Expires=900'),
      ).toBe(`http://127.0.0.1:${PORT}/friends-file/x.jpg?X-Amz-Signature=abc&X-Amz-Expires=900`);
    });

    it('localhost 旧端口回环 URL 同样剥离', () => {
      expect(resolveDisplayUrl('http://localhost:53117/avatars/u.jpg?t=1')).toBe(
        `http://127.0.0.1:${PORT}/avatars/u.jpg?t=1`,
      );
    });

    it('当前端口回环 URL 幂等(剥了再拼回同一 URL)', () => {
      expect(resolveDisplayUrl(`http://127.0.0.1:${PORT}/avatars/u.jpg?t=1`)).toBe(
        `http://127.0.0.1:${PORT}/avatars/u.jpg?t=1`,
      );
    });
  });
});

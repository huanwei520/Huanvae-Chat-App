import { describe, it, expect, vi, beforeEach } from 'vitest';

// invoke 走 Tauri 通道(plugin-http 同理), 真 fetch/page.route 拦不到 → mock invoke 单测
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
// secureFetch 现 import rediscoverOnFailure(数据面失败轮换)—— mock discovery 避免拉起真 plugin-store,
// 并可控轮换返回值验证 failover 分支
const disc = vi.hoisted(() => ({ rediscoverOnFailure: vi.fn() }));
vi.mock('../../src/services/discovery', () => ({ rediscoverOnFailure: disc.rediscoverOnFailure }));

import { isOkStatus, secureHttp, rewriteUrlHost } from '../../src/services/secureFetch';

describe('secureFetch', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    disc.rediscoverOnFailure.mockReset();
  });

  describe('isOkStatus', () => {
    it.each([
      [199, false],
      [200, true],
      [204, true],
      [299, true],
      [300, false],
      [401, false],
      [500, false],
    ])('status %i -> %s', (status, ok) => {
      expect(isOkStatus(status as number)).toBe(ok);
    });
  });

  it('secureHttp 把 SecureHttpResp 适配成 Response-like, invoke 用 ("secure_http",{req})', async () => {
    mocks.invoke.mockResolvedValue({ status: 200, headers: { 'x-a': '1' }, body: '{"data":42}' });
    const req = { method: 'GET', url: 'https://api.huanvae.cn/x', pin_ca: true };
    const resp = await secureHttp(req);

    expect(mocks.invoke).toHaveBeenCalledWith('secure_http', { req });
    expect(resp.status).toBe(200);
    expect(resp.ok).toBe(true);
    expect(resp.json<{ data: number }>()).toEqual({ data: 42 });
    expect(resp.text()).toBe('{"data":42}');
    expect(resp.headers['x-a']).toBe('1');
  });

  it('secureHttp 非 2xx -> ok=false 且透传 status', async () => {
    mocks.invoke.mockResolvedValue({ status: 401, headers: {}, body: '' });
    const resp = await secureHttp({ method: 'GET', url: 'https://x/y', pin_ca: true });
    expect(resp.ok).toBe(false);
    expect(resp.status).toBe(401);
  });

  it('secureHttp 缺 headers 容错为空对象', async () => {
    mocks.invoke.mockResolvedValue({ status: 204, body: '' });
    const resp = await secureHttp({ method: 'DELETE', url: 'https://x/y', pin_ca: true });
    expect(resp.headers).toEqual({});
    expect(resp.ok).toBe(true);
  });

  describe('rewriteUrlHost (无 SNI 直连 IP 的核心改写)', () => {
    it('https 默认端口 443 → 省略端口(等价直连 IP:443)', () => {
      expect(rewriteUrlHost('https://api.huanvae.cn/api/x?q=1', '47.105.101.42', 443)).toBe(
        'https://47.105.101.42/api/x?q=1',
      );
    });
    it('非标端口保留', () => {
      expect(rewriteUrlHost('https://api.huanvae.cn/x', '47.105.101.42', 8443)).toBe(
        'https://47.105.101.42:8443/x',
      );
    });
    it('ws(s):// 同样改写主机(WS 复用)', () => {
      expect(rewriteUrlHost('wss://api.huanvae.cn/ws?token=t', '47.104.231.235', 443)).toBe(
        'wss://47.104.231.235/ws?token=t',
      );
    });
  });

  it('secureHttp 带 direct_ip → 改写 url 主机为 IP, 且 direct_* 不下发 Rust', async () => {
    mocks.invoke.mockResolvedValue({ status: 200, headers: {}, body: 'OK' });
    await secureHttp({
      method: 'GET',
      url: 'https://api.huanvae.cn/api/x',
      pin_ca: true,
      direct_ip: '47.105.101.42',
      direct_port: 443,
    });
    const sent = (mocks.invoke.mock.calls[0]?.[1] as { req: Record<string, unknown> }).req;
    expect(sent.url).toBe('https://47.105.101.42/api/x');
    expect(sent.pin_ca).toBe(true);
    expect(sent).not.toHaveProperty('direct_ip');
    expect(sent).not.toHaveProperty('direct_port');
  });

  describe('secureHttp 数据面失败轮换 (failover)', () => {
    const dataReq = {
      method: 'GET',
      url: 'https://api.huanvae.cn/api/x',
      pin_ca: true,
      direct_ip: '47.104.231.235',
      direct_port: 443,
    };

    it('数据面连接失败 → rediscoverOnFailure(死IP) → 切到新 IP 原样重发一次并成功', async () => {
      disc.rediscoverOnFailure.mockResolvedValue({ domain: 'api.huanvae.cn', ip: '47.105.101.42', port: 443 });
      mocks.invoke
        .mockRejectedValueOnce(new Error('请求失败: connection refused'))
        .mockResolvedValueOnce({ status: 200, headers: {}, body: 'OK' });

      const resp = await secureHttp(dataReq);

      expect(disc.rediscoverOnFailure).toHaveBeenCalledWith('47.104.231.235');
      expect((mocks.invoke.mock.calls[0]?.[1] as { req: { url: string } }).req.url).toBe('https://47.104.231.235/api/x');
      expect((mocks.invoke.mock.calls[1]?.[1] as { req: { url: string } }).req.url).toBe('https://47.105.101.42/api/x');
      expect(resp.ok).toBe(true);
      expect(resp.status).toBe(200);
    });

    it('非数据面(无 direct_ip)连接失败 → 不触发轮换, 原样抛错', async () => {
      mocks.invoke.mockRejectedValue(new Error('boom'));
      await expect(secureHttp({ method: 'GET', url: 'https://ca.huanvae.cn/endpoints', pin_ca: false })).rejects.toThrow('boom');
      expect(disc.rediscoverOnFailure).not.toHaveBeenCalled();
    });

    it('轮换返回 null(全网不可达) → 不重发, 上抛原始连接错误', async () => {
      disc.rediscoverOnFailure.mockResolvedValue(null);
      mocks.invoke.mockRejectedValue(new Error('请求失败: all down'));
      await expect(secureHttp(dataReq)).rejects.toThrow('请求失败: all down');
      expect(mocks.invoke).toHaveBeenCalledTimes(1);
    });

    it('轮换返回同一 IP(未真正切换) → 不重发, 上抛原始错误', async () => {
      disc.rediscoverOnFailure.mockResolvedValue({ domain: 'api.huanvae.cn', ip: '47.104.231.235', port: 443 });
      mocks.invoke.mockRejectedValue(new Error('请求失败: same ip'));
      await expect(secureHttp(dataReq)).rejects.toThrow('请求失败: same ip');
      expect(mocks.invoke).toHaveBeenCalledTimes(1);
    });

    it('HTTP 状态错误(500, invoke 不抛)不触发轮换', async () => {
      mocks.invoke.mockResolvedValue({ status: 500, headers: {}, body: 'err' });
      const resp = await secureHttp(dataReq);
      expect(resp.ok).toBe(false);
      expect(resp.status).toBe(500);
      expect(disc.rediscoverOnFailure).not.toHaveBeenCalled();
    });
  });
});

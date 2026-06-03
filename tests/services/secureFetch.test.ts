import { describe, it, expect, vi, beforeEach } from 'vitest';

// invoke 走 Tauri 通道(plugin-http 同理), 真 fetch/page.route 拦不到 → mock invoke 单测
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

import { isOkStatus, secureHttp, rewriteUrlHost } from '../../src/services/secureFetch';

describe('secureFetch', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
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
});

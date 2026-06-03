import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  storeData: new Map<string, unknown>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
// 发现选定 active 后会调 secureProxy.setProxyTarget 同步反代目标;单测隔离为 no-op,不打真实 invoke
vi.mock('../../src/services/secureProxy', () => ({ setProxyTarget: vi.fn() }));
vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: vi.fn(() =>
      Promise.resolve({
        get: vi.fn((k: string) => Promise.resolve(mocks.storeData.get(k) ?? null)),
        set: vi.fn((k: string, v: unknown) => {
          mocks.storeData.set(k, v);
          return Promise.resolve();
        }),
        save: vi.fn(() => Promise.resolve()),
        delete: vi.fn((k: string) => {
          mocks.storeData.delete(k);
          return Promise.resolve();
        }),
        has: vi.fn((k: string) => Promise.resolve(mocks.storeData.has(k))),
      }),
    ),
  },
}));

import {
  orderCandidates,
  isFresh,
  fetchConfig,
  pickFastest,
  discoverEndpoints,
  getActiveEndpoint,
  resolveForSecureHttp,
  __resetForTest,
} from '../../src/services/discovery';
import type { DiscoveryConfig } from '../../src/services/discovery.types';

const IP1 = '47.105.101.42';
const IP2 = '47.104.231.235';
const CFG: DiscoveryConfig = {
  ips: [IP1, IP2],
  port: 443,
  domains: ['api.huanvae.cn', 'api.huanvae.com'],
  ca_pem: 'CA',
  ttl: 3600,
};
const CFG_BODY = JSON.stringify(CFG);

/** invoke 路由: /endpoints → 配置; https://<ip>:443/health → 仅 IP1 可达 */
function routeOnlyIp1Reachable(_cmd: string, args: { req: { url: string } }) {
  const url = args.req.url;
  if (url.includes('/endpoints')) {
    return Promise.resolve({ status: 200, headers: {}, body: CFG_BODY });
  }
  if (url.includes('/health')) {
    if (url.includes(IP1)) {
      return Promise.resolve({ status: 200, headers: {}, body: 'OK' });
    }
    return Promise.reject(new Error('unreachable'));
  }
  return Promise.reject(new Error(`unexpected url ${url}`));
}

describe('discovery', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.storeData.clear();
    __resetForTest();
  });

  describe('orderCandidates (pure)', () => {
    it('按上次延迟升序, 未知延迟排最后', () => {
      expect(orderCandidates(['a', 'b', 'c'], { b: 10, a: 50 })).toEqual(['b', 'a', 'c']);
    });
    it('exclude(刚失败 IP)放最后兜底而非剔除', () => {
      expect(orderCandidates(['a', 'b'], { a: 5, b: 1 }, 'b')).toEqual(['a', 'b']);
    });
  });

  describe('isFresh (pure)', () => {
    const cache = {
      ips: [],
      port: 443,
      domains: [],
      caPem: '',
      resolvedAt: 1000,
      ttlMs: 5000,
      active: null,
      perIpLatency: {},
    };
    it('ttl 内 = fresh', () => expect(isFresh(cache, 3000)).toBe(true));
    it('超 ttl = stale', () => expect(isFresh(cache, 7000)).toBe(false));
    it('null = 非 fresh', () => expect(isFresh(null, 0)).toBe(false));
  });

  describe('fetchConfig', () => {
    it('系统信任(pin_ca=false)拉 {ips,port,domains,ca_pem,ttl}', async () => {
      mocks.invoke.mockResolvedValue({ status: 200, headers: {}, body: CFG_BODY });
      const cfg = await fetchConfig();
      expect(cfg.ips).toEqual([IP1, IP2]);
      expect(cfg.port).toBe(443);
      expect(cfg.domains).toEqual(['api.huanvae.cn', 'api.huanvae.com']);
      expect(cfg.ca_pem).toBe('CA');
      expect(mocks.invoke).toHaveBeenCalledWith(
        'secure_http',
        expect.objectContaining({
          req: expect.objectContaining({
            pin_ca: false,
            url: expect.stringContaining('ca.huanvae.cn'),
          }),
        }),
      );
    });
    it('配置缺 ips 抛错', async () => {
      mocks.invoke.mockResolvedValue({
        status: 200,
        headers: {},
        body: '{"domains":["x"],"ca_pem":"x"}',
      });
      await expect(fetchConfig()).rejects.toThrow();
    });
    it('port 缺省回落 443', async () => {
      mocks.invoke.mockResolvedValue({
        status: 200,
        headers: {},
        body: JSON.stringify({ ips: [IP1], domains: ['d'], ca_pem: 'x', ttl: 60 }),
      });
      const cfg = await fetchConfig();
      expect(cfg.port).toBe(443);
    });
  });

  describe('pickFastest', () => {
    it('选可达 IP(仅 IP1 可达 → 选 IP1), domain 取稳定逻辑标签, 返回实测延迟', async () => {
      mocks.invoke.mockImplementation(routeOnlyIp1Reachable);
      const { active, perIpLatency } = await pickFastest(CFG);
      expect(active.ip).toBe(IP1);
      expect(active.port).toBe(443);
      expect(active.domain).toBe('api.huanvae.cn'); // domains[0] 稳定标签
      // 实测延迟随返回值带出(供调用方落缓存,首次发现 mem=null 也不丢)
      expect(perIpLatency[IP1]).toBeGreaterThanOrEqual(0);
    });
    it('全不可达抛错', async () => {
      mocks.invoke.mockRejectedValue(new Error('down'));
      await expect(pickFastest(CFG)).rejects.toThrow('均不可达');
    });
    it('探测打到 https://<ip>:port/health(IP 字面量, 非域名)', async () => {
      mocks.invoke.mockImplementation(routeOnlyIp1Reachable);
      await pickFastest(CFG);
      const healthUrls = mocks.invoke.mock.calls
        .map((c) => (c[1] as { req: { url: string } }).req.url)
        .filter((u) => u.includes('/health'));
      expect(healthUrls.some((u) => u.includes(`https://${IP1}`))).toBe(true);
      // 不应出现域名形式的探测 URL
      expect(healthUrls.some((u) => u.includes('huanvae.cn'))).toBe(false);
    });
  });

  describe('discoverEndpoints + active 读取', () => {
    it('拉配置 → 择优 → 缓存; getActiveEndpoint/resolveForSecureHttp 反映结果(direct_ip)', async () => {
      mocks.invoke.mockImplementation(routeOnlyIp1Reachable);
      const active = await discoverEndpoints();
      expect(active.ip).toBe(IP1);
      expect(active.domain).toBe('api.huanvae.cn');

      const ep = getActiveEndpoint();
      expect(ep?.ip).toBe(IP1);
      expect(ep?.domain).toBe('api.huanvae.cn');
      expect(ep?.caPem).toBe('CA');

      const resolve = resolveForSecureHttp();
      expect(resolve?.pin_ca).toBe(true);
      expect(resolve?.extra_ca_pem).toBe('CA');
      // 注入直连 IP/端口 → 调用层据此改写 URL 主机为 IP(不发 SNI)
      expect(resolve?.direct_ip).toBe(IP1);
      expect(resolve?.direct_port).toBe(443);
    });

    it('Worker(/endpoints)不可达 + 无缓存 → DEV 构建 fail-loud(抛错, 不退内置默认)', async () => {
      // vitest 即 import.meta.env.DEV=true → configOrFallback 在 Worker 不可达且无缓存时直接抛,
      // 确保测试真正走 ca.huanvae.cn 发现链路、不被硬编码默认静默掩盖(生产 PROD 才退 BUILT_IN_DEFAULTS)。
      mocks.invoke.mockImplementation((_cmd: string, args: { req: { url: string } }) => {
        const url = args.req.url;
        if (url.includes('/endpoints')) {
          return Promise.reject(new Error('worker down'));
        }
        return Promise.resolve({ status: 200, headers: {}, body: 'OK' });
      });
      await expect(discoverEndpoints()).rejects.toThrow(/fail-loud|不可达/);
      // 未落 active → resolveForSecureHttp 仍为 null
      expect(resolveForSecureHttp()).toBeNull();
    });
  });
});

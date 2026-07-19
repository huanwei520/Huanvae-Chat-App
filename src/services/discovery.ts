/**
 * 发现服务 —— App 启动/登录前经 CF Worker(ca.huanvae.cn)发现可直连的后端 IP + 私有 CA,
 * IP 间延迟择优,给出稳定逻辑域名(账号库 key)+ 直连 IP/端口(连接用)供 secureFetch / WS 直连源站。
 *
 * 流程:discoverEndpoints → fetchConfig(系统信任拉 {ips,port,domains,ca_pem,ttl})→ pickFastest(经
 * secure_http pin_ca 探测各 IP 的 https://<ip>:port/health,选最快可达)→ 缓存(内存 + discovery.json)。
 *
 * **连 IP 不连域名**:阿里云 ICP 备案拦截被动读明文 SNI;连 IP 字面量不发 SNI → 绕过(实测确认)。
 * 改写在 JS 层完成(resolveForSecureHttp 给出 direct_ip/direct_port,secureFetch/ai/RustWebSocket 改写 URL 主机)。
 * serverUrl 仍存**逻辑域名**(账号库 key / 数据目录命名用它,IP 漂移不丢历史)。
 * 设计见 DESIGN-app-discovery-selfsigned-tls.md。
 * @module services/discovery
 */

import { Store } from '@tauri-apps/plugin-store';
import { secureHttp, rewriteUrlHost } from './secureFetch';
import { setProxyTarget } from './secureProxy';
import { isE2E } from './e2eMode';
import type {
  ActiveEndpoint,
  DiscoveryCache,
  DiscoveryConfig,
  SecureHttpResolve,
} from './discovery.types';

const CA_ENDPOINT = 'https://ca.huanvae.cn/endpoints';
const STORE_FILE = 'discovery.json';
const CACHE_KEY = 'cache';

/**
 * 内置默认(发现入口 ca.huanvae.cn 不可达 + 无本地缓存时的最终兜底)。
 * ips/domains 与 CF Worker 的 DEFAULT_CONFIG 对齐;ca_pem 留空 —— secure_http pin_ca 用 Rust **内置**
 * 私有 CA 验证 leaf(SAN=IP),无需 extra_ca。故 App 不硬依赖 Worker 在线即可连后端(Worker 仅用于动态更新)。
 */
const BUILT_IN_DEFAULTS: DiscoveryConfig = {
  ips: ['47.105.101.42', '47.104.231.235'],
  port: 443,
  domains: ['api.huanvae.cn', 'api.huanvae.com'],
  ca_pem: '',
  ttl: 600,
};
/** edge nginx 各 server 块都有 `location = /health` → 200 "OK"(nginx 短路,不走后端) */
const PROBE_PATH = '/health';
const PROBE_TIMEOUT_SECS = 3;
const CONFIG_TIMEOUT_SECS = 8;

let mem: DiscoveryCache | null = null;
let storeInstance: Store | null = null;
/** 失败轮换的 single-flight:并发数据面失败共享同一次在途重发现,避免探测风暴 */
let rediscoverInFlight: Promise<ActiveEndpoint | null> | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load(STORE_FILE);
  }
  return storeInstance;
}

async function loadCache(): Promise<DiscoveryCache | null> {
  if (mem) {
    return mem;
  }
  try {
    const store = await getStore();
    const cached = await store.get<DiscoveryCache>(CACHE_KEY);
    if (cached) {
      mem = cached;
    }
    return mem;
  } catch {
    return null;
  }
}

async function saveCache(cache: DiscoveryCache): Promise<void> {
  mem = cache;
  try {
    const store = await getStore();
    await store.set(CACHE_KEY, cache);
    await store.save();
  } catch {
    // 持久化失败不致命:内存缓存仍有效,下次启动重新发现
  }
}

/** 缓存是否在 ttl 内(纯函数,便于单测) */
export function isFresh(cache: DiscoveryCache | null, now: number): cache is DiscoveryCache {
  return !!cache && now - cache.resolvedAt < cache.ttlMs;
}

/**
 * 候选 IP 排序:上次延迟小的优先(冷启动加速);exclude(刚失败的 IP)放到最后兜底,不直接剔除。
 * 纯函数,便于单测。
 */
export function orderCandidates(
  ips: string[],
  latency: Record<string, number>,
  exclude?: string,
): string[] {
  const head = ips
    .filter((ip) => ip !== exclude)
    .sort((a, b) => (latency[a] ?? Number.POSITIVE_INFINITY) - (latency[b] ?? Number.POSITIVE_INFINITY));
  const tail = exclude && ips.includes(exclude) ? [exclude] : [];
  return [...head, ...tail];
}

/** 从 CF Worker(系统信任 = CF 真证书)拉发现配置 */
export async function fetchConfig(): Promise<DiscoveryConfig> {
  const resp = await secureHttp({
    method: 'GET',
    url: CA_ENDPOINT,
    pin_ca: false,
    timeout_secs: CONFIG_TIMEOUT_SECS,
  });
  if (!resp.ok) {
    throw new Error(`discovery ${CA_ENDPOINT} -> HTTP ${resp.status}`);
  }
  const cfg = resp.json<DiscoveryConfig>();
  if (!cfg.ips?.length || !cfg.domains?.length) {
    throw new Error('discovery config 缺 ips/domains');
  }
  return { ...cfg, port: cfg.port || 443 };
}

/**
 * 配置获取兜底链:CF Worker → 上次缓存(过期也用)→ 内置默认。
 *
 * **DEV 构建 fail-loud**:开发/测试构建(`import.meta.env.DEV`,含 `tauri dev` 与 vitest)下,
 * 若 Worker 不可达**且**无缓存,直接抛错而非退内置默认 —— 确保测试真正走 ca.huanvae.cn 发现链路
 * (取域名/轮换 CA/解析 IP),不被硬编码默认静默掩盖(否则测不出 Worker/证书轮换是否真的工作)。
 * 生产构建(`PROD`)仍保留内置默认兜底:Worker 故障时也能连(IP 仍需 pickFastest 探测可达才算可用)。
 */
async function configOrFallback(): Promise<DiscoveryConfig> {
  try {
    return await fetchConfig();
  } catch (e) {
    if (mem) {
      return {
        ips: mem.ips,
        port: mem.port,
        domains: mem.domains,
        ca_pem: mem.caPem,
        ttl: Math.floor(mem.ttlMs / 1000),
      };
    }
    if (import.meta.env.DEV) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(
        `[discovery] CF Worker(ca.huanvae.cn) 不可达且无缓存 — DEV 构建 fail-loud(不退内置默认),确保测试走真实发现链路: ${detail}`,
      );
    }
    return BUILT_IN_DEFAULTS;
  }
}

/**
 * 探测一个 IP 的 https://<ip>:port/health 延迟(经 secure_http pin_ca,验"能直连 + leaf 链验通")。
 * IP 字面量 URL → reqwest 不发 SNI;leaf SAN=IP 由内置私有 CA 验证。返回 ms;不可达/非 2xx 返回 null。
 */
async function probe(ip: string, port: number, caPem: string): Promise<number | null> {
  const start = Date.now();
  try {
    const resp = await secureHttp({
      method: 'GET',
      url: `https://${ip}:${port}${PROBE_PATH}`,
      pin_ca: true,
      extra_ca_pem: caPem || null,
      timeout_secs: PROBE_TIMEOUT_SECS,
    });
    return resp.ok ? Date.now() - start : null;
  } catch {
    return null;
  }
}

/**
 * 并行探测所有 IP,选延迟最小且可达的;全不可达抛错。active.domain 取稳定逻辑标签 cfg.domains[0]。
 * 返回 { active, perIpLatency }:把本轮实测延迟一并返回供调用方落缓存(首次发现时 mem 仍为 null,
 * 不能靠写 mem 留存,否则冷启动延迟排序优化永远是空的)。
 */
export async function pickFastest(
  cfg: DiscoveryConfig,
  excludeIp?: string,
): Promise<{ active: ActiveEndpoint; perIpLatency: Record<string, number> }> {
  const candidates = orderCandidates(cfg.ips, mem?.perIpLatency ?? {}, excludeIp);
  const probed = await Promise.allSettled(
    candidates.map((ip) => probe(ip, cfg.port, cfg.ca_pem).then((ms) => ({ ip, ms }))),
  );

  const perIpLatency: Record<string, number> = { ...(mem?.perIpLatency ?? {}) };
  let best: { ip: string; ms: number } | null = null;
  for (const r of probed) {
    if (r.status === 'fulfilled' && r.value.ms !== null) {
      perIpLatency[r.value.ip] = r.value.ms;
      if (!best || r.value.ms < best.ms) {
        best = { ip: r.value.ip, ms: r.value.ms };
      }
    }
  }
  if (!best) {
    throw new Error('所有发现 IP 均不可达');
  }
  return { active: { domain: cfg.domains[0], ip: best.ip, port: cfg.port }, perIpLatency };
}

/**
 * 发现入口:缓存命中(未过期且有 active)直接返回,否则拉配置 + 择优 + 落缓存。
 * 拉配置失败时退化用上次缓存(过期也用);都没有则 fail-loud(去输入框后无手填兜底)。
 */
export async function discoverEndpoints(opts?: { force?: boolean; excludeIp?: string }): Promise<ActiveEndpoint> {
  const cached = await loadCache();
  if (!opts?.force && isFresh(cached, Date.now()) && cached.active) {
    await syncProxyTarget(cached.active);
    return cached.active;
  }

  const cfg = await configOrFallback();
  const { active, perIpLatency } = await pickFastest(cfg, opts?.excludeIp);
  await saveCache({
    ips: cfg.ips,
    port: cfg.port,
    domains: cfg.domains,
    caPem: cfg.ca_pem,
    resolvedAt: Date.now(),
    ttlMs: cfg.ttl * 1000,
    active,
    perIpLatency,
  });
  await syncProxyTarget(active);
  return active;
}

/**
 * 数据面失败时的端点轮换(自愈):当前 active(=failedIp)判定不可用 → 强制重发现、把 failedIp 降级到候选末位,
 * 选出新的可达 active 并更新缓存 + 反代目标。让 App 在节点下线时自愈,**不依赖发现池是否已摘掉死节点**
 * (发现池仍列死 IP 也无碍:pickFastest 探测跳过不可达者)。由 WebSocketContext 重连路径在多次重连失败后触发。
 *
 * - **并发去重**:多个数据面失败(WS + HTTP)同时上报 → 共享同一次在途重发现(single-flight),避免探测风暴。
 * - **幂等守卫**:failedIp 已不是当前 active(其他失败已把它轮换掉)→ 直接返回当前 active,不重复探测。
 * - **全不可达**:pickFastest 抛错 → 返回 null(不抛;调用方靠既有指数退避继续重试),active 保持不变。
 */
export function rediscoverOnFailure(failedIp: string): Promise<ActiveEndpoint | null> {
  const current = mem?.active ?? null;
  // 当前 active 已非 failedIp(已被其他失败轮换掉)→ 无需重探,直接返回现值
  if (!current || current.ip !== failedIp) {
    return Promise.resolve(current);
  }
  if (rediscoverInFlight) {
    return rediscoverInFlight;
  }
  // 强制重发现并把 failedIp 降级;全不可达 → null(不抛,调用方靠既有退避重试);无论成败重置在途标记
  rediscoverInFlight = discoverEndpoints({ force: true, excludeIp: failedIp })
    .catch(() => null)
    .finally(() => {
      rediscoverInFlight = null;
    });
  return rediscoverInFlight;
}

/**
 * 把当前 active 端点同步给回环安全反代(secure_proxy):webview 原生加载(头像 <img>/图片/上传 XHR)
 * 经 http://127.0.0.1:<port> 走此反代,反代再连源站 IP(钉 CA、不发 SNI)、转发时 Host 设逻辑域名
 * (兼容 presigned 按 Host 签名)。proxy 未启动也无碍——target 只是写入静态变量。
 */
async function syncProxyTarget(active: ActiveEndpoint): Promise<void> {
  await setProxyTarget(active.ip, active.port, active.domain);
}

/** 当前已择优端点(含 CA PEM),供 secureFetch 同步读取拼注入参数;未发现返回 null */
export function getActiveEndpoint(): (ActiveEndpoint & { caPem: string }) | null {
  if (!mem?.active) {
    return null;
  }
  return { ...mem.active, caPem: mem.caPem };
}

/**
 * 给 secureFetch / WS 的数据面注入参数(pin_ca + 可选 extra_ca + 直连 IP/端口)。未发现返回 null。
 * direct_ip/direct_port → 调用层把 URL 主机改写为该 IP(IP 字面量=不发 SNI),leaf SAN=IP 由内置 CA 验证。
 */
export function resolveForSecureHttp(): SecureHttpResolve | null {
  if (isE2E()) {
    // e2e：无发现面/直连 IP 改写，serverUrl 即本地集群基址，原样直连
    return null;
  }
  const active = getActiveEndpoint();
  if (!active) {
    return null;
  }
  const resolve: SecureHttpResolve = {
    pin_ca: true,
    direct_ip: active.ip,
    direct_port: active.port,
  };
  if (active.caPem) {
    resolve.extra_ca_pem = active.caPem;
  }
  return resolve;
}

/**
 * 把数据面 URL 的主机改写为当前 active 源站 IP —— 供 **Rust 侧直连源站下载**命令
 * (download_and_save_file / update_account_avatar)使用:连 IP 字面量(不发 SNI 绕 ICP),
 * leaf 由内置私有 CA 验、不验主机名。无 active 或非 http(s) URL → 原样返回。
 */
export function directIpUrl(url: string): string {
  const active = getActiveEndpoint();
  if (!active || !(url.startsWith('http://') || url.startsWith('https://'))) {
    return url;
  }
  return rewriteUrlHost(url, active.ip, active.port);
}

/** 测试用:重置内存缓存 + store 句柄(prod 不调用) */
export function __resetForTest(): void {
  mem = null;
  storeInstance = null;
  rediscoverInFlight = null;
}

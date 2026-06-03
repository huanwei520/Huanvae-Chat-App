/**
 * 发现服务类型 —— App 经 CF Worker(ca.huanvae.cn)发现可直连的后端 IP + 私有 CA,
 * IP 间择最快后**直连 `https://<ip>:port`**(IP 字面量=不发 SNI),用内置私有 CA 验证 leaf(SAN=IP)。
 *
 * 为何连 IP 而非域名:阿里云 ICP 备案拦截是**被动读 TLS ClientHello 的明文 SNI**;连 IP 字面量
 * 不发 SNI → 无域名可判 → 绕过拦截(实测确认)。leaf SAN=IP、无域名 → 连主动扫描也无据。
 *
 * 设计见工作区 DESIGN-app-discovery-selfsigned-tls.md。
 * @module services/discovery.types
 */

/** CF Worker `GET https://ca.huanvae.cn/endpoints` 返回的发现配置 */
export interface DiscoveryConfig {
  /** 可直连的后端源站 IP 集(同一私有 CA 签 leaf,IP 间择最快)。App 连 https://<ip>:port,不发 SNI。 */
  ips: string[];
  /** 数据面端口(默认 443) */
  port: number;
  /** 逻辑域名集 —— 仅作账号库 (server_url,user_id) key / 本地数据目录稳定标签,IP 漂移不裂账号。不用于连接。 */
  domains: string[];
  /** 私有根 CA 公钥 PEM(App 内置一份硬锚兜底;此处下发供轮换重叠期叠加信任) */
  ca_pem: string;
  /** 缓存有效期(秒) */
  ttl: number;
}

/** 已择优的运行时端点 */
export interface ActiveEndpoint {
  /**
   * 逻辑域名(稳定标识)—— 账号库 (server_url,user_id) key、本地数据目录命名都用它,
   * 物理 IP 漂移不丢历史、不裂账号。如 "api.huanvae.cn"。
   */
  domain: string;
  /** 择优后的直连源站 IP。连接 = `https://<ip>:<port>`(IP 字面量=不发 SNI)。 */
  ip: string;
  /** 数据面端口。 */
  port: number;
}

/** 本地缓存(内存 + tauri-plugin-store discovery.json) */
export interface DiscoveryCache {
  ips: string[];
  port: number;
  domains: string[];
  caPem: string;
  /** 上次成功发现的时刻(epoch ms) */
  resolvedAt: number;
  /** ttl 毫秒 */
  ttlMs: number;
  /** 已择优端点 */
  active: ActiveEndpoint | null;
  /** 各 IP 上次探测延迟(ms),供冷启动快速排序 */
  perIpLatency: Record<string, number>;
}

/**
 * 数据面 secure_http / WS 注入参数。
 *
 * `direct_ip`/`direct_port`:把请求(或 WS)URL 的主机改写为该 IP(IP 字面量 → reqwest/rustls
 * **不发 SNI**),leaf SAN=IP 由内置私有 CA 验证。不发 SNI → 绕阿里云 ICP 的 SNI 拦截。
 * 改写在 JS 层(secureFetch / ai.ts / RustWebSocket)完成,Rust(secure_net/ws_proxy)收到的就是 IP URL。
 */
export interface SecureHttpResolve {
  pin_ca: boolean;
  extra_ca_pem?: string;
  /** 直连 IP(改写 URL 主机用) */
  direct_ip?: string;
  /** 直连端口 */
  direct_port?: number;
}

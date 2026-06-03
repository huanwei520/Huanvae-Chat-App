/**
 * secureFetch —— `invoke('secure_http')` 的统一适配层。
 *
 * 把 Rust 侧 secure_http 命令(reqwest + rustls 自管 TLS + 内置私有 CA 硬锚 + 可选
 * resolve 直连源站 IP)适配成 `@tauri-apps/plugin-http` fetch 的 Response-like 形态,
 * 供 client.ts / auth.ts / lowcode / huanvaeGuard 等现有封装迁移时复用(解包逻辑各自保留)。
 *
 * 设计见工作区 DESIGN-app-discovery-selfsigned-tls.md。
 * @module services/secureFetch
 */

import { invoke } from '@tauri-apps/api/core';

/** 对齐 src-tauri/src/secure_net.rs 的 SecureHttpReq(字段 snake_case) */
export interface SecureHttpReq {
  method: string;
  url: string;
  headers?: Record<string, string>;
  /** 请求体(文本/JSON 字符串;已 stringify,勿二次序列化)。无则省略 */
  body?: string | null;
  /** true = 只信内置私有 CA(+extra_ca);数据面用。false = 系统信任(发现面 ca.huanvae.cn CF 真证书) */
  pin_ca: boolean;
  /** 轮换重叠期叠加信任的额外 CA PEM(稳态可省,内置 CA 已硬锚) */
  extra_ca_pem?: string | null;
  timeout_secs?: number | null;
}

/** 对齐 secure_net.rs 的 SecureHttpResp */
export interface SecureHttpResp {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** plugin-http fetch 消费方迁移用的 Response-like */
export interface SecureResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
  json: <T = unknown>() => T;
  text: () => string;
}

/** 2xx 判定(纯函数,便于单测) */
export function isOkStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * 把 URL 的主机改写为直连 IP:port。IP 字面量 → reqwest/rustls **不发 SNI** → 绕阿里云 ICP 的 SNI 拦截;
 * leaf SAN=IP 由内置私有 CA 验证(host=IP 与 SAN=IP 匹配)。纯函数,便于单测。
 * https 默认端口 443 会被 URL 省略(等价直连 IP:443),非标端口保留。
 */
export function rewriteUrlHost(url: string, ip: string, port: number): string {
  const u = new URL(url);
  u.hostname = ip;
  u.port = String(port);
  return u.toString();
}

/**
 * 经 Rust secure_http 命令发请求。
 *
 * `direct_ip`/`direct_port`(来自 discovery.resolveForSecureHttp):把 url 主机改写为该 IP 再发,
 * 即直连源站 IP、不发 SNI(数据面绕 ICP)。发现面(ca.huanvae.cn,pin_ca=false)与 probe(已是 IP URL)
 * 不带 direct_ip → 不改写。direct_* 为 JS 层消费,不下发 Rust。
 *
 * 注意:secure_http 一次性收完 body(无流式),故不适用 SSE / 大流式下载;
 * 二进制 body 暂未支持(见 secure_net.rs)。这些场景仍走各自专用通道。
 */
export async function secureHttp(
  req: SecureHttpReq & { direct_ip?: string; direct_port?: number },
): Promise<SecureResponse> {
  const { direct_ip, direct_port, ...rest } = req;
  const finalReq: SecureHttpReq =
    direct_ip && direct_port
      ? { ...rest, url: rewriteUrlHost(rest.url, direct_ip, direct_port) }
      : rest;
  const resp = await invoke<SecureHttpResp>('secure_http', { req: finalReq });
  return {
    status: resp.status,
    ok: isOkStatus(resp.status),
    headers: resp.headers ?? {},
    body: resp.body,
    json: <T = unknown>() => JSON.parse(resp.body) as T,
    text: () => resp.body,
  };
}

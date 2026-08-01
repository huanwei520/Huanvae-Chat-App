/**
 * 本机 HuanvaeGuard Windows Service API 调用 (http://127.0.0.1:19198)
 *
 * - **刻意保留 plugin-http(不迁 secure_http)**：本路径是**回环明文 http**(127.0.0.1)，
 *   既无 TLS(故无需 secure_net 的内置 CA 自管 TLS)、也非后端数据面调用(api.huanvae.cn)，
 *   不在"自签 TLS 直连数据面"迁移范围内。plugin-http 在此的作用是绕开浏览器 CORS
 *   （svc 不返回 CORS 头；dev 模式前端 origin 是 http://localhost:1420）。
 *   未来即便加鉴权(HMAC/Token)也是 header 注入，仍走 plugin-http，无需迁移。
 * - 无鉴权 —— 服务仅监听回环地址。未来 P0 计划中会加 HMAC 或 Token
 * - svc 自身由 Tauri 进程生命周期控制（见 src-tauri/src/desktop/huanvaeguard.rs）
 *
 * 函数一览：
 *   getStatus            GET  /api/tunnel/status    获取隧道状态 + peer 明细（兼作探活）
 *   startTunnel          POST /api/tunnel/start     建立 WireGuard 隧道
 *   stopTunnel           POST /api/tunnel/stop      关闭隧道
 */

import { fetch } from '@tauri-apps/plugin-http';
import type { ApiResponse, TunnelStatus, PeerConfig, ObfuscationParams } from './types';

const LOCAL_BASE = 'http://127.0.0.1:19198';

type FetchInit = Parameters<typeof fetch>[1];

/**
 * 单次本机请求的超时上限（ms）。
 *
 * 取值依据：守护进程侧的状态查询在最坏情况下可能耗时数秒（其内部需等待一次关停完成），
 * 即一次状态查询**本来就可能耗时数秒**，上限必须高于该量级，才不会把合法慢响应
 * 误判成"服务没起"。
 * 另一方面又必须有上限：守护进程"在监听但不应答"时（半死态）裸 fetch 的 promise 永不落地，
 * 调用方的 finally 也就永远不执行（按钮永久卡在 loading）。8 秒是二者之间的取值。
 */
export const LOCAL_TIMEOUT_MS = 8000;

async function localFetch<T>(path: string, init?: FetchInit): Promise<ApiResponse<T>> {
  // plugin-http 的 fetch 遵循 init.signal：发请求前检查 aborted、并在 signal 上挂 abort
  // 监听器调 plugin:http|fetch_cancel 真正取消 Rust 侧请求（见 node_modules/@tauri-apps/
  // plugin-http/dist-js/index.js 的 46 / 88 / 104-113 / 151 行），故这里的超时是真取消，
  // 不是"只丢结果、请求还在后台跑"。
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, LOCAL_TIMEOUT_MS);
  try {
    const resp = await fetch(`${LOCAL_BASE}${path}`, { ...init, signal: controller.signal });
    const parsed = await resp.json().catch(
      () => ({ success: false, error: `HTTP ${resp.status}` }) as ApiResponse<T>,
    );
    return parsed;
  } finally {
    // 无论正常返回、解析失败还是超时/异常，都要拆掉定时器，避免留下悬挂的 abort 计时
    clearTimeout(timer);
  }
}

export function getStatus(): Promise<ApiResponse<TunnelStatus>> {
  return localFetch('/api/tunnel/status');
}

export function startTunnel(params: {
  address: string;
  private_key: string;
  peers: PeerConfig[];
  obfuscation: ObfuscationParams;
  dns?: string;
  mtu?: number;
}): Promise<ApiResponse<void>> {
  return localFetch('/api/tunnel/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export function stopTunnel(): Promise<ApiResponse<void>> {
  return localFetch('/api/tunnel/stop', { method: 'POST' });
}

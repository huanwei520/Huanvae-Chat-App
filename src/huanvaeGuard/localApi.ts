/**
 * 本机 HuanvaeGuard Windows Service API 调用 (http://127.0.0.1:19198)
 *
 * - 走 @tauri-apps/plugin-http 的 fetch，绕开浏览器 CORS
 *   （svc 不返回 CORS 头；dev 模式前端 origin 是 http://localhost:1420）
 * - 无鉴权 —— 服务仅监听回环地址。未来 P0 计划中会加 HMAC 或 Token
 * - svc 自身由 Tauri 进程生命周期控制（见 src-tauri/src/desktop/huanvaeguard.rs）
 *
 * 函数一览：
 *   checkServiceRunning  GET  /api/tunnel/status    探测服务是否监听
 *   getStatus            GET  /api/tunnel/status    获取隧道状态 + peer 明细
 *   startTunnel          POST /api/tunnel/start     建立 WireGuard 隧道
 *   stopTunnel           POST /api/tunnel/stop      关闭隧道
 *   updatePeers          POST /api/tunnel/peers     替换/增量修改 peers
 */

import { fetch } from '@tauri-apps/plugin-http';
import type { ApiResponse, TunnelStatus, PeerConfig, ObfuscationParams } from './types';

const LOCAL_BASE = 'http://127.0.0.1:19198';

type FetchInit = Parameters<typeof fetch>[1];

async function localFetch<T>(path: string, init?: FetchInit): Promise<ApiResponse<T>> {
  const resp = await fetch(`${LOCAL_BASE}${path}`, init);
  return resp.json().catch(() => ({ success: false, error: `HTTP ${resp.status}` }) as ApiResponse<T>);
}

export async function checkServiceRunning(): Promise<boolean> {
  try {
    const r = await localFetch<TunnelStatus>('/api/tunnel/status');
    return r.success;
  } catch {
    return false;
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

export function updatePeers(peers: PeerConfig[], replace = true): Promise<ApiResponse<void>> {
  return localFetch('/api/tunnel/peers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ peers, replace_peers: replace }),
  });
}

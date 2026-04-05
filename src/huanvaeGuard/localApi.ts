/**
 * localhost:19198 Windows Service API 调用
 *
 * 使用 @tauri-apps/plugin-http 的 fetch 绕过 CORS 限制
 * （Tauri WebView origin 为 http://tauri.localhost，
 *  浏览器原生 fetch 会被 huanvaeguard-svc 的 CORS 策略拦截）
 * startTunnel 包含 Named Pipe 冲突自动重试（3 次 / 2s 间隔）
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { ApiResponse, TunnelStatus, PeerConfig, ObfuscationParams } from './types';

const LOCAL_BASE = 'http://127.0.0.1:19198';

async function localFetch<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const resp = await tauriFetch(`${LOCAL_BASE}${path}`, init);
  return resp.json() as Promise<ApiResponse<T>>;
}

export async function checkServiceRunning(): Promise<boolean> {
  try {
    const r = await localFetch<TunnelStatus>('/api/tunnel/status');
    return r.success;
  } catch {
    return false;
  }
}

export async function getStatus(): Promise<ApiResponse<TunnelStatus>> {
  return localFetch('/api/tunnel/status');
}

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export async function startTunnel(params: {
  address: string;
  private_key: string;
  peers: PeerConfig[];
  obfuscation: ObfuscationParams;
  dns?: string;
  mtu?: number;
}): Promise<ApiResponse<void>> {
  const body = JSON.stringify(params);
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  };

  const maxRetries = 5;
  const baseDelay = 3000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const r = await localFetch<void>('/api/tunnel/start', init);
    if (r.success) return r;

    const err = r.error ?? '';
    const isPipeConflict = err.includes('231') || err.includes('pipe') || err.includes('管道')
      || err.includes('device') || err.includes('adapter');
    if (!isPipeConflict || attempt >= maxRetries) return r;

    await delay(baseDelay + attempt * 1000);
  }

  return { success: false, error: 'Max retries exceeded' };
}

export async function stopTunnel(): Promise<ApiResponse<void>> {
  return localFetch('/api/tunnel/stop', { method: 'POST' });
}

export async function updatePeers(peers: PeerConfig[], replace = true): Promise<ApiResponse<void>> {
  return localFetch('/api/tunnel/peers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ peers, replace_peers: replace }),
  });
}

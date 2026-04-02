/** localhost:19198 Windows Service API 调用 */

import type { ApiResponse, TunnelStatus, PeerConfig, ObfuscationParams } from './types';

const LOCAL_BASE = 'http://127.0.0.1:19198';

async function localFetch<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const resp = await fetch(`${LOCAL_BASE}${path}`, init);
  return resp.json();
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

export async function startTunnel(params: {
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

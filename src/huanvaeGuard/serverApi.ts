/** 服务端 HuanvaeGuard API 调用 */

import type { HgClientConfig, DeviceRegisterResponse, HgDevice } from './types';

interface ServerApiResponse<T> {
  success: boolean;
  code: number;
  data: T;
}

async function serverFetch<T>(
  serverUrl: string,
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const resp = await fetch(`${serverUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  const json: ServerApiResponse<T> = await resp.json();
  if (!json.success) throw new Error(`API error: ${json.code}`);
  return json.data;
}

export async function registerDevice(
  serverUrl: string,
  token: string,
  deviceName: string,
  publicKey: string,
  os?: string,
): Promise<DeviceRegisterResponse> {
  return serverFetch(serverUrl, '/api/hg/devices/register', token, {
    method: 'POST',
    body: JSON.stringify({ device_name: deviceName, public_key: publicKey, os }),
  });
}

export async function getDevices(serverUrl: string, token: string): Promise<HgDevice[]> {
  return serverFetch(serverUrl, '/api/hg/devices', token);
}

export async function getDeviceConfig(
  serverUrl: string,
  token: string,
  deviceId: string,
): Promise<HgClientConfig> {
  return serverFetch(serverUrl, `/api/hg/devices/${deviceId}/config`, token);
}

export async function deleteDevice(
  serverUrl: string,
  token: string,
  deviceId: string,
): Promise<void> {
  return serverFetch(serverUrl, `/api/hg/devices/${deviceId}`, token, { method: 'DELETE' });
}

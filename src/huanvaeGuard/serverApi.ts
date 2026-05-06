/**
 * 服务端 HuanvaeGuard API 调用
 *
 * - 走 @tauri-apps/plugin-http 的 fetch，绕开浏览器 CORS
 *   （svc 和远端服务器都不会回 Access-Control-Allow-Origin）
 * - Token 由调用方传入（目前从 HuanvaeGuardPage.windowData 取，经 Tauri 事件同步）
 * - 返回包格式：{ success, code, data, error? } —— 统一由 serverFetch 解包到 data
 * - 后端为独立仓库，本仓仅消费 JSON，字段语义以后端文档为准
 */

import { fetch } from '@tauri-apps/plugin-http';
import type {
  HgClientConfig,
  DeviceRegisterResponse,
  DeviceTopology,
  HgDevice,
  HgDeviceLink,
  CreateLinkInviteResponse,
  AcceptLinkInviteResponse,
  HgGroup,
  GroupDetail,
  CreateGroupResponse,
  JoinGroupResponse,
} from './types';

interface ServerApiResponse<T> {
  success: boolean;
  code: number;
  data: T;
  error?: string;
  message?: string;
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
  const json: ServerApiResponse<T> = await resp.json().catch(() => ({
    success: false, code: resp.status, data: null as T,
  }));
  if (!resp.ok || !json.success) {
    throw new Error(json.error ?? json.message ?? `HTTP ${resp.status}`);
  }
  return json.data;
}

// ─── Devices ───

export async function registerDevice(
  serverUrl: string,
  token: string,
  deviceName: string,
  os?: string,
  deviceFingerprint?: string,
  preferredRegion?: string,
): Promise<DeviceRegisterResponse> {
  return serverFetch(serverUrl, '/api/hg/devices/register', token, {
    method: 'POST',
    body: JSON.stringify({
      device_name: deviceName,
      os,
      device_fingerprint: deviceFingerprint,
      preferred_region: preferredRegion,
    }),
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

export async function getTopology(
  serverUrl: string,
  token: string,
  deviceId: string,
  since?: number,
): Promise<DeviceTopology> {
  const qs = since != null ? `?since=${since}` : '';
  return serverFetch(serverUrl, `/api/hg/devices/${deviceId}/topology${qs}`, token);
}

export async function lockDevice(
  serverUrl: string,
  token: string,
  deviceId: string,
  endpoint: string,
): Promise<void> {
  return serverFetch(serverUrl, `/api/hg/devices/${deviceId}/lock`, token, {
    method: 'POST',
    body: JSON.stringify({ endpoint }),
  });
}

export async function unlockDevice(
  serverUrl: string,
  token: string,
  deviceId: string,
): Promise<void> {
  return serverFetch(serverUrl, `/api/hg/devices/${deviceId}/unlock`, token, {
    method: 'POST',
  });
}

export async function deleteDevice(
  serverUrl: string,
  token: string,
  deviceId: string,
): Promise<void> {
  return serverFetch(serverUrl, `/api/hg/devices/${deviceId}`, token, { method: 'DELETE' });
}

// ─── Links ───

export async function createLinkInvite(
  serverUrl: string,
  token: string,
  fromDevice: string,
): Promise<CreateLinkInviteResponse> {
  return serverFetch(serverUrl, '/api/hg/links/invite', token, {
    method: 'POST',
    body: JSON.stringify({ from_device: fromDevice }),
  });
}

export async function acceptLinkInvite(
  serverUrl: string,
  token: string,
  inviteToken: string,
  deviceId: string,
): Promise<AcceptLinkInviteResponse> {
  return serverFetch(serverUrl, '/api/hg/links/invite/accept', token, {
    method: 'POST',
    body: JSON.stringify({ invite_token: inviteToken, device_id: deviceId }),
  });
}

export async function listLinks(serverUrl: string, token: string): Promise<HgDeviceLink[]> {
  return serverFetch(serverUrl, '/api/hg/links', token);
}

export async function deleteLink(
  serverUrl: string,
  token: string,
  linkId: string,
): Promise<void> {
  return serverFetch(serverUrl, `/api/hg/links/${linkId}`, token, { method: 'DELETE' });
}

// ─── Groups ───

export async function createGroup(
  serverUrl: string,
  token: string,
  name: string,
  description?: string,
  maxDevices?: number,
): Promise<CreateGroupResponse> {
  return serverFetch(serverUrl, '/api/hg/groups', token, {
    method: 'POST',
    body: JSON.stringify({ name, description, max_devices: maxDevices }),
  });
}

export async function listGroups(serverUrl: string, token: string): Promise<HgGroup[]> {
  return serverFetch(serverUrl, '/api/hg/groups', token);
}

export async function getGroupDetail(
  serverUrl: string,
  token: string,
  groupId: string,
): Promise<GroupDetail> {
  return serverFetch(serverUrl, `/api/hg/groups/${groupId}`, token);
}

export async function joinGroup(
  serverUrl: string,
  token: string,
  groupId: string,
  deviceId: string,
): Promise<JoinGroupResponse> {
  return serverFetch(serverUrl, `/api/hg/groups/${groupId}/join`, token, {
    method: 'POST',
    body: JSON.stringify({ device_id: deviceId }),
  });
}

export async function leaveGroup(
  serverUrl: string,
  token: string,
  groupId: string,
  deviceId: string,
): Promise<void> {
  return serverFetch(serverUrl, `/api/hg/groups/${groupId}/leave/${deviceId}`, token, {
    method: 'DELETE',
  });
}

export async function toggleGroup(
  serverUrl: string,
  token: string,
  groupId: string,
): Promise<boolean> {
  return serverFetch(serverUrl, `/api/hg/groups/${groupId}/toggle`, token, {
    method: 'POST',
  });
}

export async function deleteGroup(
  serverUrl: string,
  token: string,
  groupId: string,
): Promise<void> {
  return serverFetch(serverUrl, `/api/hg/groups/${groupId}`, token, { method: 'DELETE' });
}

export async function createGroupInvite(
  serverUrl: string,
  token: string,
  groupId: string,
): Promise<CreateLinkInviteResponse> {
  return serverFetch(serverUrl, `/api/hg/groups/${groupId}/invite`, token, {
    method: 'POST',
  });
}

export async function acceptGroupInvite(
  serverUrl: string,
  token: string,
  groupId: string,
  inviteToken: string,
  deviceId: string,
): Promise<JoinGroupResponse> {
  return serverFetch(serverUrl, `/api/hg/groups/${groupId}/invite/accept`, token, {
    method: 'POST',
    body: JSON.stringify({ invite_token: inviteToken, device_id: deviceId }),
  });
}

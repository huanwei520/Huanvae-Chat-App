/**
 * 服务端 HuanvaeGuard API 调用
 *
 * - 走 Rust secure_http(secureFetch),自管 TLS / 内置私有 CA / 可直连源站 IP,
 *   同时绕开浏览器 CORS（svc 和远端服务器都不会回 Access-Control-Allow-Origin）
 * - Token 由调用方传入（目前从 HuanvaeGuardPage.windowData 取，经 Tauri 事件同步）
 * - 返回包格式：{ success, code, data, error? } —— 统一由 serverFetch 解包到 data
 * - 后端为独立仓库，本仓仅消费 JSON，字段语义以后端文档为准
 */

import { secureHttp } from '../services/secureFetch';
import { resolveForSecureHttp } from '../services/discovery';
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

/** serverFetch 的最小请求选项(对齐迁移前 plugin-http FetchInit 用到的子集) */
interface FetchInit {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

async function serverFetch<T>(
  serverUrl: string,
  path: string,
  token: string,
  init?: FetchInit,
): Promise<T> {
  // 用户 VPN master 的 /api/hg/* 属数据面 → 经 Rust secure_http(自签 + 内置 CA;
  // 子窗口内 resolveForSecureHttp 为 null 时退化 pin_ca,内置 CA 仍验通自签 leaf)。
  const resp = await secureHttp({
    method: init?.method ?? 'GET',
    url: `${serverUrl}${path}`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
    body: init?.body ?? null,
    ...(resolveForSecureHttp() ?? { pin_ca: true }),
  });
  let json: ServerApiResponse<T>;
  try {
    json = resp.body
      ? resp.json<ServerApiResponse<T>>()
      : { success: false, code: resp.status, data: null as T };
  } catch {
    json = { success: false, code: resp.status, data: null as T };
  }
  if (!resp.ok || !json.success) {
    throw new Error(json.error ?? json.message ?? `HTTP ${resp.status}`);
  }
  return json.data;
}

// ─── Devices ───

export function registerDevice(
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

export function getDevices(serverUrl: string, token: string): Promise<HgDevice[]> {
  return serverFetch(serverUrl, '/api/hg/devices', token);
}

export function getDeviceConfig(
  serverUrl: string,
  token: string,
  deviceId: string,
): Promise<HgClientConfig> {
  return serverFetch(serverUrl, `/api/hg/devices/${deviceId}/config`, token);
}

export function getTopology(
  serverUrl: string,
  token: string,
  deviceId: string,
  since?: number,
): Promise<DeviceTopology> {
  const qs = since !== undefined && since !== null ? `?since=${since}` : '';
  return serverFetch(serverUrl, `/api/hg/devices/${deviceId}/topology${qs}`, token);
}

export function lockDevice(
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

export function unlockDevice(
  serverUrl: string,
  token: string,
  deviceId: string,
): Promise<void> {
  return serverFetch(serverUrl, `/api/hg/devices/${deviceId}/unlock`, token, {
    method: 'POST',
  });
}

export function deleteDevice(
  serverUrl: string,
  token: string,
  deviceId: string,
): Promise<void> {
  return serverFetch(serverUrl, `/api/hg/devices/${deviceId}`, token, { method: 'DELETE' });
}

// ─── Links ───

export function createLinkInvite(
  serverUrl: string,
  token: string,
  fromDevice: string,
): Promise<CreateLinkInviteResponse> {
  return serverFetch(serverUrl, '/api/hg/links/invite', token, {
    method: 'POST',
    body: JSON.stringify({ from_device: fromDevice }),
  });
}

export function acceptLinkInvite(
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

export function listLinks(serverUrl: string, token: string): Promise<HgDeviceLink[]> {
  return serverFetch(serverUrl, '/api/hg/links', token);
}

export function deleteLink(
  serverUrl: string,
  token: string,
  linkId: string,
): Promise<void> {
  return serverFetch(serverUrl, `/api/hg/links/${linkId}`, token, { method: 'DELETE' });
}

// ─── Groups ───

export function createGroup(
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

export function listGroups(serverUrl: string, token: string): Promise<HgGroup[]> {
  return serverFetch(serverUrl, '/api/hg/groups', token);
}

export function getGroupDetail(
  serverUrl: string,
  token: string,
  groupId: string,
): Promise<GroupDetail> {
  return serverFetch(serverUrl, `/api/hg/groups/${groupId}`, token);
}

export function joinGroup(
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

export function leaveGroup(
  serverUrl: string,
  token: string,
  groupId: string,
  deviceId: string,
): Promise<void> {
  return serverFetch(serverUrl, `/api/hg/groups/${groupId}/leave/${deviceId}`, token, {
    method: 'DELETE',
  });
}

export function toggleGroup(
  serverUrl: string,
  token: string,
  groupId: string,
): Promise<boolean> {
  return serverFetch(serverUrl, `/api/hg/groups/${groupId}/toggle`, token, {
    method: 'POST',
  });
}

export function deleteGroup(
  serverUrl: string,
  token: string,
  groupId: string,
): Promise<void> {
  return serverFetch(serverUrl, `/api/hg/groups/${groupId}`, token, { method: 'DELETE' });
}

export function createGroupInvite(
  serverUrl: string,
  token: string,
  groupId: string,
): Promise<CreateLinkInviteResponse> {
  return serverFetch(serverUrl, `/api/hg/groups/${groupId}/invite`, token, {
    method: 'POST',
  });
}

export function acceptGroupInvite(
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

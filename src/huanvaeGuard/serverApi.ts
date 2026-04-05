/**
 * HuanvaeGuard 服务端 API
 *
 * 使用 @tauri-apps/plugin-http 发请求（避免 CSP 拦截）
 * 内置 401 自动 Token 刷新 + 重试
 */

import { fetch } from '@tauri-apps/plugin-http';
import type {
  HgClientConfig, DeviceRegisterResponse, HgDevice,
  TopologyPeer, HgDeviceLink, HgGroup,
  HgGroupDetail, HgInviteResponse, HgJoinGroupResponse,
  HgLockDeviceResult,
} from './types';

export interface HgApiConfig {
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
  onTokenRefresh?: (newAccess: string, newRefresh: string) => void;
  onSessionExpired?: () => void;
}

interface ApiEnvelope<T> {
  success: boolean;
  code: number;
  data: T;
  error?: string;
}

export function createHgApiClient(config: HgApiConfig) {
  let { accessToken, refreshToken } = config;
  const { serverUrl, onTokenRefresh, onSessionExpired } = config;

  async function refreshAccessToken(): Promise<boolean> {
    try {
      const resp = await fetch(`${serverUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!resp.ok) return false;
      const data = await resp.json();
      accessToken = data.access_token;
      if (data.refresh_token) refreshToken = data.refresh_token;
      onTokenRefresh?.(accessToken, refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };

    const doFetch = () => fetch(`${serverUrl}${path}`, {
      ...init,
      headers: { ...headers, ...init?.headers as Record<string, string> },
    });

    let resp = await doFetch();

    if (resp.status === 401) {
      const ok = await refreshAccessToken();
      if (ok) {
        headers.Authorization = `Bearer ${accessToken}`;
        resp = await doFetch();
      } else {
        onSessionExpired?.();
        throw new Error('会话已过期');
      }
    }

    const json: ApiEnvelope<T> = await resp.json();
    if (!json.success) throw new Error(json.error ?? `API error ${json.code}`);
    return json.data;
  }

  return {
    getAccessToken: () => accessToken,
    getServerUrl: () => serverUrl,

    // ─── 设备管理 ───
    registerDevice(
      deviceName: string,
      publicKey: string,
      os?: string,
      deviceFingerprint?: string,
      preferredRegion?: string,
    ) {
      return request<DeviceRegisterResponse>('/api/hg/devices/register', {
        method: 'POST',
        body: JSON.stringify({
          device_name: deviceName,
          public_key: publicKey,
          os,
          device_fingerprint: deviceFingerprint,
          preferred_region: preferredRegion,
        }),
      });
    },

    getDevices() {
      return request<HgDevice[]>('/api/hg/devices');
    },

    getDeviceConfig(deviceId: string) {
      return request<HgClientConfig>(`/api/hg/devices/${deviceId}/config`);
    },

    getTopology(deviceId: string, since?: number) {
      const qs = since ? `?since=${since}` : '';
      return request<{
        device_id: string;
        virtual_ip: string;
        peers: TopologyPeer[];
        topology_version: number;
      }>(`/api/hg/devices/${deviceId}/topology${qs}`);
    },

    deleteDevice(deviceId: string) {
      return request<string>(`/api/hg/devices/${deviceId}`, { method: 'DELETE' });
    },

    lockDevice(deviceId: string, endpoint: string) {
      return request<HgLockDeviceResult>(`/api/hg/devices/${deviceId}/lock`, {
        method: 'POST',
        body: JSON.stringify({ endpoint }),
      });
    },

    unlockDevice(deviceId: string) {
      return request<string>(`/api/hg/devices/${deviceId}/unlock`, { method: 'POST' });
    },

    // ─── 链接管理 ───
    createInvite(fromDevice: string) {
      return request<HgInviteResponse>(
        '/api/hg/links/invite',
        { method: 'POST', body: JSON.stringify({ from_device: fromDevice }) },
      );
    },

    acceptInvite(inviteToken: string, deviceId: string) {
      return request<{ link_id: string; peer: TopologyPeer }>(
        '/api/hg/links/invite/accept',
        { method: 'POST', body: JSON.stringify({ invite_token: inviteToken, device_id: deviceId }) },
      );
    },

    getLinks() {
      return request<HgDeviceLink[]>('/api/hg/links');
    },

    deleteLink(linkId: string) {
      return request<string>(`/api/hg/links/${linkId}`, { method: 'DELETE' });
    },

    // ─── 群组管理 ───
    createGroup(name: string, description?: string, maxDevices?: number) {
      return request<{ group_id: string; name: string }>('/api/hg/groups', {
        method: 'POST',
        body: JSON.stringify({ name, description, max_devices: maxDevices }),
      });
    },

    getGroups() {
      return request<HgGroup[]>('/api/hg/groups');
    },

    getGroupDetail(groupId: string) {
      return request<HgGroupDetail>(`/api/hg/groups/${groupId}`);
    },

    joinGroup(groupId: string, deviceId: string) {
      return request<HgJoinGroupResponse>(
        `/api/hg/groups/${groupId}/join`,
        { method: 'POST', body: JSON.stringify({ device_id: deviceId }) },
      );
    },

    leaveGroup(groupId: string, deviceId: string) {
      return request<string>(`/api/hg/groups/${groupId}/leave/${deviceId}`, { method: 'DELETE' });
    },

    toggleGroup(groupId: string) {
      return request<boolean>(`/api/hg/groups/${groupId}/toggle`, { method: 'POST' });
    },

    deleteGroup(groupId: string) {
      return request<string>(`/api/hg/groups/${groupId}`, { method: 'DELETE' });
    },

    createGroupInvite(groupId: string) {
      return request<HgInviteResponse>(
        `/api/hg/groups/${groupId}/invite`,
        { method: 'POST' },
      );
    },

    acceptGroupInvite(groupId: string, inviteToken: string, deviceId: string) {
      return request<HgJoinGroupResponse>(
        `/api/hg/groups/${groupId}/invite/accept`,
        { method: 'POST', body: JSON.stringify({ invite_token: inviteToken, device_id: deviceId }) },
      );
    },
  };
}

export type HgApiClient = ReturnType<typeof createHgApiClient>;

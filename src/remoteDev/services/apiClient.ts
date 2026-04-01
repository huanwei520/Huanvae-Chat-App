/**
 * 远程开发 API 客户端
 *
 * 复用 lowcode 模块的 API 客户端模式：
 * - 独立窗口使用，不依赖 SessionContext
 * - 自动 Token 刷新 + 401 重试
 *
 * @module remoteDev/services/apiClient
 */

import { fetch } from '@tauri-apps/plugin-http';

export interface RemoteDevApiClientConfig {
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
  onTokenRefresh?: (newAccessToken: string, newRefreshToken: string) => void;
  onSessionExpired?: () => void;
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  skipAuth?: boolean;
}

export function createRemoteDevApiClient(config: RemoteDevApiClientConfig) {
  let { accessToken } = config;
  let { refreshToken } = config;
  const { serverUrl, onTokenRefresh, onSessionExpired } = config;

  async function refreshAccessToken(): Promise<boolean> {
    try {
      console.warn('[RemoteDev API] 尝试刷新 Token...');
      const response = await fetch(`${serverUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!response.ok) {
        console.error('[RemoteDev API] Token 刷新失败:', response.status);
        return false;
      }

      const data = await response.json();
      accessToken = data.access_token;
      if (data.refresh_token) {
        refreshToken = data.refresh_token;
      }

      console.warn('[RemoteDev API] Token 刷新成功');
      onTokenRefresh?.(accessToken, refreshToken);
      return true;
    } catch (err) {
      console.error('[RemoteDev API] Token 刷新异常:', err);
      return false;
    }
  }

  async function request<T>(path: string, options: RequestOptions): Promise<T> {
    const { method, body, skipAuth = false } = options;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (!skipAuth && accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const requestBody = body !== undefined ? JSON.stringify(body) : undefined;
    const url = `${serverUrl}${path}`;

    let response = await fetch(url, { method, headers, body: requestBody });

    if (response.status === 401 && !skipAuth) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${accessToken}`;
        response = await fetch(url, { method, headers, body: requestBody });
      } else {
        onSessionExpired?.();
        throw new Error('会话已过期，请关闭窗口并重新打开');
      }
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || data.message || `HTTP ${response.status}`);
    }

    if (data.success === false) {
      throw new Error(data.error || data.message || '操作失败');
    }

    return (data.data !== undefined ? data.data : data) as T;
  }

  return {
    get<T>(path: string): Promise<T> {
      return request<T>(path, { method: 'GET' });
    },
    post<T>(path: string, body?: unknown): Promise<T> {
      return request<T>(path, { method: 'POST', body });
    },
    put<T>(path: string, body?: unknown): Promise<T> {
      return request<T>(path, { method: 'PUT', body });
    },
    delete<T>(path: string, body?: unknown): Promise<T> {
      return request<T>(path, { method: 'DELETE', body });
    },
    getServerUrl(): string {
      return serverUrl;
    },
    getAccessToken(): string {
      return accessToken;
    },
  };
}

export type RemoteDevApiClient = ReturnType<typeof createRemoteDevApiClient>;

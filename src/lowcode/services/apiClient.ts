/**
 * 低代码编辑器 API 客户端
 *
 * 提供带自动 Token 刷新机制的 HTTP 请求方法
 * 当访问令牌过期时，自动使用刷新令牌获取新的访问令牌并重试请求
 *
 * @module lowcode/services/apiClient
 */

import { secureHttp } from '../../services/secureFetch';
import { resolveForSecureHttp } from '../../services/discovery';

// ============================================================================
// 类型定义
// ============================================================================

/** /api/auth/refresh 响应载荷(可能裹在 ApiResponse.data 内,也可能裸返回) */
interface TokenPayload {
  access_token: string;
  refresh_token?: string;
}

/** API 客户端配置 */
export interface LowcodeApiClientConfig {
  /** 服务器 URL */
  serverUrl: string;
  /** 访问令牌 */
  accessToken: string;
  /** 刷新令牌 */
  refreshToken: string;
  /** Token 刷新回调（可选，用于通知外部 token 已更新） */
  onTokenRefresh?: (newAccessToken: string, newRefreshToken: string) => void;
  /** 会话过期回调（可选，用于处理刷新失败的情况） */
  onSessionExpired?: () => void;
}

/** 请求选项 */
interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  skipAuth?: boolean;
}

// ============================================================================
// API 客户端
// ============================================================================

/**
 * 创建低代码编辑器 API 客户端
 *
 * @param config - 客户端配置
 * @returns API 客户端实例
 */
export function createLowcodeApiClient(config: LowcodeApiClientConfig) {
  let { accessToken } = config;
  let { refreshToken } = config;
  const { serverUrl, onTokenRefresh, onSessionExpired } = config;

  /**
   * 刷新访问令牌
   */
  async function refreshAccessToken(): Promise<boolean> {
    try {
      console.warn('[Lowcode API] 尝试刷新 Token...');

      const response = await secureHttp({
        method: 'POST',
        url: `${serverUrl}/api/auth/refresh`,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
        ...(resolveForSecureHttp() ?? { pin_ca: true }),
      });

      if (!response.ok) {
        console.error('[Lowcode API] Token 刷新失败:', response.status);
        return false;
      }

      const raw = response.json<{ data?: TokenPayload } & Partial<TokenPayload>>();
      const data: TokenPayload = (raw.data ?? raw) as TokenPayload;
      accessToken = data.access_token;

      if (data.refresh_token) {
        refreshToken = data.refresh_token;
      }

      console.warn('[Lowcode API] Token 刷新成功');

      // 通知外部 token 已更新
      if (onTokenRefresh) {
        onTokenRefresh(accessToken, refreshToken);
      }

      return true;
    } catch (err) {
      console.error('[Lowcode API] Token 刷新异常:', err);
      return false;
    }
  }

  /**
   * 发送 HTTP 请求
   */
  async function request<T>(path: string, options: RequestOptions): Promise<T> {
    const { method, body, skipAuth = false } = options;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (!skipAuth && accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const requestBody = body !== undefined ? JSON.stringify(body) : null;
    const url = `${serverUrl}${path}`;
    const resolve = resolveForSecureHttp() ?? { pin_ca: true };

    // 第一次请求(经 Rust secure_http,自签 + 内置 CA;子窗口内 resolve 为 null 时退化 pin_ca)
    let response = await secureHttp({ method, url, headers, body: requestBody, ...resolve });

    // 如果返回 401，尝试刷新 Token 并重试
    if (response.status === 401 && !skipAuth) {
      const refreshed = await refreshAccessToken();

      if (refreshed) {
        // 使用新 Token 重试请求
        headers['Authorization'] = `Bearer ${accessToken}`;
        response = await secureHttp({ method, url, headers, body: requestBody, ...resolve });
      } else {
        // 刷新失败，触发会话过期回调
        if (onSessionExpired) {
          onSessionExpired();
        }
        throw new Error('会话已过期，请关闭窗口并重新打开');
      }
    }

    // 解析响应(空体安全降级)
    let data: Record<string, unknown> = {};
    try {
      if (response.body) {
        data = response.json<Record<string, unknown>>();
      }
    } catch {
      data = {};
    }

    if (!response.ok) {
      throw new Error((data.error as string) || (data.message as string) || `HTTP ${response.status}`);
    }

    // 处理标准 API 响应格式
    if (data.success === false) {
      throw new Error((data.error as string) || (data.message as string) || '操作失败');
    }

    // 返回 data 字段（如果存在）或整个响应
    return (data.data !== undefined ? data.data : data) as T;
  }

  return {
    /**
     * GET 请求
     */
    get<T>(path: string): Promise<T> {
      return request<T>(path, { method: 'GET' });
    },

    /**
     * POST 请求
     */
    post<T>(path: string, body?: unknown): Promise<T> {
      return request<T>(path, { method: 'POST', body });
    },

    /**
     * PUT 请求
     */
    put<T>(path: string, body?: unknown): Promise<T> {
      return request<T>(path, { method: 'PUT', body });
    },

    /**
     * DELETE 请求
     */
    delete<T>(path: string, body?: unknown): Promise<T> {
      return request<T>(path, { method: 'DELETE', body });
    },

    /**
     * 获取当前服务器 URL
     */
    getServerUrl(): string {
      return serverUrl;
    },

    /**
     * 获取当前访问令牌
     */
    getAccessToken(): string {
      return accessToken;
    },
  };
}

/** API 客户端类型 */
export type LowcodeApiClient = ReturnType<typeof createLowcodeApiClient>;

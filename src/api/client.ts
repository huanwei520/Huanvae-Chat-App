/**
 * API 客户端
 *
 * 提供绑定了 serverUrl 和 token 的 API 请求方法
 * 使用时无需手动传入这些参数
 */

export interface ApiClientConfig {
  /** 服务器 URL */
  baseUrl: string;
  /** 访问令牌 */
  accessToken: string;
  /** 刷新令牌 */
  refreshToken: string;
  /** Token 刷新回调 */
  onTokenRefresh?: (newAccessToken: string, newRefreshToken: string) => void;
  /** 会话过期回调 */
  onSessionExpired?: () => void;
}

export interface ApiRequestOptions {
  /** HTTP 方法 */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** 请求体 */
  body?: Record<string, unknown>;
  /** 额外的请求头 */
  headers?: Record<string, string>;
  /** 是否跳过认证 */
  skipAuth?: boolean;
}

/**
 * 创建 API 客户端
 */
export function createApiClient(config: ApiClientConfig) {
  let { accessToken } = config;
  const { baseUrl, refreshToken, onTokenRefresh, onSessionExpired } = config;

  /**
   * 刷新 Token
   */
  async function refreshAccessToken(): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      accessToken = data.access_token;

      if (onTokenRefresh) {
        onTokenRefresh(data.access_token, data.refresh_token || refreshToken);
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 发送请求
   */
  async function request<T>(
    path: string,
    options: ApiRequestOptions = {},
  ): Promise<T> {
    const { method = 'GET', body, headers: extraHeaders, skipAuth = false } = options;

    const headers: Record<string, string> = { ...extraHeaders };

    // 对于非 GET 请求，始终设置 Content-Type
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }

    if (!skipAuth && accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    // 对于非 GET 请求，如果没有 body 则发送空对象（后端要求）
    const requestBody = method !== 'GET'
      ? JSON.stringify(body ?? {})
      : undefined;

    let response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: requestBody,
    });

    // 如果返回 401，尝试刷新 Token
    if (response.status === 401 && !skipAuth) {
      const refreshed = await refreshAccessToken();

      if (refreshed) {
        // 使用新 Token 重试请求
        headers['Authorization'] = `Bearer ${accessToken}`;
        response = await fetch(`${baseUrl}${path}`, {
          method,
          headers,
          body: requestBody,
        });
      } else {
        // 刷新失败，触发会话过期回调
        if (onSessionExpired) {
          onSessionExpired();
        }
        throw new Error('会话已过期，请重新登录');
      }
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || data.message || `HTTP ${response.status}`);
    }

    return data as T;
  }

  return {
    /**
     * GET 请求
     */
    get<T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<T> {
      return request<T>(path, { ...options, method: 'GET' });
    },

    /**
     * POST 请求
     */
    post<T>(path: string, body?: Record<string, unknown>, options?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<T> {
      return request<T>(path, { ...options, method: 'POST', body });
    },

    /**
     * PUT 请求
     */
    put<T>(path: string, body?: Record<string, unknown>, options?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<T> {
      return request<T>(path, { ...options, method: 'PUT', body });
    },

    /**
     * DELETE 请求
     */
    delete<T>(path: string, body?: Record<string, unknown>, options?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<T> {
      return request<T>(path, { ...options, method: 'DELETE', body });
    },

    /**
     * PATCH 请求
     */
    patch<T>(path: string, body?: Record<string, unknown>, options?: Omit<ApiRequestOptions, 'method' | 'body'>): Promise<T> {
      return request<T>(path, { ...options, method: 'PATCH', body });
    },

    /**
     * 获取当前 baseUrl
     */
    getBaseUrl(): string {
      return baseUrl;
    },

    /**
     * 获取当前 accessToken
     */
    getAccessToken(): string {
      return accessToken;
    },
  };
}

/** API 客户端类型 */
export type ApiClient = ReturnType<typeof createApiClient>;

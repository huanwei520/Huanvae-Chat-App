/**
 * API 客户端
 *
 * 提供绑定了 serverUrl 和 token 的 API 请求方法
 * 使用 Tauri HTTP 插件绕过 CORS 限制
 * 使用时无需手动传入这些参数
 *
 * Token 刷新机制：
 * - 被动刷新：请求返回 401 时自动调用 refreshAccessToken 并重试
 * - 主动刷新：SessionContext 通过定时器在 Token 过期前 5 分钟调用 refreshAccessToken
 */

import { secureHttp } from '../services/secureFetch';
import { resolveForSecureHttp } from '../services/discovery';

/** /api/auth/refresh 响应载荷(可能裹在 ApiResponse.data 内,也可能裸返回) */
interface TokenPayload {
  access_token: string;
  refresh_token?: string;
}

/**
 * 带 HTTP 状态码的 API 错误
 *
 * 原先这里抛的是裸 `Error`，`message` 取自响应体 —— **状态码在抛出那一刻就丢了**，
 * 于是调用方要区分「参数不合法(400) / 无权(403) / 不存在(404)」只能去猜错误文案，
 * 而文案是服务端随时可改的自由文本。群名片分享的契约明确要求这三态给三种不同的处置
 * （见 `src/chat/shared/groupCard.ts` `describeShareGroupCardError`），故把状态码原样带出来。
 *
 * 兼容性：`ApiError extends Error` ⇒ 既有的 `err instanceof Error` / `err.message`
 * 判断逐字不变，只是多了一个 `status` 可读。
 */
export class ApiError extends Error {
  /** 响应的 HTTP 状态码（401 已在客户端内部完成刷新重试，到这里的 401 表示刷新后仍失败） */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** 从 catch 到的未知错误里取 HTTP 状态码；不是 ApiError（网络层失败等）返回 null */
export function apiErrorStatus(err: unknown): number | null {
  return err instanceof ApiError ? err.status : null;
}

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
   * 单飞：主动刷新（SessionContext 过期前 5 分钟定时器）与 401 被动刷新可能并发触发
   * （尤其后台节流导致主动刷新延迟到过期后，与后台请求的 401 撞车）。去重为一次在途请求：
   * ① 避免重复 POST /api/auth/refresh；② 避免轮换型 refresh_token 被并发二次消费 → 第二次
   *   请求收 401 → 误判会话过期而 onSessionExpired 登出。完成即清空句柄（含失败），不缓存结果，
   *   下次刷新照常发起（否则失败结果会毒化后续所有刷新）。
   */
  let refreshInFlight: Promise<boolean> | null = null;

  async function doRefresh(): Promise<boolean> {
    try {
      const response = await secureHttp({
        method: 'POST',
        url: `${baseUrl}/api/auth/refresh`,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
        ...(resolveForSecureHttp() ?? { pin_ca: true }),
      });

      if (!response.ok) {
        return false;
      }

      const raw = response.json<{ data?: TokenPayload } & Partial<TokenPayload>>();
      const data: TokenPayload = (raw.data ?? raw) as TokenPayload;
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
   * 刷新 Token（单飞去重，见 refreshInFlight 注释）
   */
  function refreshAccessToken(): Promise<boolean> {
    if (refreshInFlight) {
      return refreshInFlight;
    }
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
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

    // 数据面统一经 Rust secure_http(rustls 自管 TLS + 内置私有 CA + 发现服务给的 resolve 直连源站 IP)。
    // resolve 未就绪(理论上登录后必有)时退化为 pin_ca + reqwest DNS(灰云直连)。
    const resolve = resolveForSecureHttp() ?? { pin_ca: true };
    const url = `${baseUrl}${path}`;

    let response = await secureHttp({ method, url, headers, body: requestBody ?? null, ...resolve });

    // 如果返回 401，尝试刷新 Token
    if (response.status === 401 && !skipAuth) {
      const refreshed = await refreshAccessToken();

      if (refreshed) {
        // 使用新 Token 重试请求
        headers['Authorization'] = `Bearer ${accessToken}`;
        response = await secureHttp({ method, url, headers, body: requestBody ?? null, ...resolve });
      } else {
        // 刷新失败，触发会话过期回调
        if (onSessionExpired) {
          onSessionExpired();
        }
        throw new Error('会话已过期，请重新登录');
      }
    }

    // secure_http 一次性收完 body;空体(如 204)安全降级为空对象(对齐原 .catch(()=>({})) 行为)
    let data: Record<string, unknown> = {};
    try {
      if (response.body) {
        data = response.json<Record<string, unknown>>();
      }
    } catch {
      data = {};
    }

    if (!response.ok) {
      throw new ApiError(
        response.status,
        (data.error as string) || (data.message as string) || `HTTP ${response.status}`,
      );
    }

    // 解包 ApiResponse 格式：{ success, code, data: T }
    return data.data as T;
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

    /**
     * 主动刷新 Token（供 SessionContext 定时器调用）
     *
     * @returns 刷新是否成功
     */
    refreshAccessToken,
  };
}

/** API 客户端类型 */
export type ApiClient = ReturnType<typeof createApiClient>;

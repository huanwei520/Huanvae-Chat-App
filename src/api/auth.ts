/**
 * 认证 API 封装
 *
 * 调用服务器格式使用下划线 "_"
 */

import type { LoginResponse, ProfileResponse, RegisterData } from '../types/account';

/**
 * 通用 API 请求封装
 */
async function api<T>(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: Record<string, unknown>;
  } = {},
): Promise<T> {
  const { method = 'GET', token, body } = options;

  const headers: Record<string, string> = {};

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data as T;
}

/**
 * 用户登录
 */
export function login(
  serverUrl: string,
  userId: string,
  password: string,
): Promise<LoginResponse> {
  return api<LoginResponse>(serverUrl, '/api/auth/login', {
    method: 'POST',
    body: {
      user_id: userId,
      password: password,
      device_info: 'Huanvae Chat Desktop',
    },
  });
}

/**
 * 用户注册
 */
export async function register(
  serverUrl: string,
  data: RegisterData,
): Promise<void> {
  await api(serverUrl, '/api/auth/register', {
    method: 'POST',
    body: {
      user_id: data.user_id,
      nickname: data.nickname,
      password: data.password,
      email: data.email || undefined,
    },
  });
}

/**
 * 获取用户资料
 */
export function getProfile(
  serverUrl: string,
  token: string,
): Promise<ProfileResponse> {
  return api<ProfileResponse>(serverUrl, '/api/profile', {
    token,
  });
}

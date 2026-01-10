/**
 * 认证 API 封装
 *
 * 使用 Tauri HTTP 插件绕过 CORS 限制
 * 调用服务器格式使用下划线 "_"
 */

import { fetch } from '@tauri-apps/plugin-http';
import type { LoginResponse, ProfileResponse, RegisterData } from '../types/account';

/**
 * 通用 API 请求封装（使用 Tauri HTTP 插件）
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
 *
 * @param serverUrl - 服务器地址
 * @param userId - 用户 ID
 * @param password - 密码
 * @param deviceInfo - 设备描述信息（如 "DESKTOP-ABC - Windows 10.0.22621 (x86_64)"）
 * @param macAddress - MAC 地址（用于识别同一设备）
 */
export function login(
  serverUrl: string,
  userId: string,
  password: string,
  deviceInfo?: string,
  macAddress?: string | null,
): Promise<LoginResponse> {
  // 调试日志
  console.warn('[Auth] 登录请求设备信息:', { deviceInfo, macAddress });

  return api<LoginResponse>(serverUrl, '/api/auth/login', {
    method: 'POST',
    body: {
      user_id: userId,
      password: password,
      device_info: deviceInfo || 'Huanvae Chat Desktop',
      mac_address: macAddress || undefined,
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

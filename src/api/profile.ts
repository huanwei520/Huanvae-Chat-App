/**
 * 个人资料 API 封装
 *
 * 使用 SessionContext 提供的 API 客户端
 */

import type { ApiClient } from './client';

/** 个人资料响应 */
export interface ProfileResponse {
  data: {
    user_id: string;
    user_nickname: string;
    user_email: string | null;
    user_signature: string | null;
    user_avatar_url: string | null;
    admin: string;
    created_at: string;
    updated_at: string;
  };
}

/** 更新资料请求 */
export interface UpdateProfileRequest {
  email?: string;
  signature?: string;
}

/** 修改密码请求 */
export interface ChangePasswordRequest {
  old_password: string;
  new_password: string;
}

/** 上传头像响应 */
export interface UploadAvatarResponse {
  avatar_url: string;
  message: string;
}

/**
 * 获取个人资料
 */
export function getProfile(api: ApiClient): Promise<ProfileResponse> {
  return api.get<ProfileResponse>('/api/profile');
}

/**
 * 更新个人资料
 */
export function updateProfile(
  api: ApiClient,
  data: UpdateProfileRequest,
): Promise<{ message: string }> {
  return api.put('/api/profile', data as Record<string, unknown>);
}

/**
 * 修改密码
 */
export function changePassword(
  api: ApiClient,
  data: ChangePasswordRequest,
): Promise<{ message: string }> {
  return api.put('/api/profile/password', data as Record<string, unknown>);
}

/**
 * 上传头像
 * 注意：此函数需要特殊处理 FormData，不使用标准 API 客户端
 */
export async function uploadAvatar(
  serverUrl: string,
  accessToken: string,
  file: File,
): Promise<UploadAvatarResponse> {
  const formData = new FormData();
  formData.append('avatar', file);

  const response = await fetch(`${serverUrl}/api/profile/avatar`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || data.message || `HTTP ${response.status}`);
  }

  return data as UploadAvatarResponse;
}

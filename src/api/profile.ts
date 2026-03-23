/**
 * 个人资料 API 封装
 *
 * 使用 SessionContext 提供的 API 客户端
 */

import type { ApiClient } from './client';

/** 个人资料响应（createApiClient 已自动解包 ApiResponse.data，此处为解包后的扁平结构） */
export interface ProfileResponse {
  user_id: string;
  user_nickname: string;
  user_email: string | null;
  user_signature: string | null;
  user_avatar_url: string | null;
  admin: string;
  created_at: string;
  updated_at: string;
}

/** 更新资料请求 */
export interface UpdateProfileRequest {
  nickname?: string;
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
  return api.put('/api/profile/password', data as unknown as Record<string, unknown>);
}

import type { ProgressCallback } from '../types/api';
import { uploadWithProgress } from './upload';

/**
 * 上传头像
 *
 * 使用通用上传函数，支持上传进度回调
 */
export function uploadAvatar(
  serverUrl: string,
  accessToken: string,
  file: File,
  onProgress?: ProgressCallback,
): Promise<UploadAvatarResponse> {
  return uploadWithProgress<UploadAvatarResponse>(
    `${serverUrl}/api/profile/avatar`,
    accessToken,
    file,
    'avatar',
    onProgress,
  );
}

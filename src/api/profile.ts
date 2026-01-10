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

/** 进度回调类型 */
export type ProgressCallback = (progress: number) => void;

/**
 * 上传头像
 * 注意：使用 XMLHttpRequest 以获取上传进度
 */
export function uploadAvatar(
  serverUrl: string,
  accessToken: string,
  file: File,
  onProgress?: ProgressCallback,
): Promise<UploadAvatarResponse> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('avatar', file);

    const xhr = new XMLHttpRequest();

    // 监听上传进度
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const progress = Math.round((event.loaded / event.total) * 100);
        onProgress(progress);
      }
    };

    // 完成时处理响应
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data as UploadAvatarResponse);
        } else {
          reject(new Error(data.error || data.message || `HTTP ${xhr.status}`));
        }
      } catch {
        reject(new Error('解析响应失败'));
      }
    };

    xhr.onerror = () => {
      reject(new Error('网络错误'));
    };

    xhr.open('POST', `${serverUrl}/api/profile/avatar`);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.send(formData);
  });
}

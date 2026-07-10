/**
 * 个人资料 API 封装
 *
 * 使用 SessionContext 提供的 API 客户端
 */

import type { ApiClient } from './client';

/** 申请默认处理策略 */
export type RequestPolicy = 'manual' | 'auto_accept' | 'auto_reject';

/** 性别（null=未设置） */
export type Gender = 'male' | 'female' | 'other';

/** 个人资料响应（createApiClient 已自动解包 ApiResponse.data，此处为解包后的扁平结构） */
export interface ProfileResponse {
  user_id: string;
  user_nickname: string;
  user_email: string | null;
  user_signature: string | null;
  user_avatar_url: string | null;
  /** 资料背景图相对路径（需经 resolveServerAvatarUrl 收口；null=默认封面） */
  background_url: string | null;
  /** 性别：male/female/other（null=未设置） */
  gender: Gender | null;
  /** 生日 ISO 日期 YYYY-MM-DD（null=未设置） */
  birthday: string | null;
  /** 地区，自由文本（null=未设置） */
  region: string | null;
  admin: string;
  /** 搜索总开关：false=完全不可被搜索/添加 */
  allow_search: boolean;
  /** 是否允许通过用户 ID/用户名被添加 */
  search_visible_by_id: boolean;
  /** 好友申请默认处理策略 */
  friend_request_policy: RequestPolicy;
  /** 群邀请默认处理策略 */
  group_invite_policy: RequestPolicy;
  created_at: string;
  updated_at: string;
}

/** 他人公开资料响应（仅公开字段，不含邮箱与隐私设置） */
export interface PublicProfileResponse {
  user_id: string;
  user_nickname: string;
  user_signature: string | null;
  user_avatar_url: string | null;
  /** 资料背景图相对路径（需经 resolveServerAvatarUrl 收口；null=默认封面） */
  background_url: string | null;
  /** 性别：male/female/other（null=未设置） */
  gender: Gender | null;
  /** 生日 ISO 日期 YYYY-MM-DD（null=未设置） */
  birthday: string | null;
  /** 地区，自由文本（null=未设置） */
  region: string | null;
  /** 注册时间（ISO 8601；供他人资料页展示"注册时间"） */
  created_at: string;
}

/** 更新资料请求（所有字段可选，仅传需要更新的） */
export interface UpdateProfileRequest {
  nickname?: string;
  email?: string;
  signature?: string;
  allow_search?: boolean;
  search_visible_by_id?: boolean;
  friend_request_policy?: RequestPolicy;
  group_invite_policy?: RequestPolicy;
  /** 性别：male/female/other */
  gender?: Gender;
  /** 生日 ISO 日期 YYYY-MM-DD */
  birthday?: string;
  /** 地区，最长 100 字符 */
  region?: string;
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

/** 上传/重置资料背景图响应（重置时 background_url 恒为空串） */
export interface BackgroundResponse {
  background_url: string;
  message: string;
}

/**
 * 获取个人资料
 */
export function getProfile(api: ApiClient): Promise<ProfileResponse> {
  return api.get<ProfileResponse>('/api/profile');
}

/**
 * 获取他人公开资料（仅公开字段：id/昵称/签名/头像）
 */
export function getPublicProfile(api: ApiClient, userId: string): Promise<PublicProfileResponse> {
  return api.get<PublicProfileResponse>(`/api/profile/${encodeURIComponent(userId)}/public`);
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

/**
 * 上传资料背景图（封面）
 *
 * 与 uploadAvatar 同结构：字段名 'background'，返回带时间戳的相对路径（需拼接 STORAGE_BASE_URL / 经收口解析）。
 */
export async function uploadBackground(
  serverUrl: string,
  accessToken: string,
  file: File,
  onProgress?: ProgressCallback,
): Promise<BackgroundResponse> {
  // uploadWithProgress 走裸 XHR，绕过 ApiClient 的自动解包，拿到的是完整 ApiResponse 包裹
  // （{ success, code, data: BackgroundResponse, message }）。这里解包出 data 返回扁平结构，
  // 与 resetBackground（经 ApiClient 已解包）保持一致，供调用方直接读 background_url。
  const wrapped = await uploadWithProgress<{ data: BackgroundResponse }>(
    `${serverUrl}/api/profile/background`,
    accessToken,
    file,
    'background',
    onProgress,
  );
  return wrapped.data;
}

/**
 * 重置资料背景图为默认封面（后端将 background_url 置为 null）。
 * 成功响应 background_url 恒为空串，前端应据此清空本地 background_url。
 */
export function resetBackground(api: ApiClient): Promise<BackgroundResponse> {
  return api.delete<BackgroundResponse>('/api/profile/background');
}

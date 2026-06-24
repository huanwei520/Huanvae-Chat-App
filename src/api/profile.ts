/**
 * 个人资料 API 封装
 *
 * 使用 SessionContext 提供的 API 客户端
 */

import type { ApiClient } from './client';

/** 申请默认处理策略 */
export type RequestPolicy = 'manual' | 'auto_accept' | 'auto_reject';

/** 个人资料响应（createApiClient 已自动解包 ApiResponse.data，此处为解包后的扁平结构） */
export interface ProfileResponse {
  user_id: string;
  user_nickname: string;
  user_email: string | null;
  user_signature: string | null;
  user_avatar_url: string | null;
  /** 个人资料背景图相对路径（纯色/无背景时为空字符串）；显示前经 resolveDisplayUrl 收口 */
  user_background_url: string | null;
  /** 背景代表色 hex（图片=提取主色 / 纯色=该色 / 无=空）；用于 QQ 卡底淡染 + 主题色跟随 */
  user_background_color: string | null;
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
  /** 背景图相对路径（别人主页封面显示用；纯色/无背景时为空字符串） */
  user_background_url: string | null;
  /** 背景代表色 hex（别人主页卡底淡染用） */
  user_background_color: string | null;
}

/** 背景更新响应（上传图 / 设纯色 / 清除 通用） */
export interface BackgroundUpdateResponse {
  /** 背景图相对路径（纯色/清除时为空字符串） */
  user_background_url: string;
  /** 背景代表色 hex（清除时为空字符串） */
  user_background_color: string;
  message: string;
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
 * 上传个人资料背景图（multipart：`background` 图 + `dominant` 客户端提取的主色 hex）
 *
 * 落 MinIO 公开读桶 user-backgrounds，别人查公开资料也可见。返回相对路径 + 代表色。
 * uploadWithProgress 解析的是 ApiResponse 包装层，此处取 `.data` 拿到扁平响应。
 */
export async function uploadBackground(
  serverUrl: string,
  accessToken: string,
  file: File,
  dominantHex: string,
  onProgress?: ProgressCallback,
): Promise<BackgroundUpdateResponse> {
  const wrapped = await uploadWithProgress<{ data: BackgroundUpdateResponse }>(
    `${serverUrl}/api/profile/background`,
    accessToken,
    file,
    'background',
    onProgress,
    { dominant: dominantHex },
  );
  return wrapped.data;
}

/**
 * 设置纯色背景（PUT JSON `{ color }`，清空背景图）
 */
export function setBackgroundColor(
  api: ApiClient,
  color: string,
): Promise<BackgroundUpdateResponse> {
  return api.put<BackgroundUpdateResponse>('/api/profile/background', { color });
}

/**
 * 清除背景（图片 + 纯色都清空）
 */
export function clearProfileBackground(api: ApiClient): Promise<BackgroundUpdateResponse> {
  return api.delete<BackgroundUpdateResponse>('/api/profile/background');
}

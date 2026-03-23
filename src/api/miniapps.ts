/**
 * 小程序 API 封装
 *
 * 使用 SessionContext 提供的 API 客户端
 * createApiClient 已自动解包 ApiResponse.data，类型均为解包后的扁平结构
 *
 * 覆盖端点：
 * - 列表：公共已发布 / 我的小程序
 * - CRUD：创建 / 更新 / 删除
 * - 状态：发布 / 取消发布
 * - 容器：启动 / 停止 / 重启 / 查看信息 / 重置密码
 */

import type { ApiClient } from './client';

// ============================================
// 类型定义
// ============================================

/** 小程序状态 */
export type MiniAppStatus = 'draft' | 'running' | 'published' | 'stopped';

/** 小程序信息 */
export interface MiniApp {
  miniapp_id: string;
  name: string;
  display_name: string;
  description: string;
  icon_url: string;
  access_url: string;
  status: MiniAppStatus;
  developer_id: string;
  developer_nickname: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

/** 创建小程序请求 */
export interface CreateMiniAppRequest {
  name: string;
  display_name: string;
  description?: string;
  icon_url?: string;
}

/** 创建小程序响应 */
export interface CreateMiniAppResponse {
  miniapp_id: string;
  name: string;
  status: MiniAppStatus;
  access_url: string;
  container: {
    ssh_port: number;
    ssh_user: string;
    ssh_password: string;
  };
}

/** 更新小程序请求 */
export interface UpdateMiniAppRequest {
  display_name?: string;
  description?: string;
  icon_url?: string;
}

/** 容器信息 */
export interface MiniAppContainer {
  miniapp_id: string;
  name: string;
  status: string;
  container_id: string;
  ssh: {
    ssh_port: number;
    ssh_user: string;
    ssh_password: string;
  };
}

// ============================================
// 列表
// ============================================

/** 列出已发布的小程序（所有登录用户可用） */
export function listPublishedMiniApps(api: ApiClient): Promise<MiniApp[]> {
  return api.get<MiniApp[]>('/api/miniapps');
}

/** 列出自己的小程序 */
export function listMyMiniApps(api: ApiClient): Promise<MiniApp[]> {
  return api.get<MiniApp[]>('/api/miniapps/my');
}

// ============================================
// CRUD
// ============================================

/** 获取小程序详情 */
export function getMiniApp(api: ApiClient, id: string): Promise<MiniApp> {
  return api.get<MiniApp>(`/api/miniapps/${id}`);
}

/** 创建小程序（自动启动开发容器） */
export function createMiniApp(
  api: ApiClient,
  data: CreateMiniAppRequest,
): Promise<CreateMiniAppResponse> {
  return api.post<CreateMiniAppResponse>('/api/miniapps', data as unknown as Record<string, unknown>);
}

/** 更新小程序信息（仅创建者） */
export function updateMiniApp(
  api: ApiClient,
  id: string,
  data: UpdateMiniAppRequest,
): Promise<{ message: string }> {
  return api.put<{ message: string }>(`/api/miniapps/${id}`, data as unknown as Record<string, unknown>);
}

/** 删除小程序（创建者或管理员，同时销毁容器） */
export function deleteMiniApp(
  api: ApiClient,
  id: string,
): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/miniapps/${id}`);
}

// ============================================
// 发布管理
// ============================================

/** 发布小程序 */
export function publishMiniApp(api: ApiClient, id: string): Promise<MiniApp> {
  return api.post<MiniApp>(`/api/miniapps/${id}/publish`, {});
}

/** 取消发布 */
export function unpublishMiniApp(api: ApiClient, id: string): Promise<MiniApp> {
  return api.post<MiniApp>(`/api/miniapps/${id}/unpublish`, {});
}

// ============================================
// 容器操作
// ============================================

/** 启动容器 */
export function startContainer(api: ApiClient, id: string): Promise<{ message: string }> {
  return api.post<{ message: string }>(`/api/miniapps/${id}/start`, {});
}

/** 停止容器 */
export function stopContainer(api: ApiClient, id: string): Promise<{ message: string }> {
  return api.post<{ message: string }>(`/api/miniapps/${id}/stop`, {});
}

/** 重启容器 */
export function restartContainer(api: ApiClient, id: string): Promise<{ message: string }> {
  return api.post<{ message: string }>(`/api/miniapps/${id}/restart`, {});
}

/** 查看容器信息（仅创建者） */
export function getContainerInfo(api: ApiClient, id: string): Promise<MiniAppContainer> {
  return api.get<MiniAppContainer>(`/api/miniapps/${id}/container`);
}

/** 重置 SSH 密码（仅创建者） */
export function resetSSHPassword(api: ApiClient, id: string): Promise<{ new_password: string }> {
  return api.post<{ new_password: string }>(`/api/miniapps/${id}/reset-password`, {});
}

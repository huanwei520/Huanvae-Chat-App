/**
 * 文件存储 API 封装
 */

import type { ApiClient } from './client';

/** 文件信息 */
export interface FileItem {
  file_uuid: string;
  filename: string;
  file_size: number;
  content_type: string;
  preview_support: 'inline_preview' | 'download_only';
  created_at: string;
  file_url: string;
  /** 文件哈希（用于本地缓存） */
  file_hash?: string;
}

/** 文件列表响应 */
export interface FilesResponse {
  files: FileItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  has_more: boolean;
}

/** 文件列表查询参数 */
export interface FilesQueryParams {
  page?: number;
  limit?: number;
  sort_by?: 'created_at' | 'file_size';
  sort_order?: 'asc' | 'desc';
}

/** 预签名 URL 响应 */
export interface PresignedUrlResponse {
  presigned_url: string;
  expires_at: string;
  file_uuid: string;
  file_size: number;
  content_type: string;
  warning: string | null;
}

/**
 * 获取用户文件列表
 */
export function getFiles(
  api: ApiClient,
  params: FilesQueryParams = {},
): Promise<FilesResponse> {
  const searchParams = new URLSearchParams();
  if (params.page) { searchParams.set('page', params.page.toString()); }
  if (params.limit) { searchParams.set('limit', params.limit.toString()); }
  if (params.sort_by) { searchParams.set('sort_by', params.sort_by); }
  if (params.sort_order) { searchParams.set('sort_order', params.sort_order); }

  const query = searchParams.toString();
  const url = query ? `/api/storage/files?${query}` : '/api/storage/files';

  return api.get<FilesResponse>(url);
}

/**
 * 获取文件预签名 URL
 */
export function getPresignedUrl(
  api: ApiClient,
  fileUuid: string,
  operation: 'download' | 'preview' = 'preview',
): Promise<PresignedUrlResponse> {
  return api.post<PresignedUrlResponse>(
    `/api/storage/file/${fileUuid}/presigned_url`,
    { operation },
  );
}

/**
 * 获取文件类型分类
 */
export function getFileCategory(contentType: string): 'image' | 'video' | 'file' {
  if (contentType.startsWith('image/')) { return 'image'; }
  if (contentType.startsWith('video/')) { return 'video'; }
  return 'file';
}

/**
 * 软删除个人文件（后端 DELETE /api/storage/file/{uuid}）
 *
 * 后端行为（参见 backend-docs/storage 7.5）：
 * - 文件从 GET /api/storage/files 列表移除
 * - 预签名 URL 请求被拒绝
 * - MinIO 物理文件保留（revoked_at 软删除）
 * - 仅限自己上传的 user_files；他人文件返回 404
 */
export function deleteFile(api: ApiClient, fileUuid: string): Promise<void> {
  return api.delete<void>(`/api/storage/file/${fileUuid}`);
}

/**
 * 运维任务（Ops）API 封装
 *
 * 使用 SessionContext 提供的 API 客户端
 * createApiClient 已自动解包 ApiResponse.data，类型均为解包后的扁平结构
 *
 * 覆盖端点：
 * - GET /api/ops/tasks               任务列表（时间游标分页）
 * - GET /api/ops/tasks/{task_id}     任务详情（task + workers）
 * - GET /api/ops/tasks/{task_id}/events  事件增量拉取
 *
 * 权限语义：
 * - 平台 JWT 认证，仅 ops-bot 的 owner 可见自己的任务；
 * - 非 owner：列表恒为空；详情返回 404（与任务不存在同形，不泄露存在性）。
 *
 * 数据模型：
 * - task 1→N worker，worker/task 1→N event；
 * - event_id 全局单调递增，可直接作增量拉取游标（after_id）；
 * - 事件按 7 天滚动清理，历史事件不保证可回溯。
 */

import type { ApiClient } from './client';

// ============================================
// 类型定义
// ============================================

/** 任务 / worker 状态 */
export type OpsStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** 运维任务信息 */
export interface OpsTaskInfo {
  task_id: string;
  /** 所属 ops-bot 的 bot_user_id */
  bot_user_id: string;
  title: string;
  status: OpsStatus;
  /** 任务级进度摘要（服务端维护的最新一句话描述） */
  summary: string;
  /** ISO 8601 */
  created_at: string;
  updated_at: string;
}

/** 任务下的 worker 信息 */
export interface OpsWorkerInfo {
  task_id: string;
  worker_id: string;
  /** worker 所属层级标识 */
  layer: string;
  title: string;
  status: OpsStatus;
  /** worker 级进度详情 */
  detail: string;
  /** ISO 8601 */
  created_at: string;
  updated_at: string;
}

/** 任务事件（进度流水，event_id 单调递增可作增量游标） */
export interface OpsEventInfo {
  event_id: number;
  task_id: string;
  /** 任务级事件为 null */
  worker_id: string | null;
  event_type: string;
  payload: unknown;
  /** ISO 8601 */
  created_at: string;
}

/** GET /api/ops/tasks 响应 */
export interface OpsTasksResponse {
  tasks: OpsTaskInfo[];
}

/** GET /api/ops/tasks/{task_id} 响应 */
export interface OpsTaskDetailResponse {
  task: OpsTaskInfo;
  workers: OpsWorkerInfo[];
}

/** GET /api/ops/tasks/{task_id}/events 响应 */
export interface OpsEventsResponse {
  events: OpsEventInfo[];
}

// ============================================
// 任务查询
// ============================================

/** 列出自己 ops-bot 的任务（limit 1-100 由后端钳制；before 为 RFC3339 时间游标） */
export function getOpsTasks(
  api: ApiClient,
  opts?: { limit?: number; before?: string },
): Promise<OpsTasksResponse> {
  const query = new URLSearchParams();
  if (opts?.limit !== undefined) { query.set('limit', String(opts.limit)); }
  if (opts?.before) { query.set('before', opts.before); }
  const qs = query.toString();
  return api.get<OpsTasksResponse>(`/api/ops/tasks${qs ? `?${qs}` : ''}`);
}

/** 获取任务详情（task + 全部 workers；非 owner / 不存在均 404） */
export function getOpsTask(
  api: ApiClient,
  taskId: string,
): Promise<OpsTaskDetailResponse> {
  return api.get<OpsTaskDetailResponse>(`/api/ops/tasks/${encodeURIComponent(taskId)}`);
}

/** 拉取任务事件（after_id 为 event_id 增量游标；可按 worker_id 过滤） */
export function getOpsTaskEvents(
  api: ApiClient,
  taskId: string,
  opts?: { afterId?: number; workerId?: string; limit?: number },
): Promise<OpsEventsResponse> {
  const query = new URLSearchParams();
  if (opts?.afterId !== undefined) { query.set('after_id', String(opts.afterId)); }
  if (opts?.workerId) { query.set('worker_id', opts.workerId); }
  if (opts?.limit !== undefined) { query.set('limit', String(opts.limit)); }
  const qs = query.toString();
  return api.get<OpsEventsResponse>(
    `/api/ops/tasks/${encodeURIComponent(taskId)}/events${qs ? `?${qs}` : ''}`,
  );
}

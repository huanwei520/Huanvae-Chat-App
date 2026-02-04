/* eslint-disable require-await */
/**
 * 版本管理服务
 *
 * 提供流程版本历史查询和版本回滚功能
 * 流程更新时自动保存历史版本
 *
 * @module lowcode/services/versionService
 */

import type { WorkflowVersion } from '../types/lowcode';
import type { LowcodeApiClient } from './apiClient';

// ============================================================================
// 类型定义
// ============================================================================

/** 版本列表响应 */
export interface VersionListResponse {
  /** 流程 ID */
  workflow_id: string;
  /** 版本列表 */
  versions: WorkflowVersion[];
  /** 总数 */
  total: number;
}

/** 回滚响应 */
export interface RollbackResponse {
  /** 是否成功 */
  success: boolean;
  /** 消息 */
  message: string;
}

// ============================================================================
// 服务工厂
// ============================================================================

/**
 * 创建版本服务（使用 API 客户端，支持自动 Token 刷新）
 *
 * @param client - API 客户端实例
 * @returns 版本服务方法
 */
export function createVersionService(client: LowcodeApiClient) {
  return {
    /**
     * 获取流程的版本列表
     */
    async getVersions(workflowId: string): Promise<VersionListResponse> {
      return client.get<VersionListResponse>(
        `/api/lowcode/workflows/${workflowId}/versions`,
      );
    },

    /**
     * 获取特定版本的详情
     */
    async getVersion(
      workflowId: string,
      version: number,
    ): Promise<WorkflowVersion> {
      return client.get<WorkflowVersion>(
        `/api/lowcode/workflows/${workflowId}/versions/${version}`,
      );
    },

    /**
     * 回滚到指定版本
     *
     * 将流程恢复到指定版本的内容，同时版本号会增加
     */
    async rollback(workflowId: string, version: number): Promise<RollbackResponse> {
      return client.post<RollbackResponse>(
        `/api/lowcode/workflows/${workflowId}/rollback/${version}`,
      );
    },
  };
}

/** 版本服务类型 */
export type VersionService = ReturnType<typeof createVersionService>;

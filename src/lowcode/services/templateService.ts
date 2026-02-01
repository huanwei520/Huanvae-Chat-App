/**
 * 流程模板服务
 *
 * 提供流程模板的查询和基于模板创建流程功能
 * 管理员可以创建、更新、删除模板
 *
 * @module lowcode/services/templateService
 */

import type {
  Workflow,
  WorkflowTemplate,
  CreateTemplateParams,
  UpdateTemplateParams,
} from '../types/lowcode';
import type { LowcodeApiClient } from './apiClient';

// ============================================================================
// 类型定义
// ============================================================================

/** 模板列表响应 */
export interface TemplateListResponse {
  /** 模板列表 */
  templates: WorkflowTemplate[];
  /** 总数 */
  total: number;
}

/** 基于模板创建流程参数 */
export interface CreateFromTemplateParams {
  /** 新流程名称 */
  name: string;
  /** 新流程描述 */
  description?: string;
}

// ============================================================================
// 服务工厂
// ============================================================================

/**
 * 创建模板服务（使用 API 客户端，支持自动 Token 刷新）
 *
 * @param client - API 客户端实例
 * @returns 模板服务方法
 */
export function createTemplateService(client: LowcodeApiClient) {
  return {
    /**
     * 获取模板列表
     */
    async getTemplates(): Promise<TemplateListResponse> {
      return client.get<TemplateListResponse>('/api/lowcode/templates');
    },

    /**
     * 获取模板详情
     */
    async getTemplate(templateId: string): Promise<WorkflowTemplate> {
      return client.get<WorkflowTemplate>(
        `/api/lowcode/templates/${templateId}`,
      );
    },

    /**
     * 基于模板创建流程
     */
    async createFromTemplate(
      templateId: string,
      params: CreateFromTemplateParams,
    ): Promise<Workflow> {
      return client.post<Workflow>(
        `/api/lowcode/templates/${templateId}/create_workflow`,
        params,
      );
    },

    /**
     * 创建模板（管理员）
     */
    async createTemplate(params: CreateTemplateParams): Promise<WorkflowTemplate> {
      return client.post<WorkflowTemplate>('/api/lowcode/templates', params);
    },

    /**
     * 更新模板（管理员）
     */
    async updateTemplate(
      templateId: string,
      params: UpdateTemplateParams,
    ): Promise<WorkflowTemplate> {
      return client.put<WorkflowTemplate>(
        `/api/lowcode/templates/${templateId}`,
        params,
      );
    },

    /**
     * 删除模板（管理员）
     */
    async deleteTemplate(templateId: string): Promise<void> {
      await client.delete(`/api/lowcode/templates/${templateId}`);
    },
  };
}

/** 模板服务类型 */
export type TemplateService = ReturnType<typeof createTemplateService>;

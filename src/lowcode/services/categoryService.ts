/**
 * 分类配置服务
 *
 * 提供算子分类配置的 CRUD 操作和导入导出功能
 * 支持使用 API 客户端（带自动 Token 刷新）
 *
 * @module lowcode/services/categoryService
 */

import type {
  CategoryConfig,
  CategoryValidationResult,
  ExportedCategoryConfig,
} from '../types/lowcode';
import type { LowcodeApiClient } from './apiClient';

// ============================================================================
// 类型定义
// ============================================================================

/** 保存分类配置参数 */
export interface SaveCategoryConfigParams {
  /** 分类列表 */
  categories: CategoryConfig['categories'];
  /** 未分类的算子 ID 列表 */
  uncategorized: string[];
}

/** 导入分类配置参数 */
export interface ImportCategoryConfigParams {
  /** 配置内容 */
  config: {
    categories: CategoryConfig['categories'];
    uncategorized: string[];
  };
  /** 是否合并现有配置（true=合并，false=覆盖） */
  merge: boolean;
}

/** 导入分类配置响应 */
export interface ImportCategoryConfigResponse {
  /** 导入后的配置 */
  config: CategoryConfig;
  /** 是否执行了合并 */
  merged: boolean;
  /** 导入时间 */
  imported_at: string;
}

// ============================================================================
// 服务工厂
// ============================================================================

/**
 * 创建分类配置服务（使用 API 客户端，支持自动 Token 刷新）
 *
 * @param client - API 客户端实例
 * @returns 分类配置服务方法
 */
export function createCategoryService(client: LowcodeApiClient) {
  return {
    /**
     * 保存分类配置
     */
    async saveConfig(params: SaveCategoryConfigParams): Promise<CategoryConfig> {
      return client.post<CategoryConfig>('/api/lowcode/category_config', params);
    },

    /**
     * 获取分类配置
     */
    async getConfig(): Promise<CategoryConfig> {
      return client.get<CategoryConfig>('/api/lowcode/category_config');
    },

    /**
     * 删除分类配置
     */
    async deleteConfig(): Promise<void> {
      await client.delete('/api/lowcode/category_config');
    },

    /**
     * 验证分类配置
     */
    async validateConfig(
      params: SaveCategoryConfigParams,
    ): Promise<CategoryValidationResult> {
      return client.post<CategoryValidationResult>(
        '/api/lowcode/category_config/validate',
        params,
      );
    },

    /**
     * 获取可分类的算子 ID 列表
     */
    async getOperators(): Promise<string[]> {
      return client.get<string[]>('/api/lowcode/category_config/operators');
    },

    /**
     * 导出分类配置
     */
    async exportConfig(): Promise<ExportedCategoryConfig> {
      return client.get<ExportedCategoryConfig>(
        '/api/lowcode/category_config/export',
      );
    },

    /**
     * 导入分类配置
     */
    async importConfig(
      params: ImportCategoryConfigParams,
    ): Promise<ImportCategoryConfigResponse> {
      return client.post<ImportCategoryConfigResponse>(
        '/api/lowcode/category_config/import',
        params,
      );
    },
  };
}

/** 分类配置服务类型 */
export type CategoryService = ReturnType<typeof createCategoryService>;

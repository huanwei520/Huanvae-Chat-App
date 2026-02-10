/**
 * 动态算子管理服务
 *
 * 提供 S-expression 动态算子的上传、查询、更新、删除功能，
 * 以及上传 S-expression 并自动生成完整可执行工作流的功能。
 * 动态算子允许通过 HTTP API 上传 S-expression 数学公式，
 * 实时注册为可执行算子，无需重启服务或重新编译。
 *
 * @module lowcode/services/dynamicOperatorService
 * @created 2026-02-07
 */

import type { LowcodeApiClient } from './apiClient';
import type {
  DynamicOperatorSourcesResponse,
  UploadOperatorsResponse,
  UploadWorkflowResponse,
  UpdateOperatorResponse,
  DeleteOperatorResponse,
} from '../types/lowcode';

// ============================================================================
// 服务工厂
// ============================================================================

/**
 * 创建动态算子管理服务
 *
 * @param client - API 客户端实例
 * @returns 动态算子管理服务方法集
 */
export function createDynamicOperatorService(client: LowcodeApiClient) {
  return {
    /**
     * 上传 S-expression 源文件，注册动态算子
     *
     * @param sexprSource - S-expression 源代码
     * @returns 上传结果（注册的算子列表、数量、守恒律警告）
     */
    upload(sexprSource: string): Promise<UploadOperatorsResponse> {
      return client.post<UploadOperatorsResponse>(
        '/api/lowcode/operators/upload',
        { sexpr_source: sexprSource },
      );
    },

    /**
     * 上传 S-expression 源文件并自动生成完整可执行工作流
     *
     * 与 upload 不同，此方法会根据 @edge、@workflow_input、@workflow_output 等注解
     * 自动生成包含节点、边、输入输出映射的工作流定义。
     *
     * @param params - 包含工作流名称、描述和 S-expression 源代码
     * @returns 上传结果（注册的算子列表 + 生成的工作流信息）
     */
    uploadWorkflow(params: {
      name: string;
      description?: string;
      sexpr_source: string;
    }): Promise<UploadWorkflowResponse> {
      return client.post<UploadWorkflowResponse>(
        '/api/lowcode/operators/upload_workflow',
        params,
      );
    },

    /**
     * 查询动态算子源列表
     *
     * @returns 动态算子源列表及总数
     */
    getSources(): Promise<DynamicOperatorSourcesResponse> {
      return client.get<DynamicOperatorSourcesResponse>(
        '/api/lowcode/operators/sources',
      );
    },

    /**
     * 更新指定动态算子的 S-expression 源
     *
     * @param operatorId - 算子 ID（如 custom.math.quadratic）
     * @param sexprSource - 新的 S-expression 源代码
     * @returns 更新结果（新版本号）
     */
    update(operatorId: string, sexprSource: string): Promise<UpdateOperatorResponse> {
      return client.put<UpdateOperatorResponse>(
        `/api/lowcode/operators/dynamic/${encodeURIComponent(operatorId)}`,
        { sexpr_source: sexprSource },
      );
    },

    /**
     * 删除指定动态算子
     *
     * @param operatorId - 算子 ID
     * @returns 删除结果
     */
    remove(operatorId: string): Promise<DeleteOperatorResponse> {
      return client.delete<DeleteOperatorResponse>(
        `/api/lowcode/operators/dynamic/${encodeURIComponent(operatorId)}`,
      );
    },
  };
}

/** 动态算子管理服务类型 */
export type DynamicOperatorService = ReturnType<typeof createDynamicOperatorService>;

/* eslint-disable require-await */
/**
 * 流程服务
 *
 * 提供流程的 CRUD 操作和执行功能
 * 支持使用 API 客户端（带自动 Token 刷新）
 *
 * @module lowcode/services/workflowService
 */

import type {
  Workflow,
  WorkflowDefinition,
  ExecutionResult,
  InputHistoryResponse,
  BatchExecuteParams,
  BatchExecutionResult,
  WorkflowConfig,
  ConfigValidationResult,
} from '../types/lowcode';
import type { LowcodeApiClient } from './apiClient';

// ============================================================================
// 类型定义
// ============================================================================

/** 流程列表响应 */
interface WorkflowListResponse {
  workflows: Workflow[];
  total: number;
  page: number;
  page_size: number;
}

/** 验证结果 */
export interface ValidationResult {
  is_valid: boolean;
  errors: string[];
  warnings: string[];
  execution_order?: string[];
  missing_operators?: string[];
}

/** 创建流程参数 */
export interface CreateWorkflowParams {
  name: string;
  description?: string;
  definition: WorkflowDefinition;
}

/** 更新流程参数 */
export interface UpdateWorkflowParams {
  name?: string;
  description?: string;
  definition?: WorkflowDefinition;
}

/** 执行流程参数 */
export interface ExecuteWorkflowParams {
  workflow_id: string;
  inputs: Record<string, unknown>;
  options?: {
    trace?: boolean;
    timeout_ms?: number;
  };
}

/** 直接执行配置参数 */
export interface ExecuteConfigParams {
  config: {
    name: string;
    description?: string;
    definition: WorkflowDefinition;
  };
  inputs: Record<string, unknown>;
  options?: {
    trace?: boolean;
    timeout_ms?: number;
  };
}

/** 导出的流程配置 */
export interface ExportedWorkflow {
  config: {
    version: string;
    name: string;
    description?: string;
    created_at: string;
    definition: WorkflowDefinition;
  };
}

/** 导入配置结果 */
export interface ImportConfigResult {
  /** 导入的流程 */
  workflow: Workflow;
  /** 是否为新创建（false 表示更新了已有流程） */
  created: boolean;
}

// ============================================================================
// 使用 API 客户端的服务工厂
// ============================================================================

/**
 * 创建流程服务（使用 API 客户端，支持自动 Token 刷新）
 *
 * @param client - API 客户端实例
 * @returns 流程服务方法
 */
export function createWorkflowService(client: LowcodeApiClient) {
  return {
    /**
     * 创建流程
     */
    async createWorkflow(params: CreateWorkflowParams): Promise<Workflow> {
      return client.post<Workflow>('/api/lowcode/workflows', params);
    },

    /**
     * 获取流程列表
     */
    async getWorkflows(
      page: number = 1,
      pageSize: number = 20,
    ): Promise<WorkflowListResponse> {
      return client.get<WorkflowListResponse>(
        `/api/lowcode/workflows?page=${page}&page_size=${pageSize}`,
      );
    },

    /**
     * 获取流程详情
     */
    async getWorkflow(workflowId: string): Promise<Workflow> {
      return client.get<Workflow>(`/api/lowcode/workflows/${workflowId}`);
    },

    /**
     * 更新流程
     */
    async updateWorkflow(
      workflowId: string,
      params: UpdateWorkflowParams,
    ): Promise<Workflow> {
      return client.put<Workflow>(
        `/api/lowcode/workflows/${workflowId}`,
        params,
      );
    },

    /**
     * 删除流程
     */
    async deleteWorkflow(workflowId: string): Promise<void> {
      await client.delete(`/api/lowcode/workflows/${workflowId}`);
    },

    /**
     * 验证已保存的流程
     */
    async validateWorkflow(workflowId: string): Promise<ValidationResult> {
      return client.post<ValidationResult>(
        `/api/lowcode/workflows/${workflowId}/validate`,
      );
    },

    /**
     * 验证流程定义（不保存）
     */
    async validateDefinition(
      definition: WorkflowDefinition,
    ): Promise<ValidationResult> {
      return client.post<ValidationResult>('/api/lowcode/workflows/validate', {
        definition,
      });
    },

    /**
     * 导出流程配置
     */
    async exportWorkflow(workflowId: string): Promise<ExportedWorkflow> {
      return client.get<ExportedWorkflow>(
        `/api/lowcode/workflows/${workflowId}/export`,
      );
    },

    /**
     * 执行已保存的流程
     */
    async executeWorkflow(
      params: ExecuteWorkflowParams,
    ): Promise<ExecutionResult> {
      return client.post<ExecutionResult>('/api/lowcode/execute', params);
    },

    /**
     * 直接执行流程配置（不保存）
     */
    async executeConfig(params: ExecuteConfigParams): Promise<ExecutionResult> {
      return client.post<ExecutionResult>(
        '/api/lowcode/workflow_config/execute',
        params,
      );
    },

    /**
     * 查询执行结果
     */
    async getExecution(executionId: string): Promise<ExecutionResult> {
      return client.get<ExecutionResult>(
        `/api/lowcode/executions/${executionId}`,
      );
    },

    /**
     * 获取流程的输入参数历史
     */
    async getInputHistory(
      workflowId: string,
      limit: number = 10,
    ): Promise<InputHistoryResponse> {
      return client.get<InputHistoryResponse>(
        `/api/lowcode/workflows/${workflowId}/input_history?limit=${limit}`,
      );
    },

    /**
     * 批量执行流程
     */
    async executeBatch(params: BatchExecuteParams): Promise<BatchExecutionResult> {
      return client.post<BatchExecutionResult>(
        '/api/lowcode/execute_batch',
        params,
      );
    },

    /**
     * 验证流程配置文件
     */
    async validateConfig(config: WorkflowConfig): Promise<ConfigValidationResult> {
      return client.post<ConfigValidationResult>(
        '/api/lowcode/workflow_config/validate',
        { config },
      );
    },

    /**
     * 导入流程配置文件
     */
    async importConfig(
      config: WorkflowConfig,
      overwrite: boolean = false,
    ): Promise<ImportConfigResult> {
      const result = await client.post<{ workflow: Workflow; created?: boolean }>('/api/lowcode/workflow_config/import', {
        config,
        overwrite,
      });
      return {
        workflow: result.workflow || result as unknown as Workflow,
        created: result.created ?? true,
      };
    },
  };
}

/** 流程服务类型 */
export type WorkflowService = ReturnType<typeof createWorkflowService>;

// ============================================================================
// 兼容旧 API 的独立函数（不推荐使用，无自动 Token 刷新）
// ============================================================================

/**
 * 构建请求头
 * @deprecated 请使用 createWorkflowService 代替
 */
function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * 处理 API 响应
 * @deprecated 请使用 createWorkflowService 代替
 */
async function handleResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok) {
    const error = data.error || data.message || `请求失败: ${response.status}`;
    throw new Error(error);
  }

  if (data.success === false) {
    throw new Error(data.error || data.message || '操作失败');
  }

  return data.data;
}

/**
 * 创建流程
 * @deprecated 请使用 createWorkflowService 代替
 */
export async function createWorkflow(
  serverUrl: string,
  token: string,
  params: CreateWorkflowParams,
): Promise<Workflow> {
  const url = `${serverUrl}/api/lowcode/workflows`;

  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(params),
  });

  return handleResponse<Workflow>(response);
}

/**
 * 获取流程列表
 * @deprecated 请使用 createWorkflowService 代替
 */
export async function getWorkflows(
  serverUrl: string,
  token: string,
  page: number = 1,
  pageSize: number = 20,
): Promise<WorkflowListResponse> {
  const url = `${serverUrl}/api/lowcode/workflows?page=${page}&page_size=${pageSize}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(token),
  });

  return handleResponse<WorkflowListResponse>(response);
}

/**
 * 获取流程详情
 * @deprecated 请使用 createWorkflowService 代替
 */
export async function getWorkflow(
  serverUrl: string,
  token: string,
  workflowId: string,
): Promise<Workflow> {
  const url = `${serverUrl}/api/lowcode/workflows/${workflowId}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(token),
  });

  return handleResponse<Workflow>(response);
}

/**
 * 更新流程
 * @deprecated 请使用 createWorkflowService 代替
 */
export async function updateWorkflow(
  serverUrl: string,
  token: string,
  workflowId: string,
  params: UpdateWorkflowParams,
): Promise<Workflow> {
  const url = `${serverUrl}/api/lowcode/workflows/${workflowId}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: buildHeaders(token),
    body: JSON.stringify(params),
  });

  return handleResponse<Workflow>(response);
}

/**
 * 删除流程
 * @deprecated 请使用 createWorkflowService 代替
 */
export async function deleteWorkflow(
  serverUrl: string,
  token: string,
  workflowId: string,
): Promise<void> {
  const url = `${serverUrl}/api/lowcode/workflows/${workflowId}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: buildHeaders(token),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || data.message || `删除失败: ${response.status}`);
  }
}

/**
 * 验证已保存的流程
 * @deprecated 请使用 createWorkflowService 代替
 */
export async function validateWorkflow(
  serverUrl: string,
  token: string,
  workflowId: string,
): Promise<ValidationResult> {
  const url = `${serverUrl}/api/lowcode/workflows/${workflowId}/validate`;

  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token),
  });

  return handleResponse<ValidationResult>(response);
}

/**
 * 验证流程定义（不保存）
 * @deprecated 请使用 createWorkflowService 代替
 */
export async function validateDefinition(
  serverUrl: string,
  token: string,
  definition: WorkflowDefinition,
): Promise<ValidationResult> {
  const url = `${serverUrl}/api/lowcode/workflows/validate`;

  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify({ definition }),
  });

  return handleResponse<ValidationResult>(response);
}

/**
 * 导出流程配置
 * @deprecated 请使用 createWorkflowService 代替
 */
export async function exportWorkflow(
  serverUrl: string,
  token: string,
  workflowId: string,
): Promise<ExportedWorkflow> {
  const url = `${serverUrl}/api/lowcode/workflows/${workflowId}/export`;

  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(token),
  });

  return handleResponse<ExportedWorkflow>(response);
}

/**
 * 执行已保存的流程
 * @deprecated 请使用 createWorkflowService 代替
 */
export async function executeWorkflow(
  serverUrl: string,
  token: string,
  params: ExecuteWorkflowParams,
): Promise<ExecutionResult> {
  const url = `${serverUrl}/api/lowcode/execute`;

  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(params),
  });

  return handleResponse<ExecutionResult>(response);
}

/**
 * 直接执行流程配置（不保存）
 * @deprecated 请使用 createWorkflowService 代替
 */
export async function executeConfig(
  serverUrl: string,
  token: string,
  params: ExecuteConfigParams,
): Promise<ExecutionResult> {
  const url = `${serverUrl}/api/lowcode/workflow_config/execute`;

  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(params),
  });

  return handleResponse<ExecutionResult>(response);
}

/**
 * 查询执行结果
 * @deprecated 请使用 createWorkflowService 代替
 */
export async function getExecution(
  serverUrl: string,
  token: string,
  executionId: string,
): Promise<ExecutionResult> {
  const url = `${serverUrl}/api/lowcode/executions/${executionId}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(token),
  });

  return handleResponse<ExecutionResult>(response);
}

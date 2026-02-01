/**
 * 算子服务
 *
 * 从后端 API 获取算子列表和详情
 *
 * @module lowcode/services/operatorService
 */

import type { Operator } from '../types/lowcode';

// ============================================================================
// API 响应类型
// ============================================================================

interface ApiResponse<T> {
  success: boolean;
  code?: number;
  data: T;
  message?: string;
}

interface OperatorsResponse {
  operators: Operator[];
  total: number;
  categories: string[];
}

// ============================================================================
// 服务函数
// ============================================================================

/**
 * 获取算子列表
 *
 * @param serverUrl - 服务器地址
 * @returns 算子列表和分类
 */
export async function fetchOperators(serverUrl: string): Promise<{
  operators: Operator[];
  categories: string[];
}> {
  const url = `${serverUrl}/api/lowcode/operators`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`获取算子列表失败: ${response.status}`);
  }

  const result: ApiResponse<OperatorsResponse> = await response.json();

  if (!result.success) {
    throw new Error(result.message || '获取算子列表失败');
  }

  return {
    operators: result.data.operators,
    categories: result.data.categories || [],
  };
}

/**
 * 获取算子详情
 *
 * @param serverUrl - 服务器地址
 * @param operatorId - 算子 ID
 * @returns 算子详情
 */
export async function fetchOperatorDetail(
  serverUrl: string,
  operatorId: string,
): Promise<Operator> {
  const url = `${serverUrl}/api/lowcode/operators/${encodeURIComponent(operatorId)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`获取算子详情失败: ${response.status}`);
  }

  const result: ApiResponse<Operator> = await response.json();

  if (!result.success) {
    throw new Error(result.message || '获取算子详情失败');
  }

  return result.data;
}

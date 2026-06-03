/**
 * 算子服务
 *
 * 从后端 API 获取算子列表。
 *
 * webview 原生 fetch 验不过私有 CA 自签 leaf 且连逻辑域名会触发 ICP/SNI 拦截,故经回环安全反代
 * (http://127.0.0.1:<port>)转发到源站 IP(钉内置 CA、不发 SNI、Host=逻辑域名)。
 *
 * @module lowcode/services/operatorService
 */

import { proxyRequestUrl } from '../../services/secureProxy';
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
  const url = proxyRequestUrl(`${serverUrl}/api/lowcode/operators`);

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

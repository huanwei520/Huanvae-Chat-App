/**
 * 故障上报 API（POST /api/fault-reports）
 *
 * 正式路径：鉴权复用既有 ApiClient（自动带 Bearer 与 401 刷新）；请求体 = 已加密信封，
 * 不含任何明文日志。服务器响应为 ApiResponse 包裹（{success,code,data:{ticket_id}}），
 * createApiClient 已解包 ApiResponse.data，本模块直接拿到 {ticket_id}。
 *
 * 联调路径（FAULT_REPORT_DEBUG_ENDPOINT 非 null，仅联调专用构建注入）：
 * 走 WebView 原生 fetch 直连本地服务器块实例（adb reverse 回环），Bearer 用联调专用令牌
 * （FAULT_REPORT_DEBUG_TOKEN）。生产构建两值为 null，该分支为死代码被摇树。
 *
 * @module api/faultReport
 */

import type { ApiClient } from './client';
import type { FaultEnvelope } from '../services/faultReport/crypto';
import { FAULT_REPORT_ENDPOINT, FAULT_REPORT_DEBUG_ENDPOINT, FAULT_REPORT_DEBUG_TOKEN } from '../services/faultReport/config';

/** 服务器返回（正式路径由 createApiClient 解包 ApiResponse.data） */
export interface FaultReportSubmitResponse {
  /** 工单号 FR-<yyyymmdd>-<12hex>（后台可按机器码/版本/时间索引） */
  ticket_id: string;
  /** 服务器接收时间（可选回传） */
  received_at?: string;
}

/** 提交加密故障报告信封（自动选择正式/联调路径）。成功返回工单号。 */
export function submitFaultReport(
  api: ApiClient,
  envelope: FaultEnvelope,
): Promise<FaultReportSubmitResponse> {
  if (FAULT_REPORT_DEBUG_ENDPOINT) {
    return submitViaDebugEndpoint(envelope);
  }
  return api.post<FaultReportSubmitResponse>(FAULT_REPORT_ENDPOINT, envelope as unknown as Record<string, unknown>);
}

/** 联调专用：WebView fetch 直连本地实例（明文回环，仅联调构建可达此分支） */
async function submitViaDebugEndpoint(envelope: FaultEnvelope): Promise<FaultReportSubmitResponse> {
  const endpoint = FAULT_REPORT_DEBUG_ENDPOINT as string;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (FAULT_REPORT_DEBUG_TOKEN) {
    headers['Authorization'] = `Bearer ${FAULT_REPORT_DEBUG_TOKEN}`;
  }
  const resp = await fetch(`${endpoint}/api/fault-reports`, {
    method: 'POST',
    headers,
    body: JSON.stringify(envelope),
  });
  const body = (await resp.json().catch(() => ({}))) as {
    success?: boolean;
    data?: FaultReportSubmitResponse;
    error?: string;
    message?: string;
  };
  if (!resp.ok || !body.success || !body.data) {
    throw new Error(body.error || body.message || `fault-report 提交失败：HTTP ${resp.status}`);
  }
  return body.data;
}
